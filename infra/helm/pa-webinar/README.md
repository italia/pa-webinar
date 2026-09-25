# PA Webinar Helm chart

This chart installs [PA Webinar](https://github.com/italia/pa-webinar), the open-source webinar and virtual-event platform for Italian public administrations (PA). A release always contains the portal, a Next.js application whose pods apply database migrations in the `db-migrate` init container, and its scheduled jobs. Values control the rest: Jitsi Meet through the `jitsi-meet` subchart (web, Prosody, Jicofo, the videobridge, and optionally Jibri and coturn), PostgreSQL and Redis through Bitnami subcharts, the JVB scaler, the per-participant recorder and its controller, the AI post-production jobs, a NetworkPolicy and Prometheus Operator resources.

## Dependencies

The chart archive attached to each GitHub release already contains the subcharts. From a clone of the repository, fetch them first, because the archives are not committed. Use `build`, not `update`: `build` installs the versions pinned in `Chart.lock`, which are the ones CI validates.

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo add jitsi-contrib https://jitsi-contrib.github.io/jitsi-helm/
helm dependency build infra/helm/pa-webinar
```

## Values files

`values.yaml` holds the defaults. Do not edit it: layer your own file on top with `-f`.

| File | What it is for |
|---|---|
| `examples/values-simple.yaml` | Evaluation: everything in the cluster, Secrets rendered by the chart, one bridge, no recording. |
| `examples/values-standard.yaml` | External database, Secrets you create, one bridge and Jibri. |
| `examples/values-full.yaml` | Bridges and Jibri on a dedicated node pool that scales to zero, the JVB scaler, ServiceMonitors. Fix its [known issues](https://github.com/italia/pa-webinar/blob/main/docs/DEPLOYMENT.md#profiles-and-values-files) in your copy. |
| `examples/keda-jvb-scaler.yaml` | A KEDA ScaledObject sketch. It is [not a drop-in replacement](https://github.com/italia/pa-webinar/blob/main/docs/operations/jvb-scaler.md#keda) for the JVB scaler. |
| `values-production.yaml`, `values-prod.yaml`, `values-dev.yaml` | Examples only, not the configuration of any environment. `values-production.yaml` pins an outdated app image tag. |

## Install

Create the namespace and the [Secrets](https://github.com/italia/pa-webinar/blob/main/docs/DEPLOYMENT.md#secrets) first, then follow the [walkthrough for your profile](https://github.com/italia/pa-webinar/blob/main/docs/DEPLOYMENT.md#install-walkthroughs). The command has this shape; with a release archive, use `pa-webinar-X.Y.Z.tgz` as the chart:

```bash
helm upgrade --install pa-webinar ./infra/helm/pa-webinar -n pa-webinar \
  -f infra/helm/pa-webinar/examples/values-standard.yaml \
  -f pa-webinar.values.yaml \
  --set app.image.tag=X.Y.Z \
  --set app.migration.image.tag=vX.Y.Z-migrate \
  --wait --timeout 15m
```

Always pass both image tags, on every install and [upgrade](https://github.com/italia/pa-webinar/blob/main/docs/operations/upgrades.md). The app tag has no `v`. The migration tag `vX.Y.Z-migrate` exists for every release; the tag the chart derives when you leave it empty (`<app tag>-migrate`) does not.

## Validate

From the repository root, `./scripts/validate-chart.sh` lints the chart, renders it with every example profile, and checks the invariants that would otherwise fail only at install time. It needs Helm, OpenSSL, and Python 3 with PyYAML. Then let an API server check your own values. ServiceMonitor and PrometheusRule objects need the Prometheus Operator CRDs in that cluster.

```bash
helm template pa-webinar ./infra/helm/pa-webinar -n pa-webinar -f <profile> -f pa-webinar.values.yaml \
  | kubectl apply --dry-run=server -n pa-webinar -f -
```

## Documentation

- [Deploying with Helm](https://github.com/italia/pa-webinar/blob/main/docs/DEPLOYMENT.md): what the chart renders, prerequisites, Secrets, install walkthroughs and first-run checks.
- [Configuration reference](https://github.com/italia/pa-webinar/blob/main/docs/CONFIGURATION.md): environment variables, configuration layers and the secrets map.
- [Infrastructure](https://github.com/italia/pa-webinar/blob/main/docs/INFRASTRUCTURE.md): choosing and sizing a setup, network design, TURN, and per-cloud notes.
