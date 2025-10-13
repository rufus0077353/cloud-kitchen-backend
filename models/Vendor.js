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
      commissionRate: {
        type: DataTypes.DOUBLE,
        allowNull: true,
        defaultValue: 0.15,
      },
      location: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      cuisine: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      phone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      UserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "Users",
          key: "id",
        },
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
      tableName: "Vendors", // important: capital V
      timestamps: true,
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