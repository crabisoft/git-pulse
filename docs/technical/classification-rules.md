# Classification rules

A rule is a RegEx **defined once for the whole install**, then enabled source
by source from the source form. A pattern describes a naming convention, and a
convention rarely stops at one repository host — binding rules to a single
source meant retyping them for the next one.

Two independent axes:

- **`kind`** — `simple` extracts attributes through named groups (`(?<app>…)`
  yields `app=…`); `meta` only tests membership and adds the **rule name** as a
  meta-environment. A `meta` rule ignores its named groups entirely.
- **`target`** — `environment` applies to deployment environment names,
  `repository` to repo names, `incident` to incident labels.

`repository` rules exist because a pull request has no environment: without
them, `lead_time`, `coding_time`, `pickup_time` and `review_time` all fall into
a single global bucket. Classifying the repo name gives them the same
dimensions deployment metrics already have.

`incident` rules exist for the same reason: an incident has no environment
either, and its labels are how it joins the deployment dimensions. An incident
accumulates the attributes of every label it carries; on conflict the first
label wins, labels being sorted so the outcome does not depend on the tracker's
ordering.

`GET /api/env-rules?target=repository` lists the catalogue one target at a time
(`environment` by default). `POST /api/sources/:id/env-rules/classify` classifies
against the rules that source opted into, which is what the collectors use.
Patterns are tested **unanchored** — remember `^` and `$` if you want a match on
the whole name.

> A rule applies to nothing until a source selects it. `SourceEnvRule` carries
> the selection, written from the source form — with select-all and clear
> shortcuts, since a catalogue of dozens is the normal case.
