# The web application

Routing, what a URL carries, and the two safeguards that keep an expensive
screen from firing a request per keystroke.

## Navigation

Every module, section and page has its own URL — react-router in
`BrowserRouter` mode, the SPA fallback already being handled by nginx in prod
and by Vite in dev.

| URL | Page |
|---|---|
| `/dashboard/:slug` | Live view of a source |
| `/dora/:slug` | DORA metrics for a source |
| `/dora/:slug/:metric` | One metric: its trend, then the events behind it |
| `/deployments/:slug` | Deployments, filtered |
| `/deployments/:slug/changes` | One deployment: the commits it carried |
| `/changelogs/:slug` | The archive: what every deployment carried, months back |
| `/release-notes/:slug` | Notes for a range of commits, and their AI rewriting |
| `/login` | Sign in — or create the first admin on a fresh install |
| `/account` | Your own name and password |
| `/reset/:token` | Choose a new password, from a link an admin issued |
| `/settings/general` | Application settings |
| `/settings/users` | Accounts allowed to sign in |
| `/settings/sources` | Connected Git platforms |
| `/settings/environments` | Classification rules, global catalogue (`?target=repository` for the repos tab) |
| `/settings/trackers` | Ticket trackers (Jira, Linear, issues) |
| `/settings/tickets` | Ticket rules (PR → ticket linking) |
| `/settings/ai` | Model providers the install may call |
| `/settings/jobs` | Background jobs: queue state, schedule, failures |

`/`, `/dashboard`, `/dora`, `/deployments`, `/changelogs`, `/release-notes` and
the source-bound settings sections redirect to the first source; `/settings` to
`/settings/general`; everything else to the dashboard.

**Settings is an application-wide module**, and every section in it is global:
classification rules are a shared catalogue, ticket rules belong to their
tracker. Nothing there reads the topbar source picker, which is why it is hidden
under Settings — what a given source uses is declared on the source itself, in
the Sources section.

The source segment is the **slug** (`Source.slug`), a URL-safe and unique form
of the name: `Acme — Prod` gives `/dashboard/acme-prod`. Two sources with
the same name are disambiguated by a suffix (`prod`, `prod-2`). The API itself
keeps addressing sources by `id`: the front resolves slug → id from the list it
already loads for the picker, with no extra request.

The URL is the picker's source of truth: changing it keeps the current page and
replaces only the slug. An unknown slug — deleted or renamed source — falls
back to the first source, or to the empty state if none remain.

> The slug follows the name: **renaming a source invalidates its older links**.
> The fallback avoids a dead page, but the link no longer points at the same
> source.

## Request pacing

Both the dashboard and the DORA page fire an expensive request on every state
of their filters. Two safeguards, shared in `front/src/hooks.ts`:

- **`useDebounced` (500 ms)** — ticking repos one at a time, or paging through
  results, emits a single request once the burst is over. This is what spares
  the back: a cancelled request is still computed server-side, NestJS does not
  stop because the client hung up.
- **`useCancellableLoad`** — every load cancels the one it supersedes, and
  leaving the page cancels too. Guarantees the view shows the answer to its
  latest question, not whichever reply lands last.

An abort is not an error: `isAbort()` singles it out in `api.ts` so a
cancellation never shows up as a red banner, and the abandoned load leaves the
`loading` flag to whichever load replaced it.
