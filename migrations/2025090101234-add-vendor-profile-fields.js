
"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add new columns if they don't already exist
    const table = "vendors";

    await queryInterface.addColumn(table, "phone",   { type: Sequelize.STRING, allowNull: true })
      .catch(() => {});
    await queryInterface.addColumn(table, "logoUrl", { type: Sequelize.STRING, allowNull: true })
      .catch(() => {});
    await queryInterface.addColumn(table, "location",{ type: Sequelize.STRING, allowNull: true })
      .catch(() => {});
    await queryInterface.addColumn(table, "isOpen",  { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true })
      .catch(() => {});
  },

  async down(queryInterface) {
    const table = "vendors";
    await queryInterface.removeColumn(table, "phone").catch(() => {});
    await queryInterface.removeColumn(table, "logoUrl").catch(() => {});
    await queryInterface.removeColumn(table, "location").catch(() => {});
    await queryInterface.removeColumn(table, "isOpen").catch(() => {});
  },
};