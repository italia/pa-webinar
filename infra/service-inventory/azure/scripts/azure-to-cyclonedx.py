#!/usr/bin/env python3
"""Reference generator: Azure Resource Graph -> CycloneDX 1.6 services[].

Produces the OPS half of a service-inventory document for a single resource
group on a single subscription. The DEV half (components[]) and PA-specific
declarations[] are appended separately (see docs/SERVICE-INVENTORY-GENERATION.md).

Outputs a JSON file with two top-level keys:
  - services: list of CycloneDX 1.6 service objects ready to merge
  - properties: tenant-level properties (region, subscription, ...)

Requirements:
  - `az` CLI authenticated (managed identity in CronJob, or `az login` locally)
  - Role 'Reader' on the target subscription or resource group

Usage:
  azure-to-cyclonedx.py --subscription <sub-id> --resource-group <rg> \
                        --tenant <tenant-name> \
                        --output /data/services.json
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import sys
from typing import Any


# Azure resource types we surface in the inventory. Any resource whose 'type'
# starts with one of these prefixes is turned into a services[] entry. Order
# matters: the first matching mapper wins.
TYPE_MAPPERS: list[tuple[str, str, str]] = [
    # azure type prefix, service display name, layer for eventi-dtd:layer
    ("microsoft.containerservice/managedclusters",  "Azure Kubernetes Service",                  "platform"),
    ("microsoft.dbforpostgresql/flexibleservers",   "Azure Database for PostgreSQL Flexible",    "data"),
    ("microsoft.dbformysql/flexibleservers",        "Azure Database for MySQL Flexible",         "data"),
    ("microsoft.storage/storageaccounts",           "Azure Storage Account",                     "data"),
    ("microsoft.keyvault/vaults",                   "Azure Key Vault",                           "platform"),
    ("microsoft.cache/redis",                       "Azure Cache for Redis",                     "data"),
    ("microsoft.network/dnszones",                  "Azure DNS Zone",                            "access"),
    ("microsoft.network/privatednszones",           "Azure Private DNS Zone",                    "access"),
    ("microsoft.network/publicipaddresses",         "Azure Public IP",                           "access"),
    ("microsoft.network/applicationgateways",       "Azure Application Gateway",                 "access"),
    ("microsoft.network/loadbalancers",             "Azure Load Balancer",                       "access"),
    ("microsoft.operationalinsights/workspaces",    "Azure Log Analytics Workspace",             "platform"),
    ("microsoft.insights/components",               "Azure Application Insights",                "platform"),
    ("microsoft.containerregistry/registries",      "Azure Container Registry",                  "platform"),
    ("microsoft.servicebus/namespaces",             "Azure Service Bus",                         "app"),
    ("microsoft.eventhub/namespaces",               "Azure Event Hubs",                          "app"),
]


def run_az(args: list[str]) -> Any:
    """Invoke `az` CLI and return parsed JSON stdout."""
    res = subprocess.run(["az", *args, "-o", "json"], capture_output=True, text=True)
    if res.returncode != 0:
        print(f"az failed: {' '.join(args)}\n{res.stderr}", file=sys.stderr)
        sys.exit(2)
    return json.loads(res.stdout) if res.stdout.strip() else None


def query_resources(subscription: str, resource_group: str) -> list[dict[str, Any]]:
    query = f"""
        Resources
        | where subscriptionId == '{subscription}'
        | where resourceGroup == '{resource_group.lower()}'
        | project name, type, location, kind, sku, properties, tags, id
    """
    # Resource Graph returns paginated results under `data`. --first 1000 caps
    # per-page size; we iterate with `--skip-token` for larger tenants.
    all_rows: list[dict[str, Any]] = []
    skip_token: str | None = None
    while True:
        args = ["graph", "query", "-q", query, "--first", "1000"]
        if skip_token:
            args += ["--skip-token", skip_token]
        payload = run_az(args)
        all_rows.extend(payload.get("data") or [])
        skip_token = payload.get("skip_token") or payload.get("skipToken")
        if not skip_token:
            break
    return all_rows


def classify(azure_type: str) -> tuple[str, str] | None:
    """Return (display_name, layer) for a given Azure resource type, or None
    if we don't surface this type in the inventory."""
    t = azure_type.lower()
    for prefix, display, layer in TYPE_MAPPERS:
        if t == prefix or t.startswith(prefix + "/"):
            return display, layer
    return None


def to_service(r: dict[str, Any], tenant: str) -> dict[str, Any] | None:
    mapping = classify(r["type"])
    if mapping is None:
        return None
    display_name, layer = mapping

    # Build a stable, human-readable bom-ref from the ARM id.
    bom_ref = "svc:azure" + r["id"].lower()

    svc: dict[str, Any] = {
        "bom-ref": bom_ref,
        "name": display_name,
        "group": r["type"].split("/")[0],
        "provider": {
            "name": "Microsoft Corporation",
            "url": ["https://azure.microsoft.com"],
        },
        "description": f"{display_name} '{r['name']}' (risorsa ARM: {r['type']}).",
        "authenticated": True,
        "x-trust-boundary": True,
        "properties": [
            {"name": "azure:resource-type",   "value": r["type"]},
            {"name": "azure:resource-name",   "value": r["name"]},
            {"name": "azure:region",          "value": r.get("location", "unknown")},
            {"name": "azure:resource-id",     "value": r["id"]},
            {"name": "eventi-dtd:tenant",     "value": tenant},
            {"name": "eventi-dtd:layer",      "value": layer},
        ],
    }

    sku = r.get("sku") or {}
    if isinstance(sku, dict) and sku.get("name"):
        svc["properties"].append({"name": "azure:sku", "value": str(sku["name"])})

    # Resource-type-specific enrichment — extend as more types are mapped.
    t = r["type"].lower()
    props = r.get("properties") or {}
    if t.startswith("microsoft.containerservice/managedclusters"):
        kube_ver = props.get("kubernetesVersion")
        if kube_ver:
            svc["version"] = kube_ver
        fqdn = props.get("fqdn")
        if fqdn:
            svc["endpoints"] = [f"https://{fqdn}"]
    elif t.startswith("microsoft.dbforpostgresql/flexibleservers"):
        ver = props.get("version")
        if ver:
            svc["version"] = str(ver)
        fqdn = props.get("fullyQualifiedDomainName")
        if fqdn:
            svc["endpoints"] = [f"{fqdn}:5432"]
        svc["data"] = [
            {"classification": "personal-data", "flow": "bi-directional",
             "description": "Dati applicativi; classificare caso per caso."}
        ]
    elif t.startswith("microsoft.storage/storageaccounts"):
        prim = (props.get("primaryEndpoints") or {}).get("blob")
        if prim:
            svc["endpoints"] = [prim]

    return svc


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else "")
    ap.add_argument("--subscription", required=True, help="Azure subscription id")
    ap.add_argument("--resource-group", required=True, help="Resource group name")
    ap.add_argument("--tenant", required=True, help="Tenant identifier (e.g. videocall-prod)")
    ap.add_argument("--output", required=True, help="Path to write services JSON")
    args = ap.parse_args()

    resources = query_resources(args.subscription, args.resource_group)
    services: list[dict[str, Any]] = []
    skipped: list[str] = []
    for r in resources:
        svc = to_service(r, args.tenant)
        if svc is None:
            skipped.append(r["type"])
            continue
        services.append(svc)

    payload = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "tenant": args.tenant,
        "subscription": args.subscription,
        "resourceGroup": args.resource_group,
        "services": services,
        "properties": [
            {"name": "eventi-dtd:tenant",        "value": args.tenant},
            {"name": "eventi-dtd:cloud-provider","value": "Microsoft Azure"},
            {"name": "azure:subscription-id",    "value": args.subscription},
            {"name": "azure:resource-group",     "value": args.resource_group},
        ],
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"generated {len(services)} service entries → {args.output}", file=sys.stderr)
    if skipped:
        uniq = sorted(set(skipped))
        print(f"skipped {len(skipped)} resources of {len(uniq)} types not in TYPE_MAPPERS:",
              file=sys.stderr)
        for t in uniq:
            print(f"  - {t}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
