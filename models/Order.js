// models/Order.js
module.exports = (sequelize, DataTypes) => {
  const Order = sequelize.define("Order", {
    totalAmount:  { type: DataTypes.FLOAT,  allowNull: false },
    status:       { type: DataTypes.STRING, allowNull: false, defaultValue: "pending" }, // business status
    UserId:       { type: DataTypes.INTEGER, allowNull: false },
    VendorId:     { type: DataTypes.INTEGER, allowNull: false },

    // --- Payment fields (mock + future real gateways) ---
    paymentMethod: {
      type: DataTypes.STRING,                 // e.g. 'cod', 'mock_online', 'razorpay', 'stripe'
      allowNull: false,
      defaultValue: "cod",
    },
    paymentStatus: {
      type: DataTypes.STRING,                 // 'unpaid' | 'processing' | 'paid' | 'failed' | 'refunded'
      allowNull: false,
      defaultValue: "unpaid",
    },
    // you could add paymentRef / txnId later for real gateways
  }, {
    tableName: "orders",
    timestamps: true,
  });

  return Order;
};