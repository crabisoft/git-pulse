# Tests

`make test` (or `npm test`) runs **vitest** over both workspaces.

On the **back**, the pure engines — the classification matcher, the DORA maths,
the ticket extractor, the release-note range resolution, the deployment
filtering, base selection and ref validation, and the rewriting's prompt and
answer reading.
They take plain values and return plain values, so that half boots no Nest
container and no database.

On the **front**, what sits between a click and a request: the API client's
query building and error mapping, the debounce and cancellation hooks, the
shared multiselect, and the window presets.

The multiselect wraps **react-select** in `unstyled` mode — the behaviour it
brings (keyboard, ARIA, type-to-filter, a menu that escapes its container) with
the app's own CSS on top, so no second visual language enters the forms. The
menu is portalled to the body: as an absolutely positioned child of
`.modal-body`, which scrolls, it was clipped whenever it opened near the bottom
of the source form. The library costs about 30 kB gzipped, which is the price of
that list. Components render under jsdom with
translations stubbed to echo their key — what a screen *says* is the
translators' business, what it *does* is what is asserted.

Three suites step outside that rule and boot a **real client**: the quota
metering seams hook Octokit's request hooks and gitbeaker's built requesters,
which no type check covers and no upgrade announces, and the model providers
send a request shape no type check covers either. They run the actual clients
against a stubbed transport, so a library or a vendor moving its seam fails
there rather than in production — where the only symptom would be a gauge that
quietly stopped moving, or a rewriting that quietly stopped working.

The provider suite is where the vendors' disagreements are pinned down: that no
`temperature` is ever sent to Anthropic, which rejects it outright; that no
output ceiling is sent to OpenAI, whose parameter for one was renamed; that a
model name reaching Google's URL is escaped rather than opening a path of its
own; and that a refusal is reported instead of read as an empty answer.

The pure engines came first on purpose: they are what every metric on screen is
derived from, and the only place where a silent change of behaviour goes
unnoticed. A regression there reads as plausible numbers, not as a crash.

What the suite pins down is the reasoning, not the implementation — that the
median is a median and not a mean, that a negative duration is clamped instead
of pulling a value down, that an unresolved incident stays out of MTTR rather
than counting as zero, that a rule whose pattern is broken is skipped instead of
throwing, and that a link with an unresolvable placeholder comes back absent
rather than malformed.

A large part of it asserts **rejection** rather than results, because that is
where the bugs have actually been: request DTOs validated against the same
`forbidNonWhitelisted` rules as the global pipe (a target the DTO had never
heard of once made the whole rule catalogue answer 400), a page size beyond the
cap, a dimension carrying no value, a cancelled request answering 499 rather
than a logged 500, an abort reaching the UI as silence rather than a red banner.

> Both halves are checked by mutation rather than by their green tick: turning
> the median into a mean, dropping the negative-duration clamp, removing the
> guard that stops a superseded run from clearing the loading flag, or joining a
> repeated query parameter with commas each fails the suite. A suite that stays
> green under those proves nothing.

## What is not a test

The [component catalogue](frontend.md#the-component-catalogue) is built by CI
and asserts nothing. It is a workshop: a place to see a control in the states
that are hard to reach from a page, in both colour modes and both languages.
Building it catches a story that stopped compiling, and that is the whole of
what it proves.

The screenshots in the README come from the same fixtures, through the layout
suite's harness rather than through Storybook — they are pictures of pages, and
the pages are what a reader wants to see.

The [user guide](user-guide.md) has a suite of its own, on the same harness and
asserting no more than the first — a different list of pages, moving for
different reasons. Neither suite runs under `npm run test:layout`.
