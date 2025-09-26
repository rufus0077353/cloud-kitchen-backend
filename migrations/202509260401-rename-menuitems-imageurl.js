"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = "menu_items";
    const desc = await queryInterface.describeTable(table).catch(() => ({}));

    // If the old column exists and new doesn't, rename old -> new
    if (desc.imageURL && !desc.imageUrl) {
      await queryInterface.renameColumn(table, "imageURL", "imageUrl");
    }

    // If neither exists (rare), add imageUrl
    const after = await queryInterface.describeTable(table).catch(() => ({}));
    if (!after.imageUrl && !after.imageURL) {
      await queryInterface.addColumn(table, "imageUrl", {
        type: Sequelize.STRING(1024),
        allowNull: true,
      });
    }

    // Make sure it's the right type/nullable (idempotent)
    const finalDesc = await queryInterface.describeTable(table);
    if (finalDesc.imageUrl) {
      await queryInterface.changeColumn(table, "imageUrl", {
        type: Sequelize.STRING(1024),
        allowNull: true,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const table = "menu_items";
    const desc = await queryInterface.describeTable(table).catch(() => ({}));

    // Rollback: rename back if needed
    if (desc.imageUrl && !desc.imageURL) {
      await queryInterface.renameColumn(table, "imageUrl", "imageURL");
    }

    // Ensure type on the rolled-back column (optional safety)
    const after = await queryInterface.describeTable(table).catch(() => ({}));
    if (after.imageURL) {
      await queryInterface.changeColumn(table, "imageURL", {
        type: Sequelize.STRING(1024),
        allowNull: true,
      });
    }
  },
};