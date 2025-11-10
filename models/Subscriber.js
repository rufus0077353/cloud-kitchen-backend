// models/Subscriber.js
export default (sequelize, DataTypes) => {
  const Subscriber = sequelize.define("Subscriber", {
    userId: { type: DataTypes.INTEGER, allowNull: true },
    email:  { type: DataTypes.STRING, allowNull: false, unique: true },
    consentAt: { type: DataTypes.DATE, allowNull: false },
    unsubAt: { type: DataTypes.DATE, allowNull: true },
    token: { type: DataTypes.STRING, allowNull: false, unique: true }, // for one-click
  }, { tableName: "subscribers", underscored: true });
  return Subscriber;
};