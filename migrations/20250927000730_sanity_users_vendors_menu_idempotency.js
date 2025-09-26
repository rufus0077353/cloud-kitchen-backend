"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;

    /* ---------------- Users ---------------- */
    try {
      const Users = await qi.describeTable("Users");

      if (!Users.role) {
        await qi.addColumn("Users", "role", {
          type: Sequelize.STRING,
          allowNull: false,
          defaultValue: "User",
        });
      }
      if (!Users.isDeleted) {
        await qi.addColumn("users", "isDeleted", {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        });
      }
      if (!Users.createdAt) {
        await qi.addColumn("Users", "createdAt", {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        });
      }
      if (!Users.updatedAt) {
        await qi.addColumn("Users", "updatedAt", {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        });
      }
      // Make sure email has a unique index (safe with IF NOT EXISTS)
      await qi.sequelize.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON "users" ("email");'
      );
    } catch (e) {
      // table might not exist in some envs — skip
    }

    /* ---------------- Vendors ---------------- */
    try {
      const Vendors = await qi.describeTable("Vendors");

      if (!Vendors.location) {
        await qi.addColumn("Vendors", "location", {
          type: Sequelize.STRING,
          allowNull: true,
        });
      }
      if (!Vendors.cuisine) {
        await qi.addColumn("Vendors", "cuisine", {
          type: Sequelize.STRING,
          allowNull: true,
        });
      }
      if (!Vendors.phone) {
        await qi.addColumn("Vendors", "phone", {
          type: Sequelize.STRING,
          allowNull: true,
        });
      }
      if (!Vendors.logoUrl) {
        await qi.addColumn("Vendors", "logoUrl", {
          type: Sequelize.STRING(1024),
          allowNull: true,
        });
      }
      if (!Vendors.isOpen) {
        await qi.addColumn("Vendors", "isOpen", {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        });
      }
      if (!Vendors.isDeleted) {
        await qi.addColumn("Vendors", "isDeleted", {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        });
      }
      if (!Vendors.UserId) {
        // Start nullable so we never fail migration; app logic can populate it.
        await qi.addColumn("Vendors", "UserId", {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: { model: "Users", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE",
        });
      }
      if (!Vendors.createdAt) {
        await qi.addColumn("Vendors", "createdAt", {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        });
      }
      if (!Vendors.updatedAt) {
        await qi.addColumn("Vendors", "updatedAt", {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        });
      }
    } catch (e) {
      // skip if table missing
    }

    /* ---------------- Menu_Items ---------------- */
    try {
      const mi = await qi.describeTable("Menu_Items");
      // rename legacy imageURL -> imageUrl
      if (mi.imageURL && !mi.imageUrl) {
        await qi.renameColumn("Menu_Items", "imageURL", "imageUrl");
      }
      const mi2 = await qi.describeTable("Menu_Items");
      if (!mi2.imageUrl) {
        await qi.addColumn("Menu_Items", "imageUrl", {
          type: Sequelize.STRING(1024),
          allowNull: true,
        });
      }
    } catch (e) {
      // skip if table missing
    }

    /* ---------------- idempotency_keys ---------------- */
    try {
      const ik = await qi.describeTable("idempotency_keys");
      if (!ik.createdAt) {
        await qi.addColumn("idempotency_keys", "createdAt", {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        });
      }
      if (!ik.updatedAt) {
        await qi.addColumn("idempotency_keys", "updatedAt", {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        });
      }
    } catch (e) {
      // skip if table missing
    }
  },

  // Keep down light (avoid data loss). Only remove what we added if present.
  async down(queryInterface /*, Sequelize */) {
    const qi = queryInterface;

    const safeRemove = async (table, col) => {
      try {
        const d = await qi.describeTable(table);
        if (d[col]) await qi.removeColumn(table, col);
      } catch {}
    };

    await safeRemove("Users", "role");
    await safeRemove("Users", "isDeleted");
    await safeRemove("Users", "createdAt");
    await safeRemove("Users", "updatedAt");

    await safeRemove("Vendors", "location");
    await safeRemove("Vendors", "cuisine");
    await safeRemove("Vendors", "phone");
    await safeRemove("Vendors", "logoUrl");
    await safeRemove("Vendors", "isOpen");
    await safeRemove("Vendors", "isDeleted");
    await safeRemove("Vendors", "UserId");
    await safeRemove("Vendors", "createdAt");
    await safeRemove("Vendors", "updatedAt");

    await safeRemove("Menu_Items", "imageUrl");
    await safeRemove("idempotency_keys", "createdAt");
    await safeRemove("idempotency_keys", "updatedAt");
  },
};