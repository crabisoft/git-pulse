# The store and its feeds

What a `stored` source keeps, which feed fills each column, and how rows
written by three writers at once end up consistent. The mode itself is
described in [Sources](sources.md).

## What is stored, and what fills it

Four tables, and nothing else of a source's data. Each column is filled by one
or two feeds, and which ones is worth knowing: it decides what a webhook can
keep current on its own, and what only a listing ever brings.

| Table | Columns | Filled by |
|---|---|---|
| `StoredRepo` | `name` | the repository listing, only |
| `StoredPullRequest` | `number`, `title`, `state`, `author`, `url`, `repoUrl`, `headRef`, `openedAt`, `updatedAt`, `mergedAt`, `reviewers` | the open listing, and the pull-request events |
| | `firstCommitAt`, `firstReviewAt` | the **merged listing only** — see below |
| `StoredPipeline` | `ref`, `status`, `url`, `createdAt`, `updatedAt`, `durationSec` | the pipeline listing, and the run events |
| `StoredDeployment` | `environment`, `ref`, `status`, `createdAt` | the deployment listing, and the deployment events |
| | `environmentUrl` | the listing, and the GitHub events only |

Three consequences follow, and each is a real behaviour rather than a caveat:

- **The lead-time segments never come from an event.** `firstCommitAt` and
  `firstReviewAt` cost one API call each and are read during the merged listing,
  which is also the first thing given up under the API reserve. A pull request
  merged through a webhook therefore appears in DORA immediately with its lead
  time, and gains its coding and pickup segments at the next reconciliation.
- **A new repository appears only at the next synchronisation.** No event maps
  to a repository. Until one lists it, an event about it is still stored, but
  invisible: every read filters on the repositories in scope, and that list comes
  from `StoredRepo`.
- **A GitLab pipeline gets its duration from events sooner than from listings.**
  The listing would need one call per pipeline to know it, so it stores `null`;
  the `Pipeline Hook` reports it directly.
- **A GitLab deployment event names the environment but not its address.** The
  `Deployment Hook` carries no external URL, so an event never fills
  `environmentUrl` there — only the listing does, and the merge keeps what is
  already stored rather than blanking it.

Alongside them sit three tables that are not source data: `SyncState` (the
cursors), `WebhookSecret` and `WebhookDelivery`.

> `StoredRepo.defaultBranch` exists and is never written: the synchronisation
> lists names only, and the one caller that needs a default branch — the release
> notes — reads live in either mode. It is a column waiting for a reader.

## One row, two feeds, no ordering

The open listing, the merged listing and the webhooks all write the same rows,
in an order nobody controls. `merge.ts` holds the rules and is pure for that
reason:

- A reading older than what is stored is **dropped** — but still marks the row
  as seen, or the very run that listed a pull request as open would then close it.
- A feed never blanks what it does not report: the merged listing carries no
  author, the open one carries no lead-time segments, and `null` from a run
  degraded under the API reserve means *not read*, not *does not exist*.
- A deployment states no update date, so its status settles by rank instead:
  `unknown` < pending < running < terminal. An event arriving late cannot undo a
  success.

The database guards the same thing again, in the `where` of the update: two
writers can touch a row at the same moment, and the one holding the older state
has to lose.

## Staying converged

A stored view that drifts from its provider is worse than no view. Three things
keep it honest, and all three run without a single event ever arriving:

- The open listing is **complete by construction** — every open pull request of
  every repo, or it throws — so anything stored as open that it did not report
  has moved on, and is closed. Every run, not just the reconciliation.
- A **reconciliation** every six hours re-reads the whole reporting window and
  drops what the scope no longer covers. Its clock is a duration, not a count of
  runs, and it is blind to the events received.
- A **retention sweep** bounds the store at the reporting window plus a week.
  Open pull requests are exempt however old: one opened two years ago is exactly
  what the stale-PR tile is for.

## Webhooks, when the network allows

`Accept events` is offered on a stored source only, and is off by default: it is
an acceleration, never a prerequisite. An install whose network refuses inbound
traffic leaves it off and loses nothing but freshness.

The URL to declare on the provider side is:

```
https://<app-domain>/api/webhooks/<sourceId>
```

**The `/api` prefix is part of it.** Leaving it out is the mistake to expect: the
provider only reports the status code, so a hook declared without it fails with a
bare 404 and nothing saying why. The dialog that issues the secret spells the
full URL out for that reason — it returns a path rather than a URL because the
backend does not reliably know the origin it is reachable at from the outside.
Behind a reverse proxy or a tunnel, only the operator does.

Six events are handled, three per platform — the ones that move a row of the
four tables above. Subscribing to more is harmless and useless: anything else is
authenticated, recorded as delivered, and ignored.

| Writes | GitHub | GitLab |
|---|---|---|
| `StoredPullRequest` | `pull_request` | `Merge Request Hook` |
| `StoredPipeline` | `workflow_run` | `Pipeline Hook` |
| `StoredDeployment` | `deployment_status` | `Deployment Hook` |

Those are the values of the `X-GitHub-Event` and `X-Gitlab-Event` headers. In
the providers' own forms the boxes read *Pull requests*, *Workflow runs* and
*Deployment statuses* on GitHub, and *Merge request events*, *Pipeline events*
and *Deployment events* on GitLab — the dialog that issues the secret names them
that way, since it is read next to those forms.

`push` is deliberately absent: no table holds commits. So is
`pull_request_review`, which looks like a way to fill `firstReviewAt` and is not:
it reports *a* review, with no way of telling whether it is the first, so a hook
enabled after a pull request was already reviewed would record a later one as
such — and silently, since nothing downstream can tell the difference.

> On GitHub, set the content type to **`application/json`**. The default is
> `application/x-www-form-urlencoded`, whose body is the JSON wrapped in a form
> field: the signature still verifies, so the delivery is accepted and then
> ingests nothing. It shows up as a `204` on the provider side and one
> `Unreadable payload` line in the logs.

That endpoint is anonymous to the session layer — GitHub holds no account here —
and authenticated by the signature over the body. GitHub signs it
(`X-Hub-Signature-256`), which proves both sender and integrity; GitLab sends the
secret itself (`X-Gitlab-Token`), which proves only the sender. The secret is per
source, encrypted at rest like a credential, and readable exactly once when
issued — issuing another rotates it, which is all recovering from a leak takes.

The endpoint authenticates, records the delivery id and answers `204`. Nothing
else: a provider kept waiting marks the delivery failed and eventually disables
the hook. The work goes to its own queue, so a burst of events never sits behind
a synchronisation that takes minutes.

> Deliveries are at-least-once and out of order by nature. The unique index on
> `(sourceId, deliveryId)` is what makes handling one twice a no-op — including
> across several API instances, where an in-memory guard would not.

Events influence the schedule in exactly one direction: while some have arrived
in the last fifteen minutes, the incremental listings are skipped — the store is
demonstrably current, and listing would spend the budget to learn it. The
reconciliation is never skipped. A flood of events cannot become a source that
stops being checked against its provider.

### Testing them from a dev machine

A provider has to reach the application, which a laptop is not. Pointing a tunnel
(ngrok, Cloudflare Tunnel…) at the **Vite dev server** works: it proxies `/api`
to the back, so one tunnel serves the UI and the deliveries both.

Vite refuses a `Host` it does not know, though, and answers **403 before the
request reaches the API** — which reads exactly like a rejected delivery and is
not one. Add the tunnel's hostname to `VITE_ALLOWED_HOSTS` (comma-separated) in
`.docker/.env.local`, which is git-ignored, and restart the front container.

> Which layer answered is settled in one look: every error from the API is JSON
> shaped `{"statusCode":…,"code":"errors.…"}`. An HTML body, or one mentioning
> Vite or the tunnel, means the request never got there.
