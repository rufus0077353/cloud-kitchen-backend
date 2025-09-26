
// models/vendor.js
module.exports = (sequelize, DataTypes) => {
  const Vendor = sequelize.define(
    "Vendor",
    {
      name:      { type: DataTypes.STRING, allowNull: false },
      location:  { type: DataTypes.STRING, allowNull: true },   // allow null so ensure middleware can create defaults
      cuisine:   { type: DataTypes.STRING, allowNull: true },
      phone:     { type: DataTypes.STRING, allowNull: true },

      // ✅ keep this — frontend uses it and your migration adds it
      logoUrl:   { type: DataTypes.STRING(1024), allowNull: true },

      isOpen:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      isDeleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName: "vendors",
      timestamps: true, // uses createdAt / updatedAt
    }
  );

  Vendor.associate = (models) => {
    Vendor.belongsTo(models.User,  { foreignKey: "UserId", onDelete: "CASCADE" });
    Vendor.hasMany(models.MenuItem, { foreignKey: "VendorId" });
    Vendor.hasMany(models.Order,    { foreignKey: "VendorId" });
  };

  return Vendor;
};