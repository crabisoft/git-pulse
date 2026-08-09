===============
Getting started
===============

From an install nobody has signed into yet to a dashboard with figures on it.
The steps are in this order for a reason: each one is what makes the next one
show something.

1. Create the first admin
=========================

Open the application. An install with **no account at all** offers to create
one — *Create the first admin*: a name, an email address and a password.

That offer closes for good as soon as an account exists. There is no
self-registration afterwards and no sign-up link to find: every other account
is handed out from :ref:`settings-accounts`. The same screen becomes the
ordinary sign-in form from then on.

.. warning::

   Locked out later with no admin able to sign in is the one state this
   interface cannot repair. It is repaired from the host, and the runbook for
   it is :repo:`Nobody can sign in <docs/runbooks/lost-admin-access.md>`.

2. Connect a source
===================

**Settings › Sources › Add a source.** A source is one organization or group on
one platform.

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Field
     - What to put in it
   * - **Name**
     - Free text. It becomes the address of every page of this source, so
       ``Acme — Prod`` gives ``/dashboard/acme-prod``
   * - **Platform**
     - GitHub or GitLab, public or self-hosted
   * - **Base URL**
     - The instance, e.g. ``https://gitlab.example.com``. Self-hosted and
       Enterprise are supported
   * - **Organization** / **Group**
     - Whose repositories are read
   * - **Authentication**
     - *Shared token*, or *GitHub App* where the platform offers it
   * - **Secret**
     - Encrypted the moment it is saved, and never shown again

Everything the credential is used for is **read-only**. What exactly to create
and what to grant it — the App's six permissions, a token's scopes, and what
each of them is asked for — is :doc:`credentials`. It is worth reading before
this step rather than after: a missing permission does not fail loudly, it
leaves a panel empty.

Press **Test connection** before saving anything else. It proves the base URL,
the owner and the secret together, which no form can check on its own.

.. note::

   **Test** only exercises the repository listing. It passes on a credential
   that will still come up short on, say, deployments — so an empty
   Deployments page on a source that tested green means the grant, not the
   connection. :ref:`credentials-symptoms` reads the empty pages back into the
   permission behind them.

Live or stored
--------------

**Data read from** decides who calls the platform:

.. list-table::
   :header-rows: 1
   :widths: 34 33 33

   * -
     - **Live**
     - **Stored**
   * - Who calls the platform
     - every page view
     - the collection only
   * - What the API budget follows
     - your traffic
     - your collection schedule
   * - How fresh a page is
     - this instant
     - the last collection (or the last event)

``live`` is the simpler thing to reason about and the easier one to exhaust:
ten people refreshing twenty repositories every thirty seconds is fifty
thousand calls an hour, against the five thousand github.com allows. Anything
beyond a couple of readers wants ``stored``.

Switching a source to ``stored`` fires a first collection by itself — otherwise
the board would stay empty until the schedule next came round.

3. Collect
==========

On a ``stored`` source, **Collect now** (next to *Test*, in the sources list)
is what fills the store. There is nothing else to trigger: ingestion is part of
collecting.

**A first run over a large scope takes minutes** and walks the whole reporting
window repository by repository. Behind a reverse proxy it is long enough to
hit a gateway timeout — the browser then reports a network error while the
collection carries on perfectly well server-side. :ref:`settings-jobs` says
whether it is still going.

4. Teach it your naming conventions
===================================

At this point the pages have data and every filter is empty. That is expected:
**dimensions do not exist until you describe them.**

A classification rule is a regular expression with named groups, applied to a
name. ``(?<client>[a-z]+)-(?<app>[a-z]+)-prod`` turns the environment
``acme-billing-prod`` into ``client=acme``, ``app=billing``. Those two words
are then what every filter offers, what the board folds on, what the matrix
crosses and what DORA slices by.

**Settings › Environments** holds the catalogue, on five tabs. The first three
are where to start:

.. list-table::
   :header-rows: 1
   :widths: 20 30 50

   * - Tab
     - Matched against
     - Without it
   * - **Environments**
     - Deployment environment names
     - The board is one flat list and deployment metrics have one bucket
   * - **Repositories**
     - Repository names
     - Lead time and its four segments fall into a single global bucket — a
       pull request has no environment
   * - **Incidents**
     - Incident labels
     - Change failure rate finds no deployment to divide by

The other two — **PR labels** and **PR titles** — classify a merged request by
what it carries rather than by the repository holding it. Skip them unless one
repository holds several things that ship on their own, which is
:doc:`monorepo`.

Two things catch people out:

- A rule applies to **nothing** until a source ticks it, back on the source
  form (*Classification rules*). The catalogue is global; the subscription is
  per source. That split is deliberate — a naming convention rarely stops at
  one repository host.
- Patterns are matched **unanchored**. Remember ``^`` and ``$`` if you mean the
  whole name.

Use **Test the rule set** as you go. It classifies a name you type against the
saved rules and shows what comes out, which is faster than a collection and
tells you the same thing.

.. note::

   Rules are applied **when a page is read**, never when data is ingested. A
   rule corrected today applies to everything already collected, with nothing
   to re-run. The one exception is the historised DORA readings, which were
   computed at the time — :ref:`replaying them <settings-sources>` is an
   explicit action.

5. Look at it
=============

:doc:`The Overview <overview>` is now worth opening. If it is still thin, the
usual causes in order: the collection has not run yet, no rule matches your
environment names, or the credential is missing a permission.

What is left
============

- :ref:`settings-accounts` for everyone else. Roles are coarse on purpose:
  *Admin* configures the install, *User* only reads.
- **Public dashboard** (:ref:`settings-general`) is **on** by default — the
  Overview and DORA are readable without signing in. Turn it off and the whole
  application asks for an account. The settings are admin-only either way.
- :ref:`settings-trackers` if you want pull requests to link to their tickets,
  and incidents to be tied to the deployment that caused them.
- :ref:`settings-ai-providers` if you want release notes rewritten into prose.
  Notes are generated without one.
- :ref:`settings-versions` if you want the dashboard to report what your
  environments are **running** rather than only what was deployed to them.
  Nothing else in the application reaches outside the Git platform, and this is
  off until you ask for it — :doc:`versions`.

.. tip::

   Want to see the pages populated before committing a credential to it?
   ``make demo`` fills a local install with a fictional organization and calls
   no platform at all — :ref:`install-demo`.
