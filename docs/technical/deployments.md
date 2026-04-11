# Deployments

`GET /api/sources/:id/deployments` lists what went where, over a period, with
the environment resolved against the classification rules. The attributes on a
row are the very ones DORA slices on, so a line here and a slice of a metric
mean the same thing by construction rather than by convention.

The filters split the same way the DORA report's do:

| Parameter | Effect |
|---|---|
| `from` / `to` / `windowDays` | Period — the shared resolution, not a second one |
| `repos` | **Scopes collection** (repeatable or comma-separated) |
| `environment` | Environment names, exact, repeatable |
| `status` | Deployment statuses, repeatable |
| `dimension` | `key:value` pairs from the classification, all must match |

Vocabularies — repos, environments, statuses, dimensions — are computed **before
the filters apply**, so narrowing one never empties the list you pick the next
one from. A meta-environment is offered under the key `@meta`: it is a
membership rather than an attribute, and the `@` is there because a rule
extracting an attribute literally named `meta` is entirely plausible.

> The period logic is `resolvePeriod`, shared with DORA rather than restated.
> Two implementations of "what does an omitted `to` mean" would drift, and a
> period is what every number on screen is relative to.

The payload also carries what each row's environment was running — see
[Installed versions](versions.md) — which is what tells a pipeline that went
green apart from a deployment that actually arrived. Three fields, because a
row can be in three states:

| Field | What it is |
|---|---|
| `versions` | the reading **frozen against each listed deployment**, at most one per row |
| `currentVersions` | what each environment answers **now**, one per (repo, environment) |
| `versionRules` | how many version rules the source has attached |

A row shows its frozen reading when it has one — that is the strong claim, made
about the deployment itself. Failing that, and **only on the most recent
deployment of its environment**, it shows the current reading, marked as the
environment's state rather than as something that deployment delivered. On an
older row that would simply be false: something newer went out since. Everything
else reads "not read", which is a fact and not a gap — a version cannot be read
after the event.

The fallback exists because the frozen rows only start the day version rules do:
without it, every deployment older than the feature would be blank for ever.

`versionRules` is what decides whether the column appears at all, and
deliberately not "are there any readings". A source configured five minutes ago
has rules and nothing read, which is exactly when somebody goes looking for the
column to find out why it is empty.

Every ref on the page — the deployed one, and the base it is compared against —
is a **link to the platform's page for it**. Unlike an environment's address
this one is derivable, so it is built rather than read: `refUrl` takes the
platform, the base URL, the owner and the repo, all of which `readSpec` carries
without decrypting anything. One shape covers a branch, a tag and a commit,
since both platforms resolve `tree/<ref>` against whichever it turns out to be —
nothing has to guess what it is holding. The links open in a new tab: a reader
following one is comparing, not leaving, and losing the filters they set would
be the wrong trade.

> It is built on the **backend** and travels with the payload. Composing the
> URL in the UI would put the difference between GitHub and GitLab there, and
> nothing in the model, the UI or the metrics names a platform.

An environment name is a **link** whenever the platform stated where to reach
it: GitHub carries it on a deployment status, GitLab on the environment itself.
It is read and never built — the address of a deployed application follows from
nothing we hold, so a guess would be a broken link. Null is the common case, and
also what a GitHub run degraded under the API reserve leaves behind, since the
status call carries the URL and the status together. Stored sources keep it in a
column of its own, under the usual rule: a feed that does not report it does not
blank it.

## What a deployment carried

Each deployment has a **page of its own** at `/deployments/:slug/changes`, which
lists the commits between it and the previous deployment to the same environment.
A page rather than a dialog because this is the thing people send each other:
"look at what went out" is a link, and a link has to survive a refresh and open
without the list that produced it. Everything it needs therefore travels in the
URL — the deployment, its repo, the base, and the period — and the payload
carries the deployment itself so one request draws the whole page.

It asks `GET …/deployments/:deploymentId/changes?repo=&base=`, which compares two
refs and reads the commits between them with the very same parser the release
notes use — one reading of a commit message, not two.

**Three bases are offered, and none is right in general:**

| `base` | Answers | Empty when |
|---|---|---|
| `previous` | What went out since the last successful deployment of that repo to that environment | It is the first deployment there in the period |
| `default` | What this ref adds on top of the default branch — its history since diverging from it | The deployed ref *is* that branch |
| `ref` | What went out since a tag, a branch or a commit the reader names | The named ref is the deployed one |

That second row is why the choice is the reader's. Deploying `main` is the
common case in production, and comparing `main` to `main` yields nothing;
`previous` stays useful there. Conversely a first deployment has no predecessor,
and `default` is the one that still says something.

The third exists because those two answer the questions asked *most often*, not
all of them: "since the release we rolled back from" is a tag, and "since that
fix" is a sha. It is picked in a dialog — a list of the repo's tags and branches,
plus a field for anything else — and applied in one go, the way the custom
period is: the comparison behind it is a round of platform calls, and refetching
on every keystroke of a sha would spend a budget answering questions nobody
asked. The picker and the field are one control: a sha is a ref like the others,
and whichever was touched last wins.

> A named ref is checked before it travels (`isValidGitRef`). It is permissive —
> the platform is the authority on what resolves — and rejects only what cannot
> work: whitespace and the characters git forbids, a leading dash, and `..`.
> That last one matters most: the compare endpoints are built around
> `base...head`, so a ref carrying it would be read as a second bound and answer
> a different question without saying so.

`previous` skips failed deployments deliberately: comparing against one would
report what was *attempted* rather than what is running, and a run of failures
would make every deployment after it look empty.

> **The platforms record nothing about which branch a branch was cut from.** It
> is written neither in Git nor in either API, so `default` is as close to a
> fork point as anything can honestly get — and it is exact whenever the branch
> was cut from the default branch, which is the usual case.

The period travels with the detail request: the base is looked for among the
deployments of the window the list was showing, so both answer about the same
stretch of time — and a link reproduces exactly what its sender was reading.

> Switching source from that page rewrites the path and drops the query with
> it, since `generatePath` carries no search string. A page reached without an
> `id` therefore redirects back to the list rather than reporting a deployment
> it cannot find — which also covers a hand-edited link.

## Keeping it — the changelog archive

Everything above is computed on demand, which works for exactly as long as the
platform can still answer. It usually cannot for very long: **a deployment is
the most perishable thing this install reports on.** Its environment gets torn
down, the branch it deployed is deleted on merge, its record ages out of the
provider's API — and the ingestion's own retention drops the row a week past the
reporting window. Ask in September what went to a review environment in March
and there is nothing left to compare.

So what a deployment carried is **written down while it can still be read**, in
`DeploymentChangelog`. It is the one table here that is not a mirror of the
platform: everything else can be rebuilt from the provider if it were lost, and
this cannot. The retention sweep therefore does not touch it, and nothing else
purges it either.

**Filed by the collection, not by a reader.** The archiver runs at the end of
each `collect-source`, after the ingestion and the DORA snapshot: by the time
somebody asks about March, March is unreadable. It walks the deployments of the
reporting window, keeps the successful ones it has not filed yet, oldest first,
and compares each against `previous` — the same comparison the detail page
makes, through the same service, so the archive and the page never drift.

| Bound | Value | Why |
|---|---|---|
| Batch | 25 deployments per run | A first run over a busy month would otherwise spend a source's whole rate-limit budget at once |
| Reserve | the same `quotaReservePct` the enrichment respects | Checked *between* deployments, so a budget going scarce halfway stops the run where it is |
| Order | oldest first | Over the cap, the oldest are the ones closest to falling out of the store — and closest to being uncomputable for ever |

Nothing is lost to either bound: the deployments stay in the store, and the next
cycle picks up where this one stopped.

**When the platform has already dropped the refs.** A branch deleted on merge, a
tag moved, a commit pruned — and the compare endpoint answers 404 for a
deployment that really did happen. Both connectors translate that into
`errors.compare.unresolvable` (or `unknownRef`, without a lower bound) rather
than letting the client's error through: raw, it surfaced as `errors.internal`
and a 500, which says the install is broken when what is broken is nothing.

The archiver then **files the deployment without contents** (`unreadable`),
instead of retrying it. A 404 on a compare does not become false later, and one
deployment retried every cycle would hold the batch against the ones that can
still be read. What is filed is still true and still unobtainable elsewhere:
this went out, on this ref, at this time — and what it carried is no longer
knowable by anyone. The detail route answers `410 Gone` for it, because an empty
payload would read as "this carried nothing", the one thing it did not mean.

> Only that code is filed as unreadable. A network blip or a 5xx leaves the
> deployment unfiled and it comes back round on the next cycle — the two are not
> the same failure, and treating them alike would either lose the transient ones
> or retry the permanent ones for ever.

**Successful deployments only.** A failed one carried nothing to the
environment, and it is also what the next success is compared against: filing
failures would make every one of them look empty and every success look twice as
large.

**Written once.** A record is never overwritten. The whole value of the table is
that it says what was true *then*, and a second pass finding the branch deleted
would replace a full changelog with an empty one.

What is stored is the answer, not the means of recomputing it: the structured
entries **and** the rendered Markdown, the counts, the generator that produced
the text, and the platform links — stored rather than derived, because a source
re-scoped or moved since would otherwise grow links into a repo that no longer
holds these commits. Only the environment classification is resolved fresh on
read: rules are configuration, and a rule corrected today must apply to what it
describes.

`GET …/deployments/:deploymentId/changes` **consults the archive first**, and
only for the comparison it filed (`base=previous`). A reader asking for another
base is asking about the platform, and goes to the platform. An archived answer
says so — `archivedAt` on the payload, a pill on the page — because a reader
comparing two of these has to know which is a recollection and which is a
reading.

| Route | Answers |
|---|---|
| `GET …/changelogs` | The archive, newest first: repo, environment and free-text filters, optional bounds, paginated |
| `GET …/changelogs/:deploymentId` | One filed record, contents included |

The list route carries **summaries only** — no entries, no Markdown. A page of a
hundred releases would otherwise carry every commit message of each, which is
most of the payload and none of what the table shows; the commit and author
counts are columns for that reason. The history page fetches the contents of the
one release somebody opens.

> Unlike every other report here, the archive has **no rolling window**: absent
> bounds mean the whole history rather than the configured period. Reading it
> months later is the entire point, and it makes no platform call to do so — a
> history years deep answers as fast as yesterday's.
