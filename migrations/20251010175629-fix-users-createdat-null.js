"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // If createdAt doesn't exist, add it with a default timestamp
    const table = "Users";

    // 1️⃣ Ensure createdAt exists and backfill
    await queryInterface.sequelize.query(`
      ALTER TABLE "${table}"
      ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    `);

    // 2️⃣ Ensure updatedAt exists and backfill
    await queryInterface.sequelize.query(`
      ALTER TABLE "${table}"
      ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    `);

    // 3️⃣ Make sure both columns are non-nullable now that they have defaults
    await queryInterface.sequelize.query(`
      ALTER TABLE "${table}"
      ALTER COLUMN "createdAt" SET NOT NULL;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "${table}"
      ALTER COLUMN "updatedAt" SET NOT NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Users", "createdAt");
    await queryInterface.removeColumn("Users", "updatedAt");
  },
};