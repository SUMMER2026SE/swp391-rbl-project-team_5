CREATE OR REPLACE FUNCTION refresh_vietticket_attraction_search()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."locationTextNormalized" := ' ' || normalize_vietticket_attraction_search(
    concat_ws(' ', NEW."address", NEW."city", NEW."district")
  ) || ' ';
  NEW."searchTextNormalized" := ' ' || normalize_vietticket_attraction_search(
    concat_ws(
      ' ',
      NEW."title",
      NEW."description",
      NEW."address",
      NEW."city",
      NEW."district"
    )
  ) || ' ';
  RETURN NEW;
END;
$$;

UPDATE "Attraction" SET "title" = "title";
