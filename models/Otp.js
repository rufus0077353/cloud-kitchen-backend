// models/Otp.js
export default (sequelize, DataTypes) => {
  const Otp = sequelize.define("Otp", {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false },
    codeHash: { type: DataTypes.STRING, allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    attempts: { type: DataTypes.INTEGER, defaultValue: 0 },
    usedAt: { type: DataTypes.DATE, allowNull: true },
  }, { tableName: "otps", underscored: true });
  return Otp;
};
