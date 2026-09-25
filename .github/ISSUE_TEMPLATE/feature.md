---
name: Feature request
about: Propose a new capability or a change to how PA Webinar behaves
title: 'feat: '
labels: enhancement
assignees: ''
---

<!--
  SECURITY: a weakness that someone could exploit is not a feature request.
  Report it privately, as described in SECURITY.md:
  https://github.com/italia/pa-webinar/security
-->

<!--
  PUBLIC ISSUE: describe the general case that any public body would
  recognize. Leave out the names of internal events, meetings, people and
  organizations, internal ticket codes, and the hostnames of your
  installation (use webinar.example.com instead). Never paste a moderator
  link or any URL with `?token=`: these are working credentials.
-->

## Already on the roadmap?

<!--
  The feature tour lists what PA Webinar already does. The roadmap lists only
  what is missing, including the known limitations of shipped features.
  If your request is already there, name the item and add your use case.
-->

- [ ] I checked the [feature tour](https://github.com/italia/pa-webinar/blob/main/docs/FEATURES.md) and the [roadmap](https://github.com/italia/pa-webinar/blob/main/docs/ROADMAP.md), including its [known limitations](https://github.com/italia/pa-webinar/blob/main/docs/ROADMAP.md#known-limitations-of-shipped-features).
- Related roadmap item or issue, if any:

## The problem and who has it

<!--
  Describe the problem before any solution: what cannot be done today, or
  what is hard, and what it costs (time, mistakes, accessibility, compliance).
  Then tick every role that has the problem.
-->

- [ ] Participant (registrant or guest)
- [ ] Moderator or speaker
- [ ] Organizer
- [ ] Administrator
- [ ] Operator who runs the installation
- [ ] Controller or data protection officer (DPO)
- [ ] Developer or integrator reusing the code

## Proposed behavior

<!--
  What should PA Webinar do? Write the general case, for example
  "a fixed-cadence series" or "a moving-date series", not one specific event.
  Refer to people by role ("the moderator", "Speaker 1"), never by name.
  Say what each affected role sees and does, and what stays unchanged.
  Alternatives you considered are welcome.
-->

## Acceptance criteria

<!--
  Checks a reviewer can verify on a running installation, one per line.
  A useful shape: "Given <state>, when <role> does <action>, then <observable result>."
-->

- [ ]

## Technical notes

<!--
  Optional. Components, routes or data you expect to change, and anything a
  reviewer should weigh:
  - Personal data: does it collect, store or show new personal data?
    See docs/GDPR.md.
  - Configuration: is it set per event, per installation (site settings),
    or switched on during a live event?
  - Languages: every user-facing string ships in all 24 interface languages.
  - Jitsi: can it be done through the IFrame API or Jitsi configuration?
    See docs/architecture/jitsi-integration.md.
  - Architecture: a new component, a new external service, a new data
    domain, or a change to a trust boundary or to the Jitsi boundary needs an
    Architecture Decision Record first. See docs/adr/README.md.
-->

## Mockups

<!--
  Optional. Sketches, wireframes or screenshots. Remove personal data first.
  The interface follows the .italia design system (Bootstrap Italia and
  design-react-kit).
-->
