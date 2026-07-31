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

## The component catalogue

The pages are built from about twenty shared controls, and `styles.css`
declares the tokens they are drawn with. Neither had anywhere to be *seen*:
the tokens existed only as twelve hundred lines of CSS, and the only way to
look at a control was to find a page that happened to use it in the state you
were after.

```bash
make storybook                           # the workshop, on :6006
npm run build-storybook -w @repo/front   # what CI builds
```

It runs **inside the front container**, which is where the dependencies are:
`make dev` first. The port is published like the dev server's, and
`STORYBOOK_PORT` moves it.

**Controls only, deliberately.** The pages need the router, the API and a
session; the layout suite under `e2e/` already renders them in a real engine
over stubbed answers, and a second harness for the same thing would be two to
keep in step — with the odds on the wrong one being the one that rots.

What it holds:

| | |
|---|---|
| **Foundations › Design tokens** | Every custom property, read back out of the loaded stylesheet at render time. It cannot go stale: a token added or renamed appears on the next reload, and the values follow the mode in effect |
| **Controls › …** | One page per shared control, and a story per state that is easy to get wrong — a declared quota beside a measured one, a window that has elapsed, a sparkline with too few points to plot, a page of results that fits in one page and therefore renders nothing |

Three switches sit in the toolbar, because they are exactly what a control can
look right in one of and wrong in another: the **colour mode**, the **overview
direction** and the **language**. The first two are the same `data-` attributes
`display.ts` stamps on the root element, so a story is styled by the
application's own rules rather than by anything Storybook holds.

The rows in the `DataList` stories come from `e2e/fixtures.ts` — the fixtures
the layout suite and the documentation screenshots already answer with. A
second set of invented data here would have drifted from that one within a
release.

> **It asserts nothing.** CI builds it, which catches a story that no longer
> compiles — a catalogue entry nobody would otherwise notice was gone, since
> nothing renders it until somebody opens it. What a component *does* is still
> the unit suites' business, and whether a page fits a phone is still the
> layout suite's.

## The icon set

The same mark is served twice, because two things ask for it in two ways.

**`front/public/`** is copied to the root of the bundle untouched, which is
where a browser looks for icons it was never told about — and nginx reaches
them before the SPA fallback, `try_files $uri` matching the file first.

| File | Asked for by |
|---|---|
| `favicon.ico` (48, 32, 16) | the tab, and anything that guesses at `/favicon.ico` |
| `favicon-96x96.png` | the tab, where a browser prefers PNG |
| `apple-touch-icon.png` (180) | iOS, added to a home screen |
| `web-app-manifest-{192,512}.png` | the manifest, installed as an application |
| `site.webmanifest` | the name and colours of that installed application |

**`front/src/assets/logo.png`** (96) is the one in the topbar and on the two
pages that show without a session. It is imported rather than linked, so the
bundler hashes it and a replacement is never served from a stale cache — which
is exactly what the icons above cannot have, their URLs being fixed.

Every file is transparent **but `apple-touch-icon.png`, which is white**: iOS
composites a home-screen icon onto black, and a mark drawn in dark navy would
lose its outline against it.

Replacing the mark means regenerating all of them from one square source, plus
the two copies the documentation reads on its own — `docs/images/logo.png` for
the README and `docs/user/source/_static/` for the guide, which Sphinx points
`html_logo` and `html_favicon` at. Then regenerate
[both screenshot suites](user-guide.md#screenshots): the topbar is in every
picture either of them takes.
