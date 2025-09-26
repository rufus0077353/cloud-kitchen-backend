
"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = "vendors";
    const qi = queryInterface;
    const desc = await qi.describeTable(table).catch(() => ({}));

    // Step 1: If UserId missing, add it (nullable at first)
    if (!desc.UserId) {
      await qi.addColumn(table, "UserId", {
        type: Sequelize.INTEGER,
        allowNull: true,   // ✅ allow nulls first
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      });
    }

    // Step 2: Backfill any null UserId with a fallback user
    // You must decide how — here we just set to the first admin user, or 1.
    await qi.sequelize.query(`
      UPDATE "${table}"
      SET "UserId" = (
        SELECT id FROM users ORDER BY id ASC LIMIT 1
      )
      WHERE "UserId" IS NULL
    `);

    // Step 3: Now enforce NOT NULL
    await qi.changeColumn(table, "UserId", {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: "users", key: "id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
  },

  async down(queryInterface, Sequelize) {
    // relax back to nullable
    await queryInterface.changeColumn("vendors", "UserId", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "users", key: "id" },
    });
  },
};