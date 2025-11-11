// models/OtpToken.js
module.exports = (sequelize, DataTypes) => {
  const OtpToken = sequelize.define("OtpToken", {
    email: { type: DataTypes.STRING(190), allowNull: false },
    otpHash: { type: DataTypes.STRING(190), allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    channel: { type: DataTypes.STRING(32), allowNull: false, defaultValue: "email" },
  }, {
    tableName: "OtpTokens",
    indexes: [
      { fields: ["email"] },
      { fields: ["expiresAt"] },
    ],
  });

  return OtpToken;
};