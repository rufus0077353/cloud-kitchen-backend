"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("Vendors", "lat", {
      type: Sequelize.DECIMAL(10, 7),
      allowNull: true,
    });
    await queryInterface.addColumn("Vendors", "lng", {
      type: Sequelize.DECIMAL(10, 7),
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn("Vendors", "lat");
    await queryInterface.removeColumn("Vendors", "lng");
  },
};
