"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("Users");

    if (!table.isDeleted) {
      await queryInterface.addColumn("Users", "isDeleted", {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }
  },

  async down(queryInterface) {
    // optional: remove if rolling back
    await queryInterface.removeColumn("Users", "isDeleted");
  },
};
