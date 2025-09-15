
"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // Ensure vendors table has timestamps
    const vendors = await queryInterface.describeTable("vendors").catch(() => ({}));

    if (!vendors.created_at) {
      await queryInterface.addColumn("vendors", "created_at", {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      });
    }
    if (!vendors.updated_at) {
      await queryInterface.addColumn("vendors", "updated_at", {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      });
    }

    // Check idempotency_keys table only if it exists
    const tables = await queryInterface.showAllTables();
    if (tables.includes("idempotency_keys")) {
      const keys = await queryInterface.describeTable("idempotency_keys");
      if (!keys.created_at) {
        await queryInterface.addColumn("idempotency_keys", "created_at", {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn("NOW"),
        });
      }
      if (!keys.updated_at) {
        await queryInterface.addColumn("idempotency_keys", "updated_at", {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn("NOW"),
        });
      }
    }
  },

  async down(queryInterface, Sequelize) {
    const vendors = await queryInterface.describeTable("vendors").catch(() => ({}));
    if (vendors.created_at) {
      await queryInterface.removeColumn("vendors", "created_at");
    }
    if (vendors.updated_at) {
      await queryInterface.removeColumn("vendors", "updated_at");
    }

    const tables = await queryInterface.showAllTables();
    if (tables.includes("idempotency_keys")) {
      const keys = await queryInterface.describeTable("idempotency_keys");
      if (keys.created_at) {
        await queryInterface.removeColumn("idempotency_keys", "created_at");
      }
      if (keys.updated_at) {
        await queryInterface.removeColumn("idempotency_keys", "updated_at");
      }
    }
  },
};