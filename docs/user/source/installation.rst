============
Installation
============

An install is four pieces: the API, the web application, a PostgreSQL database
and a Redis instance for the background jobs. Everything below is a different
way of putting those four together — the application is the same in all of
them.

Every other page of this guide assumes one is running.

Which way to install it
=======================

.. list-table::
   :header-rows: 1
   :widths: 24 40 36

   * - Way
     - What it is for
     - What it needs
   * - :ref:`install-images`
     - Running it, and evaluating it. Nothing is cloned and nothing is built
     - Docker, and one file
   * - :ref:`install-source`
     - Changing it, or building the images yourself
     - Docker, Node 24+, the repository
   * - :ref:`install-bare`
     - A host where Docker is not an option
     - Node 24+, your own PostgreSQL and Redis

.. _install-images:

From the published images
=========================

The shortest route. Two images are published on every release; this compose
file wires them to a database and a Redis:

.. code-block:: bash

   curl -O https://raw.githubusercontent.com/CrabiSoft/git-dashboard/main/.docker/docker-compose.ghcr.yml
   docker compose -f docker-compose.ghcr.yml up -d

The application is on http://localhost:8080, **API included** — one origin, one
port, nothing to configure between the two. The database migrations run before
the API starts, on every boot, so an upgrade is a pull and a restart.

Then go to :doc:`getting-started`: the first screen offers to create the first
admin account, and that offer closes as soon as one exists.

.. _install-source:

From the source
===============

For changing the application, or for building the images rather than pulling
them. Needs Docker and Node 24+.

.. code-block:: bash

   git clone https://github.com/CrabiSoft/git-dashboard.git
   cd git-dashboard
   make dev

Two stacks, and they are not the same thing:

.. list-table::
   :header-rows: 1
   :widths: 20 80

   * - Command
     - What you get
   * - ``make dev``
     - Watch mode: the API restarts on a change, the web application reloads
       in the browser. Web on http://localhost:5173, API on
       http://localhost:3001/api
   * - ``make prod``
     - The images built locally and served through nginx, as they would be in
       production. Everything on http://localhost:8080

``make`` with no argument lists every target.

.. _install-bare:

Without Docker
==============

Needs Node 24+, and a PostgreSQL and a Redis you can reach — ``.env.example``
documents the variables that point at them.

.. code-block:: bash

   npm install
   npm run build:shared
   npm run db:deploy      # applies the migrations
   npm run dev:back       # http://localhost:3001
   npm run dev:front      # http://localhost:5173

.. _install-demo:

Trying it locally, with no platform at all
==========================================

Evaluating a dashboard should not start with creating a GitHub App, granting it
repositories and waiting for a collection to finish. The demo skips all of it:
a fictional organization is written straight into the store, and **no platform
is ever called** — the source is created in ``stored`` mode, so there is
nothing to authenticate and nothing to rate-limit.

With a stack from :ref:`install-source` running:

.. code-block:: bash

   make dev               # or make prod
   make demo              # fills the install
   make demo-clear        # removes it again

.. note::

   The demo needs the repository, because the command lives in its Makefile —
   ``make demo mode=prod`` for the built stack. It is the one thing the
   published-images route above cannot do on its own.

It prints the account to sign in with — ``demo@example.com`` /
``demo-password``, unless ``make demo email=… password=…`` says otherwise — and
the source appears as **Acme Platform (demo)** at ``/dashboard/acme-platform``.

What you get to click through
-----------------------------

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Four repositories
     - Under an ``acme`` owner
   * - Environments
     - ``prod-``, ``staging-`` and three ``review-`` per client and app
   * - Ninety days of history
     - Weekdays only, so the charts have a shape rather than a straight line
   * - ~460 deployments
     - Roughly one in ten failed, which is what gives change failure rate and
       MTTR something to be
   * - ~250 merged pull requests
     - With their lead-time segments, plus 14 open — three of them stale
   * - Changelogs
     - The last 30 production deployments, one of them deliberately filed
       unreadable, so :doc:`history` shows what a lost content looks like

**Two classification rules come with it**, which is what makes the filters work
out of the box: an environment name carries the client and the app, a repository
name carries the app. That is where the ``env``, ``client`` and ``app``
dimensions on every page come from — and it is the quickest way to see what
:ref:`settings-environments` is for before writing your own.

Everything the demo writes is what an ingestion would have written: the same
tables, the same shapes. The pages cannot tell the difference, which is the
point — what you are looking at is the real application, on invented data.

.. note::

   The demo has no version readings: :doc:`versions` asks real environments over
   HTTP, and there are none here. That reading stays empty.

Before you put anything real in it
==================================

.. warning::

   **The master key encrypts every credential the application stores.** It is
   generated on first boot into its own volume, and it is not in the database
   dump. Back it up separately, now, before adding a source — a restored
   database without its key gives back secrets nobody can decrypt.

   Backing up, restoring, rotating it and upgrading are the operator's side of
   the application, and they live with the code:
   :repo:`the runbooks <docs/runbooks/README.md>`.

Configuration
=============

Ports, database credentials and origins come from ``.docker/.env``. Override
them in ``.docker/.env.local`` — it is ignored by git — rather than editing the
versioned file.

Everything else lives in the database and is edited from the application
itself: collection schedule, DORA window, page size, API reserve, public access.
That is :doc:`settings`, and it needs no restart.
