# How we develop PA Webinar

This page describes the development process of PA Webinar: how a change is scoped, branched, committed, checked, reviewed, merged and released, and the rules that keep the documentation and the roadmap honest. It is written for contributors and maintainers, and for anyone judging the maturity of the project.

Three other pages cover what this one does not:

- [CONTRIBUTING.md](../../CONTRIBUTING.md) is the step-by-step guide for an outside contributor: reporting, proposing, opening a pull request.
- [SECURITY.md](../../SECURITY.md) owns the supply-chain controls: runner isolation, pinned actions, token permissions, dependency updates, scanners, SBOMs and the secrets policy.
- [CI, images and releases](ci-and-release.md) owns what each workflow does, the image tags and the release procedure.

## At a glance

| Practice | Where it is checked |
|---|---|
| Conventional Commits with a scope | Review. The release workflow also groups the GitHub Release notes by commit type. |
| Pre-commit gates: lint, typecheck and unit tests before every commit | The author, by hand. There is no Git hook, and no test runs on `dev`. |
| The same commands as CI before every push | The author, with the table in [CI parity](#ci-parity-before-every-push). |
| Full CI before anything reaches `main` | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs on the `dev` → `main` pull request, and the maintainers merge only when every blocking job is green |
| Code review of every non-trivial change | Before the commit, or before the merge of a pull request |
| Coverage that cannot silently drop | Thresholds in [`app/vitest.config.ts`](../../app/vitest.config.ts), enforced by `npm run test:coverage` |
| Project rules encoded as tests | [Guard tests](#guard-tests), such as the 24-language parity test |
| Schema and migrations in sync | The Migration Integrity job |
| A chart that renders on every profile, and that a Kubernetes API server accepts for the example profiles | [`scripts/validate-chart.sh`](../../scripts/validate-chart.sh), and `kubectl apply --dry-run=server` on a throwaway kind cluster |
| Dependency license policy | The License Compliance job |
| Vulnerability and secret scanning | Trivy on the repository and on the image (blocking by rule); CodeQL (non-blocking) |
| Architecture decisions | Architecture Decision Records in [`docs/adr/`](../adr/README.md) |
| Release notes in all 24 languages | A test on the release-note catalogs |

The CI jobs block a merge by rule, not by a repository setting: `main` has no required status checks, so a red job does not technically stop a merge. The maintainers do not merge the `dev` → `main` pull request until every job of `ci.yml` that is not marked `continue-on-error` is green.

## Principles

PA Webinar is public software for reuse by public administrations (PAs). The people who install it never took part in the discussions behind it. Every rule on this page follows from that.

- **Public artifacts describe the product.** Code, comments, commit messages, branch names, pull requests and documentation describe what the software does now. They do not tell how a change was produced, who asked for it or which event prompted it. History lives in `git log` and the changelog. The reasons behind architecture-level choices live in ADRs.
- **Write for the reuser.** A reader in another administration cannot resolve internal names. Public artifacts contain no internal event, meeting or person names, no internal ticket codes, no data from a real environment (hosts, IP addresses, cluster, namespace or secret names) and no secrets. Use placeholders: `webinar.example.com`, `meet.webinar.example.com`, `<namespace>`, `<cluster>`, `<public-ip>`.
- **Generalize the example.** A request often arrives with a concrete case to make it clear. The code, the commit and the documentation describe the general case instead: "a fixed-cadence series", "a moving-date series", "Speaker 1".
- **Code and configuration are the source of truth.** Code and configuration come first: `package.json`, `app/vitest.config.ts`, `infra/helm/pa-webinar/values.yaml` and `.github/workflows/*`. The documentation comes second. When the two disagree, the code wins, and the documentation is fixed.
- **Done means verified.** A change is done only when its gates are green and, if it is non-trivial, its code review has run. The commit body says what was verified and what was not.

## The life of a change

```mermaid
flowchart TB
  classDef portal fill:#E6F0FA,stroke:#0066CC,stroke-width:2px,color:#17324D
  classDef check fill:#FFF4E5,stroke:#CC7A00,stroke-width:2px,color:#17324D
  classDef auto fill:#E0F5F5,stroke:#00A3A3,stroke-width:2px,color:#17324D
  classDef out fill:#E5F3EE,stroke:#008055,stroke-width:2px,color:#17324D
  classDef ext fill:#EEF1F4,stroke:#5C6F82,stroke-width:1px,color:#17324D
  classDef emph fill:#17324D,stroke:#17324D,stroke-width:2px,color:#FFFFFF
  classDef optional fill:#EEF1F4,stroke:#5C6F82,stroke-width:1px,color:#17324D,stroke-dasharray:5 4

  subgraph AUTHOR["1 · Before the change reaches dev"]
    direction LR
    issue["Issue, ADR or<br/>direct pull request"]:::ext
    topic["Topic branch<br/>feat/ fix/ docs/ chore/"]:::portal
    gates["Pre-commit gates<br/>lint, typecheck, unit tests<br/>+ area checks"]:::check
    review["Code review<br/>every non-trivial change"]:::check
    issue -->|"sets the scope"| topic
    topic -->|"before every commit"| gates
    gates -->|"green"| review
  end
  style AUTHOR fill:#F7F9FB,stroke:#5C6F82,color:#17324D

  subgraph MAIN["2 · From dev to a release"]
    direction LR
    dev["dev<br/>dev.yml builds :dev images"]:::portal
    pr["Pull request<br/>dev → main"]:::portal
    ci["ci.yml<br/>coverage, chart, scans,<br/>licenses, migrations, image"]:::auto
    nb["E2E smoke, CodeQL<br/>continue-on-error"]:::optional
    merge["Merge commit on main<br/>never squashed"]:::portal
    tag["Tag vX.Y.Z"]:::emph
    rel["release.yml<br/>builds and publishes"]:::auto
    out["Images, SBOMs, chart,<br/>GitHub Release"]:::out
    dev -->|"maintainers open"| pr
    pr -->|"runs"| ci
    pr -.->|"also runs"| nb
    ci -->|"merged only<br/>when all green"| merge
    merge --> tag
    tag -->|"triggers"| rel
    rel --> out
  end
  style MAIN fill:#F7F9FB,stroke:#5C6F82,color:#17324D

  AUTHOR -->|"findings fixed or accepted,<br/>CI parity run, then push"| MAIN
```

No blocking check runs in the first row. Of the repository's workflows, only CodeQL runs on a pull request into `dev`, and it is non-blocking. A push to `dev` builds images and runs CodeQL again. The full CI runs on the way to `main`, often many commits later. That is why the pre-commit gates and the CI-parity run are mandatory rather than advisable. A failure found on the `dev` → `main` pull request costs far more to trace than one found before the commit.

## Branches

| Branch | Role |
|---|---|
| `main` | The released line. It moves only through a pull request from `dev`, which the maintainers open, and release tags `vX.Y.Z` are cut on it. |
| `dev` | The integration branch. Every change enters the project here. Each push to `dev` builds the development images with the moving `:dev` tag. |
| `feat/`, `fix/`, `docs/`, `chore/` | Topic branches with a short kebab-case description, for example `fix/reminder-timezone`. A contributor working from a fork always uses one. For maintainers with write access they are optional. |

- **Merge commits into `main`, never squash.** The `dev` → `main` pull request is merged with a merge commit, so each commit on `dev` stays a readable, revertible unit in the history of `main`.
- **Topic branches enter `dev` first.** A maintainer may squash a topic pull request when it enters `dev`. The pull-request title then becomes the commit subject, so it follows the commit format.
- **Target `dev`.** GitHub's default branch is `main`, so switch the base to `dev` when you open a pull request.
- **Names describe the change**, never a person or an event.
- **Delete the topic branch after the merge.**

```mermaid
%%{init: {"theme": "base", "themeVariables": {"git0": "#0066CC", "git1": "#00A3A3", "git2": "#CC7A00", "git3": "#008055", "gitBranchLabel0": "#FFFFFF", "gitBranchLabel1": "#FFFFFF", "gitBranchLabel2": "#FFFFFF", "gitBranchLabel3": "#FFFFFF", "commitLabelColor": "#17324D", "commitLabelBackground": "#EEF1F4", "tagLabelColor": "#FFFFFF", "tagLabelBackground": "#17324D", "tagLabelBorder": "#17324D"}}}%%
gitGraph
  commit id: "previous release"
  branch dev
  checkout dev
  commit id: "docs(helm): small fix"
  branch feat/example
  checkout feat/example
  commit id: "feat(scope): change"
  commit id: "test(scope): cover it"
  checkout dev
  branch fix/example
  checkout fix/example
  commit id: "fix(scope): correct it"
  checkout dev
  merge feat/example id: "feat/example into dev"
  merge fix/example id: "fix/example into dev"
  commit id: "chore(release): vX.Y.Z"
  checkout main
  merge dev id: "PR dev to main" tag: "vX.Y.Z"
```

The graph draws the topic branches as merges into `dev`. When a maintainer squashes a topic pull request, it leaves a single commit on `dev` instead. The `dev` → `main` step is always a merge commit.

## Commits

The project uses [Conventional Commits](https://www.conventionalcommits.org/) with a scope:

```text
type(scope): imperative subject, 72 characters at most

What changes and why, in a few lines.

Verified: the gates that ran, and any manual checks.
Not verified: what was out of reach, and why.
```

| Type | Use it for |
|---|---|
| `feat` | A new capability |
| `fix` | A defect |
| `docs` | Documentation only |
| `chore` | Maintenance with no behavior change, including the release commit `chore(release): vX.Y.Z` |
| `refactor` | A restructuring with no behavior change |
| `perf` | A performance improvement |
| `test` | Tests only |
| `ci` | Workflows |
| `build` | Images, the Dockerfile and the build system |
| `security` | Hardening and vulnerability remediation |
| `i18n` | Translations and message catalogs |

- **Scope** names the area touched, such as `admin`, `live`, `helm`, `recorder`, `postprod` or `lobby`. Run `git log` to see the scopes in use. Omit the scope only for a change that truly cuts across the codebase.
- **Subject**: imperative mood, 72 characters or fewer, no emoji, no trailing period.
- **Body**: required for every non-trivial change. It says what changes, why, and what was verified.
- **Language**: commit messages and pull-request titles are written in Italian, the language of the existing history. A message never mixes languages.
- **No attribution trailers or signature footers.** Git already records authorship.

Subjects matter beyond `git log`. The release workflow builds the GitHub Release body from the commit subjects since the previous tag, grouped by type. Only `feat`, `fix`, `perf`, `refactor`, `docs`, `ci`, `chore` and `test` get their own section. Every other subject lands under "Other": subjects of the `build`, `security` and `i18n` types, and subjects that do not follow the format ([Release notes and the changelog](ci-and-release.md#release-notes-and-the-changelog)).

## Local gates before every commit

These three commands are the pre-commit gates. Run them from the repository root before **every** commit. All three must pass:

```bash
npm run lint --workspace=app
npx tsc --noEmit --project app/tsconfig.json
npm run test --workspace=app
```

No Git hook runs them for you, and no test runs on `dev`. They are the only check between a commit and the integration branch.

These three commands cover the `app` workspace only. If you touched one of the areas below, also run its check:

| If you changed | Also run |
|---|---|
| `lobby/` | `npm run lobby:typecheck`. The lobby has no unit tests, so the type check is its only gate. |
| `infra/recorder/` or `infra/recorder-controller/` | In that folder: `npm ci`, then `npx tsc --noEmit -p tsconfig.json && npm test`. Both packages sit outside the npm workspaces. |
| `infra/ai/worker/` | In that folder: `pip install -r requirements-test.txt`, then `python -m pytest -q`. The tests cover pure logic and need no GPU. |
| `infra/helm/` | `./scripts/validate-chart.sh`. No other local check looks at the chart. |
| Dependencies | `npm run license:report`, then commit `license-report.json` together with `package-lock.json` |
| `app/prisma/schema.prisma` | `npm run db:migrate:dev --workspace=app`, then commit the generated SQL with the schema. See [Database changes](#database-changes). |
| Interface strings | The key must exist in all 24 catalogs in `app/src/i18n/messages/`. Add it to `it.json` and `en.json`, then run `node scripts/sync-i18n.mjs` to create it in the other catalogs. |

The i18n sync script fills a missing key with the English text. The parity test then passes, because it checks that keys are present, non-empty and have the same placeholders, and it cannot tell a copy from a translation. Replace the English copies with real translations. Review is the only check that catches an untranslated string.

`validate-chart.sh` needs Helm, `python3` with PyYAML, and the subcharts (`helm dependency build infra/helm/pa-webinar`). When something is missing, it stops and prints the command that fixes it. It renders the chart with the default values and with each profile and example values file, runs `helm lint`, and checks invariants whose violation breaks an installation. For example, it checks that every Secret a component mounts carries the keys that component needs, and that every Ingress path is absolute. The script itself is the authoritative list.

## CI parity before every push

The pre-commit gates do not cover everything CI checks: the coverage thresholds, security scanning, license compliance, migration integrity and the image build all run only in CI. Before every push, run **the same commands CI runs**, not a subset remembered from memory.

The authority is [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). The table below is derived from it. A pull request that changes a job in `ci.yml` updates this table as well.

Run every command from the repository root unless the table says otherwise.

| Job in `ci.yml` | Local equivalent | You may skip it when |
|---|---|---|
| Lint & Typecheck | `npm run lint --workspace=app` and `npx tsc --noEmit --project app/tsconfig.json` | Never |
| Unit Tests | `npm run test:coverage --workspace=app`. **Not** `npm run test`: only the coverage run enforces the thresholds. | Never |
| Unit Tests (recorder, controller) | In `infra/recorder/` and in `infra/recorder-controller/`: `npm ci`, then `npx tsc --noEmit -p tsconfig.json && npm test` | Nothing changed in either folder |
| Typecheck (lobby) | `npm run lobby:typecheck`, which runs the same `tsc --noEmit` as `npx tsc --noEmit -p lobby/tsconfig.json` | Nothing changed in `lobby/` |
| Helm Chart | `./scripts/validate-chart.sh`. The second step, `kubectl apply --dry-run=server`, needs a cluster (see below). | Nothing changed in `infra/helm/` |
| Unit Tests (worker AI) | In `infra/ai/worker/`: `pip install -r requirements-test.txt`, then `python -m pytest -q` | Nothing changed in `infra/ai/worker/` |
| Security Scan | `trivy fs --severity CRITICAL,HIGH --exit-code 1 .` | Never: it also looks for secrets in every file |
| License Compliance | `npx license-checker --production --failOn "GPL-2.0;GPL-3.0;AGPL-3.0;AGPL-3.0-only;SSPL-1.0" --excludePrivatePackages`, then `npm run license:report && git diff --exit-code license-report.json` | No dependency changed |
| Migration Integrity | `prisma migrate deploy` and `prisma migrate diff` against a throwaway database (see below) | Nothing changed in `app/prisma/` |
| Docker Build & Scan | `docker build -t pa-webinar:local .`, then `trivy image --severity CRITICAL,HIGH --exit-code 1 pa-webinar:local` | Documentation-only changes |
| E2E Smoke Tests (non-blocking) | Start the local stack, then run `npx playwright test --project=chromium` from `app/` (see below) | You did not touch the flows of the live room |

A few jobs need more than one command, or have a catch.

**Match the install.** CI starts every Node job from `npm ci`. If `package-lock.json` changed, run `npm ci` locally first, so that you test the tree CI installs. `license-checker` in particular reads the installed `node_modules`.

**Migration Integrity.** CI applies every migration to an empty PostgreSQL, then checks that the migrations produce exactly the schema in `schema.prisma`. Do the same against a throwaway database. The `migrate diff` step **resets the shadow database**: never point it at a database whose contents you want to keep, including your local development database.

```bash
# A throwaway PostgreSQL. Use the image of the job's `postgres` service in ci.yml.
docker run --rm -d --name pa-webinar-scratch-db \
  -e POSTGRES_PASSWORD=scratch -p 55432:5432 <postgres-image>
SCRATCH=postgresql://postgres:scratch@localhost:55432/postgres

# 1. Every migration applies to an empty database.
DATABASE_URL=$SCRATCH npx prisma migrate deploy --schema=app/prisma/schema.prisma

# 2. The migrations and schema.prisma describe the same schema.
DATABASE_URL=$SCRATCH npx prisma migrate diff \
  --from-migrations app/prisma/migrations \
  --to-schema-datamodel app/prisma/schema.prisma \
  --shadow-database-url "$SCRATCH" \
  --exit-code

docker stop pa-webinar-scratch-db
```

**Security Scan.** Run it from the repository root, because Trivy loads `.trivyignore` from the working directory. Your working tree also holds files that a CI checkout does not, such as build output and local test results, and the scanner reads them too. For an exact match, scan a clean checkout of the commit you are about to push:

```bash
git worktree add --detach ../pa-webinar-scan HEAD
(cd ../pa-webinar-scan && trivy fs --severity CRITICAL,HIGH --exit-code 1 .)
git worktree remove ../pa-webinar-scan
```

**Docker Build & Scan.** The image build runs `next build`, and it is the only CI job that builds the application. A change can pass lint and the type check and still fail to build. `npm run build` is a faster first check for build errors than a full image build. Run the image scan from the repository root as well, for the same `.trivyignore`.

**Helm Chart.** CI pins Helm to the oldest version the chart supports, so a newer local Helm can accept something CI rejects. The server-side dry run renders the `simple`, `standard` and `full` example profiles and applies them with `kubectl apply --dry-run=server` to a throwaway kind cluster. With a local kind cluster you can run the same loop, which is in the `chart` job of `ci.yml`. Without one, skip this step and declare it.

**E2E Smoke Tests.** CI marks this job `continue-on-error`, so it does not block a merge. Run it anyway when you touch the flows of the live room:

```bash
docker compose up --build -d --wait
docker compose --profile setup run --rm --build db-migrate
cd app
npx playwright install chromium   # first time only
ADMIN_API_KEY=<the value set for the app service in docker-compose.yml> \
  npx playwright test --project=chromium
```

Keep `--build` in both commands. The `app` and `db-migrate` services are built from the working tree, and without the flag Compose reuses an image built earlier, so the tests would run against old code.

### Declaring what you skipped

You may skip a job whose area you did not touch, but you must say so in the pull request or the commit body. For example: "Docker Build & Scan not run: no change to the Dockerfile, dependencies or application code." Never skip a job silently and then find out from a red CI run.

## Code review

Every non-trivial change gets a code review **before** it is committed to `dev`, or before its pull request is merged. Non-trivial means a change to any of the following:

- behavior;
- response contracts;
- guards and authorization checks;
- the data model;
- interface logic;
- interface strings and translations.

A typo, a comment or a formatting fix needs only the gates.

- **Review the diff, not the description.** The reviewer reads the change and the code around it: its callers, the paths through it, and the documentation that describes it.
- **Findings are verified.** A finding is confirmed when the reviewer can show the failure against the code or reproduce it. A suspicion that cannot be shown stays a question for the author.
- **Every confirmed finding is settled before the commit.** It is either fixed, or accepted on purpose with the reason written in the commit body or the pull request. It is never left for "later" without saying so.
- **Review does not replace the gates.** A reviewed change still passes lint, the type check and the tests, and a green change still gets reviewed.

Who reviews and who merges is described in [GOVERNANCE.md](../../GOVERNANCE.md).

## Regression discipline

Passing checks prove only that nothing *tested* broke. Line coverage of the application is far from complete, so a green run is not an acquittal. For every change, read the diff and ask what else passes through the code you touched:

- **Callers.** Who calls the function you changed, and with which inputs?
- **Guards.** Which existing paths go through a guard you added, removed or tightened? A new guard can be right for the case in front of the author and wrong for a path nobody re-checked: a guest instead of a registrant, a speaker instead of a moderator, the organizer role instead of the administrator. It is the change most likely to break a path that used to work.
- **Readers.** Who reads the field, enum value, response property or i18n key you renamed?
- **Defaults.** Which default changed under installations that are already running? A new or changed default in `values.yaml` reaches an installation at its next upgrade, unless that upgrade uses `--reuse-values`. That flag ignores the new chart's `values.yaml`: new keys get no default, and changed defaults keep their old value ([Why not `--reuse-values`](../operations/upgrades.md#why-not---reuse-values)). A changed default in `schema.prisma` applies only to rows created afterward, so the existing site settings row keeps its old value unless the migration updates it ([Migrations](../architecture/data-model.md#migrations)).
- **Shared contracts.** When you change a contract that more than one place depends on, check each consumer explicitly, by reading it or by running it. Such contracts include the response shape of a route, a guard, an enum value and a token rule.

When a change is visible in the browser or depends on the live stack, run it in the local stack described in [Local development](../DEVELOPMENT.md). Some things cannot be tested headless, such as the conference itself and the waiting-room canvas. [Testing](testing.md) lists them.

Major dependency upgrades follow the same discipline. Each one is a dedicated change: the code is adapted, the full gates run and the change is reviewed. Major upgrades are never merged in bulk. The Dependabot policy behind this is in [SECURITY.md](../../SECURITY.md#dependency-updates).

## Coverage ratchet and guard tests

### The coverage ratchet

The coverage thresholds in [`app/vitest.config.ts`](../../app/vitest.config.ts) are a ratchet, not a target:

- **A floor just below the measured value.** The margin is a couple of points. It absorbs the noise of an ordinary change, such as a few new uncovered functions. It does not absorb the loss of a tested module, which costs several points and turns the run red.
- **It rises and never falls.** When coverage rises and stays up, the thresholds are raised behind it. They are never lowered to let a change pass.
- **Read the numbers from the file.** Do not quote them in documentation, pull requests or commit messages.
- **Enforced only with coverage.** `npm run test:coverage --workspace=app` enforces the thresholds, and it is what the Unit Tests job runs. `npm run test` runs the same suite without them.
- **Scope.** The thresholds cover `app/src`. The recorder, the recorder controller and the AI worker have their own test suites without a coverage floor, and the lobby is only type-checked.

### Guard tests

Some project rules are too easy to forget to leave to memory, so tests and lint rules encode them. A guard fails the gate the moment the rule is broken, instead of the next time someone notices. For example, `app/src/i18n/locale-parity.test.ts` fails when an interface string is missing or empty in one of the 24 catalogs, and `app/src/lib/gdpr/cleanup-coverage.test.ts` fails when a table with an `eventId` column is not classified as purged or kept by the GDPR cleanup. When you add a rule that can be checked mechanically, add its guard in the same change. [Guard tests that encode rules](testing.md#guard-tests-that-encode-rules) lists every guard and what each one cannot catch.

## Database changes

The schema lives in `app/prisma/schema.prisma`, and every change reaches a database only as a migration. [Data model](../architecture/data-model.md#migrations) owns the migration rules and the [naming conventions](../architecture/data-model.md#names), and [Every schema change](extending.md#every-schema-change) is the checklist to follow. Four rules shape the process:

- **Migration and schema travel together.** Run `npm run db:migrate:dev --workspace=app`, review the generated SQL in `app/prisma/migrations/`, and commit it in the same commit as the schema change. The Migration Integrity job fails when the two disagree.
- **Migrations are additive.** During a rollout, and after a rollback, older code runs against the newer schema. A migration therefore adds only what that code can ignore.
- **A migration is never edited once it is merged or applied anywhere.** Prisma keeps a checksum of every migration it has applied, so an edited file is either treated as drift or never re-run. Write a new migration instead.
- **Personal data needs a retention path.** A new model that holds participants' personal data is purged by the `/api/cron/cleanup` transaction and its test, and classified in `app/src/lib/gdpr/cleanup-coverage.ts`. If the model points to a stored file, the cleanup deletes the file too ([Rules for developers](../GDPR.md#rules-for-developers)).

## Architecture decisions

A decision that is expensive to reverse, or that sets a boundary other work depends on, is recorded as an Architecture Decision Record (ADR), in the pull request that implements it or in one opened ahead of the code. Typical cases include:

- a new component or a new external service;
- a change to a trust boundary;
- a change to the boundary with Jitsi Meet;
- a new data domain;
- a new way to authenticate a class of users.

ADRs record *why* a design was chosen. The rest of the documentation records *what* the software does now. [Architecture decision records](../adr/README.md) holds the index, the status legend, the template and the process, including [how a record is proposed and accepted](../adr/README.md#proposing-and-accepting).

## Documentation, roadmap and release notes

- **Documentation changes with behavior.** The change that alters behavior updates the page that owns that behavior, in the same pull request. When a page and the code disagree, fix the page.
- **One owner page per topic.** Other pages link to the owner instead of writing a second description. [The documentation hub](../README.md) lists the owners and the documentation conventions.
- **Current behavior only.** Pages describe what the software does now. They contain no history, no dates of changes, no working notes and no "planned" features. History belongs in `git log` and the changelog, and plans belong in the roadmap.
- **No drifting inventories.** Pages contain no counts, version tables or file lists that go stale. They point to the file or command that gives the authoritative answer. A default is quoted only together with the file it comes from.
- **Diagrams are rendered before they are committed.** GitHub shows a Mermaid block that fails to parse as an error box. Render each one, for example with `npx -y @mermaid-js/mermaid-cli -i diagram.mmd -o diagram.svg`.
- **The roadmap lists only what is missing.** The release commit removes the items that release ships ([How this roadmap works](../ROADMAP.md#how-this-roadmap-works)).
- **Release notes are written by hand in 24 languages**, and `CHANGELOG.md` is generated from them, never edited ([Release notes and the changelog](ci-and-release.md#release-notes-and-the-changelog)).

## Security in the process

SECURITY.md owns the [supply-chain and CI controls](../../SECURITY.md#supply-chain-and-ci) and the [secrets policy](../../SECURITY.md#secrets). What they mean for a change:

- **Pull-request code never runs on the self-hosted runner.** Every action is pinned to a full commit SHA, and token permissions are kept to the minimum. A new or changed workflow keeps all three properties.
- **Scans run on the way to `main`.** Trivy scans the repository and the application image. A CRITICAL or HIGH finding means the pull request is not merged until the finding is fixed or recorded in `.trivyignore`. CodeQL and OpenSSF Scorecard are non-blocking.
- **The repository holds no secrets.** No pre-commit hook scans for secrets. Before a change reaches `dev`, review is the only control. On the way to `main`, the Trivy filesystem scan also looks for embedded secrets. Leave the development placeholders in `docker-compose.yml` and `.env.example` as they are.

## Releases

- **Where releases come from.** A release is a `vX.Y.Z` tag on `main`, cut after the `dev` → `main` pull request is merged. `release.yml` runs on any `v*` tag, whatever branch it is on, so tagging the merge commit on `main` is the maintainers' responsibility.
- **The release commit.** The commit that prepares the release uses `chore(release): vX.Y.Z`. It carries the version, the release notes in all 24 languages, the regenerated `CHANGELOG.md` and the roadmap pruning.
- **The release workflow does not re-run the tests.** It builds and publishes the images, the SBOMs, the packaged chart and the GitHub Release. Tag only a commit whose `ci.yml` run on `main` is green.
- **CI never deploys.** Each installation upgrades when its operator decides, following [Upgrades and rollback](../operations/upgrades.md).

The workflows, the image tags and the step-by-step release procedure are in [CI, images and releases](ci-and-release.md).

## Related pages

- [CONTRIBUTING.md](../../CONTRIBUTING.md): the contributor's path from issue to merged pull request
- [Extending PA Webinar](extending.md): code conventions and a checklist for each kind of change
- [Testing](testing.md): test layers, commands and guard tests
- [CI, images and releases](ci-and-release.md): workflows, image tags and the release procedure
- [SECURITY.md](../../SECURITY.md): the security policy and supply-chain controls
- [GOVERNANCE.md](../../GOVERNANCE.md): roles, decisions and the roadmap policy
- [Local development](../DEVELOPMENT.md): running the stack on your machine
