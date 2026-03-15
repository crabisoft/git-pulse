# The API budget is spent

Collections fail part-way, or metrics thin out on their own: lead-time segments
go missing, deployments arrive with an `unknown` status. Both are the same
cause seen from two sides — the platform's rate limit.

## Where you stand

**Settings › Sources** shows a gauge per source, read from the platform's own
rate-limit headers on every response. Three readings to tell apart:

| Gauge | Meaning |
|---|---|
| A number, marked as measured | What the platform says it has left |
| A number, marked as declared | Counted here, because the instance sends no headers |
| Nothing at all | Nothing has been measured or declared. Not an empty budget — an unknown one |

Testing a connection is the cheapest way to get a first reading out of a source
that has never been collected: it spends one call and flushes it straight away.

## Immediate relief

In the order that costs least:

1. **Narrow the scope.** `Settings › Sources` → the repository selection. The
   collection's cost is its fan-out — one call per repo, plus one per merged
   pull request and one per deployment. Dropping repositories nobody reads
   metrics for is the one change that reduces the bill proportionally.
2. **Collect less often.** `Settings › General` → the collection schedule. Every
   quarter of an hour is a lot for an organization that deploys twice a day.
3. **Raise the API reserve** (`Settings › General`, 10 % by default). It is the
   share of the budget the optional calls may not dip into: the lead-time
   segments and the deployment statuses. Raising it means giving those up
   earlier, which keeps the repositories, pull requests and deployments — and
   with them every metric that is a count.

What the reserve gives up costs `coding_time`, `pickup_time` and `review_time`,
and leaves a deployment with an `unknown` status — which keeps it in the
deployment frequency and out of the failure rate. Listing one repository less
would instead cost every metric that repository feeds.

## The structural fix

**Switch the source to `stored`.** A `live` source calls the platform on every
dashboard request, so its cost follows your traffic: ten people refreshing
twenty repositories every thirty seconds is fifty thousand calls an hour against
the five thousand github.com allows. A `stored` source pays once per collection
whatever the traffic.

`Settings › Sources › Data read from`. The first collection after the switch
fills the store and takes minutes; the pages read the database afterwards.

Then, optionally, **accept events**: with webhooks arriving, the incremental
listings are skipped while the store is demonstrably current, which removes most
of the remaining calls.

## An instance that meters nothing

A self-hosted GitLab with rate limiting switched off sends no counters. It is
not slower to reach a limit — it is silent about it, and the limit that stops
the collection is the reverse proxy's, or the operator's patience.

`Settings › Sources` takes a ceiling by hand for such a source: so many calls
per minute, hour or day. The count is then kept here, the window opens on the
first call charged, and the reserve starts working for that source. A
measurement always wins: the first response that does carry counters marks the
source as metered and the counting stops for good.

## What not to do

- **Do not raise the reserve to 50 %.** Past a point the collection gives up the
  enrichment on every run, and the lead-time breakdown simply stops existing.
  Narrow the scope instead.
- **Do not add a second token to spread the load.** Both platforms meter per
  installation or per user, not per token, and the model here is one credential
  per source.
