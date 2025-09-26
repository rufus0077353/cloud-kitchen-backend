// models/MenuItem.js
module.exports = (sequelize, DataTypes) => {
  const MenuItem = sequelize.define(
    "MenuItem",
    {
      name:        { type: DataTypes.STRING, allowNull: false },
      price:       { type: DataTypes.FLOAT,  allowNull: false },
      description: { type: DataTypes.STRING, allowNull: true },
      isAvailable: { type: DataTypes.BOOLEAN, defaultValue: true },
      VendorId:    { type: DataTypes.INTEGER, allowNull: false },

      // 👇 canonical key expected by your routes & frontend
      imageUrl:    { type: DataTypes.STRING(1024), allowNull: true, validate: { isUrl: true } },
    },
    {
      tableName: "menu_items",
      timestamps: true,
    }
  );

  return MenuItem;
};