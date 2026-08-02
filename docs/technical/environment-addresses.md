# Environment addresses

A deployment record rarely says where the environment it reached can be opened.
GitHub carries an `environment_url` only on a deployment status that was
configured with one; GitLab only when the environment declares an external URL.
Most installs therefore watch environments they cannot link to — and the
[version probe](versions.md), which reads what an environment is running, has
nowhere to send its request.

This module supplies the missing address, two ways: a **rule** deriving it from
the environment's name, and a **declaration** stating it outright. Both feed the
same field — `environmentUrl` on the deployment — so everything downstream (the
board, the deployment list, the changelog page, the version probe) inherits it
without knowing where it came from.

## Filling, and overwriting

The common case needs no decision. A deployment that arrives without an address
takes whatever this module can produce for it, automatically. Replacing an
address the platform *did* publish is the deliberate act, so it is a field:

| `mode` | What it does |
|---|---|
| `fill` (default) | Speaks only for the environments whose platform published nothing |
| `overwrite` | Replaces the published address |

`overwrite` exists for the addresses that are published and wrong — an internal
hostname, a load balancer nobody outside the cluster can reach, a preview URL
that has since moved.

## Rules

Like a [classification rule](classification-rules.md), an address rule is
**defined once for the whole install** and enabled source by source: an address
follows a naming convention — one host per customer, one path per environment —
and a convention rarely stops at one repository host.

Two fields narrow a rule:

| Field | Effect |
|---|---|
| `pattern` | The rule answers for environment names this matches. Its **named groups** are what the address is built from |
| `repo` | Optional. The rule only answers within repos this matches — and never for an environment belonging to none, which is not a wildcard: see [Declared environments](#declared-environments) |

Patterns are tested **unanchored** — remember `^` and `$` for a whole-name
match. An unreadable pattern keeps its rule silent rather than letting it apply
everywhere.

Unlike a classification rule, an address rule is **selected rather than
accumulated**: an environment has one address, so the lowest `priority` number
among the matching rules wins outright.

It is selected once and for all, which is where it parts company with a
[version rule](versions.md#several-addresses-for-one-environment). That one
tries its candidates in turn, because whether an address answers is something
only the request can settle. Here nothing is requested — a template either
resolves or does not — so a second rule would have nothing to add that the first
did not already decide.

### The template

`urlTemplate` is filled per deployment:

| Placeholder | Resolves to |
|---|---|
| `{<group>}` | A named capture group of the rule's own `pattern` |
| `{repo}` `{environment}` `{ref}` | The deployment's own fields |
| `{attr.<key>}` | An attribute from the classification rules |

```
https://{client}.example.com          # from (?<client>\w+)-prod
https://{attr.client}.example.com/{environment}
```

A group outranks the fixed name it shadows: a rule capturing
`(?<environment>…)` means its group, which is the part of the name it went to
the trouble of isolating.

Names are matched **exactly as spelled**: `(?<Customer>…)` is not `{customer}`,
JavaScript being case-sensitive about both.

A placeholder nothing resolves leaves the deployment's own address in place
rather than producing one with a hole in it — a URL with `{client}` still in it
is not somewhere to go, and it fails in a way nobody can read back to the rule
that produced it.

Which makes an unresolved placeholder and an unmatched pattern produce the same
absent address while wanting opposite fixes. The preview tells them apart:
`resolveEnvUrl` returns the rule that answered and the first placeholder that
did not resolve, where `environmentUrlFor` — what the board and the deployment
list call — keeps returning the address alone.

A template must begin with `http://` or `https://`. Unlike a version rule's it
cannot open on `{environmentUrl}`: this is what *produces* that address, so a
template built from it would be defining itself.

## Declared environments

Some environments never reach the platform at all — an appliance shipped to a
customer, a release installed by hand. They are declared per source:

| Field | |
|---|---|
| `environment` | The name, which is what the boards fold on |
| `repo` | Empty when it belongs to none, which a customer instance usually does |
| `url` | Where it answers. Absolute `http(s)`, as a rule's template is: it is stated by hand and rendered as a link. Optional — declaring the environment without claiming an address still makes it exist |
| `attributes` | Forced, since no name was matched and nothing classified it |
| `mode` | As above |

A declaration is the **last word** on an address: it is somebody stating
outright where a named environment lives, which no pattern can be more specific
than. The pair `(repo, environment)` matches first; a declaration bound to no
repo answers for its name wherever the name turns up, and one bound to a repo
never answers for another.

A declared environment is an environment in every other respect:

- it gets a **row on the boards**, with no deployment count, no last status and
  no ref — the row says so rather than inventing them;
- the **version probe** reads it on the same terms as any other, so what a
  customer's appliance is running becomes knowable;
- the reading it files is attributed to **no deployment**, because none put it
  there.

A declaration whose name the source *also* deploys to adds no second row: the
one built from deployments says more. The declaration was not idle there — it
still decided the address.

## Where it is applied

The address is settled where deployments are classified, in
`DeploymentsService.classify` and `DashboardService.dimension` — after the
classification, since a template may address `{attr.…}`, and in both places
because the two views read their deployments separately and must not disagree
about where an environment answers.

The archived changelog goes through **today's** rules, like the classification
beside it and unlike the platform links it stores: where an environment answers
is configuration, and configuration corrected since must apply to what it
describes. The links are data, built when the source still pointed where it no
longer does.

## What it does not do

Nothing here validates that an address is reachable, and nothing should: the
boundary belongs where the address is used. The [version probe](versions.md)
resolves and checks it before connecting — that check is what stands between a
client-supplied template and a request into a private network, and it stays in
force whatever this module produces.
