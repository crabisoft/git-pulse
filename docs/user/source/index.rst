==========
User guide
==========

Git Dashboard reports on the Git platforms it reads: what is deployed where,
how fast changes get out, what is in the way, and what each release carried. It
writes nothing back — every credential it holds is read-only.

Most of what follows is the application as seen from a browser. :doc:`Putting it
somewhere <installation>` is here too, in the shape somebody evaluating it
needs; keeping it alive afterwards — backups, upgrades, the master key — lives
with the code, in the :repo:`runbooks <docs/runbooks/README.md>`.

.. toctree::
   :maxdepth: 2
   :caption: The guide

   installation
   getting-started
   credentials
   overview
   dora
   deployments
   versions
   history
   release-notes
   settings
   account

Start here
==========

**Nothing installed yet?** :doc:`installation` — three ways to put it
somewhere, and how to fill a local one with a fictional organization so there
is something to click through before any credential exists.

**Installed, but empty?** :doc:`getting-started` — the first admin account, the
first source, and the first collection. Roughly ten minutes, most of it spent
waiting for the platform to answer.

**Somebody already set it up?** Go straight to :doc:`the Overview <overview>`.
It is the page the application opens on, and the only one that tries to answer
"is anything wrong right now" before anything else.

The pages
=========

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Page
     - What it answers
   * - :doc:`installation`
     - Where it can run, what each way needs, and how to try it locally with
       no platform at all
   * - :doc:`credentials`
     - What to create on GitHub or GitLab, what to grant it, and what each
       missing grant leaves empty
   * - :doc:`overview`
     - What is running, how fast it is going out, what is stuck — in four
       readings you switch between
   * - :doc:`dora`
     - The four metrics over a period and a slice, and what each value is made
       of
   * - :doc:`deployments`
     - What went where, and the commits each deployment carried
   * - :doc:`versions`
     - What each environment is actually running, asked of the environment
       itself rather than of the platform
   * - :doc:`history`
     - The same question months later, after the platform has forgotten
   * - :doc:`release-notes`
     - A range of commits summarised as Markdown, optionally rewritten by a
       model
   * - :doc:`settings`
     - Sources, rules, accounts, and everything an admin sets — admins only
   * - :doc:`account`
     - Your name, your password, your language, and how the application looks
       to you

Two things worth knowing before reading any of them
===================================================

**A figure is always relative to a period and a scope.** Every page carries a
filter bar, and the same metric over two periods is two different numbers
rather than a disagreement. Where a page can, it states the period it actually
applied rather than the one you asked for — they differ when a bound was left
open.

**What you are looking at lives in the URL.** Filters, the period, the fold,
the crossing — all of it. A link therefore reproduces exactly what its sender
was reading, the back button works, and a refresh loses nothing. This is the
intended way to send somebody a figure: send the link, not the number.

.. note::

   **Dimensions** — the words ``app``, ``type``, ``client`` and the like that
   slice nearly every page — do not exist until an admin writes the rules that
   extract them from your own naming conventions. On a fresh install every
   filter offers nothing and every metric is one global bucket.
   :ref:`settings-environments` is where that changes, and it is the single
   highest-value thing to configure after the first source.
