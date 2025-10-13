
'use strict';

/**
 * Ensures a single (non-null) Vendor.UserId per vendor:
 *  - Cleans duplicates (keeps first, sets others to NULL)
 *  - Drops any existing UNIQUE constraints / indexes on ("UserId")
 *  - Creates a PARTIAL UNIQUE INDEX on ("UserId") WHERE "UserId" IS NOT NULL
 * Works whether the table is named "Vendors" (quoted, PascalCase) or vendors (lowercase).
 */

async function detectVendorsTable(sequelize) {
  // Check quoted first: public."Vendors"
  const [[q1]] = await sequelize.query(
    `SELECT to_regclass('public."Vendors"') AS reg;`
  );
  if (q1 && q1.reg) {
    return {
      bare: 'Vendors',                // relname
      qualified: 'public."Vendors"',  // fully-qualified identifier for SQL
    };
  }

  // Then check unquoted: public.vendors
  const [[q2]] = await sequelize.query(
    `SELECT to_regclass('public.vendors') AS reg;`
  );
  if (q2 && q2.reg) {
    return {
      bare: 'vendors',
      qualified: 'public.vendors',
    };
  }

  throw new Error('Neither table public."Vendors" nor public.vendors exists');
}

module.exports = {
  async up(queryInterface /* , Sequelize */) {
    const sql = queryInterface.sequelize;

    // 1) Detect actual table name
    const T = await detectVendorsTable(sql); // => { bare: 'Vendors' | 'vendors', qualified: 'public."Vendors"' | 'public.vendors' }
    const IDX_NAME = 'vendors_userid_unique';

    // 2) Clean duplicates (keep row_number = 1, null out the rest)
    await sql.query(
      `
      WITH d AS (
        SELECT id, "UserId",
               ROW_NUMBER() OVER (PARTITION BY "UserId" ORDER BY id) AS rn
        FROM ${T.qualified}
        WHERE "UserId" IS NOT NULL
      )
      UPDATE ${T.qualified} v
      SET "UserId" = NULL
      FROM d
      WHERE v.id = d.id AND d.rn > 1;
      `
    );

    // 3) Drop any existing UNIQUE constraints or plain indexes that reference ("UserId")
    // Use a DO block with format(%I) so case is always handled correctly.
    await sql.query(
      `
      DO $$
      DECLARE
        rec RECORD;
      BEGIN
        -- Drop UNIQUE constraints on the table that reference ("UserId")
        FOR rec IN
          SELECT c.conname
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'public'
            AND t.relname = '${T.bare}'
            AND c.contype = 'u'
            AND pg_get_constraintdef(c.oid) ILIKE '%("UserId")%'
        LOOP
          EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I;', 'public', '${T.bare}', rec.conname);
        END LOOP;

        -- Drop plain indexes on the table that reference ("UserId")
        FOR rec IN
          SELECT i.indexname
          FROM pg_indexes i
          WHERE i.schemaname = 'public'
            AND i.tablename = '${T.bare}'
            AND i.indexdef ILIKE '%("UserId")%'
        LOOP
          EXECUTE format('DROP INDEX IF EXISTS %I;', rec.indexname);
        END LOOP;

        -- Drop our target index if it already exists
        IF EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = '${IDX_NAME}'
        ) THEN
          EXECUTE format('DROP INDEX %I;', '${IDX_NAME}');
        END IF;
      END $$;
      `
    );

    // 4) Create the partial unique index (only for non-null UserId)
    await sql.query(
      `
      DO $$
      BEGIN
        -- Create the index if it doesn't already exist
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = '${IDX_NAME}'
        ) THEN
          EXECUTE format(
            'CREATE UNIQUE INDEX %I ON %I.%I ("UserId") WHERE "UserId" IS NOT NULL;',
            '${IDX_NAME}', 'public', '${T.bare}'
          );
        END IF;
      END $$;
      `
    );
  },

  async down(queryInterface /* , Sequelize */) {
    const sql = queryInterface.sequelize;

    // Just drop the index (idempotent)
    await sql.query(`DROP INDEX IF EXISTS vendors_userid_unique;`);
  },
};