-- Keep normalized search documents in the database so every write path
-- (application, seed, import or SQL) remains searchable without accents.
CREATE EXTENSION IF NOT EXISTS unaccent;

ALTER TABLE "Attraction"
ADD COLUMN "searchTextNormalized" TEXT NOT NULL DEFAULT '',
ADD COLUMN "locationTextNormalized" TEXT NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION normalize_vietticket_attraction_search(input TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  normalized TEXT;
BEGIN
  normalized := trim(regexp_replace(
    lower(unaccent(coalesce(input, ''))),
    '[^a-z0-9]+',
    ' ',
    'g'
  ));

  normalized := regexp_replace(normalized, '\mthanh pho ho chi minh\M', 'ho chi minh', 'g');
  normalized := regexp_replace(normalized, '\mtp ho chi minh\M', 'ho chi minh', 'g');
  normalized := regexp_replace(normalized, '\mtp hcm\M', 'ho chi minh', 'g');
  normalized := regexp_replace(normalized, '\mtphcm\M', 'ho chi minh', 'g');
  normalized := regexp_replace(normalized, '\mhcm\M', 'ho chi minh', 'g');
  normalized := regexp_replace(normalized, '\msai gon\M', 'ho chi minh', 'g');
  normalized := regexp_replace(normalized, '\mthanh pho ha noi\M', 'ha noi', 'g');
  normalized := regexp_replace(normalized, '\mtp ha noi\M', 'ha noi', 'g');
  normalized := regexp_replace(normalized, '\mhanoi\M', 'ha noi', 'g');
  normalized := regexp_replace(normalized, '\mhn\M', 'ha noi', 'g');
  normalized := regexp_replace(normalized, '\mthanh pho da nang\M', 'da nang', 'g');
  normalized := regexp_replace(normalized, '\mtp da nang\M', 'da nang', 'g');
  normalized := regexp_replace(normalized, '\mdanang\M', 'da nang', 'g');
  normalized := regexp_replace(normalized, '\mhalong\M', 'ha long', 'g');
  normalized := regexp_replace(normalized, '\mnhatrang\M', 'nha trang', 'g');
  normalized := regexp_replace(normalized, '\mphuquoc\M', 'phu quoc', 'g');
  normalized := regexp_replace(normalized, '\msapa\M', 'sa pa', 'g');
  normalized := regexp_replace(normalized, '\mq[[:space:]]*([0-9]{1,2})\M', 'quan \1', 'g');

  RETURN trim(regexp_replace(normalized, '[[:space:]]+', ' ', 'g'));
END;
$$;

CREATE OR REPLACE FUNCTION refresh_vietticket_attraction_search()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."locationTextNormalized" := normalize_vietticket_attraction_search(
    concat_ws(' ', NEW."address", NEW."city", NEW."district")
  );
  NEW."searchTextNormalized" := normalize_vietticket_attraction_search(
    concat_ws(
      ' ',
      NEW."title",
      NEW."description",
      NEW."address",
      NEW."city",
      NEW."district"
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Attraction_refresh_normalized_search"
BEFORE INSERT OR UPDATE OF "title", "description", "address", "city", "district"
ON "Attraction"
FOR EACH ROW
EXECUTE FUNCTION refresh_vietticket_attraction_search();

-- Backfill existing rows by invoking the trigger without changing business data.
UPDATE "Attraction" SET "title" = "title";
