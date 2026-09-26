# Email delivery (SMTP)

PA Webinar hands every outgoing email to one SMTP relay that the operator provides. It has no mail server of its own and no provider-specific API integration. Any relay that accepts SMTP submission works, from a commercial service to the public body's own mail server.

A working relay is required. Registration confirmations with the personal join link, reminders, date-change notices, post-event follow-ups, the links of moderators and speakers, the one-time sign-in links of staff accounts and the verification links of data-subject requests all travel by email. Without a relay, none of them arrives. Only the instance API key (`ADMIN_API_KEY`) signs in to the administration area without email.

This page covers the transport: the settings, where they live, provider examples and problems on the relay side. How mail moves inside the platform (the outbox, the catalog of emails, languages, the sender identity and how to trace a missing message) is in [Email and calendar](../architecture/email.md). The schedule of the job that sends the mail is in [Scheduled and background jobs](../architecture/background-jobs.md#email-outbox).

## How the platform uses the relay

- **Only the portal talks to the relay, and only from the `email-outbox` job.** Features queue their messages in the email outbox and never wait for SMTP. The job calls `GET /api/cron/email-outbox` once a minute, both in the Helm chart and in Docker Compose, and that request is what opens SMTP connections. If the job does not run, the relay is never contacted.
- **One pooled transport per app process.** It is created at the first send. Like every environment variable, the `SMTP_*` values are read when the app container starts, so a change takes effect only after the app pods restart ([A corrected setting has no effect](#a-corrected-setting-has-no-effect)).
- **Failures are retried, then given up.** A failed send is retried with backoff, and the row becomes `FAILED` after the attempt limit. The relay's answer is stored in the row's `last_error` column. The job does not tell temporary replies (4xx) from permanent ones (5xx): an address the relay rejects for good still uses every attempt before it is marked `FAILED` ([A row's life](../architecture/email.md#a-rows-life)).
- **Throughput is capped by the platform, not by the relay.** Each run sends at most one batch, so the outbox delivers at most about 50 messages a minute ([Throughput and timing](../architecture/email.md#throughput-and-timing)). The relay's rate limit should allow at least that; otherwise sends are throttled, retried with backoff, and can end as `FAILED` (see [Many rows retried with `421`, `450`, `451` or `452`](#many-rows-retried-with-421-450-451-or-452)).

## Transport settings

The transport is built in `app/src/lib/email/send.ts`, and every default below comes from that file.

| Variable | Default | Meaning |
|---|---|---|
| `SMTP_HOST` | None | Hostname of the relay. Use the name on the relay's TLS certificate, not an IP address. If it is missing, the portal logs `Missing recommended environment variables` at startup and keeps running. The mail library then tries `localhost`, and every send fails with an error that names a loopback address (`127.0.0.1` or `::1`). |
| `SMTP_PORT` | `587` | Port of the relay. |
| `SMTP_SECURE` | `false` | Only the exact string `true` turns on implicit TLS, where the connection is encrypted from the first byte (port 465). Any other value, including `TRUE` or `1`, opens a plain connection that switches to TLS with STARTTLS. See [Matching TLS mode and port](#matching-tls-mode-and-port). |
| `SMTP_USER`, `SMTP_PASSWORD` | Empty | Credentials for SMTP authentication. They are sent only when both are set. If either one is empty, the portal connects without authenticating. |
| `SMTP_FROM` | `noreply@dominio.gov.it`, only when the variable is absent | Sender address, used both in the `From` header and as the envelope sender. It must be an address the relay is authorized to send as. An **empty** value does not get the fallback: messages then leave with an empty sender address ([Sender name, address and reply-to](../architecture/email.md#sender-name-address-and-reply-to)). |
| `SMTP_FROM_NAME` | The site name, then "PA Webinar" | Display name used by the deployment. The **Sender name** field in the administration area overrides it. |
| `SMTP_POOL_MAX_CONNECTIONS` | `5` | Maximum number of simultaneous connections one app process opens to the relay. |
| `SMTP_POOL_MAX_MESSAGES` | `100` | Messages sent over one connection before it is closed and replaced. |

### Matching TLS mode and port

`SMTP_SECURE` must match the port. The portal always passes the setting to the mail library explicitly, so the library never turns on implicit TLS for port 465 by itself: port 465 needs `SMTP_SECURE=true` spelled out.

| Port | `SMTP_SECURE` | Result |
|---|---|---|
| 587 | `false` | Recommended. The connection starts in plain text and switches to TLS with STARTTLS when the relay offers it. |
| 465 | `true` | Implicit TLS: the connection is encrypted from the first byte. |
| 587 | `true` | Fails at once. The client starts a TLS handshake the server does not expect, and `last_error` shows an OpenSSL `wrong version number` error. |
| 465 | `false` | Fails slowly. The client waits for a plain-text greeting that never comes, and `last_error` reads `Greeting never received`. |
| 25 | `false` | Works on paper, but many cloud platforms block or throttle outbound port 25. Use 587. |

The transport has two limits to keep in mind:

- **STARTTLS is opportunistic.** On port 587 the client switches to TLS only if the relay advertises STARTTLS, and no setting makes it mandatory. If the relay does not offer it, messages travel to the relay unencrypted, personal join links and sign-in links included. Credentials travel unencrypted too, if the relay accepts them without TLS. For a relay outside your own network, use one that always offers STARTTLS, or use port 465.
- **Certificates are always verified.** A certificate that does not match `SMTP_HOST`, is self-signed, or comes from a private certificate authority is rejected, and no SMTP setting relaxes the check. To trust a private certificate authority, see [Certificate errors](#certificate-errors).

### Sender identity

The sending address comes only from `SMTP_FROM`. The display name and the reply-to address can also be set by administrators under **Settings** > **General** > **Features** > **Email sender**, with the **Sender name** and **Reply-to address** fields. Those two fields are read from the site settings at send time, through a per-process cache that lasts up to a minute, so a change needs no restart and applies within about a minute. The precedence rules, and what an empty `SMTP_FROM` does to calendar files, are in [Sender name, address and reply-to](../architecture/email.md#sender-name-address-and-reply-to).

Set a **Reply-to address**. `SMTP_FROM` is normally a no-reply mailbox, so without a reply-to address a registrant's reply reaches nobody.

### Connection pool

Each app process keeps its own pool. It holds up to `SMTP_POOL_MAX_CONNECTIONS` open connections and replaces each one after `SMTP_POOL_MAX_MESSAGES` messages, so the TCP, TLS and login handshake happens once per connection instead of once per email.

The outbox job sends five messages at a time (`PARALLELISM` in `app/src/app/api/cron/email-outbox/route.ts`), and each run is served by a single pod. Raising `SMTP_POOL_MAX_CONNECTIONS` above 5 therefore does not speed up delivery. Lowering it is useful when the relay limits concurrent connections per client: the extra sends wait for a free connection inside the pool.

## Where the settings live

| Installation | Where to set the `SMTP_*` values | What to watch |
|---|---|---|
| Helm, `secrets.mode: existing` (the chart default) | The application Secret named by `secrets.existingSecretName` | `infra/helm/pa-webinar/templates/secret.yaml` lists the `SMTP_*` keys among the keys the Secret should hold, but nothing checks that they are there. |
| Helm, `secrets.mode: external` | The External Secrets mapping for your provider | The default `secrets.external.azureKeyVault.secretMappings` in `infra/helm/pa-webinar/values.yaml` maps only `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` and `SMTP_PASSWORD`. The AWS and GCP mappings are empty. Add `SMTP_FROM`, `SMTP_FROM_NAME` and, for port 465, `SMTP_SECURE`, either to the mapping or to `app.env`. Otherwise the sender falls back to the placeholder address. |
| Helm, `secrets.mode: generate` (development and test only) | `secrets.generate.SMTP_*` | The defaults are port `587` and `SMTP_SECURE` `"false"`. Everything else is empty, including `SMTP_FROM`, so set it. |
| Helm, any mode | `app.env` | Rendered into the ConfigMap. This suits the keys that are not secret and the two pool settings. The container reads the ConfigMap and the Secret through `envFrom`. If a key is in both, the Secret's value wins, because it is listed last. |
| Docker Compose | `environment` of the `app` service in `docker-compose.yml` | It points at the bundled Mailpit out of the box. The values are written literally in the file, so a shell or `.env` override has no effect. For a real relay, set them in a `docker-compose.override.yml` for the `app` service, then run `docker compose up -d app`. |
| Next.js on the host | `app/.env`, created from the template `.env.example` | The template already points at Mailpit on `localhost:1025`. |

Two consequences for Helm installations:

- **Restarts.** The Deployment carries a checksum of the ConfigMap only. A `helm upgrade` that changes `app.env` restarts the app pods. A change made only in the Secret, whether by hand, by External Secrets or through `secrets.generate`, does not. Restart the pods yourself: `kubectl -n pa-webinar rollout restart deployment/pa-webinar`.
- **NetworkPolicy.** With `networkPolicy.enabled: true`, the app pods may reach the relay only on `networkPolicy.egress.smtpPort` (587 by default). `networkPolicy.egress.allowImplicitTlsSmtp: true` also opens 465. A relay on any other port, such as 2525, needs `smtpPort` set to match. The policy also affects the scheduled jobs; see [Before enabling the NetworkPolicy](../architecture/background-jobs.md#before-enabling-the-networkpolicy).

The complete environment reference and the secrets map are in [Configuration reference](../CONFIGURATION.md). Secret modes and install walkthroughs are in [Deploying with Helm](../DEPLOYMENT.md).

## Choosing a relay

- **The relay sees everything in the email.** The outbox encrypts the recipient and the body at rest in the database, but the relay receives them in clear: addresses, names in greetings, personal join and sign-in links, calendar attachments. The provider is a processor of personal data. Prefer processing in the EU, put a data processing agreement in place, and name the provider in the privacy notice and in the service inventory ([Privacy notice checklist for controllers](../privacy/privacy-notice-checklist.md), [Service inventory: generating the document](../SERVICE-INVENTORY-GENERATION.md)).
- **The sending domain must be authenticated.** Publish the SPF and DKIM records the provider gives you for the domain of `SMTP_FROM`, and a DMARC policy. The portal cannot fix alignment problems: it only hands the message over.
- **The platform does not process bounces.** Bounces and complaints go to the relay's return path. Check the provider's logs and suppression lists when a message was accepted but never arrived.

## Provider examples

The examples below list the keys as they go in the application Secret, or in `secrets.generate` for a test installation. Replace every `<placeholder>`. `SMTP_FROM_NAME` is optional in all of them.

### Mailgun (EU region)

```yaml
SMTP_HOST: "smtp.eu.mailgun.org"
SMTP_PORT: "587"
SMTP_SECURE: "false"
SMTP_USER: "postmaster@mg.webinar.example.com"
SMTP_PASSWORD: "<mailgun-smtp-password>"
SMTP_FROM: "no-reply@mg.webinar.example.com"
SMTP_FROM_NAME: "<public body> webinars"
```

- `smtp.eu.mailgun.org` is the endpoint for sending domains created in Mailgun's EU region. A domain's region is fixed when it is created.
- The user and password are an SMTP credential of the sending domain, managed per domain in the Mailgun control panel. They are not the account login.
- For implicit TLS, use port `465` with `SMTP_SECURE: "true"`, and set `networkPolicy.egress.allowImplicitTlsSmtp: true` if the NetworkPolicy is enabled.

### Azure Communication Services

```yaml
SMTP_HOST: "smtp.azurecomm.net"
SMTP_PORT: "587"
SMTP_SECURE: "false"
SMTP_USER: "<acs-resource-name>.<entra-app-id>.<entra-tenant-id>"
SMTP_PASSWORD: "<entra-app-client-secret>"
SMTP_FROM: "DoNotReply@<verified-domain>"
SMTP_FROM_NAME: "<public body> webinars"
```

- This needs an Email Communication Services resource with a verified domain connected to the Communication Services resource, and a Microsoft Entra application that has permission to send through that resource.
- The password is a client secret of that Entra application. Client secrets expire, so plan their rotation, and restart the app pods after each one.
- The service also accepts an SMTP username defined on the Communication Services resource in place of the three-part user shown above.
- `SMTP_FROM` must be a sender address configured on the connected domain.

### SendGrid

```yaml
SMTP_HOST: "smtp.sendgrid.net"
SMTP_PORT: "587"
SMTP_SECURE: "false"
SMTP_USER: "apikey"
SMTP_PASSWORD: "<sendgrid-api-key>"
SMTP_FROM: "no-reply@webinar.example.com"
SMTP_FROM_NAME: "<public body> webinars"
```

- `SMTP_USER` is the literal string `apikey`.
- The password is an API key with permission to send mail.
- `SMTP_FROM` must be a verified sender, or belong to an authenticated domain.

### Generic SMTP relay

This covers the public body's own mail server and any other SMTP service, such as the regional SMTP endpoint of Amazon SES with its SMTP credentials.

```yaml
SMTP_HOST: "smtp.example.com"
SMTP_PORT: "587"
SMTP_SECURE: "false"
SMTP_USER: "webinar@example.com"
SMTP_PASSWORD: "<password>"
SMTP_FROM: "webinar@example.com"
SMTP_FROM_NAME: "<public body> webinars"
```

- **Relay that allows by source address, without authentication.** Leave `SMTP_USER` and `SMTP_PASSWORD` empty. The relay sees the address that outbound traffic leaves the cluster from, which is usually a NAT gateway or a node address rather than a pod address. Allow that address on the relay.
- **Relay with a certificate from a private certificate authority.** See [Certificate errors](#certificate-errors).

### Mailpit (development only)

```yaml
SMTP_HOST: "mailpit"      # "localhost" when Next.js runs on the host
SMTP_PORT: "1025"
SMTP_SECURE: "false"
SMTP_FROM: "no-reply@webinar.example.com"
```

- Docker Compose starts Mailpit with the rest of the stack. It listens for SMTP on port 1025 and serves its web interface at `http://localhost:8025`.
- It accepts any credentials and keeps every message, so nothing reaches a real inbox.
- A message reaches Mailpit only when something drains the outbox. In Compose, that is the `cron` service. When Next.js runs on the host, drain the outbox yourself as described in [Local development](../DEVELOPMENT.md#nextjs-on-the-host).

The local stack is described in [Local development](../DEVELOPMENT.md).

## Troubleshooting delivery

Start with [Tracing a missing email](../architecture/email.md#tracing-a-missing-email). The message's row in `email_outbox` shows whether it was never queued, is waiting for the job, is being refused by the relay or was accepted, and `last_error` holds the relay's answer. The entries below cover causes in the transport settings and on the relay side. The error texts quoted are those of the mail library and of OpenSSL, followed in `last_error` by whatever the relay replied.

### Rows stay `PENDING` with `attempts` at 0

Nothing drains the outbox; no SMTP setting is at fault yet. See [Tracing a missing email](../architecture/email.md#tracing-a-missing-email) and [email-outbox](../architecture/background-jobs.md#email-outbox).

### `wrong version number`

**Cause.** `SMTP_SECURE` is `true` on a port that expects STARTTLS, usually 587.

**Fix.** Set `SMTP_SECURE` to `false`, or move to port 465, and restart the app pods.

### `Greeting never received`

**Cause.** The port expects implicit TLS, usually 465, but `SMTP_SECURE` is not exactly `true`. This also happens when an External Secrets mapping leaves out `SMTP_SECURE`.

**Fix.** Set `SMTP_SECURE` to `true`, or move to port 587, and restart the app pods.

### `Connection timeout` or `ECONNREFUSED`

**Cause.** The portal cannot open a connection to the relay. The usual reasons are:

- the chart's NetworkPolicy allows SMTP only on `networkPolicy.egress.smtpPort` (587 by default), plus 465 when `networkPolicy.egress.allowImplicitTlsSmtp` is `true`; dropped packets surface as `Connection timeout` after about two minutes;
- a cloud firewall or the platform blocks the port, which is common for port 25;
- the relay allows only certain source addresses;
- `SMTP_HOST` is missing, so the library tries `localhost`, and the error names a loopback address (`127.0.0.1` or `::1`).

**Fix.** Set `SMTP_HOST`. Align `networkPolicy.egress.smtpPort` with `SMTP_PORT`. Allow the cluster's outbound address on the relay. Prefer port 587 over 25.

### `Invalid login`, `535`, or `530 Authentication required`

**Cause.** The relay rejects the credentials, or it requires authentication and none was sent:

- `535` usually means the credentials are wrong, have expired (an Entra client secret, for Azure Communication Services) or were revoked;
- `530` means the portal did not authenticate at all, because `SMTP_USER` or `SMTP_PASSWORD` is empty. Authentication is attempted only when both are set.

**Fix.** Correct or rotate the credential in the Secret, then restart the app pods.

### The relay refuses the sender: `550`, `553` or `554`

**Cause.** The sender address is not one the relay will send as. Look at the address in the error:

- `noreply@dominio.gov.it` means `SMTP_FROM` never reached the pod, which is typical of an External Secrets mapping that leaves it out;
- an empty sender means `SMTP_FROM` is set but empty;
- any other address is not verified with the provider, or belongs to a domain the relay does not handle.

**Fix.** Set `SMTP_FROM` to an address the provider has verified, then restart the app pods.

### Certificate errors

**Symptoms.** `self-signed certificate`, `unable to get local issuer certificate`, or `Hostname/IP does not match certificate's altnames`.

**Cause.** One of these:

- the relay's certificate does not match `SMTP_HOST`, often because `SMTP_HOST` is an IP address;
- the certificate is self-signed;
- the certificate is issued by a private certificate authority.

**Fix.**

- Set `SMTP_HOST` to the name on the certificate.
- For a private certificate authority, give Node.js the authority's certificate. Mount the CA bundle into the app container with `app.extraVolumes` and `app.extraVolumeMounts`, and set `NODE_EXTRA_CA_CERTS` in `app.env` to its path. Node.js reads the variable when it starts.
- Those two lists replace the chart defaults, so copy the default `tmp` and `next-cache` volumes into your override. The root filesystem is read-only, and the portal needs them.

### Many rows retried with `421`, `450`, `451` or `452`

**Cause.** The relay is throttling: a per-minute or daily quota, a cap on concurrent connections, or greylisting. The outbox can send about 50 messages a minute, which a small plan may not allow.

**Fix.**

- Raise the plan's limits.
- Lower `SMTP_POOL_MAX_CONNECTIONS` if the relay limits concurrent connections.
- Throttled messages are retried with backoff and usually go out later. The ones that used every attempt become `FAILED`. [Tracing a missing email](../architecture/email.md#tracing-a-missing-email) shows how to queue them again.

### Rows are `SENT` but mail lands in spam or never arrives

**Cause.** The relay accepted the message, so the platform's part is done. What remains is sender reputation and authentication, or the recipient's address being on the provider's suppression list after an earlier bounce.

**Fix.**

- Check the SPF, DKIM and DMARC alignment of the `SMTP_FROM` domain.
- Check the provider's delivery log and suppression list.
- A **Reply-to address** does not affect deliverability, but it lets registrants answer.

### A corrected setting has no effect

**Cause.** Environment variables are read when the app container starts, and a change made only in the Secret (by hand, by External Secrets or through `secrets.generate`) does not restart the pods. This applies to every `SMTP_*` variable, `SMTP_FROM` and `SMTP_FROM_NAME` included. The **Sender name** and **Reply-to address** fields are the exception: they come from the site settings and apply within about a minute.

**Fix.**

- Helm: `kubectl -n pa-webinar rollout restart deployment/pa-webinar`.
- Docker Compose: `docker compose up -d app`, which recreates the container with the new environment.
- Next.js on the host: restart the dev server after editing `app/.env`. The SMTP transport is built once per process, at the first send, and keeps the connection settings it was built with.

Symptoms that span several subsystems are collected in [Troubleshooting](../operations/troubleshooting.md).
