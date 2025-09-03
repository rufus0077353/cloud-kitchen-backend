module.exports = (sequelize, DataTypes) => {
  const AuditLog = sequelize.define("AuditLog", {
    userId: { type: DataTypes.INTEGER, allowNull: true },
    vendorId: { type: DataTypes.INTEGER, allowNull: true },
    action: { type: DataTypes.STRING, allowNull: false }, // e.g., "ORDER_STATUS_UPDATE"
    details: { type: DataTypes.JSONB, allowNull: true }, // flexible payload
  });
  return AuditLog;
};