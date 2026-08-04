# Sources

Declaring a platform to read, what to grant the credential, and the choice
between calling the provider on every request and reading a store.

## Configuring a source

1. **Settings › Sources** → *Add a source*.
2. Platform, base URL (e.g. `https://gitlab.example.com`), organization/group,
   auth method and secret. The secret is encrypted immediately.
3. **Test** the connection, then switch to the **Dashboard** tab.

### What to grant it

The table below maps each permission to **the calls that need it**. The user
guide covers the same ground from the other end — how to create the App or the
token, and what each missing grant leaves empty on screen: [Platform
credentials](../user/source/credentials.rst). Change one and check the other.

Everything below is **read-only**: no call any connector makes writes anything.
Publishing release notes back as a platform release will be the first exception,
and it is not implemented yet.

**GitHub App** — the permissions are what the calls need, nothing wider:

| Permission | Level | What uses it |
|---|---|---|
| Metadata | Read | Listing the org's repos, and reading a repo's default branch. Mandatory on every GitHub App anyway. |
| Contents | Read | Tags, branches, commits and comparisons — release notes, and the contents of a deployment |
| Pull requests | Read | Open and merged PRs, plus their commits and reviews for the lead-time segments |
| Actions | Read | Workflow runs — the pipelines on the dashboard |
| Deployments | Read | Deployments and their statuses — the deployments page, and DORA |
| Issues | Read | **Only** when `failureSource` is `incidents` or `both` and that tracker is GitHub |

Install it on the organization and grant it the repositories the source's scope
covers — an installation only ever sees what it was given, so a repo missing
here is a repo missing from every metric.

With **webhooks** on, subscribe to three events; each is covered by a permission
already granted above:

| Event | Reads through |
|---|---|
| *Pull requests* (`pull_request`) | Pull requests |
| *Workflow runs* (`workflow_run`) | Actions |
| *Deployment statuses* (`deployment_status`) | Deployments |

**Token instead of an App.** A classic PAT needs `repo` and `read:org`; a
fine-grained one needs the same repository permissions as the table above.

**GitLab.** A group access token or PAT with `read_api` covers all of it —
GitLab has no per-resource split to make here.

> A source missing one of these does not fail loudly: the services degrade
> rather than lose the whole view, so the symptom is a panel that stays empty.
> The dashboard says which collection failed in its warnings banner, and
> **Test** proves the credential before any of that — but note it only exercises
> the repo listing, so it passes on a token that will still come up short on,
> say, deployments.

## Collecting on demand

**Settings › Sources** carries a *Collect now* action per source, next to *Test*.
On a `stored` source this is also what fills the store: the ingestion is part of
collecting it rather than a schedule of its own, so there is nothing else to
trigger. It is `POST /api/sources/:id/collect`, admin-only like the rest of the
configuration.

The same call fires by itself, silently, the first time a source is switched to
`stored` — waiting for the cron would show an empty board for as long as
`collectCron` says. There, a form closing is no place for an error; on the
button, the outcome is reported.

> **A first run over a large scope takes minutes**, and walks the whole
> reporting window repo by repo. Behind a reverse proxy that is long enough to
> hit a gateway timeout: the browser then reports a network error while the
> collection carries on server-side. **Settings › Background jobs** shows
> whether it is still running.

## Reading live, or reading a store

[API quotas](api-quotas.md) rations a budget. It does not change what spends it, and what
spends it is the shape of the read path: a `live` source calls its provider on
**every dashboard request**, so the cost follows the traffic. Ten people
refreshing twenty repos every thirty seconds is fifty thousand calls an hour,
against the five thousand github.com allows.

**Settings › Sources › Data read from** switches a source between the two:

| | `live` | `stored` |
|---|---|---|
| Who calls the provider | every request | the collection only |
| Cost | per visitor | per collection, whatever the traffic |
| Freshness | of the instant | of the last run (or of the last event) |

In `stored` mode the dashboard and DORA read `StoredRepo`, `StoredPullRequest`,
`StoredPipeline` and `StoredDeployment` instead. Both callers go through a
`SourceReader` — the exact subset of `SourceConnector` they consumed — so
neither knows which one it holds. Release notes stay live in either mode: they
read tags and commits, which are not stored.

> Classification and ticket rules still apply **at read time**, exactly as they
> did: changing a rule takes effect on the next page load, with nothing to
> re-ingest. Only the platform data is stored, never what we make of it — which
> is why `StoredPullRequest` keeps the **description**: it is a text the
> platform answered, and a ticket rule reading it must find the same thing in
> either mode, on the board as in the DORA samples. It is read and dropped,
> never returned to the front.

[Version rules](versions.md) are the exception to that last sentence, and
knowingly: what an environment answered can only be known by asking it at the
time, so the answer is written down. They are attached to a source the same way
classification rules are — `versionRuleIds` on the source form, from a catalogue
that belongs to no source.

### What a period costs, either way

Anything reporting over a period — DORA, the deployments list — now asks its
reader to reach back to the start of that period rather than taking the most
recent slice. The two modes pay for that very differently:

- **`stored`**: one indexed query. The rows are already local, so a ninety-day
  window costs what a one-day window costs.
- **`live`**: the connector pages down to the date, up to twenty pages of a
  hundred per repo — and on GitHub each deployment then costs a status call on
  top. Widening the period on a live source widens its bill, per request.

That is the trade the mode already described, sharpened. A live source under
budget pressure degrades rather than exhausting itself: past the **API reserve**
the per-deployment enrichment is dropped and those deployments come back with an
`unknown` status — they still count towards frequency, just not towards the
failure rate. A source watched over long windows belongs in `stored` mode.
