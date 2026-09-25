# ADR-002: A single Next.js full-stack application

**Status:** Accepted

## Context

PA Webinar wraps Jitsi Meet in a portal ([ADR-001](001-jitsi-iframe-api.md)). The portal has several jobs:

- It serves public pages in 24 languages: the event catalog, event pages, registration, post-event pages and the video library. These pages must load fast, work with little client code and produce link previews.
- It runs the administration area and the moderator tools.
- It issues the Jitsi JWT for each seat and hosts the live panels (Q&A, polls, chat, word cloud, reactions, timer) with their streaming endpoints.
- It exposes endpoints for machine callers: scheduled jobs, the Jibri finalize script, the recorder bot and its controller, and the AI post-production worker.

Three constraints shape how this is packaged:

- **Reuse.** Other public administrations install PA Webinar themselves, either on a single VM with Docker Compose or on Kubernetes with the Helm chart. The portal therefore has to be easy to deploy, upgrade and roll back.
- **One image for every installation.** The same image must run in test and in production, and in every administration's installation. Anything that differs between installations has to come from the environment or from site settings, never from the build.
- **A small team.** One language for UI and server means types and validation rules are written once.

## Decision

The portal is one Next.js application: the `app` workspace in the repository's npm workspaces. It ships as one container image.

### App Router, Server Components by default

- The application uses the App Router. Pages are Server Components that read their data on the server.
- A component becomes a Client Component (`'use client'`) only when it needs browser state or browser APIs. Examples are the Jitsi embed, the live panels and interactive forms.
- One middleware runs in front of the pages. It handles locale routing and security headers, and it keeps visitors without a session out of the administration area. It is not an authorization layer: each page and each route handler decides for itself what its caller may see and do.

### Every mutation is a route handler

- Every mutation that a person or a machine requests is an HTTP request to a route handler, a `route.ts` file under `app/src/app/api/`. This includes the changes the administration area makes.
- Rendering never writes user input. The only writes during rendering are idempotent derivations: the settings row is created on first read, and the recap of an ended event is saved when its page is first viewed.
- The application has no Server Actions.
- Structured request bodies are validated with Zod, and the generated OpenAPI document reuses the same schemas.
- Each handler authenticates its own caller. The middleware does not run on `/api/*`, so there is no global authentication layer.

The reason is a single surface for people and machines. It can be reviewed route by route, exercised with `curl`, described in OpenAPI and called by clients that are not browsers. Conventions, the error shape and the route families are described in [API surface](../architecture/api.md).

### One standalone image

- The portal is built with Next.js standalone output. The image holds the traced server and the files it serves, and nothing needed only to build it.
- The image never runs database migrations. Migrations run from another stage of the same `Dockerfile`, before the portal starts.

### Runtime configuration, never build-time

Next.js replaces `process.env.NEXT_PUBLIC_*` in dot notation with its build-time value, in client and server bundles alike. A value read that way is frozen into the image. The image could then serve only the installation it was built for.

The rule is:

- Read `NEXT_PUBLIC_*` variables only through `getPublicEnv()` in `app/src/lib/env.ts`. It uses bracket notation, which the bundler leaves alone, so the value comes from the running process.
- Call it from Server Components and route handlers. Client Components receive the value as a prop from a Server Component.

The build-identity variables are the deliberate exception: `NEXT_PUBLIC_BUILD_VERSION`, `NEXT_PUBLIC_BUILD_SHA`, `NEXT_PUBLIC_BUILD_CHANNEL` and `NEXT_PUBLIC_BUILD_DATE`. They describe the image itself, so they are fixed when it is built.

Settings that an administrator changes without redeploying live in the `SiteSetting` singleton ([ADR-010](010-site-settings-singleton.md)).

### The square is bundled, not deployed

- The square is a separate npm workspace, `lobby/` (package `@pa-webinar/lobby`), built on Phaser. It has its own typecheck and a Vite test bench.
- It is not a separate deployable. Next.js compiles it into the portal, and it loads only in the browser, so Phaser stays out of the server and out of the main client bundle.
- The square's presence endpoint is an ordinary portal route. See [The waiting room and the square](../architecture/waiting-room.md) and the [lobby README](../../lobby/README.md).

## Consequences

### "One deployable" means the portal

The decision covers the portal only. Pages, the API, streaming endpoints and the endpoints that scheduled work calls all ship in the one Next.js image.

Work that cannot run in a web process ships as its own image: the recorder bot and its controller ([ADR-013](013-multitrack-speaker-attribution.md)), the post-production worker ([ADR-016](016-in-cluster-ai-postproduction.md)) and the patched `jitsi/web` ([ADR-017](017-patched-jitsi-web-image.md)). The migration image is the `builder` stage of the same `Dockerfile`. The full list of images and their tags is in [CI, images and releases](../development/ci-and-release.md#image-tags).

An installation also runs upstream images: the Jitsi components, PostgreSQL and Redis, plus others such as coturn and Jibri when those options are turned on.

### What the decision buys

- **One thing to deploy, upgrade and roll back** for the portal. Helm pulls the published image. Docker Compose builds its image from the same `Dockerfile`.
- **Scheduled work stays in the portal.** The chart's scheduled CronJobs and the Compose `cron` service are generic `curl` or `kubectl` containers that call `/api/cron/*` and `/api/internal/*` endpoints. The logic, its authentication and its tests all live in the application. The exception is the two suspended CronJobs that serve only as pod templates for the recorder bot and the post-production worker ([Scheduled and background jobs](../architecture/background-jobs.md#suspended-cronjobs-as-job-templates)).
- **Types and validation are written once.** UI code, route handlers and the OpenAPI document share the same TypeScript types and Zod schemas.
- **Replicas share no session state.** Sessions are signed cookies and live updates reach every replica through Redis, so the app tier scales horizontally. Per-process state is limited to short-lived caches, open streams and the approximate in-memory rate limiter ([The app tier in brief](../architecture/scaling.md#the-app-tier-in-brief)).
- **One image serves every installation and environment.** Values come from the environment and from `SiteSetting`.

### What it costs

- **The runtime-configuration rule is a convention.** No lint rule and no repository-wide test enforces it. Guard tests cover individual variables only. A dot-notation read of `NEXT_PUBLIC_*` compiles and works in local development, where build and runtime values match. It then silently freezes a value in the published image. Code review has to catch it. The codebase still contains a few such reads. Those with a visible effect are described in the configuration reference, under [Public variables are read at run time](../CONFIGURATION.md#public-variables-are-read-at-run-time) and [Build-time values](../CONFIGURATION.md#build-time-values). Each one is a defect against this decision, not a precedent.
- **More plumbing.** Without Server Actions, every administration form calls a route and handles its errors explicitly.
- **Shared processes.** Server-Sent Events connections are held by the same processes that render pages, so app-tier sizing has to account for open streams.
- **One framework couples everything.** A major Next.js upgrade touches pages, API and middleware at once.
- **Long work stays out.** Long-running or resource-heavy work cannot live in the portal. That is why recording and post-production have their own images and talk to the portal over HTTP.

## Alternatives considered

### A separate single-page application plus an API service

A static single-page application, served by a web server, plus a separate API service. It was rejected for these reasons:

- **Two deployables.** There would be two images to version and release together. They would also need either a cross-origin contract or a reverse-proxy contract between them.
- **Slower public pages.** Pages rendered in the browser load slower on first visit. Link previews and indexing would need extra work.
- **Shared code needs a home.** Types and validation would be duplicated, or would move into a third shared package.
- **Little to gain.** Most of the load in an event is media, and Jitsi Videobridge carries it. The portal's own traffic does not justify splitting the tier.

### Server Actions for mutations

Server Actions were rejected for mutations. They have no stable URL, so machine callers cannot call them and `curl` or OpenAPI cannot describe them. Mutations would also be split between two mechanisms, each with its own way of checking authorization.

### One build per installation

Baking each installation's `NEXT_PUBLIC_*` values into its own build was rejected. Every installation and environment would need its own image. An image tested in one environment could not be promoted to production unchanged.

## Implementation notes

**Middleware.** It lives in `app/src/middleware.ts`, next to `app/src/app/`.

- It handles locale routing, including redirects away from languages that are turned off.
- It sets the security headers, among them the Content Security Policy with its per-request nonce ([Content Security Policy](../SECURITY-CSP.md)).
- It runs a signature-only gate in front of the administration area. It accepts a valid administrator or organizer session, and it lets an event's management page through when the link carries a moderator token. Each page still authorizes the viewer itself.
- Its matcher excludes `/api/*`, `_next` assets and static files.

**Route handlers and validation.**

- No module declares `'use server'`.
- Shared Zod schemas live in `app/src/lib/validation/`. A few handlers check their fields by hand instead. Most of them read only one or two scalar fields. Another is the signed recording webhook (`app/src/app/api/webhooks/recording/route.ts`), which verifies the HMAC over the raw body, then parses it and checks its fields explicitly.

**Writes during rendering.**

- `getSettings()` in `app/src/lib/settings.ts` creates the `SiteSetting` row with an upsert on first read, then caches it per process for a short time.
- `ensureEventRecap()` in `app/src/lib/events/recap.ts` saves the recap of an `ENDED` event on the first view of its public page. The update only matches while no recap is saved yet.

**The image.**

- `app/next.config.ts` sets `output: 'standalone'`. It also sets `outputFileTracingRoot` to the workspace root, so that dependencies hoisted to the root `node_modules` are traced into the output.
- Standalone tracing follows imports. A file that the server reads from disk at run time, and that no module imports, is left out of the image unless `outputFileTracingIncludes` lists it. The fonts of the link-preview card route are an example.
- The root `Dockerfile` has three stages: `deps` → `builder` → `runner`.
- The runner stage holds the traced server, the static assets, `public/` and a small entrypoint (`scripts/docker-entrypoint.sh`) that waits for the database. It runs `node app/server.js` on port 3000 as a non-root user under `tini`, and never runs migrations. npm and npx are removed from it. Its Docker `HEALTHCHECK` calls `/api/health`.
- The migration image is the `builder` stage, which still carries the Prisma CLI. In the cluster, the `db-migrate` initContainer of the app Deployment runs `prisma migrate deploy` from it. Docker Compose runs the same stage as its `db-migrate` setup service.

**Public variables.**

- `getPublicEnv()` in `app/src/lib/env.ts` falls back to development defaults, defined in that file, for a few keys.
- Parse `NEXT_PUBLIC_APP_URL` only through `appBaseUrl()`, in the same file. It returns `null` for an empty or malformed value instead of throwing, so a misconfigured value cannot break a page or a route.
- The workflows pass the build-identity variables as build arguments. The `Dockerfile` gives the few other `NEXT_PUBLIC_*` variables it declares generic placeholder defaults and leaves the rest unset, so an image carries no installation's values. How the build identity is set and shown is described in [CI, images and releases](../development/ci-and-release.md#build-identity).
- Guard tests fail on a dot-notation read of a specific variable, for example `app/src/lib/jitsi/rnnoise.test.ts` and `app/src/lib/jitsi/whiteboard.test.ts`. `app/eslint.config.mjs` has no such rule.

**The square.**

- `app/next.config.ts` lists `@pa-webinar/lobby` in `transpilePackages`.
- The waiting room (`app/src/components/live/waiting-room.tsx`) loads the square's wrapper through `next/dynamic` with `ssr: false`.
- The workspace is typechecked with `npm run lobby:typecheck`.

## Related

- [API surface](../architecture/api.md): route conventions, validation, error shape and OpenAPI
- [Architecture](../ARCHITECTURE.md): building blocks and design properties
- [Configuration reference](../CONFIGURATION.md): the environment variables that `getPublicEnv()` reads
- [Scheduled and background jobs](../architecture/background-jobs.md): the jobs that call the portal's endpoints
- [CI, images and releases](../development/ci-and-release.md): the images and how they are built
- [Extending PA Webinar](../development/extending.md): code conventions that follow from this decision
- [ADR-001](001-jitsi-iframe-api.md), [ADR-010](010-site-settings-singleton.md), [ADR-013](013-multitrack-speaker-attribution.md), [ADR-016](016-in-cluster-ai-postproduction.md), [ADR-017](017-patched-jitsi-web-image.md)
