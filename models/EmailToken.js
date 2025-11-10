// models/EmailToken.js
export default (sequelize, DataTypes) => {
  const EmailToken = sequelize.define("EmailToken", {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    token: { type: DataTypes.STRING, allowNull: false, unique: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    usedAt: { type: DataTypes.DATE, allowNull: true },
  }, { tableName: "email_tokens", underscored: true });
  return EmailToken;
};