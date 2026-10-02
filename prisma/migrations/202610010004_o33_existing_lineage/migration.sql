UPDATE "stock_movements" m SET "source_revision" = 0, "source_operation" = 'CREATE'
WHERE "source_type" IN ('SERVICE', 'SLS')
  AND "movement_type" IN ('SERVICE_ISSUE', 'SLS_ISSUE')
  AND "source_revision" IS NULL;
