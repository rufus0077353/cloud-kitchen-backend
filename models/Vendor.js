// models/vendor.js
"use strict";

module.exports = (sequelize, DataTypes) => {
  const Vendor = sequelize.define(
    "Vendor",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },

      // Core business fields
      commissionRate: {
        type: DataTypes.DOUBLE,
        allowNull: true,
        defaultValue: 0.15,
      },
      isOpen: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      // Display / UX fields
      imageUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      description: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      location: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      cuisine: {
        // comma-separated list or short text
        type: DataTypes.STRING,
        allowNull: true,
      },

      // Swiggy/Zomato style info
      ratingAvg: {
        type: DataTypes.DOUBLE, // 0.0 - 5.0
        allowNull: false,
        defaultValue: 0,
      },
      ratingCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      etaMins: {
        // estimated delivery time in minutes
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 30,
      },
      deliveryFee: {
        type: DataTypes.DOUBLE,
        allowNull: false,
        defaultValue: 0,
      },

      phone: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      UserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onDelete: "CASCADE",
      },

      createdAt: {
        allowNull: false,
        type: DataTypes.DATE,
        defaultValue: sequelize.fn("NOW"),
      },
      updatedAt: {
        allowNull: false,
        type: DataTypes.DATE,
        defaultValue: sequelize.fn("NOW"),
      },
    },
    {
      tableName: "Vendors",
      timestamps: true,
      indexes: [
        { fields: ["isOpen"] },
        { fields: ["name"] },
        { fields: ["cuisine"] },
      ],
    }
  );

  Vendor.associate = (models) => {
    Vendor.belongsTo(models.User, { foreignKey: "UserId" });
    if (models.MenuItem) {
      Vendor.hasMany(models.MenuItem, { foreignKey: "VendorId" });
    }
    if (models.Order) {
      Vendor.hasMany(models.Order, { foreignKey: "VendorId" });
    }
  };

  return Vendor;
};
