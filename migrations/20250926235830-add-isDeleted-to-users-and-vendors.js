"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Ensure users table has isDeleted
    const Users = await queryInterface.describeTable("Users");
    if (!Users.isDeleted) {
      await queryInterface.addColumn("Users", "isDeleted", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }

    // Ensure vendors table has isDeleted
    const Vendors = await queryInterface.describeTable("Vendors");
    if (!Vendors.isDeleted) {
      await queryInterface.addColumn("Vendors", "isDeleted", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Users", "isDeleted");
    await queryInterface.removeColumn("Vendors", "isDeleted");
  },
};