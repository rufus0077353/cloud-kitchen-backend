// models/PushSubscription.js
module.exports = (sequelize, DataTypes) => {
  const PushSubscription = sequelize.define("PushSubscription", {
    userType: { type: DataTypes.STRING, allowNull: false }, // "user" | "vendor"
    userId:   { type: DataTypes.INTEGER, allowNull: false },
    endpoint: { type: DataTypes.STRING, allowNull: false, unique: true },
    keys:     { type: DataTypes.JSON,   allowNull: false },  // { p256dh, auth }
  }, {
    tableName: "push_subscriptions",
  });
  return PushSubscription;
};