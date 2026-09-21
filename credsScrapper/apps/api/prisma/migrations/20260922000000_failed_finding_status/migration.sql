-- Earlier inconclusive live checks were stored as unknown. Preserve their
-- timestamps and reasons while reserving unknown for never-attempted findings.
UPDATE "findings"
SET "status" = 'failed'
WHERE "status" = 'unknown'
  AND ("checked_at" IS NOT NULL OR COALESCE("test_reason", '') <> '');
