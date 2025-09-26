"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("IdempotencyKeys", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      key: { type: Sequelize.STRING, allowNull: false, unique: true },
      requestMethod: { type: Sequelize.STRING },
      requestParams: { type: Sequelize.JSON },
      responseData: { type: Sequelize.JSON },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("IdempotencyKeys");
  },
};