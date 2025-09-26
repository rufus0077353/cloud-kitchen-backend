"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Vendors", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      UserId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
        onDelete: "CASCADE",
      },
      name: { type: Sequelize.STRING, allowNull: false },
      location: { type: Sequelize.STRING, allowNull: false },
      cuisine: { type: Sequelize.STRING, allowNull: false },
      phone: { type: Sequelize.STRING },
      logoUrl: { type: Sequelize.STRING },
      isOpen: { type: Sequelize.BOOLEAN, defaultValue: true },
      isDeleted: { type: Sequelize.BOOLEAN, defaultValue: false },
      commissionRate: { type: Sequelize.FLOAT, defaultValue: 0.15 },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("Vendors");
  },
};