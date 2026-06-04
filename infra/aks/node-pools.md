# AKS Node Pool Configuration — pa-webinar

## Node Pool: jvb

Dedicated node pool for Jitsi Video Bridge and Jibri (recording) pods.

### Creation

```bash
az aks nodepool add \
  --resource-group <RG_NAME> \
  --cluster-name <CLUSTER_NAME> \
  --name jvb \
  --node-count 0 \
  --min-count 0 \
  --max-count 4 \
  --enable-cluster-autoscaler \
  --node-vm-size Standard_D4s_v3 \
  --labels workload=jitsi-jvb \
  --node-taints workload=jitsi-jvb:NoSchedule \
  --os-type Linux \
  --os-sku AzureLinux \
  --max-pods 30 \
  --zones 1 2 3 \
  --mode User
```

### Key Parameters

| Parameter | Value | Rationale |
|---|---|---|
| VM Size | Standard_D4s_v3 | 4 vCPU, 16 GiB — sufficient for 1-2 JVB + 1 Jibri |
| Min nodes | 0 | Scale-to-zero when no events |
| Max nodes | 4 | Supports ~4 JVB (up to 300 participants each) |
| Taint | workload=jitsi-jvb:NoSchedule | Only JVB/Jibri pods scheduled here |
| Label | workload=jitsi-jvb | Pod nodeSelector target |
| Zones | 1, 2, 3 | Spread across availability zones |

### Scaling Behavior

The cluster autoscaler will:
- **Scale up**: When JVB/Jibri pods are Pending due to insufficient resources (~2-3 min)
- **Scale down**: When nodes are underutilized for 10 minutes (configurable)
- **Scale to zero**: When all JVB/Jibri pods are removed (0 replicas)

### Cost Estimate (West Europe)

| Scenario | Nodes | Monthly Cost (approx.) |
|---|---|---|
| No events | 0 | €0 |
| 1 event/week, 2h each | ~8h/month @ 1 node | ~€2.50 |
| 1 event/day, 2h each | ~60h/month @ 1 node | ~€19 |
| Heavy usage, 4 nodes | 720h/month @ 4 nodes | ~€900 |

Standard_D4s_v3 in West Europe: ~€0.312/hour (pay-as-you-go, Linux).

## Pre-event Scaling

To avoid cold-start delays (2-3 min for node provisioning), scale up JVB 30 minutes before an event:

### Option A: CronJob (simple)

A Kubernetes CronJob that runs before scheduled events and scales up JVB replicas.

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: jvb-scaler
  namespace: pa-webinar
spec:
  schedule: "*/5 * * * *"  # Check every 5 minutes
  jobTemplate:
    spec:
      template:
        spec:
          serviceAccountName: jvb-scaler
          containers:
            - name: scaler
              image: bitnami/kubectl:latest
              command:
                - /bin/sh
                - -c
                - |
                  # This would be replaced with a smarter script
                  # that checks the events database for upcoming events
                  echo "Checking for upcoming events..."
          restartPolicy: OnFailure
```

### Option B: KEDA (advanced)

Use KEDA with a PostgreSQL scaler that queries the events table for events starting within 30 minutes.

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: jvb-scaler
  namespace: pa-webinar
spec:
  scaleTargetRef:
    name: jitsi-jvb
  minReplicaCount: 0
  maxReplicaCount: 4
  triggers:
    - type: postgresql
      metadata:
        connectionFromEnv: DATABASE_URL
        query: >
          SELECT CASE
            WHEN COUNT(*) > 0 THEN GREATEST(1, COUNT(*))
            ELSE 0
          END
          FROM events
          WHERE status IN ('PUBLISHED', 'LIVE')
          AND starts_at <= NOW() + INTERVAL '30 minutes'
          AND ends_at >= NOW()
        targetQueryValue: "1"
```

### Option C: Application-driven (recommended)

The Next.js API handles scaling via the Kubernetes API when an event is about to start:

1. Event creation: schedule a pre-scale job (30 min before start)
2. Pre-scale: PATCH JVB Deployment replicas to desired count
3. Post-event: PATCH JVB Deployment replicas to 0

This requires a ServiceAccount with permissions to scale deployments in the namespace.
