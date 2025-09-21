// models/Vendor.js
module.exports = (sequelize, DataTypes) => {
  const Vendor = sequelize.define(
    "Vendor",
    {
      name: DataTypes.STRING,
      location: DataTypes.STRING,
      cuisine: DataTypes.STRING,
      phone: DataTypes.STRING,
      logoUrl: DataTypes.STRING,
      isOpen: { type: DataTypes.BOOLEAN, defaultValue: true },
      UserId: { type: DataTypes.INTEGER, allowNull: true }, // keep flexible if old rows exist
    },
    {
      tableName: "vendors",
      timestamps: true, // <-- important
    }
  );

  Vendor.associate = (models) => {
    Vendor.belongsTo(models.User, { foreignKey: "UserId", onDelete: "CASCADE" });
    Vendor.hasMany(models.MenuItem, { foreignKey: "VendorId" });
    Vendor.hasMany(models.Order, { foreignKey: "VendorId" });
  };

  return Vendor;
};