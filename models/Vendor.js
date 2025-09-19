// models/Vendor.js
module.exports = (sequelize, DataTypes) => {
  const Vendor = sequelize.define(
    "Vendor",
    {
      name:      { type: DataTypes.STRING, allowNull: false },
      location:  { type: DataTypes.STRING, allowNull: false },
      cuisine:   { type: DataTypes.STRING, allowNull: false },
      isOpen:    { type: DataTypes.BOOLEAN, defaultValue: true },
      phone:     { type: DataTypes.STRING, allowNull: true },
      logoUrl:   { type: DataTypes.STRING, allowNull: true },

      // TEMPORARY HOTFIX: allow null so server can boot and we can clean orphans
      UserId: {
        type: DataTypes.INTEGER,
        allowNull: true, // ← change back to false in Step 3 after cleanup
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },

      // soft-delete flag (used by routes I gave you)
      isDeleted: { type: DataTypes.BOOLEAN, defaultValue: false },
    },
    {
      tableName: "vendors",
      timestamps: true,
    }
  );

  Vendor.associate = (models) => {
    Vendor.belongsTo(models.User, { foreignKey: "UserId" });
    Vendor.hasMany(models.MenuItem, { foreignKey: "VendorId" });
    Vendor.hasMany(models.Order, { foreignKey: "VendorId" });
  };

  return Vendor;
};