module.exports = (sequelize, DataTypes) => {
  const MenuItem = sequelize.define(
    "MenuItem",
    {
      name:        { type: DataTypes.STRING, allowNull: false },
      price:       { type: DataTypes.FLOAT,  allowNull: false },
      description: { type: DataTypes.STRING, allowNull: true },
      isAvailable: { type: DataTypes.BOOLEAN, defaultValue: true },
      imageUrl:    { type: DataTypes.STRING(1024), allowNull: true }, // accept /uploads and http(s)
    },
    { tableName: "MenuItems", timestamps: true }
  );

  MenuItem.associate = (models) => {
    MenuItem.belongsTo(models.Vendor, { foreignKey: "VendorId", onDelete: "CASCADE" });
    MenuItem.hasMany(models.OrderItem, { foreignKey: "MenuItemId" });
  };

  return MenuItem;
};