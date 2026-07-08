# 30-bot load test via Selenium Grid (in-cluster)

This is the **proven** way to run a jitsi-meet-torture (MalleusJitsificus) load
test against the deployed Jitsi. Local Chrome in the maven container does NOT
work (Chrome exits on startup); upstream always runs browsers on Selenium
node-chrome. The `k8s-job.yaml` (local-Chrome) is kept only for reference — use
this instead.

Files:
- `selenium-grid.yaml` — Selenium 4 hub + 6× node-chrome (5 sessions each = 30 slots).
- `torture-job-selenium.yaml` — MalleusJitsificus in Selenium-remote mode (30 bots).

## Why it failed before (all fixed in the manifests)
1. prosody enforces token auth (`allow_empty_token=false`). Bots need a valid JWT,
   injected via **`-Dorg.jitsi.token`** (NOT `-Dorg.jitsi.malleus.jwt`, which does
   not exist). Without it the client fails before signaling → zero connections.
2. Malleus props are `org.jitsi.malleus.*` and `createData` parses the numeric
   ones with no null-guard → pass the FULL set (see the Job).
3. `config.bosh` is an absolute PUBLIC URL, so use the public instance URL; the
   in-cluster ClusterIP does not bypass the ingress for signaling.
4. The grid-readiness gate must tolerate whitespace in the hub's JSON
   (`"totalSlots": 30`, with a space).

## Run it
```sh
# 0. Namespace + release
NS=pa-webinar

# 1. Prep prod: capture baseline, suspend the JVB scaler, bring JVB up
kubectl -n $NS get cronjob pa-webinar-jvb-scaler -o jsonpath='{.spec.suspend}'      # note it
kubectl -n $NS get deploy  pa-webinar-jitsi-meet-jvb-0 -o jsonpath='{.spec.replicas}' # note it
kubectl -n $NS patch cronjob pa-webinar-jvb-scaler -p '{"spec":{"suspend":true}}'
kubectl -n $NS delete job -l app.kubernetes.io/name=jvb-scaler --ignore-not-found   # clear in-flight
kubectl -n $NS scale deploy/pa-webinar-jitsi-meet-jvb-0 --replicas=1

# 2. Mint a wildcard JWT (room:"*") from the deploy's secret + store it
export JITSI_JWT_SECRET=$(kubectl -n $NS get secret videocall-secrets -o jsonpath='{.data.JITSI_JWT_SECRET}' | base64 -d)
export JITSI_JWT_ISSUER=$(kubectl -n $NS get secret videocall-secrets -o jsonpath='{.data.JITSI_JWT_ISSUER}' | base64 -d)
export JITSI_JWT_AUDIENCE=$(kubectl -n $NS get secret videocall-secrets -o jsonpath='{.data.JITSI_JWT_AUDIENCE}' | base64 -d)
export JITSI_JWT_SUBJECT=pa-webinar-jitsi.developers.italia.it JWT_TTL_SECONDS=7200
kubectl -n $NS create secret generic torture-jwt --from-literal=jwt="$(sh mint-jwt.sh)"

# 3. Deploy the grid, wait for 30 slots
kubectl -n $NS apply -f selenium-grid.yaml
kubectl -n $NS rollout status deploy/selenium-node-chrome --timeout=360s

# 4. SMOKE FIRST (mandatory gate): does media flow in-cluster→public JVB LB?
#    Run a 3-bot job and watch `kubectl -n $NS exec <jvb-pod> -- curl -s localhost:8080/colibri/stats`.
#    If participants>0 AND non-zero packet_rate_download → hairpin OK, proceed.
#    If zero media → AKS LB doesn't hairpin; run the grid OFF-cluster instead.

# 5. 30-bot run
kubectl -n $NS apply -f torture-job-selenium.yaml
kubectl -n $NS logs -f job/torture-malleus

# 6. RESTORE (always): delete load-test, JVB→baseline, un-suspend scaler
kubectl -n $NS delete deploy,svc,job -l app.kubernetes.io/component=load-test
kubectl -n $NS delete secret torture-jwt --ignore-not-found
kubectl -n $NS scale deploy/pa-webinar-jitsi-meet-jvb-0 --replicas=0     # restore captured value
kubectl -n $NS patch cronjob pa-webinar-jvb-scaler -p '{"spec":{"suspend":false}}'
```

## Result (prod, 7 Jul 2026)
30/30 bots joined a single conference on the JVB=1-capped bridge behind its single
LoadBalancer and **held stable for the full run: 0 ICE failures, 0 packet loss,
~1% bridge stress**. Confirms the 12-Jun single-LB multi-bridge kick does NOT
recur with `JVB_MAX_REPLICAS=1`. Caveat: senders use the synthetic fake device
(no y4m), so `endpoints_sending_video=0` — this validates signaling + ICE +
connection stability at 30 endpoints, not video-bandwidth throughput. For a
real-media test, bake `resources/FourPeople_1280x720_30.y4m` into the node image
and add `-Dremote.resource.path=<dir>`.
