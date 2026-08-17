# Installed versions

A deployment record says what was *sent* to an environment. It does not say what
is *running* there — the pipeline that went green may have deployed to a
container that never restarted, and nothing in the platform's API would differ.
A version rule closes that gap: it reads the environment's own answer over HTTP
and files what it says beside the deployment that was supposed to put it there.

Like a [classification rule](classification-rules.md), a version rule is
**defined once for the whole install** and enabled source by source. The address
of a version endpoint follows a convention — one path under each environment's
URL, one host per customer — and a convention rarely stops at one repository
host.

## Which rule answers for an environment

Two RegEx narrow a rule, both optional:

| Field | Effect |
|---|---|
| `environment` | The rule only answers for environment names this matches |
| `repo` | The rule only answers within repos this matches |

Omitting one means "every one of them". Patterns are tested **unanchored** —
remember `^` and `$` if you want a match on the whole name.

Unlike a classification rule, a version rule does not **accumulate**: a version
is a single reading, so several matching rules cannot each contribute a piece of
it. They are candidates in turn, tried lowest `priority` number first until one
answers — see [Several addresses for one environment](#several-addresses-for-one-environment)
for what counts as an answer. An unreadable pattern keeps its rule quiet rather
than letting it apply everywhere.

## Where the probe goes

`urlTemplate` is filled per deployment:

| Placeholder | Resolves to |
|---|---|
| `{environmentUrl}` | The environment's address — published by the platform, or supplied by an [address rule](environment-addresses.md), which is what makes this placeholder usable on most installs |
| `{repo}` `{environment}` `{ref}` | The deployment's own fields |
| `{attr.<key>}` | An attribute from the classification rules |

Two shapes, both common:

```
{environmentUrl}/actuator/info
https://{attr.client}.example.com/{repo}/version
```

The second exists because the first is unavailable most of the time — neither
platform states an environment address unless one was explicitly configured.
A placeholder that cannot be resolved makes the rule **silent for that
deployment** rather than failing: the reading is filed with the reason, and no
request is made.

A template must begin with `http://`, `https://` or `{environmentUrl}`. Anything
else could only ever produce an address the probe would refuse.

## Reading the version out of the response

`format` decides how the body is read, and `template` how the version is
assembled from it. The template is literal text plus `{path}` placeholders, so
`v{build.version} (build {build.number})` is a version string.

**`json` and `xml`** are parsed into the same tree and addressed by path:

| Path | Reads |
|---|---|
| `build.version` | Descend by key |
| `components[1]` | Index into a list |
| `components[name=back]` | Select the element whose `name` is `back` |
| `project.@version` | An XML attribute |
| `version.#text` | The text of an element that also carries attributes |

XML is normalised so that **every element is a list**, whatever its cardinality.
Without it, a parser yields an object for one `<module>` and a list for two, so a
path written against a response holding one breaks in production and never in
testing. Paths written the obvious way keep working either way: a key steps
through a single-element list on its own, and `[0]` on a lone value yields that
value.

The path language stops there deliberately. It is small enough to be generated
by clicking a node in the response tree, and it evaluates nothing — JSONPath
filters, which several implementations run through the JS engine, would turn a
string typed into a form into code this process executes.

**`text`** is the escape hatch for what is neither JSON nor XML: a body holding
`1.4.2` and a newline, a page carrying the version in a meta tag. It takes a
`pattern` with named groups, which the template refers to by name.

> A path that resolves to nothing **fails the whole extraction**. `1.4.2-` and
> `1.4.2-undefined` are worse than no reading at all: they are wrong quietly,
> and they would be filed and shown beside a deployed ref as if they had been
> read. The same goes for a template holding no placeholder — a constant matches
> every response for ever, and is refused when the rule is saved.

## Several addresses for one environment

One application may state its version at more than one address — an actuator on
the installs upgraded this year, a static `version.json` on the ones that are
not — and which of them answers is a property of the environment, not something
anybody can enumerate in a pattern. So the rules claiming an environment are
tried **in turn** rather than reduced to one.

The order is the lowest `priority` number first, with one exception that
outranks it: **the rule that answered last time goes first.** That is stored on
the reading (`EnvironmentVersion.ruleId`) and is evidence, where the priority is
only what an author declared. Without it, an environment whose third address
answers would pay the first two — two addresses that do not exist, each held to
its five-second timeout — on every cycle, for ever. With it, that is paid once,
and again only when the address that was working stops.

**A forced run ignores it** and walks the declared order. The saving is for the
scheduled step; a person clicking *Read the installed versions* has usually just
written a rule, and a remembered one answering first is how a new rule gets
written, attached, and never tried. The deployment event keeps the preference,
being automatic in the same way the collection is.

The walk stops at the first rule that **reached the application**, which is not
the first that answered at all:

| Outcome | |
|---|---|
| No address could be built (`skipped`) | Try the next: nothing was asked, so nothing was learnt |
| The request failed (`unreachable`) | Try the next |
| The body is not the `format` the rule declared, or no `text` pattern matched | Try the next: this is somebody else's response |
| The body parsed as declared | **Stop**, whether or not the template read a version out of it |

A `200` alone is not an answer. A proxy answers `200` on every path, and a
single-page app serves its shell on all of them; a walk stopping there would
lock onto the wrong address and file nothing for ever while looking perfectly
reachable.

Stopping on a body that *parsed* but produced no version is the other half of
the same care. The rule reached what it was written for and the template is what
is wrong — walking on would file a version read somewhere nobody meant to ask,
and bury the failure that explains it.

When every address refuses, the reading filed is the attempt that **got
furthest**: answered with the wrong thing, then never answered, then could not
be addressed at all. One reading is filed per environment whatever the number of
attempts — the store holds one row per pair.

## Authentication

Optional, and one secret whatever the scheme:

| `authKind` | What is sent |
|---|---|
| `none` | Nothing |
| `bearer` | `Authorization: Bearer <secret>` |
| `basic` | `Authorization: Basic <base64 of the secret>`, the secret being `user:password` |
| `header` | `<authHeader>: <secret>` |

The secret lives in `Credential`, under the same AES-256-GCM envelope and the
same [master key](../runbooks/master-key.md) as the platform tokens. It never
comes back out of the API: a rule reports `hasSecret`, and nothing more.

## What the probe will not do

The URL is configuration typed into a form, and on a hosted install the person
typing it is not the person operating the backend. Everything below follows from
that:

- **`http` and `https` only.** `file:` reads the container.
- **The resolved address is checked, then connected to.** Loopback, private,
  link-local, carrier-grade NAT, multicast and the documentation ranges are all
  refused — and so is `169.254.169.254`, whose answer on a cloud host is a set
  of credentials. Checking the hostname would be theatre: a name resolves
  wherever its owner points it. The address that passed the check is the one the
  socket is handed, so a name answering differently the second time changes
  nothing.
- **No redirect is followed.** A `302` to an internal address would otherwise
  walk past the check above carrying the rule's secret. The redirect is reported
  instead, so its author points the rule where it was going.
- **A five-second timeout and a 256 KB ceiling**, because the endpoint belongs
  to somebody else and a collection cycle is waiting behind it.

Writing a rule does not require any of this: the editor's preview runs against a
**pasted body** by default, which touches no network at all.

## When it runs

With the collection, after the ingestion and before the changelog archiving —
what a reading confirms is the deployment that just went out, and running it
behind a batch of comparisons would confirm it a good deal later.

The run reads the rules first and stops when a source has none, so an install
using no version rule pays nothing for the feature. Otherwise it takes the
latest **successful** deployment of each `(repo, environment)` and reads the
ones that are due:

- an environment read less than **15 minutes** ago is left alone;
- unless **a deployment arrived since the last reading**, which makes it due
  immediately — waiting a quarter of an hour to confirm a deployment is not
  confirming a deployment;
- at most **25 environments per run**, four at a time. What is left over goes to
  the next cycle, which is a few minutes away.

These requests are made against the customer's own application, not against a
Git platform, so none of them touches the [API budget](api-quotas.md).

`POST /api/sources/:id/versions/probe` reads them all again now, for whoever is
watching a deployment go out. It **ignores the interval**, always: the route
exists for people, and the reading somebody is trying to replace is exactly the
one the interval would have protected — a manual run that answered `skipped`
would look broken. The batch cap stays, since a click is no reason to open two
hundred connections, and what it leaves behind is reported as `skipped`. The
scheduled step keeps both.

The outcome distinguishes three cases that look identical in the figures: **no
rule attached** to the source, **rules attached but no environment** collected
for them to describe, and the readings themselves. The Sources page carries the
button — on a saved source, since the run uses the rules the source is *stored*
with, and never inside the edit form, where it would answer for a selection that
has not been saved yet.

### And when a deployment event arrives

A source receiving webhooks gets a second trigger: a **successful** deployment
event queues a reading for the one environment it reached. Failed and running
events queue nothing — they put nothing on the environment, and a reading taken
against one would describe what was already there.

Four things make it behave:

- **A settling delay of 30 seconds.** The event fires when the platform calls
  the deployment done, which is before the application has finished coming back
  up. Read immediately and the answer is the version being *replaced* — frozen
  for ever against the deployment that replaced it.
- **One reading per environment, not per event.** A deployment emits several
  status events; the job id is derived from `(source, repo, environment)` and
  BullMQ refuses the duplicates, the same way a second click cannot start a
  second deep re-read. Two deployments landing a minute apart collapse too, and
  correctly: the job resolves its target when it runs, so the survivor describes
  whichever one actually went out last.
- **One retry, never a loop.** If the environment still answers the version it
  answered before, it usually had not restarted yet — so it is read once more,
  and only once. A redeployment of the same version is legitimate and looks
  identical from here, which is exactly why this stops instead of waiting for a
  change that may never come. Whatever was read is filed either way.
- **Its own queue, four at a time.** Fifty deployments landing at once is a
  normal afternoon; fifty simultaneous connections into customers' applications
  is not something any of them agreed to.

**The scheduled probe is unchanged, and there is no arbitration between the
two.** None is needed: the 15-minute interval means the collection does not
re-read what an event read a minute ago. A source without webhooks behaves
exactly as it did before — the event is an acceleration, never a prerequisite,
which is the same stance the ingestion takes.

## What is stored

Three tables. They look alike and they are not: each answers a question the
other two cannot, and the differences only show up when something goes wrong —
which is when this is read.

| Table | Answers | Grows with |
|---|---|---|
| `EnvironmentVersion` | what is running there **now** | nothing — one row per environment |
| `VersionChange` | when each version **arrived** | versions that actually moved |
| `DeploymentVersion` | what **one deployment** put there | deployments |

The redundancy is apparent rather than real, and the case that separates them is
this: somebody restarts a container by hand on an old image at two in the
morning. `EnvironmentVersion` shows the wrong version and says nothing about how
it got there. `DeploymentVersion` has no row for it — no deployment happened.
Only `VersionChange` records that the version moved with no deployment to
explain it, which is precisely the signal worth having. Drop it as redundant and
that night becomes invisible.

The other direction is just as sharp: `DeploymentVersion` is the only one that
survives being superseded. Once 1.4.3 goes out, no other table can still answer
"was 1.4.2 ever actually live".

`EnvironmentVersion` — one row per `(source, repo, environment)`, overwritten at
every reading. **A failed reading overwrites too**: an environment that stopped
answering must not go on displaying last week's version, which would read as a
deployment that never went out. The row carries the status:

| Status | Meaning |
|---|---|
| `ok` | Read, and the template produced a version |
| `unreachable` | The request was made and brought back nothing usable |
| `noMatch` | The response arrived; the template found nothing in it |
| `skipped` | No request was made — see the reason on the row |

Readings are handed out **already classified**: the store resolves each
`(repo, environment)` pair against the source's rules on the way out, exactly as
the deployments list does, so a grid crossing `client` and a metric sliced on
`client` mean the same thing. The attributes are not stored — rules are
configuration, and one corrected today has to apply to a reading taken
yesterday.

`VersionChange` — appended **only when the version differs** from the reading
before it. It is the timeline: "when did 1.4.2 reach prod", asked long after
1.4.3 replaced it. Written on change alone, a probe running every quarter of an
hour for a year costs the number of releases rather than thirty-five thousand
rows. It is also the only place a version that moved **without a deployment**
leaves a mark — a manual restart on an old image, a rollback done outside the
platform, a drift nobody declared.

It is read from **a cell of the version grid**, which is where the question
arises: one is looking at a version and wants to know since when, and what was
there before. The cell already knows the repo and the environment a dedicated
page would have to ask for again, so it opens the timeline directly — as a real
button, since it is an action and answers the keyboard like one. The pair
travels in the address beside the fold and the axes: a timeline nobody can paste
into a conversation is worth half of what it should be.

Three things that timeline has to get right:

- **A change with no deployment is the headline, not an edge case.** It is
  marked as such and stands out on the rail: something moved the version and the
  platform knows nothing about it, which is the one reading no per-deployment
  record can produce.
- **Durations are computed across page boundaries.** A version ends when the
  next one begins, so the first entry of any page but the first depends on a row
  that is *not on that page*. The store over-reads one row to close it — a
  timeline that is right in the middle and wrong at every joint would be worse
  than one with no durations at all.
- **The record starts when the rule started reading**, and the page says so
  under every page of the list. A short timeline is not a stable environment: it
  may be a rule written yesterday, and letting silence read as evidence is the
  mistake this note exists to prevent.

`DeploymentVersion` — one row per deployment, written by the same probe path
that updates the current state, so there is no second mechanism to keep in step.
It copies the repo, the environment, the ref and the deployment time rather than
pointing at `StoredDeployment`, which is swept to each source's depth: the
frozen row has to outlive it, exactly as `DeploymentChangelog` does.

Two things about it are worth stating plainly, because neither is guessable:

**It is an upsert, not a single write.** A later reading of the same deployment
is better evidence than an earlier one — the first can catch an application
mid-restart and read the version being replaced. Everywhere else that mistake
corrects itself at the next reading; a frozen row has no next reading, so
without the upsert it would be wrong for ever.

**A deployment replaced before any probe reached it will never have a version,
and that is not a defect.** It is what reading a version *is*: asking an
environment today answers about today. This is the one place where the
comparison with `DeploymentChangelog` breaks down — that one can be filed hours
late, because the commits it describes are still on the platform. A version has
one moment in which it can be taken, and if that moment passed, it passed. Hence
"not read" is a state the deployments page shows in words, never as an empty
cell: a blank invites somebody to go looking for the reading that would fill it.

It is also why the deployments page keeps a **fallback** to the environment's
current reading, on the most recent deployment of each environment only, marked
as the current state rather than as a confirmation — see
[Deployments](deployments.md). The frozen rows begin the day the rules do, and
without the fallback every deployment older than the feature would show nothing
for ever. The two claims are kept visually and textually apart, because "this
deployment put 1.4.2 live" and "1.4.2 is what answers there today" differ
exactly where it matters.

Each row also carries **how long after the deployment it was read**. A version
confirmed three seconds in says much less than one confirmed ten minutes in, and
the reader is the only one who can weigh that.

## Following one

The row filed against an environment carries **one** attempt — the one that
settled, or the one that got furthest when none did. That is the right thing to
show beside a version and not enough to diagnose a rule that reads nothing: the
question is usually about an address that was never tried, or one that was tried
and passed over. So the walk is kept, twice over.

### On the page

`POST /api/sources/:id/versions/probe` answers with a `trace`: one entry per
environment it walked, in the order it walked them, and inside each the rules in
the order they were tried — the address as requested, the response status, the
wall clock, what was read or the reason nothing was, and which single attempt
became the reading. The Sources page unfolds it under the run's figures, so the
question is answered where it is asked and nobody needs the API's logs to see
where a rule went.

An environment **no rule claims** is in the trace with no attempts, rather than
absent: it is the commonest reason a version never appears, and it is filed
nowhere. What the batch cap deferred has no entry at all — nothing was tried, so
there is nothing to say about it.

Addresses are stripped of their credentials on the way out and nowhere else: the
stored reading keeps what was actually requested, since that is its own record,
while this is read on a page and pasted into tickets. The secret a rule
[authenticates with](#authentication) never appears either way — it travels as a
header, and no header is carried.

### In the logs

The scheduled collection answers nobody, so the same walk narrates itself at
`debug`:

```
[VersionReadingsService] acme/api/prod: trying 2 of 5 rule(s) — Actuator → version.json
[VersionReadingsService] acme/api/prod · Actuator: GET https://api.acme.example.com/actuator/info → 404 in 83ms — errors.version.httpStatus
[VersionReadingsService] acme/api/prod · version.json: GET https://api.acme.example.com/version.json → 200 in 41ms
[VersionReadingsService] acme/api/prod · version.json: read 1.4.2
[VersionReadingsService] acme/api/prod: filing ok 1.4.2 from https://api.acme.example.com/version.json
```

Set `LOG_LEVEL=debug` to see it — the levels are `error < warn < log < debug <
verbose`, each including the ones before it, and the default is `log`. It is one
line per rule per environment per cycle, which is priceless for ten minutes and
noise for the rest of the year.

What the lines answer, in the order the questions actually come up:

| Line | Says |
|---|---|
| `none of the N rule(s) claim it` | The environment was read and no pattern matched. Nothing is filed on this path, so this is its only trace |
| `trying N of M rule(s) — a → b` | Which rules claimed it, **in the order they will be tried** — the remembered one first, then by priority |
| `no address — errors.version.noEnvironmentUrl (template)` | The rule claimed it and could not be addressed. The template is printed beside the placeholder that cost it |
| `GET url → 404 in 83ms` | The request as it went on the wire, with the status and the wall clock. Five seconds means the timeout |
| `read nothing — … (wrong address; trying the next)` | The body parsed as something else — the walk moves on |
| `read nothing — … (right address, template to fix; stopping here)` | The body parsed as declared and the path did not resolve. Trying another address here would hide the template to fix |
| `filing … from …` | Which of the attempts above became the row |

One line is said at the default level, because it is the shape of a
misconfiguration rather than of a bad afternoon: **every environment read, none
answering**. It names the source and what to turn on.

## The routes

| Route | What it does |
|---|---|
| `GET /api/version-rules` | The catalogue |
| `POST /api/version-rules` | Create — patterns, template and URL are validated here |
| `PATCH /api/version-rules/:id` | Update; an omitted secret keeps the stored one, an empty one clears it |
| `DELETE /api/version-rules/:id` | Delete, secret included |
| `POST /api/version-rules/preview` | Run a candidate rule over a pasted body, or over one it reads |
| `GET /api/sources/:id/versions` | What each environment was last seen running |
| `GET /api/sources/:id/versions/history` | Every version one environment has run, newest first — takes `repo` and `environment` |
| `POST /api/sources/:id/versions/probe` | Read them all again now, interval ignored — answers with the [walk](#on-the-page) as well as the figures |

Everything except `GET /api/sources/:id/versions` is **admin-only**. That is not
uniformity for its own sake: `preview` reads an address it is given and hands
back the answer, which is a capability rather than a report.

The deployments report carries the readings alongside its rows — see
[Deployments](deployments.md) — rather than on each row: a reading describes an
environment at a moment, not the deployment that happens to be listed, and
repeating it on every row would suggest each had been confirmed separately.

## Reading them across the estate

The overview's fourth direction, **Versions**, crosses the readings into a grid
whose axes the reader picks: `repo`, `environment`, or any classification key.
The overview report carries them under `versions`, and **empty for a caller
without an account** — like the queue state and the quota, since a version names
the release each public address is exposing.

They obey the page's filters — the repo scope, the dimensions and the
meta-environment — like everything else on it: a reader who narrowed to one
client is asking every part of the page the same question. **Not the period**,
for the reason the live environments escape it too: a version that has not moved
for forty days is precisely what this view exists to show, and narrowing to the
window would drop the rows worth looking at. The other lists are reports *over*
a period; this one is a statement about now.

One thing is decided **before** any layout: whether a reading is *behind*. It is
compared against the furthest release its own repo runs anywhere, never against
the row it happens to be displayed in — cross the grid on `client` and a row
holds several repos, and `api 1.5.0` beside `front 2.1.0` says nothing at all.
Judging per reading is what makes the free axes safe: the same reading is
flagged whichever way the grid is turned.

Two readings can land on one cell once the axes are free. Agreeing on a release,
the cell shows it with the matrix's `+N`; disagreeing, it says so and names no
version — answering with one of them would claim a set of environments runs a
release it does not agree on.

> A rule applies to nothing until a source selects it. `SourceVersionRule`
> carries the selection, written from the source form, exactly as `SourceEnvRule`
> does for classification.
