# Release notes

`GET /api/sources/:id/release-notes?repo=&from=&to=` summarises a range of
commits; `GET /api/sources/:id/tags?repo=` lists what a range can be picked
from, and `GET /api/sources/:id/repos` the repos to pick among. That last one
goes through the `SourceReader`, so a `stored` source answers it from its own
table instead of spending a call on a list it already has.

**A bound is a ref, not a release**: a tag or a branch, since that is what the
platforms compare. `GET /api/sources/:id/branches?repo=` lists the second kind
alongside `tags`, and the picker offers them in named groups — `release/3.0`
read as a version would be a poor guess. On GitHub that listing costs two calls
rather than one: it does not say which branch is the default, and that is the
branch an omitted bound resolves to. Paid when a picker opens rather than during
a collection, so it sits outside the fan-out the API reserve guards.

Bounds fill themselves in: `to` defaults to the most recent tag — a release is
summarised as it was cut, not as the branch has drifted since — and `from` to
the tag below it. With no tag at all the range runs from the beginning of
history to the default branch, which is what a first release needs.

> When `to` is a **branch** there is no tag "below" it to find, so `from`
> becomes the most recent tag instead of the beginning of history: *everything
> on this branch since the last release* is the question a branch as an upper
> bound is asking. `resolveRange` is pure and tested for exactly that.

Each commit is read as a **Conventional Commit** and filed under its type, with
breaking changes repeated at the top: they are what a reader upgrading needs
first. A message following no convention is filed under `other` rather than
dropped, since most histories are mixed. The parser is deliberately strict —
`Reverting this: fix login` yields nothing rather than a type named `reverting`.

Ticket references are read from commit messages by the **same rules** as branch
names and PR titles, so a release note links its tickets without any further
configuration.

## Reading a whole range, squashes included

Two things used to make a range under-report, both silently.

**A comparison is paginated.** GitHub's compare endpoint returns its `commits`
array a page at a time; read in one call, a range of a hundred commits came back
as its first page and said nothing about the rest. It is now read to
`total_commits`, which the same payload gives — and when the platform's own cap
of 250 commits per comparison is hit, that is logged rather than passed off as a
complete list.

**A squash has no commits to read.** Squashing collapses a branch into a single
commit, so the work that went into it is nowhere in the history the range walks:
no amount of paging finds it. It survives only on the request, which both
platforms keep answering for long after the branch is deleted — so a squash is
**replaced by the commits it was made of** (`pullRequestCommits`).

What counts as a squash is a **one-parent commit whose own message names a
request**, which is the shape the platform writes. Two things it deliberately is
not:

- *A merge commit.* Two parents, and what it brought in is already in the range,
  being reachable from the head that was compared. Expanding it would pay a call
  for commits already in hand and then have to recognise them as duplicates.
- *Any commit we happened to find a request for.* The association endpoint
  answers for **every** commit of every request, so that reading would expand the
  whole range, spend a call per request and arrive back where it started.

That is why `Commit` carries `parents`: guessing from the message alone reads
`fix: thing (#42)` as a squash and a developer's `Merge branch 'main'` as a
request.

| | Calls | Effect |
|---|---|---|
| Merge commit | none | Already whole |
| Squash | one per request, paginated | The branch's commits, in place of the one that replaced them |
| Everything else | none | Unchanged |

The cost is one call per squashed request, which is the same fan-out shape the
enrichment has — so it sits behind `allowsOptionalCalls` and stops at the
reserve. A request given up on, or one the platform will not detail, leaves the
squash exactly as it was written: the range is never made worse by the attempt.
Children inherit the request their squash named rather than resolving one each,
and a commit the range already holds is never added twice.

> **GitLab squashes are not expanded.** The signal is the message, and GitLab's
> squashed commit message is whatever the project configured — usually the MR
> title, with nothing naming the request. Recognising them needs the association
> plus the MR's `squash` flag; the connector method is implemented and waiting
> for that day.

A deployment's contents go through the same reading, so what a release note says
and what the deployments page says about the same commits stay one answer.
`authors` is therefore counted off the entries and not off the listed commits —
after an expansion the two no longer describe the same set.

## Rewriting them with a model

Generated notes read like a commit log, because that is what they are. **Settings
› AI providers** declares a model API — a vendor, a model, a key — and the
release-notes page offers to rewrite the notes through it.

`POST /api/release-notes/rewrite` takes the Markdown in its body rather than a
range to regenerate: generating costs a walk through a history, and the caller
is holding the result already. It is also why the route is bound to no source —
nothing in it needs a connector.

**The Markdown is the only thing that leaves the install.** No token, no repo
listing, nothing about the source beyond what the notes already say.

The instructions are constraints rather than a style, since the failure that
matters is not a dull sentence:

| Asked for | Why |
|---|---|
| State nothing the input does not | An invented impact or number reads exactly like a real one |
| Keep every Markdown link as written | The commit and ticket links are how a reader verifies the rest |
| Keep every entry; merging two is allowed, dropping one is not | A missing entry is invisible, where a clumsy one is not |
| Rewrite the wording, drop the Conventional Commits prefixes | This is the part worth paying a model for |

The generated notes stay on screen next to the rewriting — reading the two
together is the only way to catch a model that embellished, and no instruction
replaces it.

**An install that declared no provider never sees the rewriting at all**: the
panel is absent rather than present and explaining why it cannot act. A control
that does nothing is noise on every visit, and the place to fix it is Settings,
where an admin already is when they care. The same rule hides it from a visitor
reading a public dashboard, who has no account to spend the budget with.

> The prompt and the reading of the answer are pure functions in
> `release-notes/rewrite.ts`, tested like the DORA maths: this is a place where
> a change of behaviour looks stylistic and is not. A model that wraps the whole
> document in a code fence is unwrapped; one that wraps a shell sample *inside*
> the notes is not.

## Declaring a provider

| Field | Role |
|---|---|
| `kind` | `anthropic`, `openai`, `google`, `mistral` — decides the request shape and the auth header |
| `model` | free text, as the vendor spells it |
| `apiKey` | encrypted at rest like a source token, readable by nothing afterwards |
| `baseUrl` | optional: a gateway, a proxy, a compatible deployment |

Several may coexist — one per vendor, or two of the same vendor on different
models — and exactly one carries the **default**, which is what a caller naming
none gets. The first provider declared takes it whatever the form said, and
deleting the holder promotes the oldest survivor: a provider nobody can reach by
omitting an id would be a trap. Testing a provider spends one call, and is the
only way to prove the key, the model name and the endpoint together — a form
can check none of the three.

**The model is free text on purpose.** Vendors rename models far more often than
they change their API, so a validated list would go stale between releases. The
form prefills a default where we can state one that is current, and starts empty
where we cannot: a model identifier we could not vouch for would be worse than
none, since it only fails at the first call.

Anthropic goes through the vendor's own SDK, the same choice the Git connectors
make with Octokit and gitbeaker — it buys retries, typed errors and a request
shape that follows the API rather than our reading of it. The other three are a
single JSON POST each, which is not worth a dependency until one of them needs
more than one call.

> Model budgets are **not** metered. `ApiQuota` counts calls against a
> rate-limit window, where a vendor bills tokens — a different unit on a
> different clock. Declaring the ceiling would mean counting what a completion
> spends, which the answer states and the request does not.

> Publishing the notes back as a platform release is the remaining step of this
> phase.
