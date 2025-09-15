// migrations/2025090101234-add-vendor-profile-fields.js
"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add UserId but allow NULL so existing rows don't break
    await queryInterface.addColumn("vendors", "UserId", {
      type: Sequelize.INTEGER,
      allowNull: true,              // ✅ important for existing data
      unique: true,
      references: { model: "users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    // Add isOpen (default true) if not already present
    await queryInterface.addColumn("vendors", "isOpen", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });

    // Add commissionRate (nullable, default 0.15)
    await queryInterface.addColumn("vendors", "commissionRate", {
      type: Sequelize.FLOAT,
      allowNull: true,              // let it be null and use fallback in code
      defaultValue: 0.15,
    });
  },

  async down(queryInterface, _Sequelize) {
    await queryInterface.removeColumn("vendors", "commissionRate");
    await queryInterface.removeColumn("vendors", "isOpen");
    await queryInterface.removeColumn("vendors", "UserId");
  },
};