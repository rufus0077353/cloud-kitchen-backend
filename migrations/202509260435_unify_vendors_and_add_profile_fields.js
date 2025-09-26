
"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const TBL = "vendors";

    // Fail fast instead of hanging on locks
    await qi.sequelize.query(`SET lock_timeout = '5s'; SET statement_timeout = '60s';`);

    // Always read the latest columns before each block (but don't wrap in one big transaction)
    const describe = async () => qi.describeTable(TBL).catch(() => ({}));

    // --- Profile / status fields expected by frontend ---
    let cols = await describe();

    if (!cols.logoUrl) {
      await qi.addColumn(TBL, "logoUrl", { type: Sequelize.STRING(1024), allowNull: true });
    }
    cols = await describe();

    if (!cols.phone) {
      await qi.addColumn(TBL, "phone", { type: Sequelize.STRING(64), allowNull: true });
    }
    cols = await describe();

    if (!cols.cuisine) {
      await qi.addColumn(TBL, "cuisine", { type: Sequelize.STRING(255), allowNull: true });
    }
    cols = await describe();

    if (!cols.location) {
      await qi.addColumn(TBL, "location", { type: Sequelize.STRING(255), allowNull: true });
    }
    cols = await describe();

    if (!cols.isOpen) {
      await qi.addColumn(TBL, "isOpen", { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
    }
    cols = await describe();

    if (!cols.isDeleted && !cols.isdeleted) {
      await qi.addColumn(TBL, "isDeleted", { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    }

    // --- Timestamps: add camelCase if missing; DO NOT rename/drop snake_case to avoid heavy locks ---
    cols = await describe();
    if (!cols.createdAt) {
      await qi.addColumn(TBL, "createdAt", {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
      });
    }
    cols = await describe();
    if (!cols.updatedAt) {
      await qi.addColumn(TBL, "updatedAt", {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
      });
    }

    // --- UserId: add nullable first, backfill, then tighten only if safe ---
    cols = await describe();
    if (!cols.UserId) {
      await qi.addColumn(TBL, "UserId", {
        type: Sequelize.INTEGER,
        allowNull: true,                      // start nullable
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE"
      });
    }

    // if we have at least one user, backfill NULLs with the first user id
    const [[userCountRow]] = await qi.sequelize.query(
      `SELECT COUNT(*)::int AS cnt FROM "users";`
    );
    const userCount = userCountRow?.cnt ?? 0;

    if (userCount > 0) {
      await qi.sequelize.query(
        `UPDATE "${TBL}"
         SET "UserId" = sub.id
         FROM (SELECT id FROM "users" ORDER BY id ASC LIMIT 1) AS sub
         WHERE "${TBL}"."UserId" IS NULL;`
      );
    }

    // tighten to NOT NULL only if no NULLs remain
    const [[nullsRow]] = await qi.sequelize.query(
      `SELECT COUNT(*)::int AS cnt FROM "${TBL}" WHERE "UserId" IS NULL;`
    );
    const nullsRemain = nullsRow?.cnt ?? 0;

    if (nullsRemain === 0) {
      await qi.changeColumn(TBL, "UserId", {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE"
      });
    } // else leave it nullable; you can tighten later after creating users.

    // helpful index (idempotent)
    const idx = await qi.showIndex(TBL).catch(() => []);
    if (!idx?.some(i => i.name === "vendors_userid_idx")) {
      await qi.addIndex(TBL, ["UserId"], { name: "vendors_userid_idx" });
    }
  },

  async down(queryInterface, Sequelize) {
    // Non-destructive down: just relax NOT NULL if it was applied
    try {
      const desc = await queryInterface.describeTable("vendors").catch(() => ({}));
      if (desc.UserId && !desc.UserId.allowNull) {
        await queryInterface.changeColumn("vendors", "UserId", {
          type: Sequelize.INTEGER,
          allowNull: true,
          references: { model: "users", key: "id" }
        });
      }
    } catch {}
  }
};