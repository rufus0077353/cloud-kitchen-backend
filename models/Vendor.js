
module.exports = (sequelize, DataTypes) => {
  const Vendor = sequelize.define(
    "Vendor",
    {
      name:      { type: DataTypes.STRING, allowNull: false },
      location:  { type: DataTypes.STRING, allowNull: true },
      cuisine:   { type: DataTypes.STRING, allowNull: true },
      phone:     { type: DataTypes.STRING, allowNull: true },
      logoUrl:   { type: DataTypes.STRING(1024), allowNull: true }, // allow /uploads and http(s)
      isOpen:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      isDeleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      commissionRate: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0.15 },
    },
    { tableName: "Vendors", timestamps: true }
  );

  Vendor.associate = (models) => {
    Vendor.belongsTo(models.User,  { foreignKey: "UserId", onDelete: "CASCADE" });
    Vendor.hasMany(models.MenuItem, { foreignKey: "VendorId" });
    Vendor.hasMany(models.Order,    { foreignKey: "VendorId" });
    Vendor.hasMany(models.Payout,   { foreignKey: "VendorId" });
  };

  return Vendor;
};