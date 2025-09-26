"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Payouts", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      VendorId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Vendors", key: "id" },
        onDelete: "CASCADE",
      },
      amount: { type: Sequelize.FLOAT, allowNull: false },
      status: { type: Sequelize.ENUM("pending", "paid", "rejected"), defaultValue: "pending" },
      paymentStatus: { type: Sequelize.STRING, defaultValue: "unpaid" },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("Payouts");
  },
};