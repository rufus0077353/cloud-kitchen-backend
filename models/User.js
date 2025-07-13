const bcrypt = require("bcrypt");

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define("User", {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    role: {
      type: DataTypes.STRING,
      defaultValue: "user", // very important for role-based access
    }
  }, {
    tableName: 'users',
    timestamps: true,
    freezeTableName: true 
  });

  // Hash password before saving
  User.beforeCreate(async (user) => {
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(user.password, salt);
  });

  // Instance method for password validation
  User.prototype.validPassword = async function (inputPassword) {
    return await bcrypt.compare(inputPassword, this.password);
  };

  return User;
};