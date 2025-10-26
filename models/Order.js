
module.exports = (sequelize, DataTypes) => {
  const Order = sequelize.define(
    "Order",
    {
      totalAmount:   { type: DataTypes.FLOAT, allowNull: false },
      status:        { type: DataTypes.ENUM("pending","accepted","rejected","ready","delivered"),
                       allowNull: false, defaultValue: "pending" },
      paymentMethod: { type: DataTypes.STRING, allowNull: false, defaultValue: "cod" },
      paymentStatus: { type: DataTypes.STRING, allowNull: false, defaultValue: "unpaid" },
      paidAt:        { type: DataTypes.DATE, allowNull: true },
      note:          { type: DataTypes.TEXT,  allowNull: true },
      address:       { type: DataTypes.TEXT,  allowNull: true },
      cancelledAt:    { type: DataTypes.DATE,  allowNull: true },
      rating:        { type: DataTypes.INTEGER, allowNull: true, validate: { min: 1, max: 5 } },
      review:        { type: DataTypes.TEXT,    allowNull: true },
      ratedAt:       { type: DataTypes.DATE,    allowNull: true },
      refundStatus:   { type: DataTypes.ENUM("none", "pending", "success", "failed"),
                       allowNull: false, defaultValue: "none" },
    },
    { tableName: "Orders", timestamps: true }
  );

  Order.associate = (models) => {
    Order.belongsTo(models.User,   { foreignKey: "UserId" });
    Order.belongsTo(models.Vendor, { foreignKey: "VendorId" });
    Order.hasMany(models.OrderItem, { foreignKey: "OrderId" });
    Order.belongsToMany(models.MenuItem, {
      through: models.OrderItem,
      foreignKey: "OrderId",
      otherKey: "MenuItemId",
    });
  };

  return Order;
};