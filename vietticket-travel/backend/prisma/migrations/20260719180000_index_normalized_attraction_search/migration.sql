CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Attraction_searchTextNormalized_trgm_idx"
ON "Attraction"
USING GIN ("searchTextNormalized" gin_trgm_ops);

CREATE INDEX "Attraction_locationTextNormalized_trgm_idx"
ON "Attraction"
USING GIN ("locationTextNormalized" gin_trgm_ops);
