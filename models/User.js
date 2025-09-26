const bcrypt = require("bcrypt");

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define(
    "User",
    {
      name:      { type: DataTypes.STRING, allowNull: false },
      email:     { type: DataTypes.STRING, allowNull: false, unique: true },
      password:  { type: DataTypes.STRING, allowNull: false },
      role:      { type: DataTypes.ENUM("user", "vendor", "admin"), defaultValue: "user" },
      isDeleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName: "Users",  // ⚠️ lowercase plural is standard
      timestamps: true,
    }
  );

  // Hash password on create AND update
  User.beforeSave(async (user) => {
    if (user.changed("password")) {
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(user.password, salt);
    }
  });

  User.prototype.validPassword = async function (inputPassword) {
    return bcrypt.compare(inputPassword, this.password);
  };

  User.associate = (models) => {
    User.hasOne(models.Vendor, { foreignKey: "UserId" });
    User.hasMany(models.Order, { foreignKey: "UserId" });
  };

  return User;
};