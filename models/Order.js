// models/Order.js
module.exports = (sequelize, DataTypes) => {
  const Order = sequelize.define("Order", {
    totalAmount: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "pending",
    },
    UserId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    VendorId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    }
  }, {
    tableName: "orders",
    timestamps: true,
  });

  return Order;
};