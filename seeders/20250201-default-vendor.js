"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // Try to find an admin user first (id = 1 by default seeder)
    const [admins] = await queryInterface.sequelize.query(
      `SELECT id FROM "Users" WHERE role = 'admin' ORDER BY id ASC LIMIT 1;`
    );

    if (!admins.length) {
      console.log("⚠️ No admin found, skipping Vendor seeder");
      return;
    }

    const adminId = admins[0].id;

    // Insert a default vendor linked to that admin
    await queryInterface.bulkInsert("Vendors", [
      {
        name: "Default Vendor",
        location: "Chennai",
        cuisine: "Indian",
        phone: "9876543210",
        logoUrl: null,
        isOpen: true,
        isDeleted: false,
        UserId: adminId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete("vendors", { name: "Default Vendor" });
  },
};