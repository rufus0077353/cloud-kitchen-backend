
"use strict";
module.exports = (sequelize, DataTypes) => {
  const Vendor = sequelize.define(
    "Vendor",
    {
      name:        { type: DataTypes.STRING, allowNull: false },
      cuisine:     { type: DataTypes.STRING, allowNull: true },
      location:    { type: DataTypes.STRING, allowNull: true },
      phone:       { type: DataTypes.STRING, allowNull: true },
      logoUrl:     { type: DataTypes.STRING, allowNull: true },
      isOpen:      { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

      // keep your existing fields:
      UserId:      { type: DataTypes.INTEGER, allowNull: false },
      commissionRate: { type: DataTypes.FLOAT, allowNull: true, defaultValue: 0.15 },
    },
    {
      tableName: "vendors",
      underscored: true,
    }
  );

  Vendor.associate = (models) => {
    Vendor.belongsTo(models.User, { foreignKey: "UserId" });
    Vendor.hasMany(models.MenuItem, { foreignKey: "VendorId" });
    Vendor.hasMany(models.Order,    { foreignKey: "VendorId" });
  };

  return Vendor;
};