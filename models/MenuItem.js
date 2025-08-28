
// models/menuitem.js
module.exports = (sequelize, DataTypes) => {
  const MenuItem = sequelize.define("MenuItem", {
    name: { type: DataTypes.STRING, allowNull: false },
    price: { type: DataTypes.FLOAT, allowNull: false },
    description: { type: DataTypes.STRING },
    isAvailable: { type: DataTypes.BOOLEAN, defaultValue: true },
    VendorId: { type: DataTypes.INTEGER, allowNull: false }
  }, {
    tableName: 'menu_items',
    timestamps: true
  });

  MenuItem.associate = (models) => {
    MenuItem.belongsTo(models.Vendor, { foreignKey: 'VendorId' });
  };

  return MenuItem;
};
