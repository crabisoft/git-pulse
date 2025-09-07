-- AlterTable: nullable first, so existing rows can be backfilled.
ALTER TABLE "Source" ADD COLUMN "slug" TEXT;

-- Backfill from the name: lowercase, every run of non-alphanumerics becomes a
-- single dash. Accented characters collapse to a dash here (no unaccent
-- extension assumed) — renaming the source regenerates a cleaner slug.
-- Duplicate names are disambiguated by creation order: foo, foo-2, foo-3.
UPDATE "Source" AS s
SET "slug" = base.slug || CASE WHEN base.rn = 1 THEN '' ELSE '-' || base.rn END
FROM (
  SELECT
    id,
    slug,
    row_number() OVER (PARTITION BY slug ORDER BY "createdAt", id) AS rn
  FROM (
    SELECT
      id,
      "createdAt",
      COALESCE(
        NULLIF(trim(BOTH '-' FROM regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), ''),
        'source'
      ) AS slug
    FROM "Source"
  ) normalized
) base
WHERE s.id = base.id;

ALTER TABLE "Source" ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Source_slug_key" ON "Source"("slug");
