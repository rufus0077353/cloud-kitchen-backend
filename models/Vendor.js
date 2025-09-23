
// models/Vendor.js
module.exports = (sequelize, DataTypes) => {
  const Vendor = sequelize.define(
    "Vendor",
    {
      name:      { type: DataTypes.STRING, allowNull: false },
      location:  { type: DataTypes.STRING, allowNull: false },
      cuisine:   { type: DataTypes.STRING, allowNull: false },
      phone:     { type: DataTypes.STRING, allowNull: true },
      logoUrl:   { type: DataTypes.STRING, allowNull: true },
      isOpen:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

      // 🔑 used by your routes; MUST exist in the DB
      isDeleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName: "vendors",
      timestamps: true, // createdAt/updatedAt are required by your code too
    }
  );

  Vendor.associate = (models) => {
    Vendor.belongsTo(models.User, { foreignKey: "UserId", onDelete: "CASCADE" });
    Vendor.hasMany(models.MenuItem, { foreignKey: "VendorId" });
    Vendor.hasMany(models.Order,    { foreignKey: "VendorId" });
  };

  return Vendor;
};