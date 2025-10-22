"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await Promise.all([
      queryInterface.addColumn("Orders", "cancelledAt", {
        type: Sequelize.DATE,
        allowNull: true,
      }),
      queryInterface.addColumn("Orders", "refundStatus", {
        type: Sequelize.ENUM("none", "pending", "success", "failed"),
        allowNull: false,
        defaultValue: "none",
      }),
    ]);
  },

  async down(queryInterface, Sequelize) {
    await Promise.all([
      queryInterface.removeColumn("Orders", "cancelledAt"),
      queryInterface.removeColumn("Orders", "refundStatus"),
    ]);
  },
};
