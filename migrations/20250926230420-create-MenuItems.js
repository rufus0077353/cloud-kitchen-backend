"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("MenuItems", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      VendorId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Vendors", key: "id" },
        onDelete: "CASCADE",
      },
      name: { type: Sequelize.STRING, allowNull: false },
      description: { type: Sequelize.TEXT },
      price: { type: Sequelize.FLOAT, allowNull: false },
      imageUrl: { type: Sequelize.STRING },
      isAvailable: { type: Sequelize.BOOLEAN, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("MenuItems");
  },
};