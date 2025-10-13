// migrations/20251009xxxxxx-vendors-unique-userid-partial.js
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Optional: clean obvious duplicates by nulling extra rows
    await queryInterface.sequelize.query(`
      WITH d AS (
        SELECT id, "UserId",
               ROW_NUMBER() OVER (PARTITION BY "UserId" ORDER BY id) AS rn
        FROM "Vendors"
        WHERE "UserId" IS NOT NULL
      )
      UPDATE "Vendors" v
      SET "UserId" = NULL
      FROM d
      WHERE v.id = d.id AND d.rn > 1;
    `);

    // Create a partial unique index (Postgres) so only non-null, non-deleted rows
    // must be unique. Adjust "deletedAt" check if you don't use paranoid deletes.
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'vendors_userid_unique'
        ) THEN
          CREATE UNIQUE INDEX vendors_userid_unique
          ON "Vendors" ("UserId")
          WHERE "UserId" IS NOT NULL AND ("deletedAt" IS NULL OR "deletedAt" IS NOT DISTINCT FROM NULL);
        END IF;
      END $$;
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS vendors_userid_unique;
    `);
  }
};