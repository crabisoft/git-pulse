=============
Release notes
=============

A range of commits, read as Conventional Commits and summarised as Markdown —
then, if you want it, rewritten into prose by a model.

Nothing on this page is stored. It is generated when you press **Generate**,
from the platform, and it stays on screen.

Choosing the range
==================

A **repository**, and two bounds that are each a tag or a branch. They fill
themselves in with the answer you usually want: **the most recent tag** as the
upper bound, and **the tag below it** as the lower one — which is the range of
the release about to go out.

- Pick from the tags and branches the repository offers, or leave them alone.
- A repository with **no tag** says so, and offers the alternative: pick a
  branch, or leave the bounds alone to run from the beginning of history to the
  default branch.
- *No repository in this source scope* means the credential lists none — a
  permission, not an empty organization.

The generated notes
===================

Commits are read as `Conventional Commits <https://www.conventionalcommits.org>`_
and filed under the section their type names: Features, Bug fixes,
Performance, Reverts, Refactoring, Documentation, Style, Tests, Build,
Continuous integration, Chores.

**Commits following no convention are not dropped.** They land in a section
called *Following no convention*, which is the honest thing to do: silence
there would read as "nothing else changed".

Three things happen beyond sorting:

**Breaking changes are lifted out.** Anything marking itself breaking — the
``!`` or a ``BREAKING CHANGE:`` footer — is repeated at the top under a warning
of its own, rather than being left in the middle of the section it belongs to.

**Squashes are expanded.** A squash merge that replaced fifteen commits is read
as the work it replaced, not as one line.

**Ticket references are resolved into links**, using the tracker rules an admin
set — see :ref:`settings-trackers`. Without those rules the references stay as
written.

The **Markdown** tab is the same notes as text, ready to paste into a release,
a ticket or a mail.

.. note::

   The generator itself is an install-wide choice
   (:ref:`settings-release-notes`), between the built-in one and
   ``conventional-changelog``. The second lists **only** the commits that
   follow the convention, and it does not carry the ticket links the rules
   found. The sections on the page hold everything either way — the choice
   affects the Markdown, not what was read.

Rewriting with a model
======================

Optional, and off unless an admin declared a provider
(:ref:`settings-ai-providers`). It turns a list of commits into something
written for people who did not write them.

.. warning::

   **What is sent is the Markdown above, and nothing else.** Not your code, not
   your diffs, not your repository. The result appears beside it, so you can
   check that nothing was added — a model asked to summarise can also invent,
   and the page is laid out so that comparing is easy rather than optional.

**Language** is either a language you name, or *Follow the commits* — the notes
come back in whatever language the commit messages are written in.

The result is credited: *Rewritten by <provider> (<model>)*. It stays on
screen and is stored nowhere.

When nothing comes out
======================

*No change in this range.* The two bounds resolve to the same tree — most often
a tag that was just moved onto the branch it is being compared with.
