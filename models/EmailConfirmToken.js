
// models/EmailConfirmToken.js
module.exports = (sequelize, DataTypes) => {
  const EmailConfirmToken = sequelize.define("EmailConfirmToken", {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    token: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    usedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: "EmailConfirmTokens",
    indexes: [
      { fields: ["token"], unique: true },
      { fields: ["userId"] },
    ],
  });

  EmailConfirmToken.associate = (models) => {
    EmailConfirmToken.belongsTo(models.User, { foreignKey: "userId" });
  };

  return EmailConfirmToken;
};
