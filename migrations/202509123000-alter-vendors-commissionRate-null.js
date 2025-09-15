// migrations/XXXX-alter-vendors-commissionRate-null.js
"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn("vendors", "commissionRate", {
      type: Sequelize.FLOAT,
      allowNull: true,      // <— allow null so it won’t auto-reset
      defaultValue: 0.15,   // default only applies on INSERT without a value
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn("vendors", "commissionRate", {
      type: Sequelize.FLOAT,
      allowNull: false,
      defaultValue: 0.15,
    });
  },
};