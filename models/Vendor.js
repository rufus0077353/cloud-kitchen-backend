
"use strict";
module.exports = (sequelize, DataTypes) => {
  const Vendor = sequelize.define(
    "Vendor",
    {
      name:     { type: DataTypes.STRING, allowNull: false },
      cuisine:  { type: DataTypes.STRING, allowNull: true },
      location: { type: DataTypes.STRING, allowNull: true },
      phone:    { type: DataTypes.STRING, allowNull: true },
      logoUrl:  { type: DataTypes.STRING, allowNull: true },
      isOpen:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      isDeleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

      // keep existing fields
      UserId:         { type: DataTypes.INTEGER, allowNull: true, unique: true },
      commissionRate: { type: DataTypes.FLOAT,   allowNull: true,  defaultValue: 0.15 },
    },
    {
      tableName: "vendors",
      underscored: true,   // => created_at / updated_at
      timestamps: true,    // 👈 required for Fix 1
    }
  );

  Vendor.associate = (models) => {
    Vendor.belongsTo(models.User,   { foreignKey: "UserId" });
    Vendor.hasMany(models.MenuItem, { foreignKey: "VendorId" });
    Vendor.hasMany(models.Order,    { foreignKey: "VendorId" });
  };

  return Vendor;
};