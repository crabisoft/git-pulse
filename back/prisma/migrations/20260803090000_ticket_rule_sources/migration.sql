-- The texts a rule's pattern is run over. The default is what the extraction
-- already read: the branch, the title of whatever carries the change, and the
-- commit message. `body` is deliberately absent — reading a pull request's
-- description costs an API call the previous behaviour never made, so an
-- existing rule must not start paying for it without being asked.
ALTER TABLE "TicketRule" ADD COLUMN "sources" TEXT[] NOT NULL DEFAULT ARRAY['branch', 'title', 'commit']::TEXT[];
