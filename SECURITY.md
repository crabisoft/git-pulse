# Security policy

Git Pulse holds credentials for the Git platforms it reads — a GitHub App
private key, a GitHub or GitLab token, webhook secrets. A flaw here can expose
an organization's whole source history, so security reports are welcome and
taken seriously.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private reporting instead:

> **Security** tab → **Report a vulnerability**

That opens a draft advisory visible only to you and the maintainers. Include
what you need to reproduce: the affected route or job, the deployment mode
(`make dev`, `make prod`, or a local run), and the source mode (`live` or
`stored`) when it matters.

Expect a first answer within 7 days, and a status update at least every 14 days
until the report is closed. Fixes land on `main`; the advisory is published once
a fix is available, crediting you unless you ask otherwise.

Please do not include real tokens, private keys, or the contents of
`master.key` in a report — a redacted excerpt is always enough.

## What is in scope

The dashboard as this repository ships it, deployed from `.docker/`:

- authentication, session cookies, and the sign-in throttle;
- the encryption of stored secrets and the handling of the master key;
- the API surface under `/api`, including access to another account's data;
- webhook ingestion, notably signature verification on `/api/webhooks/*`;
- anything that makes a connector write to a platform — every call the
  connectors make is meant to be read-only;
- injection into the model prompts used to rewrite release notes.

## What is out of scope

- Vulnerabilities in GitHub, GitLab, or the model provider themselves — report
  those to them.
- Findings that require an attacker to already hold the master key, the
  database, or a maintainer account.
- Missing hardening headers on a deployment that does not use the bundled
  `nginx.conf`.
- Denial of service through the platform API quotas, which the dashboard
  deliberately consumes on the operator's behalf.

## Supported versions

The project is pre-1.0. Only the latest commit on `main` is supported, and
fixes are not backported. Tagged releases will get a support window once 1.0 is
out.

## Operator notes

Two properties of a deployment are the operator's responsibility, not the
code's:

- **The master key.** It lives in `MASTER_KEY_FILE` (or `MASTER_KEY`), and it
  decrypts every stored secret. Back it up outside the machine, and treat a leak
  as a compromise of every source token the dashboard holds.
- **`TRUST_PROXY`.** Leave it unset when nothing proxies the API. Setting it
  without a real proxy in front lets a caller forge `X-Forwarded-For` and defeat
  the sign-in throttle.

Grant the platform credentials the read-only permissions listed in
[`docs/technical/sources.md`](docs/technical/sources.md#what-to-grant-it), and
nothing wider.
