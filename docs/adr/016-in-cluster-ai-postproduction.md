# ADR-016: In-cluster AI post-production

**Status:** Accepted

## Context

A recording on its own serves few people after an event. People who were absent want to know what
was said without watching an hour of video. Deaf and hard-of-hearing viewers need subtitles. Viewers
who speak another EU language need a translation. Public bodies also have a legal duty here. The
Legge Stanca (Italian accessibility law) and the guidelines of AgID (Agenzia per l'Italia Digitale,
the Agency for Digital Italy) that implement it apply EN 301 549, which includes WCAG 2.1 level AA.
Its success criterion 1.2.2 requires captions for prerecorded video with audio. Transcribing,
subtitling and translating every event by hand does not scale for the teams that run events at a
public administration (PA).

Machine speech recognition, diarization, summarization, translation and speech synthesis can do this
work. How they are run is a data-protection decision as much as a technical one:

- **Recordings are personal data.** The audio carries the voices, names and opinions of participants
  and staff. Per-participant tracks isolate one voice each, which makes them particularly sensitive
  ([ADR-013](013-multitrack-speaker-attribution.md)). Diarization computes voice embeddings, and voice
  becomes biometric data under Article 4(14) GDPR when it is processed to identify someone. Every
  place the audio is sent adds a processor, possibly a transfer outside the EU, and another retention
  regime to govern.
- **Data sovereignty.** PA Webinar is built to be reused by other public bodies. Each of them must be
  able to say where its recordings and the texts derived from them go. The answer that works for all
  of them is: nowhere outside the installation, meaning the operator's cluster and the object storage
  the operator configured. A hosted AI service would put the data under that provider's terms, and
  every reusing body would need its own contract with that provider.
- **Transparency.** Article 50 of the EU AI Act requires that generated audio and text be identifiable
  as artificially generated, and that people be told when they meet such content.
- **The shape of the workload.** The work is batch. A few hours of audio arrive after each event, and
  nobody needs the result within seconds. Speech recognition needs a GPU to run at a useful speed, and
  summaries and translations need a large language model. Events are hours or days apart, and an idle
  GPU node costs as much as a busy one.
- **Reuse.** Every component must be something another public body can install and operate: open
  software, open-weights models, and nothing beyond Kubernetes with a GPU device plugin and node
  autoscaling. No proprietary service, and no extra operator or controller.

## Decision

AI post-production runs **inside the installation's Kubernetes cluster**, with **open-weights models
that the operator hosts**, on **GPU nodes that exist only while there is work**. The portal owns the
queue and makes every decision. The GPU side only executes.

The pipeline is drawn in [AI post-production](../POSTPROD.md). See the pipeline at a glance in
[Architecture and inputs](../POSTPROD.md#the-pipeline-at-a-glance), the dependencies between jobs in
the [job graph](../POSTPROD.md#job-graph), the [job states](../POSTPROD.md#job-states) and the
[claim, progress and register sequence](../POSTPROD.md#claim-progress-register).

### Open-weights models, served in-cluster, from closed lists

- **The engines.** WhisperX runs speech recognition and word alignment. pyannote.audio runs
  diarization of mixed audio, through WhisperX. vLLM serves the language model for summaries and
  translations over an OpenAI-compatible API. Piper synthesizes dubbed audio from catalog voices, and
  AudioSeal watermarks it. The default models and where each default is set are listed in
  [Models](../POSTPROD.md#defaults).
- **The default language model** is `mistralai/Mistral-Small-3.2-24B-Instruct-2506`, set in
  `app/src/lib/ai/providers.ts`. It is an open-weights model under Apache-2.0 from a European vendor,
  and its 16-bit weights fit on a single 80 GB GPU. `AI_VLLM_MODEL_ID` replaces it with any model that
  vLLM can serve ([Choosing another model](../POSTPROD.md#choosing-another-model)).
- **Closed engine lists.** `app/src/lib/ai/providers.ts` allows one value per engine: `vllm` for the
  language model, `whisperx` for speech recognition and `piper` for synthesis. The site-settings API
  (`app/src/lib/validation/site-settings.ts`) repeats the same values in its own enums, and the claim
  endpoint parses the stored value through the `providers.ts` enums again. The comment at the head of
  `providers.ts` states the product's sovereignty policy: every provider runs in-cluster, on the AI
  GPU node pool. It names the hosted AI services it excludes and states that no data leaves the
  cluster except to the configured object storage. Synthesis engines whose licenses do not allow
  commercial use, such as XTTS-v2, are left out of the TTS enum.
- **Adding a backend** takes four things: an enum value in `providers.ts`, the same value in
  `site-settings.ts`, a resolver branch in `providers.ts` and an implementation in the worker. The
  in-cluster rule still applies.
- **The endpoint is operator configuration.** The closed enums fix which engines exist. The language
  model's endpoint, `AI_VLLM_BASE_URL`, is not validated, and the policy that it names an in-cluster
  Service is not enforced by code.
- **The portal decides and the worker executes.** The portal chooses the engine, the language-model
  endpoint, the ASR and language-model ids and the voice path, and sends them in `providerHints` with
  every claim. The worker's own settings point it at the portal (`APP_INTERNAL_URL`). A few choices
  are fixed in the worker image instead: the diarization and alignment models, the watermark model and
  the voice for each speaker. The worker's data paths and its offline model cache are described in
  [Data sovereignty](../POSTPROD.md#data-sovereignty).

### A PostgreSQL queue drained by an orchestrator CronJob

- **The queue is a table behind the portal.** Jobs are rows of `postprod_jobs` (`PostprodJob`), in the
  same outbox pattern as the email outbox. Every input goes through `app/src/lib/ai/enqueue.ts`: the
  recording webhook, the multitrack manifest and staff actions (administrators, and organizers on
  their own events). The site switch `aiPipelineEnabled` gates all of them. The queue shares the
  database with the events and recordings, so a staff action can turn on the event's AI flags and
  enqueue in one transaction, and an idempotency key absorbs a redelivered webhook or a double click.
- **Dependencies are one column.** `dependsOnId` points to the parent job, and a job becomes runnable
  when its parent is `DONE`.
- **Claims are atomic and leased, and the queue owns retries.** Leases, reclaim, backoff and the
  attempt limit are described in [Queue semantics](../POSTPROD.md#queue-semantics).
- **A CronJob turns the queue into workers.** The orchestrator runs on
  `postprod.orchestrator.schedule`. It asks the portal (`GET /api/internal/postprod-pending`) how many
  workers it wants, which is capped by `aiMaxConcurrentJobs` and zero while the site switch is off. It
  counts the active worker Jobs and creates the difference. It never reads the database. This is the
  split of the JVB scaler ([ADR-007](007-jvb-scale-to-zero.md)): the portal decides, and a CronJob
  applies the decision to the cluster ([The orchestrator](../POSTPROD.md#the-orchestrator)).

### One-shot GPU worker Jobs from a suspended template

- **The template.** The chart renders the worker's pod spec as a suspended CronJob,
  `<release>-postprod-worker`, that never fires. The orchestrator creates each worker with
  `kubectl create job --from=cronjob/<release>-postprod-worker`. The recorder uses the same pattern
  ([Suspended CronJobs as Job templates](../architecture/background-jobs.md#suspended-cronjobs-as-job-templates)).
- **One Job, one queue job.** Each worker pod claims one job, runs it and exits. If nothing is runnable
  the pod exits cleanly. The Kubernetes Job does not retry (`backoffLimit: 0`), because the queue owns
  retries.
- **A pool that scales to zero.** The worker targets nodes labeled and tainted `workload=ai-gpu` and
  requests `nvidia.com/gpu`. The pool has a minimum of zero nodes. A pending worker makes the cluster
  autoscaler add a node, and the node goes away when no worker needs it.
- **vLLM on demand.** vLLM is a Deployment that the operator deploys next to the release. With
  `postprod.vllm.autoscale` on (default `false` in `infra/helm/pa-webinar/values.yaml`), it rests at
  zero replicas and the orchestrator scales it to one while there is work or any worker is active,
  and back to zero otherwise. The orchestrator skips this step while the site switch is off, so
  turning the pipeline off does not scale vLLM down. With autoscale off, the operator keeps vLLM
  running (see *An always-on GPU* below).
- **No database or storage credentials on the GPU nodes.** The worker holds `CRON_API_KEY` to call the
  portal and the Hugging Face token, and reaches storage only through presigned URLs. Its pod mounts
  no service-account token and runs as a non-root user with a read-only root file system. The register
  endpoint recomputes each artifact's canonical storage key from `app/src/lib/ai/paths.ts` and rejects
  any other key.

### Outputs are marked as machine-generated

- **In the data.** Every `PostprodArtifact` has `isSynthetic = true`, transcripts included. The row
  records the producing model in `modelId` and `modelVersion`. When the recording's queue drains, its
  `pipelineSnapshot` records the engines, models, voices and languages of the artifacts present.
- **In the interface.** The transcript and summary carry the badge **AI-generated content**. While
  dubbed audio plays, the player shows **AI-dubbed audio — synthetic voice, automatically generated
  content.** **AI processing transparency** opens the recording's `pipelineSnapshot`. Before an event
  that uses any AI option, the waiting room shows an AI notice. Its built-in text can be replaced per
  language in **AI notice in the waiting room**.
- **In the audio.** Dubbed audio carries an inaudible AudioSeal watermark when watermarking succeeds
  (`watermarkType = audioseal`).
- **The video stays authoritative.** Staff can correct transcripts. The machine version is preserved in
  `PostprodOriginalBody` on the first correction.
- **No voice cloning.** Dubbing speaks translated text with catalog synthetic voices. No participant
  audio goes into synthesis ([Dubbing without cloning](../privacy/recordings-and-ai.md#dubbing-without-cloning)).

### Opt-in at every level, after the event only

- The chart renders nothing until `postprod.enabled` is set (default `false` in
  `infra/helm/pa-webinar/values.yaml`).
- The portal queues nothing until an administrator turns on **Post-event pipeline active**
  (`aiPipelineEnabled`, default `false` in `app/prisma/schema.prisma`).
- Each event opts in with **Automatic transcription** (`aiTranscriptEnabled`) and the options that
  build on it. `consentSnapshot` records what each run was allowed to do.
- The pipeline works on finished recordings only. Live captions are out of scope for this decision
  ([Roadmap](../ROADMAP.md#further-out)).

## Consequences

### What the decision buys

- **Hosted engines are kept out of the code.** A reviewer reads `providers.ts`, and the guard test
  `app/src/lib/ai/providers.test.ts` fails if a hosted provider id is accepted. The worker sends no API
  key to the language model, and no setting holds one, so a hosted API that requires a key cannot be
  wired in. The vLLM endpoint itself remains operator configuration (see above).
- **GPU nodes run only while there is work,** plus the autoscaler's scale-down delay, and no fee is
  charged per minute of audio.
- **Credentials stay contained.** A GPU node holds no database password and no storage key; it reaches
  storage only through presigned URLs. What it can reach through the portal is bounded by
  `CRON_API_KEY`, which is shared with every scheduled job (see *A shared machine key* below).
- **One set of patterns.** The queue works like the email outbox, the orchestrator works like the JVB
  scaler, and the worker template works like the recorder's. An operator who knows one of them knows
  the others.
- **Provenance per recording.** `consentSnapshot` records what a run was allowed to do when it was
  queued, and `pipelineSnapshot` records the engines, models and voices of the artifacts present when
  the recording's queue drains. Later changes to the event or the settings do not rewrite them; the
  snapshot's known gaps are in [Known limitations](../POSTPROD.md#known-limitations).
- **Live events are unaffected.** The pipeline runs after the event, on separate nodes. A failure there
  never touches a conference.

### GPU operations

The operator takes on a GPU node pool. That means GPU quota in the region, a pool labeled and tainted
`workload=ai-gpu` with a minimum of zero, and a device plugin whose DaemonSets tolerate that taint (the
NVIDIA GPU Operator or the platform's equivalent). It also means a vLLM Deployment and Service, which
the chart does not render. The orchestrator scales the Deployment named in
`postprod.vllm.deploymentName` (empty means `<fullname>-vllm`). The portal sends workers to
`AI_VLLM_BASE_URL`, which defaults to `http://pa-webinar-vllm:8000/v1` in `providers.ts`, so set it
when the Service has another name or namespace. vLLM and each worker request a whole GPU, so without
GPU sharing a summary or translation run occupies two GPU nodes. The reference modules in
`infra/tofu/aks`, `infra/tofu/gke` and `infra/tofu/eks` create a GPU pool on request. The default
language model needs an 80 GB GPU, which the AKS module's default machine carries; the GKE and EKS
defaults are smaller. The steps are in the
[operational checklist](../POSTPROD.md#operational-checklist). Choosing hardware, quotas and costs per
cloud is covered in the platform guides of [Installing PA Webinar](../install/README.md) and in
[Node pools](../INFRASTRUCTURE.md#node-pools).

### Cold starts

A run that starts from zero waits for several things. A node must be provisioned, a large CUDA image
pulled onto it, and vLLM must load its weights. That takes minutes, and the decision accepts it:
outputs arrive some time after the event, not during it. A worker that finds vLLM unreachable, or
answering `503`, keeps retrying for `LLM_CONNECT_WAIT_S` seconds (720 by default in
`infra/ai/worker/llm.py`). Meanwhile the job stays `RUNNING` instead of going into backoff, and its
worker Job stays active, so the orchestrator keeps vLLM at one replica (with `postprod.vllm.autoscale`
on). The orchestrator's default one-minute schedule adds up to a minute of latency. That is
acceptable for batch work, but not for starting a recording, which is why the recorder uses a
reconciling controller instead ([ADR-013](013-multitrack-speaker-attribution.md)).

Presigned upload URLs last 30 minutes from the claim with the worker's default and are not renewed. A
progress report renews the lease, but a stage that runs longer than that without reporting progress is
reclaimed while still running ([Known limitations](../POSTPROD.md#known-limitations)).

### Pre-seeded weights

The worker runs offline and reads weights from `/models`, so the operator seeds a volume once. The
files must be in each library's cache layout. Seeding needs network access to Hugging Face and a token
from an account that accepted the conditions of the gated pyannote models
([Seeding the models volume](../POSTPROD.md#seeding-the-models-volume)). Without a seeded volume, every
real transcription fails.

Two components still fetch public weights (never data) when these are missing from the cache: the
torchaudio alignment models that WhisperX uses for some languages, and the AudioSeal generator. The
sovereignty rule is enforced by what the code calls, not by the network. The chart's NetworkPolicy
(`networkPolicy.enabled`, off by default) selects only the application pods: the worker, the
orchestrator and vLLM have no policy, so their egress is unrestricted. Operators who need
network-level enforcement restrict the GPU pool's egress to the portal, the storage endpoint and vLLM
([Data sovereignty](../POSTPROD.md#data-sovereignty)).

### Model licenses

Whoever seeds the volume accepts each model's terms, and open weights do not mean unrestricted use.
[Third-party licenses](../../THIRD-PARTY-LICENSES.md#ai-stack-and-model-weights) flags several defaults
for review:

- WhisperX's default alignment models for Italian, French, German and Spanish carry non-commercial
  terms, and Italian is the default source language.
- The worker image contains GPL-licensed code.
- Some Piper voices were trained on datasets under research or copyleft terms.

Replacing the language model needs its own license review. The replacement must also update the vendor
and license values, which `app/src/lib/ai/pipeline-snapshot.ts` writes as fixed values into the
provenance panel.

### No post-production on a single VM

Post-production needs Kubernetes and a GPU pool. The Docker Compose stack has no orchestrator, no
worker and no reclaim, retention or multitrack-purge job
([Docker Compose](../architecture/background-jobs.md#docker-compose)).
The job that deletes per-participant tracks after transcription is rendered only with
`postprod.enabled`. An installation that records per-participant audio therefore needs post-production
turned on, or the tracks are never purged.

### Other costs

- **A shared machine key.** The worker authenticates with the same `CRON_API_KEY` as every scheduled
  job, so it can call any `/api/cron/*` or `/api/internal/*` route. That includes claiming other jobs,
  which returns download URLs for other recordings, and asking for further presigned upload URLs. No
  credential is scoped to the worker
  ([Machine credentials](../architecture/identity-and-access.md#machine-credentials)).
- **Output quality has limits.** Open-weights models make mistakes, which is why outputs are marked and
  editable. The pipeline's current gaps are listed in
  [Known limitations](../POSTPROD.md#known-limitations).

## Alternatives considered

### Hosted AI APIs

Commercial speech-to-text and language-model APIs give high-quality results with no GPU to operate.
They were rejected on data sovereignty. The recording would leave the installation, and its voices and
content would fall under the provider's retention and reuse terms, often outside the EU. Every reusing
body would need its own contract, data processing agreement and transfer assessment. The platform
would also depend on a service that some bodies cannot use. The closed enums in `providers.ts` keep
hosted engines out of the code; the vLLM endpoint remains operator configuration.

### A workflow engine such as Argo Workflows

A workflow engine models job graphs, retries and artifacts directly. The graph here is small: one root
transcription job, then summary, translation, dubbing and the on-demand archive, each job with a
single parent ([Job graph](../POSTPROD.md#job-graph)). One `dependsOnId` column expresses it. An
engine would add custom resources and a controller that every reusing body must install and upgrade.
It would also keep its state outside the portal's database. The queue must share transactions with the
event and recording rows, the idempotency keys and the consent snapshots, and the administration area
reads queue state directly from PostgreSQL.

### KEDA

A KEDA ScaledJob can start workers from a PostgreSQL query. It was rejected for the reasons that apply
to the bridges ([ADR-007](007-jvb-scale-to-zero.md#keda)):

- KEDA is an extra operator.
- KEDA would need a database credential, while the orchestrator never reads the database.
- The runnability rule and the concurrency cap from the site settings would have to be duplicated in a
  query.
- Scaling vLLM up and down with the queue would still need a job.

### Redis streams

Redis already runs next to the portal. In PA Webinar, though, it carries realtime fan-out only and
runs without persistence ([ADR-005](005-live-interaction-in-portal.md); `save ""` and `appendonly no`
in `values.yaml`). Jobs wait minutes or hours for a GPU, are retried over hours, and must survive
restarts. Their rows are also written in the same transactions as recordings, artifacts and consent
snapshots. PostgreSQL provides durability, those transactions and `SKIP LOCKED` claims.

### An always-on GPU

A GPU node that is always on, with vLLM always warm, removes cold starts and is the simplest to reason
about. It was rejected as the design point: events are hours or days apart, and the node costs the
same while idle. It remains an operator's choice. A pool with a minimum of one node, and vLLM at one
replica with `postprod.vllm.autoscale` off, gives exactly that.

## Implementation notes

- **Policy and routing:** `app/src/lib/ai/providers.ts`, with its guard test `providers.test.ts`. The
  engine settings are validated in `app/src/lib/validation/site-settings.ts`.
- **Queue:** `app/src/lib/ai/enqueue.ts` (every enqueue path), `idempotency.ts` (keys), `paths.ts`
  (canonical storage keys) and `pipeline-snapshot.ts` (provenance).
- **Internal API:** `app/src/app/api/internal/postprod-pending`, `postprod-claim` (atomic claim with
  `FOR UPDATE ... SKIP LOCKED`), `postprod-progress` and `postprod-artifact`.
- **Staff actions:** `app/src/app/api/admin/postprod/recordings/[id]/*`, guarded by
  `requireRecordingManager`.
- **Scheduled routes:** `app/src/app/api/cron/postprod-reclaim`, `postprod-retention` and
  `multitrack-purge`.
- **Chart:** `infra/helm/pa-webinar/templates/cronjob-postprod-orchestrator.yaml` (its namespaced Role
  and the vLLM scaling), `cronjob-postprod-worker.yaml` (the suspended template),
  `cronjob-postprod-reclaim.yaml`, `cronjob-postprod-retention.yaml` and `cronjob-multitrack-purge.yaml`.
  The keys are under `postprod` in `infra/helm/pa-webinar/values.yaml`.
- **Worker:** `infra/ai/worker/` and `infra/ai/Dockerfile.worker`. The worker's tests run with
  `python -m pytest` from that folder.
- **Reference GPU pools:** `gpu_pool` in `infra/tofu/aks` and `infra/tofu/gke`, `gpu_enabled` in
  `infra/tofu/eks`.
- **Data model:** `Recording`, `RecordingTrack`, `PostprodJob`, `PostprodArtifact`,
  `PostprodOriginalBody` and `Speaker` in `app/prisma/schema.prisma`.

## Related

- [AI post-production](../POSTPROD.md): the owner page. It covers the pipeline, the queue, the models,
  configuration, the operational checklist and troubleshooting.
- [ADR-006](006-recording-and-storage.md): the recording paths and the storage abstraction that the
  pipeline reads from and writes to.
- [ADR-013](013-multitrack-speaker-attribution.md): per-participant recording, the input of
  `TRANSCRIBE_MULTITRACK`.
- [ADR-007](007-jvb-scale-to-zero.md): the scale-to-zero pattern this decision reuses.
- [ADR-010](010-site-settings-singleton.md): the runtime settings that hold the site switch and the
  engine choices ([Runtime settings](../configuration/runtime-settings.md)).
- [Recordings, voice data and AI outputs](../privacy/recordings-and-ai.md): legal bases, voice data,
  transparency and retention.
- [Scheduled and background jobs](../architecture/background-jobs.md): every post-production CronJob.
- [Node pools](../INFRASTRUCTURE.md#node-pools): the GPU pool on any cluster.
