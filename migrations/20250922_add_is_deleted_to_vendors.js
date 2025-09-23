
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // add isDeleted if missing
    const table = await queryInterface.describeTable("vendors").catch(() => ({}));
    if (!table.isDeleted && !table.isdeleted) {
      await queryInterface.addColumn("vendors", "isDeleted", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }

    // ensure timestamps (safely)
    if (!table.createdAt && !table.createdat) {
      await queryInterface.addColumn("vendors", "createdAt", {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      });
    }
    if (!table.updatedAt && !table.updatedat) {
      await queryInterface.addColumn("vendors", "updatedAt", {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      });
    }

    // ensure user fk not-null (only if column exists)
    if (table.UserId && table.UserId.allowNull) {
      await queryInterface.changeColumn("vendors", "UserId", {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      });
    }
  },

  async down(queryInterface) {
    // keep it simple; don’t drop columns in down to avoid data loss
    return Promise.resolve();
  },
};