
// migrations/XXXXXX-add-rating-review-to-orders.js
"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("Orders", "rating", {
      type: Sequelize.FLOAT,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn("Orders", "review", {
      type: Sequelize.TEXT,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn("Orders", "ratedAt", {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn("Orders", "isRated", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Orders", "isRated");
    await queryInterface.removeColumn("Orders", "ratedAt");
    await queryInterface.removeColumn("Orders", "review");
    await queryInterface.removeColumn("Orders", "rating");
  },
};
