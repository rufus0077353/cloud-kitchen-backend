module.exports = (sequelize, DataTypes) => {
  const OrderItem = sequelize.define(
    "OrderItem",
    {
      quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    },
    { tableName: "OrderItems", timestamps: true } // your migration created timestamps
  );

  OrderItem.associate = (models) => {
    OrderItem.belongsTo(models.Order,    { foreignKey: "OrderId", onDelete: "CASCADE" });
    OrderItem.belongsTo(models.MenuItem, { foreignKey: "MenuItemId", onDelete: "CASCADE" });
  };

  return OrderItem;
};