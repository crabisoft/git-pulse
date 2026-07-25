# Local commands for the guide. Read the Docs runs neither of them — it reads
# ../.readthedocs.yaml — but checking a page before pushing it needs the first.

SPHINXBUILD ?= sphinx-build
SOURCE      := source
BUILD       := build

.PHONY: html clean

## The guide, warnings fatal, as Read the Docs builds it.
html:
	$(SPHINXBUILD) -W -b html $(SOURCE) $(BUILD)/html

clean:
	rm -rf $(BUILD)
