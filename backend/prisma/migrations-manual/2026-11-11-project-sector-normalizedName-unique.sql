-- EFMS — ProjectSector normalizedName unique constraint (PostgreSQL)
-- Phase B.2.1.4: Final catalog-verified unique index creation.
--
-- PREREQUISITES (must all pass before this migration runs):
-- 1. Migration 2026-11-10-project-sector-m2m.sql must be applied.
-- 2. Backfill script (normalize-project-sector-names.ts) must have run successfully.
-- 3. Conflict detection query must return zero rows.
-- 4. No empty/whitespace-only normalizedName values may exist.
--
-- VERIFICATION queries (run manually before applying):
--   SELECT COUNT(*) FROM core."ProjectSector" WHERE "normalizedName" IS NULL;
--   SELECT COUNT(*) FROM core."ProjectSector" WHERE LENGTH(TRIM(BOTH E' \t\n\r\f\v' FROM "normalizedName")) = 0;
--   SELECT "projectId", "normalizedName", COUNT(*) FROM core."ProjectSector"
--     GROUP BY "projectId", "normalizedName" HAVING COUNT(*) > 1;
-- All three must return 0.
--
-- CATALOG VERIFICATION: This migration inspects PostgreSQL catalog metadata
-- to determine whether the index already exists and whether it matches the
-- required definition. It does NOT blindly use IF NOT EXISTS.

-- ============================================================
-- Step 1: Verify prerequisite — no NULL normalizedName
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM core."ProjectSector" WHERE "normalizedName" IS NULL) THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED: ProjectSector contains NULL normalizedName values. Run backfill first.';
  END IF;
END $$;

-- ============================================================
-- Step 2: Verify prerequisite — no empty/whitespace-only normalizedName
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM core."ProjectSector" WHERE LENGTH(TRIM(BOTH E' \t\n\r\f\v' FROM "normalizedName")) = 0) THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED: ProjectSector contains empty/whitespace-only normalizedName values.';
  END IF;
END $$;

-- ============================================================
-- Step 3: Verify prerequisite — no duplicate (projectId, normalizedName)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT "projectId", "normalizedName"
    FROM core."ProjectSector"
    GROUP BY "projectId", "normalizedName"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'PREREQUISITE FAILED: Duplicate (projectId, normalizedName) values exist. Resolve conflicts first.';
  END IF;
END $$;

-- ============================================================
-- Step 4: Catalog verification — exact index identity and definition
-- ============================================================
-- Verify schema, table, index name, uniqueness, validity, readiness,
-- column count, column order, no partial predicate, no expression index,
-- default collation, and default operator class.
DO $$
DECLARE
  idx_exists BOOLEAN;
  idx_schema TEXT;
  idx_table TEXT;
  idx_unique BOOLEAN;
  idx_valid BOOLEAN;
  idx_ready BOOLEAN;
  idx_nkeyatts INT;
  idx_natts INT;
  idx_columns TEXT;
  idx_partial BOOLEAN;
  idx_expression BOOLEAN;
  idx_indexprs NULL;
  idx_collation OID[];
  idx_opclass_default BOOLEAN;
  idx_opclass_amname TEXT;
  idx_opclass_types TEXT;
BEGIN
  -- Check if index exists by schema + table + name
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'core'
      AND tablename = 'ProjectSector'
      AND indexname = 'ProjectSector_projectId_normalizedName_key'
  ) INTO idx_exists;

  IF idx_exists THEN
    -- Verify schema and table via pg_class + pg_namespace
    SELECT n.nspname, c.relname INTO idx_schema, idx_table
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace tn ON tn.oid = t.relnamespace
    WHERE c.relname = 'ProjectSector_projectId_normalizedName_key'
      AND tn.nspname = 'core'
      AND t.relname = 'ProjectSector';

    IF idx_schema IS NULL OR idx_table IS NULL THEN
      RAISE EXCEPTION 'INDEX IDENTITY MISMATCH: index found but not on core.ProjectSector.';
    END IF;

    -- Verify indisunique
    SELECT i.indisunique INTO idx_unique
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'ProjectSector_projectId_normalizedName_key';

    IF NOT idx_unique THEN
      RAISE EXCEPTION 'INDEX MISMATCH: ProjectSector_projectId_normalizedName_key exists but is NOT unique.';
    END IF;

    -- Verify indisvalid
    SELECT i.indisvalid INTO idx_valid
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'ProjectSector_projectId_normalizedName_key';

    IF NOT idx_valid THEN
      RAISE EXCEPTION 'INDEX MISMATCH: ProjectSector_projectId_normalizedName_key exists but is NOT valid.';
    END IF;

    -- Verify indisready
    SELECT i.indisready INTO idx_ready
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'ProjectSector_projectId_normalizedName_key';

    IF NOT idx_ready THEN
      RAISE EXCEPTION 'INDEX MISMATCH: ProjectSector_projectId_normalizedName_key exists but is NOT ready.';
    END IF;

    -- Verify indnkeyatts = 2
    SELECT i.indnkeyatts INTO idx_nkeyatts
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'ProjectSector_projectId_normalizedName_key';

    IF idx_nkeyatts <> 2 THEN
      RAISE EXCEPTION 'INDEX MISMATCH: indnkeyatts is %, expected 2.', idx_nkeyatts;
    END IF;

    -- Verify indnatts = 2
    SELECT i.indnatts INTO idx_natts
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'ProjectSector_projectId_normalizedName_key';

    IF idx_natts <> 2 THEN
      RAISE EXCEPTION 'INDEX MISMATCH: indnatts is %, expected 2.', idx_natts;
    END IF;

    -- Verify columns are exactly (projectId, normalizedName) in order
    SELECT string_agg(a.attname, ',' ORDER BY k.ord) INTO idx_columns
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
    WHERE n.nspname = 'core'
      AND c.relname = 'ProjectSector_projectId_normalizedName_key'
      AND a.attnum = k.attnum;

    IF idx_columns IS DISTINCT FROM 'projectId,normalizedName' THEN
      RAISE EXCEPTION 'INDEX MISMATCH: columns are "%", expected "projectId,normalizedName".', idx_columns;
    END IF;

    -- Verify not partial (indpred IS NULL)
    SELECT (i.indpred IS NOT NULL) INTO idx_partial
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'ProjectSector_projectId_normalizedName_key';

    IF idx_partial THEN
      RAISE EXCEPTION 'INDEX MISMATCH: ProjectSector_projectId_normalizedName_key is a partial index (has WHERE clause).';
    END IF;

    -- Verify not expression index (indexprs IS NULL, no 0 in indkey)
    SELECT (i.indexprs IS NOT NULL) INTO idx_expression
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'ProjectSector_projectId_normalizedName_key';

    IF idx_expression THEN
      RAISE EXCEPTION 'INDEX MISMATCH: ProjectSector_projectId_normalizedName_key is an expression index.';
    END IF;

    IF 0 = ANY (
      SELECT unnest(i.indkey)
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'core' AND c.relname = 'ProjectSector_projectId_normalizedName_key'
    ) THEN
      RAISE EXCEPTION 'INDEX MISMATCH: ProjectSector_projectId_normalizedName_key contains expression columns (0 in indkey).';
    END IF;

    -- Verify default collation (all zeros = default collation)
    SELECT i.indcollation INTO idx_collation
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'ProjectSector_projectId_normalizedName_key';

    IF idx_collation <> ARRAY[0, 0]::oid[] THEN
      RAISE EXCEPTION 'INDEX MISMATCH: non-default collation detected (got %, expected [0,0]).', idx_collation;
    END IF;

    -- Verify operator classes: all must be default operator classes for their types.
    -- Uses pg_opclass.opcdefault (portable, no hardcoded OIDs).
    -- Also verifies the access method is btree and types are int4 + text.
    SELECT bool_and(oc.opcdefault) INTO idx_opclass_default
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(i.indclass) AS oc_oid(oid)
    JOIN pg_opclass oc ON oc.oid = oc_oid.oid
    WHERE n.nspname = 'core' AND c.relname = 'ProjectSector_projectId_normalizedName_key';

    IF idx_opclass_default IS NULL THEN
      RAISE EXCEPTION 'INDEX MISMATCH: could not determine operator class default status (NULL result).';
    END IF;

    IF NOT idx_opclass_default THEN
      RAISE EXCEPTION 'INDEX MISMATCH: non-default operator class detected.';
    END IF;

    -- Verify access method is btree
    SELECT am.amname INTO idx_opclass_amname
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_am am ON am.oid = (SELECT relam FROM pg_class WHERE oid = i.indexrelid)
    WHERE n.nspname = 'core' AND c.relname = 'ProjectSector_projectId_normalizedName_key';

    IF idx_opclass_amname IS DISTINCT FROM 'btree' THEN
      RAISE EXCEPTION 'INDEX MISMATCH: access method is "%", expected "btree".', idx_opclass_amname;
    END IF;

    -- Verify operator class input types are int4 and text (in order)
    SELECT string_agg(t.typname, ',' ORDER BY k.ord) INTO idx_opclass_types
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(i.indclass) WITH ORDINALITY AS k(oc_oid, ord)
    JOIN pg_opclass oc ON oc.oid = k.oc_oid
    JOIN pg_type t ON t.oid = oc.opcintype
    WHERE n.nspname = 'core' AND c.relname = 'ProjectSector_projectId_normalizedName_key';

    IF idx_opclass_types IS DISTINCT FROM 'int4,text' THEN
      RAISE EXCEPTION 'INDEX MISMATCH: operator class types are "%", expected "int4,text".', idx_opclass_types;
    END IF;

    -- If all checks pass
    RAISE NOTICE 'Index ProjectSector_projectId_normalizedName_key already exists with exact required definition. Skipping creation.';
  ELSE
    -- Index does not exist: create it
    CREATE UNIQUE INDEX "ProjectSector_projectId_normalizedName_key"
        ON core."ProjectSector" ("projectId", "normalizedName");
    RAISE NOTICE 'Index ProjectSector_projectId_normalizedName_key created successfully.';
  END IF;
END $$;

-- ============================================================
-- Step 5: Verify CHECK constraint exists and is correct
-- ============================================================
DO $$
DECLARE
  check_def TEXT;
  check_validated BOOLEAN;
BEGIN
  SELECT pg_get_constraintdef(con.oid), con.convalidated INTO check_def, check_validated
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'core'
    AND rel.relname = 'ProjectSector'
    AND con.conname = 'ProjectSector_normalizedName_check'
    AND con.contype = 'c';

  IF check_def IS NULL THEN
    RAISE EXCEPTION 'CHECK CONSTRAINT MISSING: ProjectSector_normalizedName_check not found. Apply structural migration first.';
  END IF;

  IF NOT check_validated THEN
    RAISE EXCEPTION 'CHECK CONSTRAINT NOT VALIDATED: ProjectSector_normalizedName_check exists but is not validated.';
  END IF;

  -- Verify the CHECK expression contains the key components:
  -- 1. LENGTH(TRIM(...)) > 0  (non-empty after trimming)
  -- 2. normalizedName column reference
  -- 3. TRIM with whitespace characters (space, tab, newline, CR, form feed, vertical tab)
  -- Note: pg_get_constraintdef() normalizes output, so we check for semantic components.
  -- Limitation: This is still a substring-based check. PostgreSQL does not expose
  -- a parsed expression tree for CHECK constraints in a easily comparable format.
  -- The safest defensible verification checks for all key components.
  IF check_def NOT LIKE '%length%' OR check_def NOT LIKE '%trim%' OR check_def NOT LIKE '%normalizedName%' OR check_def NOT LIKE '%> 0%' THEN
    RAISE EXCEPTION 'CHECK CONSTRAINT MISMATCH: definition is "%", expected to check normalizedName is not empty/whitespace (must contain length, trim, normalizedName, and > 0).', check_def;
  END IF;

  -- Additional: verify the trim includes the standard whitespace characters
  IF check_def NOT LIKE '%'' %' THEN
    RAISE NOTICE 'WARNING: CHECK constraint may not trim space character explicitly. Definition: %', check_def;
  END IF;

  RAISE NOTICE 'CHECK constraint ProjectSector_normalizedName_check verified (validated=%): %', check_validated, check_def;
END $$;

-- ROLLBACK:
-- DROP INDEX IF EXISTS core."ProjectSector_projectId_normalizedName_key";
-- (CHECK constraint rollback is in the structural migration)
