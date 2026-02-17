<!-- Title follows Conventional Commits: feat(dora): … · fix(gitlab): … -->

## What this changes

<!-- One paragraph. What behaviour is different after this merges? -->

## Why

<!-- The problem, or a link to the issue it closes. -->

## How it was checked

<!-- Which tests you added, and what you exercised by hand if anything. -->

## Checklist

- [ ] `make typecheck` passes
- [ ] `make test` passes
- [ ] New behaviour is covered by a test — a bug fix has a test that failed before it
- [ ] Schema change ships with its migration (`make migrate name=…`)
- [ ] README or `docs/` updated if the change alters how the thing is operated
- [ ] Layout suite run locally if this touches the UI (`npm run test:layout -w @repo/front`)
