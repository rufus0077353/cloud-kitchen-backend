
"use strict";
const bcrypt = require("bcrypt");

module.exports = {
  async up(queryInterface, Sequelize) {
    const passwordHash = await bcrypt.hash("Admin@123", 10);

    // insert only if not exists
    const [results] = await queryInterface.sequelize.query(
      `SELECT * FROM "Users" WHERE email = 'admin@example.com' LIMIT 1;`
    );

    if (results.length === 0) {
      await queryInterface.bulkInsert("Users", [
        {
          name: "Super Admin",
          email: "admin@example.com",
          password: passwordHash,
          role: "admin",
          isDeleted: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      console.log("✅ Default admin user created");
    } else {
      console.log("ℹ️ Admin already exists, skipping seeder");
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete("Users", { email: "admin@example.com" });
  },
};