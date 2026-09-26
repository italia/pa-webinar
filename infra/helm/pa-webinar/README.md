# PA Webinar Helm chart

This chart installs [PA Webinar](https://github.com/italia/pa-webinar), the open-source webinar and virtual-event platform for Italian public administrations (PA). A release always contains the portal, a Next.js application whose pods apply database migrations in the `db-migrate` init container, and, by default, its scheduled jobs (`cronjobs.*.enabled`). Values control the rest: Jitsi Meet through the `jitsi-meet` subchart (web, Prosody, Jicofo, Jitsi Videobridge (JVB), and optionally Jibri and coturn), PostgreSQL and Redis through Bitnami subcharts, the JVB scaler, the recorder bot for per-participant recording and the recorder controller, the AI post-production jobs, a NetworkPolicy and Prometheus Operator resources.

## Dependencies

The chart installs with Helm 3 or 4. The chart archive attached to each GitHub release already contains the subcharts. From a clone of the repository, fetch them first, because the archives are not committed. Use `build`, not `update`: `build` installs the versions pinned in `Chart.lock`, which are the ones CI validates.

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo add jitsi-contrib https://jitsi-contrib.github.io/jitsi-helm/
helm dependency build infra/helm/pa-webinar
```

## Values files

`values.yaml` holds the defaults. Do not edit it: layer your own file on top with `-f`. What each profile sets, and the notes to read before you use one, are in [Profiles and values files](https://github.com/italia/pa-webinar/blob/main/docs/DEPLOYMENT.md#profiles-and-values-files).

| File | What it is for |
|---|---|
| `examples/values-simple.yaml` | Everything in the cluster, one fixed bridge. The base of the minikube and k3s overlays. |
| `examples/values-minikube.yaml` | Overlay on the simple profile for evaluation on one workstation ([guide](https://github.com/italia/pa-webinar/blob/main/docs/install/minikube.md)). |
| `examples/values-k3s.yaml` | Overlay on the simple profile for one k3s server, the small-production layout ([guide](https://github.com/italia/pa-webinar/blob/main/docs/install/k3s.md)). |
| `examples/values-standard.yaml` | External database, Jibri. |
| `examples/values-full.yaml` | Dedicated bridge node pool, scale to zero, JVB scaler. |
| `examples/values-aks.yaml`, `values-gke.yaml`, `values-eks.yaml` | Overlays on the full profile for the managed clouds ([guides](https://github.com/italia/pa-webinar/blob/main/docs/install/README.md)). |
| `examples/keda-jvb-scaler.yaml` | A KEDA sketch, [not a drop-in replacement](https://github.com/italia/pa-webinar/blob/main/docs/operations/jvb-scaler.md#keda) for the JVB scaler. |
| `values-production.yaml`, `values-prod.yaml`, `values-dev.yaml` | Examples only, not the configuration of any environment. |

Your own file names the two public hosts once, in `site.portalHost` and `site.conferenceHost`: the chart derives the portal and conference addresses and the Ingress hosts from them, and stops the render when an explicit key disagrees. `jitsi-meet.publicURL` (`https://<site.conferenceHost>`) still has to be written, because Helm passes subchart values as written; the render checks it. `jitsi.conferenceIngress` lets the chart render the conference Ingress instead of the subchart, with annotations that `null` removes. `backup.enabled` adds a nightly `pg_dump` of the in-cluster PostgreSQL to a volume; the post-install notes show how to list, copy and restore the dumps. Each key is described in `values.yaml`.

## Install

Create the namespace and the [Secrets](https://github.com/italia/pa-webinar/blob/main/docs/DEPLOYMENT.md#secrets) first, then follow the [walkthrough for your profile](https://github.com/italia/pa-webinar/blob/main/docs/DEPLOYMENT.md#install-walkthroughs). The command has this shape. With a release archive, use `pa-webinar-X.Y.Z.tgz` as the chart and take the profile from the archive's `examples/` directory (`tar xzf pa-webinar-X.Y.Z.tgz pa-webinar/examples`, then `-f pa-webinar/examples/values-standard.yaml`).

```bash
helm upgrade --install pa-webinar ./infra/helm/pa-webinar -n pa-webinar \
  -f infra/helm/pa-webinar/examples/values-standard.yaml \
  -f pa-webinar.values.yaml \
  --set app.image.tag=X.Y.Z \
  --set app.migration.image.tag=vX.Y.Z-migrate \
  --wait --timeout 15m
```

Always pass both image tags, on every install and [upgrade](https://github.com/italia/pa-webinar/blob/main/docs/operations/upgrades.md). The app tag has no `v`. Each release publishes the migration image as `X.Y.Z-migrate`, the tag the chart derives when `app.migration.image.tag` is empty, and as `vX.Y.Z-migrate`. Releases published before both forms existed carry only `vX.Y.Z-migrate`, so passing it explicitly works for every release ([details](https://github.com/italia/pa-webinar/blob/main/docs/development/ci-and-release.md#migration-image-tags)).

## Validate

From the repository root, `./scripts/validate-chart.sh` lints the chart, renders it with every example profile, and checks the invariants that would otherwise fail only at install time. It needs Helm, OpenSSL, and Python 3 with PyYAML. Then let an API server check your own values. ServiceMonitor and PrometheusRule objects need the Prometheus Operator CRDs in that cluster.

```bash
helm template pa-webinar ./infra/helm/pa-webinar -n pa-webinar -f <profile> -f pa-webinar.values.yaml \
  | kubectl apply --dry-run=server -n pa-webinar -f -
```

## Documentation

- [Deploying with Helm](https://github.com/italia/pa-webinar/blob/main/docs/DEPLOYMENT.md): what the chart renders, prerequisites, Secrets, install walkthroughs and first-run checks.
- [Configuration reference](https://github.com/italia/pa-webinar/blob/main/docs/CONFIGURATION.md): environment variables, configuration layers and the secrets map.
- [Installing PA Webinar](https://github.com/italia/pa-webinar/blob/main/docs/install/README.md): choosing a platform, the checklist, requirements and known limitations, with a guide for minikube, k3s, AKS, GKE and EKS.
- [Infrastructure reference](https://github.com/italia/pa-webinar/blob/main/docs/INFRASTRUCTURE.md): sizing evidence, network design, TURN, network policies and images.
