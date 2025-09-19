// models/Order.js
module.exports = (sequelize, DataTypes) => {
const Order = sequelize.define(
  "Order",
  {
    totalAmount: { type: DataTypes.FLOAT, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "pending" },
    UserId: { type: DataTypes.INTEGER, allowNull: false },
    VendorId: { type: DataTypes.INTEGER, allowNull: false },

    // Payment
    paymentMethod: {
      type: DataTypes.STRING, // 'cod' | 'mock_online' | 'razorpay' | 'stripe' etc.
      allowNull: false,
      defaultValue: "cod",
    },
    paymentStatus: {
      type: DataTypes.STRING, // 'unpaid' | 'processing' | 'paid' | 'failed' | 'refunded'
      allowNull: false,
      defaultValue: "unpaid",
    },
    paidAt: { type: DataTypes.DATE, allowNull: true },
    note: { type: DataTypes.TEXT, allowNull: true },
    address: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    tableName: "orders",
    timestamps: true,
  }
);

// Associations (needed for includes in routes/UI)
Order.associate = (models) => {
  Order.belongsTo(models.User, { foreignKey: "UserId" });
  Order.belongsTo(models.Vendor, { foreignKey: "VendorId" });

  // Many-to-many with MenuItem through OrderItem
  Order.belongsToMany(models.MenuItem, {
    through: models.OrderItem,
    foreignKey: "OrderId",
    otherKey: "MenuItemId",
  });

  // Explicit convenience
  Order.hasMany(models.OrderItem, { foreignKey: "OrderId" });
};

return Order;
};