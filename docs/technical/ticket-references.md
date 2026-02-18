# Ticket references

Pull requests are linked to their ticket by RegEx, from two texts and in that
order: the **branch name**, then the **PR title**. Both are free — the
connectors already receive `head.ref` / `source_branch` and the title with the
PR itself, so extraction costs no extra API call. PR comments are deliberately
not scanned: that would be one request per PR, on the heaviest path of the
product.

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
| `priority` | lowest wins when two rules claim the same key |

Matching is global: a PR referencing two tickets yields both. The same key found
in the branch *and* the title is kept once, attributed to the branch. The
returned order is the discovery order — highest-priority rule first, branch
before title — so the PR's main ticket comes first.

> A loose pattern is the failure mode here: `[A-Z]{2,5}-\d+` also matches
> `UTF-8`, `SHA-256` and `RFC-2119`. The rule tester in **Settings › Tickets**
> exists for that — it runs every saved rule over a sample branch, title, org
> and repo, and shows the URL each reference resolves to, which a pattern check
> alone cannot validate.

References surface on the dashboard PR table and in the DORA lead-time samples,
and they are what ties an incident to the deployment that caused it — see
[Tying a failure to the change that caused it](dora.md#tying-a-failure-to-the-change-that-caused-it).
