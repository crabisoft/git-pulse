"""Sphinx configuration for the user guide.

One source tree, one language. What Read the Docs adds on top is the version
axis: it builds a branch or a tag per version and serves them side by side, so
a reader on 1.4 gets the guide of 1.4 rather than the guide of `main`.
"""

project = "Git Dashboard"
author = "CrabiSoft"
copyright = "2026, CrabiSoft"

extensions = [
    "sphinx.ext.extlinks",
]

# The technical documentation and the runbooks stay in the repository, beside
# the code they describe, and are deliberately not part of this guide: they
# address whoever runs the application, not whoever reads it. They are linked
# for what they are — files on GitHub.
extlinks = {
    "repo": ("https://github.com/CrabiSoft/git-dashboard/blob/main/%s", "%s"),
}

exclude_patterns = []

html_theme = "sphinx_rtd_theme"
html_title = f"{project} — user guide"
html_show_sourcelink = False

# Full width, and tables that wrap rather than scroll sideways. See the file
# itself for what the theme does that this undoes.
html_static_path = ["_static"]
html_css_files = ["custom.css"]
