// models/PushSubscription.js
module.exports = (sequelize, DataTypes) => {
  const PushSubscription = sequelize.define("PushSubscription", {
    userType: { // "user" | "vendor"
      type: DataTypes.STRING,
      allowNull: false,
    },
    userId: {   // id from Users table OR Vendors table (we’ll use Users id & Vendors id)
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    endpoint: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    keys: { // JSON with p256dh & auth
      type: DataTypes.JSON,
      allowNull: false,
    },
  }, {
    tableName: "push_subscriptions"
  });
  return PushSubscription;
};