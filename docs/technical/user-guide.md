# The user guide

The documentation in this directory is for whoever operates or changes the
application. The **user guide** — what each page answers, what the figures on it
mean, which setting moves them — is a separate body of text, written for
whoever *reads* the dashboard, and it is built and published differently.

It sits beside this one, in [`docs/user/`](../user/), and it is the only part of
`docs/` that is not Markdown: it is a Sphinx project in reStructuredText.

## Why it is built rather than read in place

Because it has a version, and the rest of `docs/` does not. A reader on 1.4
needs the guide of 1.4, not the guide of `main`, and a file in a repository only
ever shows the tip of a branch.

Read the Docs gives that from this same repository: it builds a branch or a tag
per version and serves them side by side, with a switcher. `latest` follows the
default branch; a `v*` tag published on GitHub becomes a version of its own
without anything in the repository changing.

The build is declared in [`.readthedocs.yaml`](../../.readthedocs.yaml) at the
repository root — Python version, requirements, and `fail_on_warning: true`.

> Creating the project on readthedocs.org is the one step that cannot live in
> the repository. It is done once, by hand. Everything after that is driven by
> pushes.

## Writing it

reStructuredText under `docs/user/source/`, one file per page, all of them
listed in the `toctree` of `index.rst` — a page missing from it is a warning,
and warnings are fatal here.

```bash
make docs                   # in the dev container, as you; needs `make dev` first
```

Sphinx lives in the dev image, in a virtualenv of its own, so nothing has to be
installed on the host — the same reason `make storybook` runs where it does. The
build writes `docs/user/build/html/`, owned by you rather than by root, so
opening `index.html` in a browser is the end of it.

Editing `docs/user/requirements.txt` means rebuilding the image, which `make
dev` does: the pins are installed into the image rather than fetched on every
build.

With Sphinx on the host instead, the target underneath is the same one CI runs:

```bash
make -C docs/user html      # -W, exactly as Read the Docs builds it
```

Cross-references are `:doc:` between pages and `:ref:` to a labelled section;
both break the build when their target disappears, which is the reason to use
them over a bare link. Anything else in this repository — a runbook, a technical
document — is linked with the `:repo:` role rather than a relative path: the
guide is published from another host, where `../runbooks/` means nothing.

**The guide is English only.** The application is translated; the guide is not,
and the pages say so where it matters rather than pretending otherwise.

## Screenshots

The guide's screenshots are **not** the ones in [`docs/images/`](../images/).
Those five illustrate the README and follow the project's pitch; these follow
the guide's pages, which is a different list moving for different reasons. They
live in `docs/user/source/images/`.

They are generated from the real application over stubbed fixtures — no
database, no credential, no cropping by hand:

```bash
make screenshots                # rewrites docs/user/source/images/*.png
make screenshots suite=screenshots   # the README's five, unaffected by the above
```

That target is the supported way, and the only one that needs nothing installed
but Docker. It runs the suite in a container of its own —
[`Dockerfile.screenshots`](../../.docker/Dockerfile.screenshots), the Playwright
image plus the repository's Node — as the calling user, so the PNGs land in the
working tree owned by whoever asked for them.

**Nothing else brings it into existence.** The service sits behind the
`screenshots` compose profile, so `make dev` and `docker compose up` both ignore
it, and the image does not exist on a machine that has never asked for the
images. It also needs no stack running: the suite stubs every API call and
Playwright starts a Vite of its own inside the container, which is why this
works on a checkout where `make dev` was never typed.

The image is built on the **first** run — budget a few minutes for it, a browser
and its libraries are being downloaded — and reused by every run after, which is
a container start. Nothing rebuilds it on its own, so the two changes that need
one are:

```bash
make screenshots rebuild=1   # after editing Dockerfile.screenshots or PLAYWRIGHT_IMAGE
```

`PLAYWRIGHT_IMAGE` in [`.docker/.env`](../../.docker/.env) carries the browser
build that version of Playwright drives, so it moves with `@playwright/test` in
`front/package.json`. A mismatch is not subtle — Playwright refuses to start and
names the executable it wanted.

The suites also run straight from a machine that has the dependencies and the
browsers, which is what CI and a devcontainer do:

```bash
npm run screenshots:docs -w @repo/front
npm run screenshots -w @repo/front
```

The suite pins the browser locale to English, because the account fixture states
no language and the interface would otherwise follow whatever machine ran it —
a French screenshot in an English guide, decided by the developer's laptop.

**Every figure declares a `:width:`**, and a new one that forgets it is the
mistake to look for: the guide's article is 2000px wide, so an image left to its
own size is drawn several times larger than the interface it photographs. A full
page takes `1000px`, a dialog `720px`, a small card its own size. The framing —
border, radius, and a caption that wraps at the image's edge rather than at the
article's — is in [`_static/custom.css`](../user/source/_static/custom.css).

A figure whose state is behind a click — a dialog, a tab, a generated range —
declares a `prepare` step and gets there the way a reader would, rather than
being assembled out of markup the application never renders. Two states no
click reaches (an install with no account, a read that ran out of pages)
override a route with `stub` instead. `clip` photographs one element, which is
what keeps a dialog free of the dimmed page behind it.

## What CI refuses

[`.github/workflows/docs.yml`](../../.github/workflows/docs.yml) builds the
guide with `-W` on any change under `docs/user/`. That is the same build Read
the Docs runs, so a dead cross-reference, a page outside the `toctree` or a
figure whose file was never committed fails before the merge rather than after
the publish.

Reproduce it with `make -C docs/user html`.
