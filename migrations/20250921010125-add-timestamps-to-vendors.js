
"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add createdAt + updatedAt if missing
    await queryInterface.addColumn("vendors", "createdAt", {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.fn("NOW"),
    });

    await queryInterface.addColumn("vendors", "updatedAt", {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.fn("NOW"),
    });
  },

  async down(queryInterface, Sequelize) {
    // Rollback: remove columns
    await queryInterface.removeColumn("vendors", "createdAt");
    await queryInterface.removeColumn("vendors", "updatedAt");
  },
};
'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    /**
     * Add altering commands here.
     *
     * Example:
     * await queryInterface.createTable('users', { id: Sequelize.INTEGER });
     */
  },

  async down (queryInterface, Sequelize) {
    /**
     * Add reverting commands here.
     *
     * Example:
     * await queryInterface.dropTable('users');
     */
  }
};
