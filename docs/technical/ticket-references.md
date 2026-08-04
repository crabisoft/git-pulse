# Ticket references

Pull requests are linked to their ticket by RegEx, from four texts and in that
order: the **branch name**, the **PR title**, the **PR description**, then the
**commit message**. Each rule declares which of them it reads — see
[What a rule reads](#what-a-rule-reads) — because a pattern loose enough to be
useful on a branch matches far too much in a description.

Where the texts come from decides what they cost. Wherever a pull request is the
subject — the dashboard board and the DORA lead-time samples — all of them are
free: the connectors receive `head.ref` / `source_branch`, the title and the
description in the listing's own payload, and in `stored` mode the description
is kept on the row (`StoredPullRequest.body`) so both modes feed the rules the
same texts. Generating release notes walks commits rather than pull requests, so
there the title and the description have to be asked for — one call per commit —
while the branch and the commit message are already in hand. PR comments are
deliberately not scanned at all: that would be one more request per PR, on the
heaviest path of the product.

The description is read but never returned: it feeds the rules and is dropped
before the board or the samples are answered, since neither shows any of it. It
is therefore absent from the shared `PullRequest` and `MergedPullRequest` types
and carried on the backend-only `SourcePullRequest` and
`SourceMergedPullRequest`.

## Trackers

A **`Tracker`** is declared once — name, kind, base URL — in **Settings ›
Trackers**. The base URL lives there rather than on every rule, so moving a Jira
instance is a single edit.

**Attaching happens from the source**, not from the tracker: the question one
actually answers while setting things up is *what does this source use*, and a
source has two or three trackers where a tracker may serve twenty sources. The
source form therefore carries two controls, and the tracker list only shows its
sources read-only:

- **Attached trackers** — the ones this source's pull requests may reference,
  and the only ones its ticket rules can point at.
- **Incidents read from** — a **single** choice among them, or none. Single by
  design: two would leave the collector with no way to choose, which a boolean
  per binding made representable. Only kinds an incident provider exists for
  (`github`, `gitlab`) are offered, and the API refuses the others rather than
  failing mid-collection.

A source with no incident tracker collects no incident, whatever
`failureSource` says — the fallback is logged, since an empty metric otherwise
looks like an absence of failures.

Links are built from the tracker's `urlTemplate`, or from the shape derived from
its kind when it defines none:

| kind | default template |
|---|---|
| `jira` | `{base}/browse/{key}` |
| `linear` | `{base}/issue/{key}` |
| `github` | `{base}/{owner}/{repo}/issues/{key}` |
| `gitlab` | `{base}/{repo}/-/issues/{key}` |

`{owner}` and `{repo}` are resolved **per pull request** — a `#42` only becomes
a URL together with the repo it was filed against, which is why a git-hosted
tracker cannot be linked from a static template. When a placeholder cannot be
resolved the reference is returned without a URL, rather than with a hole in it.

> `{key}` is URL-encoded, `{owner}` and `{repo}` are not: on platforms with
> nested groups a repo reads `group/sub/project`, and its slashes are path
> separators rather than content to escape.

## Rules

`TicketRule` is kept apart from `EnvRule`: it yields references rather than
attributes. It belongs to a **tracker** and to nothing else — a key format is a
property of the tracker, not of a repository host — so which sources it applies
to follows from the sources attached to that tracker, and needs stating nowhere
else.

| Field | Role |
|---|---|
| `pattern` | the `(?<key>…)` named group yields the key; otherwise the whole match |
| `trackerId` | the tracker the rule belongs to, and through which it reaches sources |
| `sources` | the texts the pattern is run over; never empty |
| `priority` | lowest wins when two rules claim the same key |

Matching is global: a PR referencing two tickets yields both. The same key found
in the branch *and* the title is kept once, attributed to the branch. The
returned order is the discovery order — highest-priority rule first, branch
before title — so the PR's main ticket comes first.

### What a rule reads

`sources` is a subset of `branch`, `title`, `body`, `commit`, and a rule reads
nothing else. It answers two problems at once:

- **Precision.** `\d{3,}` on a branch is a ticket number; in a description it is
  any figure somebody typed. Confining the rule is what lets the pattern stay
  simple.
- **Cost.** Reading a request's title or description while generating release
  notes costs one API call per commit, since neither is in the commit message. A
  rule set confined to `branch` and `commit` costs nothing at all, which is why
  a rule created from the UI starts there.

A rule reading no text is refused rather than stored: it would match nothing,
silently, and look exactly like a pattern that is simply wrong. Existing rules
were migrated to `branch, title, commit` — what the extraction read before the
column existed, `body` excepted, since it had no way to.

Whichever order the sources were saved in, they are scanned in the order above,
so a key found in several texts is always attributed to the same one.

> A loose pattern is the failure mode here: `[A-Z]{2,5}-\d+` also matches
> `UTF-8`, `SHA-256` and `RFC-2119`. The rule tester in **Settings › Tickets**
> exists for that — it runs every saved rule over a sample of each text, plus an
> org and a repo, and shows the URL each reference resolves to, which a pattern
> check alone cannot validate.

References surface on the dashboard PR table and in the DORA lead-time samples,
they are the **only** source of the ticket links in generated release notes —
see [Release notes](release-notes.md) — and they are what ties an incident to
the deployment that caused it — see
[Tying a failure to the change that caused it](dora.md#tying-a-failure-to-the-change-that-caused-it).
