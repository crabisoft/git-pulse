===============
Worked examples
===============

Things to copy. Everything here supports :doc:`monorepo` — the page that
explains *why* — and nothing on it is required for a repository holding one
deployable.

Two fictional organisations run through the whole page:

- **acme/platform** on GitHub — ``front``, ``api`` and ``worker`` in one
  repository, released separately
- **acme/plateforme** on GitLab — the same, self-hosted

.. _examples-labelling:

Labelling a pull request from CI
================================

Only needed where titles are not enough. If your teams write Conventional
Commits, a **PR titles** rule already names the component in every title and
there is nothing to install — see :ref:`monorepo-dimensions`. What follows is
for everyone else, and for the one thing a title genuinely cannot carry: the
size of a change.

.. note::

   Git Pulse never writes to your repositories. Every credential it holds is
   read-only, so labels are applied by your own CI and merely *read* here.
   Nothing on this page is a prerequisite: it is a convention you may already
   have, described in the shape this application can consume.

GitHub — by path
----------------

``actions/labeler`` derives a label from the files a pull request touches,
which is the most faithful signal available and one nobody has to remember to
apply.

``.github/labeler.yml``:

.. code-block:: yaml

   area/front:
     - changed-files:
         - any-glob-to-any-file: 'apps/front/**'
   area/api:
     - changed-files:
         - any-glob-to-any-file: 'services/api/**'
   area/worker:
     - changed-files:
         - any-glob-to-any-file: 'services/worker/**'

``.github/workflows/labeler.yml``:

.. code-block:: yaml

   name: labeler
   on: [pull_request_target]

   permissions:
     contents: read
     pull-requests: write

   jobs:
     label:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/labeler@v5
           with:
             repo-token: ${{ secrets.GITHUB_TOKEN }}

.. warning::

   ``pull_request_target`` is what gives the job a write token on pull requests
   from forks. It runs in the context of the **base** repository with that
   token, so never check out or execute the pull request's own code inside it.
   The action above reads file names and applies labels — nothing from the
   branch is run.

GitHub — by size
----------------

The one dimension a title cannot carry, and the reason to bother with a
labeller at all if your titles are already good. Reading the size here would
cost one API call per request; a label costs none.

.. code-block:: yaml

   name: size-label
   on: [pull_request_target]

   permissions:
     contents: read
     pull-requests: write

   jobs:
     size:
       runs-on: ubuntu-latest
       steps:
         - uses: pascalgn/size-label-action@v0.5.5
           env:
             GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
           with:
             sizes: >
               {"0":"size/XS","20":"size/S","100":"size/M","500":"size/L"}

The action removes the previous size label when it applies a new one. GitHub
has no notion of mutually exclusive labels, so that behaviour is what keeps a
request from carrying ``size/S`` and ``size/L`` at once.

GitLab — by path and size
-------------------------

No packaged equivalent, but a job and the API are enough. Use **scoped
labels** — the ``::`` form — because GitLab guarantees a merge request carries
only one label of a scope, which is exactly what a dimension needs.

``.gitlab-ci.yml``:

.. code-block:: yaml

   label-mr:
     stage: .pre
     rules:
       - if: $CI_PIPELINE_SOURCE == "merge_request_event"
     variables:
       GIT_DEPTH: 0
     script:
       - BASE="origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
       - CHANGED=$(git diff --name-only "$BASE"...HEAD)
       - LABELS=""
       - echo "$CHANGED" | grep -q '^apps/front/'      && LABELS="$LABELS,area::front"
       - echo "$CHANGED" | grep -q '^services/api/'    && LABELS="$LABELS,area::api"
       - echo "$CHANGED" | grep -q '^services/worker/' && LABELS="$LABELS,area::worker"
       - LINES=$(git diff --numstat "$BASE"...HEAD | awk '{a+=$1+$2} END {print a+0}')
       - |
         if   [ "$LINES" -lt 20  ]; then LABELS="$LABELS,size::S"
         elif [ "$LINES" -lt 200 ]; then LABELS="$LABELS,size::M"
         else                            LABELS="$LABELS,size::L"; fi
       - |
         curl --fail --silent --request PUT \
           --header "PRIVATE-TOKEN: $LABEL_TOKEN" \
           --data-urlencode "add_labels=${LABELS#,}" \
           "$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests/$CI_MERGE_REQUEST_IID"

``LABEL_TOKEN`` is a project access token with the ``api`` scope and the
*Developer* role, stored as a masked CI/CD variable. ``GIT_DEPTH: 0`` is
required — the default shallow clone has no merge base to diff against.

.. note::

   A scoped label is one label whose *name* contains the separator. Git Pulse
   reads ``area::front`` as the single string it is and never splits it, so
   write the separator in your pattern: ``^area::(?<component>.+)$``.

.. _examples-configuring:

Configuring the application to read them
========================================

Three steps, whichever platform applied the labels. All of it lives in
:doc:`settings`.

Step 1 — classify the deployments
---------------------------------

:ref:`settings-environments` → **Environments** tab. This one you very likely
have already; what matters is that it produces the *same attribute name* the
pull requests will.

.. code-block:: text

   Name      Monorepo environments
   Pattern   ^(?<component>front|api|worker)-(?<type>prod|staging)$
   Kind      simple
   Priority  100
   Repo      (empty)

Step 2 — classify the pull requests
-----------------------------------

:ref:`settings-environments` → **PR labels** tab, confined to the monorepo so
the ordinary repositories beside it are untouched.

.. code-block:: text

   Name      Monorepo components
   Pattern   ^area/(?<component>front|api|worker)$
   Kind      simple
   Priority  100
   Repo      ^acme/platform$

On GitLab, with scoped labels, the pattern is ``^area::(?<component>.+)$``.

Add a **PR titles** rule beside it at a *higher* priority number if your titles
follow the convention too — it then covers the requests nobody labelled:

.. code-block:: text

   Name      Component from the commit convention
   Pattern   ^\w+\((?<component>front|api|worker)\)
   Kind      simple
   Priority  200
   Repo      ^acme/platform$

Enable both on the source, from the source form. A rule applies to nothing
until a source opts into it.

Step 3 — name the deployable
----------------------------

:ref:`settings-general` → **Deployable attribute**: ``component``.

That is the whole of it. Nothing declares which repository is a monorepo: the
rules produce the attribute where they were written to, and the correlation
narrows only for the pairs that carry it on both sides.

Checking it worked
------------------

.. list-table::
   :header-rows: 1
   :widths: 40 60

   * - Where
     - What you should see
   * - **Test the rule set**, in the Environments section
     - ``area/front`` against the source's own rules answers
       ``component=front``
   * - :doc:`dora`, filter bar
     - A ``component`` filter offering ``front``, ``api`` and ``worker``
   * - :doc:`dora`, deploy time
     - A value per component, no longer whichever release went out first
   * - Backend logs
     - No ``matches no deployment of the same repo`` warning. If there is one,
       the two sides are spelling the value differently — see
       :ref:`monorepo-deployable`

.. _examples-collection:

Tuning the collection
=====================

Why this matters on a monorepo, and what the banner means, is
:ref:`monorepo-collection`. Here are the two walkthroughs.

A GitHub monorepo, 90-day window
--------------------------------

**Symptom.** The DORA page shows *Read short on 1 listing(s)
(acme/platform)*. Lead time looks unusually good.

**Why.** Merged requests are read 50 to a page, twenty pages, so 1 000
requests — but the listing is ordered by *update*, not by merge. Every comment
on an old request pushes merges further down it. A repository with lively
review threads exhausts the budget on requests that merged months ago.

**What to do, in order:**

1. Set the DORA window to 30 days and see whether the banner clears. If the
   answer you need is a 90-day one, carry on.
2. Switch the source to *stored* mode with a 90-day history depth. Each
   scheduled collection then only reaches back to the previous one, so no
   single read has to cross the window. The banner disappears because the
   reports stop calling the platform at all.
3. Only if you must stay *live*: raise **API page cap** to cover your traffic.
   At 400 merges a month over 90 days — 1 200 requests, plus the comment
   traffic ahead of them — a cap of 40 is a reasonable first try. Watch the
   banner rather than the arithmetic.

A GitLab monorepo, 90-day window
--------------------------------

**Symptom.** The same banner, usually naming ``deployments`` first.

**Why.** Deployments are read 100 to a page, twenty pages, so 2 000 — and the
endpoint offers no creation filter, so the listing is bounded on
``updated_after``. An environment that updates old deployments keeps them in
the window. A monorepo deploying three components to three environments several
times a day reaches 2 000 in about three weeks.

**What to do:** the same three steps, in the same order. *stored* mode is worth
reaching for sooner here, because the client library follows pagination links
itself: there is no partial read to salvage, only a listing that stopped.

.. list-table::
   :header-rows: 1
   :widths: 34 33 33

   * - Reach for
     - When
     - Cost
   * - A narrower period
     - Always try first
     - None — a shorter, true answer
   * - *stored* mode
     - Any monorepo read over more than a few weeks
     - Storage, and a first ingestion that is one large read
   * - A higher page cap
     - Live reads you intend to keep
     - API budget on every deep read, on every collection
