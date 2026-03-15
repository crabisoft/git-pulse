# Webhooks are not arriving

Webhooks are an acceleration, never a prerequisite: an install that never
receives one stays correct, and only loses freshness between collections. So the
first question is whether this is worth chasing at all — if the schedule is
doing its job, it is not urgent.

Two failures look alike from the outside and are not the same at all:
**nothing arrives**, and **everything arrives and changes nothing.**

## Nothing arrives

The provider records every attempt. Start there: GitHub shows *Recent
Deliveries* on the hook, GitLab an *Edit → Recent events* list. What the status
code says:

| Code | Cause |
|---|---|
| **404** | The URL is missing its `/api` prefix. This is the mistake to expect — the URL is `https://<host>/api/webhooks/<sourceId>`, and without it the request never reaches a route |
| **401** | The signature did not verify: the secret on the platform is not the one this source holds. Issue a new one and paste it over |
| **403**, or an HTML body | Something in front answered instead of the API. Every error from the API is JSON shaped `{"statusCode":…,"code":"errors.…"}` — an HTML body means the request stopped at a proxy |
| **Timeout** | The endpoint is not reachable from the platform at all. A self-hosted GitLab behind the same firewall usually can; github.com cannot reach a private address |

The URL to declare is spelled out in full by the dialog that issues the secret —
it returns a path rather than a URL because the backend does not reliably know
the origin it is reachable at from outside. Behind a proxy or a tunnel, only you
do.

Check that the source is set up for it at all: **accept events** is offered on a
`stored` source only, and is off by default.

## Everything arrives and changes nothing

The provider reports `204` and the store does not move.

**On GitHub, check the content type.** The default is
`application/x-www-form-urlencoded`, whose body is the JSON wrapped in a form
field: the signature still verifies, so the delivery is accepted and then
ingests nothing. It shows as a `204` on their side and one `Unreadable payload`
line in the logs. Set it to **`application/json`**.

```bash
$C logs back | grep -i "unreadable payload\|Delivery rejected"
```

**Check which events are subscribed.** Six are handled, three per platform — the
ones that move a row of the four stored tables:

| Writes | GitHub | GitLab |
|---|---|---|
| Pull requests | *Pull requests* | *Merge request events* |
| Pipelines | *Workflow runs* | *Pipeline events* |
| Deployments | *Deployment statuses* | *Deployment events* |

Subscribing to more is harmless and useless: anything else is authenticated,
recorded as delivered, and ignored. `push` is deliberately not handled — no
table holds commits.

**A new repository will not appear from an event.** No event maps to a
repository, so an event about one that has never been listed is stored and
invisible until the next synchronisation lists it.

## The secret

It is per source, encrypted at rest, and readable exactly once when issued.
Issuing another rotates it — which is all that recovering from a leak takes, on
this side. Paste the new one into the platform's hook straight away: from the
moment it is issued, deliveries signed with the old one are rejected.

## Testing from a development machine

A provider has to reach the application, which a laptop is not. Point a tunnel
(ngrok, Cloudflare Tunnel) at the **Vite dev server**: it proxies `/api` to the
back, so one tunnel serves the UI and the deliveries both.

Vite refuses a `Host` it does not know and answers **403 before the request
reaches the API** — which reads exactly like a rejected delivery and is not. Add
the tunnel's hostname to `VITE_ALLOWED_HOSTS` in `.docker/.env.local`, then
restart the front container.

## What arriving does, and does not, change

While events have arrived in the last fifteen minutes, the incremental listings
are skipped — the store is demonstrably current and listing would spend the
budget to learn it. **The reconciliation is never skipped**: every six hours the
whole reporting window is re-read whatever the events said. A flood of events
cannot turn into a source that stops being checked against its provider.
