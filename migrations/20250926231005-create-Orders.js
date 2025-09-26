
"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Orders", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      UserId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
        onDelete: "CASCADE",
      },
      VendorId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Vendors", key: "id" },
        onDelete: "CASCADE",
      },
      totalAmount: { type: Sequelize.FLOAT, allowNull: false },
      status: {
        type: Sequelize.ENUM("pending", "accepted", "rejected", "ready", "delivered"),
        defaultValue: "pending",
      },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("Orders");
  },
};