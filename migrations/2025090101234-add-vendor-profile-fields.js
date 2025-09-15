
// migrations/XXXX-add-timestamps-to-vendors.js
"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("vendors", "created_at", {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.fn("NOW"),   // ✅ ensures old rows get a value
    });

    await queryInterface.addColumn("vendors", "updated_at", {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.fn("NOW"),
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("vendors", "created_at");
    await queryInterface.removeColumn("vendors", "updated_at");
  },
};