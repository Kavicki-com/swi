-- OCC do Report (U01, ticket 12): PATCH com baseVersion desatualizado -> 409.
ALTER TABLE "Report" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
