---
name: Bug report
about: Report something in PA Webinar that is broken or does not work as documented
title: 'fix: '
labels: bug
assignees: ''
---

<!--
  SECURITY: do not report vulnerabilities in a public issue.
  Report them privately through one of the channels in SECURITY.md:
  https://github.com/italia/pa-webinar/blob/main/SECURITY.md#how-to-report
-->

<!--
  PERSONAL DATA: this issue is public. Before you paste text, logs or
  screenshots, remove names, email addresses, IP addresses and the hostnames
  of your installation (use webinar.example.com instead). Also remove every
  credential: moderator links and any link from a PA Webinar email (many
  carry a credential in `?token=` or `?t=`), API keys, cookies and JWTs.
-->

## Description

<!-- What is broken, in one or two sentences. -->

## Steps to reproduce

<!--
  Start from a known state: the event status (for example `PUBLISHED`,
  `LIVE` or `ENDED`) and the settings that matter, such as whether
  registration is required.
-->

1.
2.
3.

## Expected behavior

<!-- What you expected to happen. -->

## Actual behavior

<!-- What happened instead. Include the exact error message, if any. -->

## Environment

- Version: <!-- shown in the page footer: `vX.Y.Z`, or "development build" ("build di sviluppo" in Italian), followed by a commit hash when the build has one. Or give the image tag you installed (`ghcr.io/italia/pa-webinar:X.Y.Z` or `:dev-<sha>`). -->
- Your role: <!-- participant (registrant or guest), moderator, speaker, organizer, administrator, or operator -->
- Interface language: <!-- for example `en`, as in the URL prefix `/en/` -->
- Browser and version:
- Operating system:
- Installation: <!-- Docker Compose on a single VM; Helm with the `simple`, `standard` or `full` profile (`jitsi.mode`); or Helm with an external Jitsi (`jitsi.enabled: false`) -->

## Screenshots and logs

<!--
  Optional. Paste logs inside a code block.
  Remove personal data and credentials first (see the note at the top).
-->
