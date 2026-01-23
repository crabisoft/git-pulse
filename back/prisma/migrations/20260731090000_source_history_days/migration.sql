-- How far back the ingestion reads for a stored source. Nullable on purpose --
-- null means "follow the reporting window", which every existing source was
-- already doing, and which a copy of that window would stop doing the day it
-- changes.
ALTER TABLE "Source" ADD COLUMN "historyDays" INTEGER;
