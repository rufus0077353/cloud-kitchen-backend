
"use strict";

/**
 * Demo seeder: enriches existing Vendors with UX data
 * (image, rating, ETA, delivery fee, etc.)
 * Safe to run multiple times — will only update Vendors that lack these fields.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const [vendors] = await queryInterface.sequelize.query(
      `SELECT id, name FROM "Vendors" ORDER BY id;`
    );

    if (!vendors || vendors.length === 0) {
      console.log("⚠️  No vendors found to seed.");
      return;
    }

    console.log(`🌱 Enriching ${vendors.length} vendor(s)...`);

    const sampleImages = [
      "https://images.unsplash.com/photo-1600891964599-f61ba0e24092?w=800&q=80",
      "https://images.unsplash.com/photo-1601050690597-4b4ecba4c3e3?w=800&q=80",
      "https://images.unsplash.com/photo-1603052875280-236f3ec17f64?w=800&q=80",
      "https://images.unsplash.com/photo-1555992336-03a23c7b20d6?w=800&q=80",
      "https://images.unsplash.com/photo-1551782450-17144efb9c50?w=800&q=80",
    ];

    const cuisines = [
      "Indian, Chinese",
      "Italian, Continental",
      "Desserts, Bakery",
      "Beverages, Snacks",
      "South Indian, Fast Food",
    ];

    const updates = vendors.map((v, idx) => {
      const rating = (Math.random() * 2 + 3).toFixed(1); // 3.0–5.0
      const count = Math.floor(Math.random() * 200 + 50); // 50–250
      const eta = 20 + Math.floor(Math.random() * 20); // 20–40
      const fee = [0, 19, 29, 39][Math.floor(Math.random() * 4)];
      const cuisine = cuisines[idx % cuisines.length];
      const img = sampleImages[idx % sampleImages.length];

      return queryInterface.sequelize.query(
        `
        UPDATE "Vendors"
        SET
          "ratingAvg" = :rating,
          "ratingCount" = :count,
          "etaMins" = :eta,
          "deliveryFee" = :fee,
          "imageUrl" = :img,
          "cuisine" = :cuisine,
          "description" = :desc,
          "isOpen" = true,
          "updatedAt" = NOW()
        WHERE "id" = :id;
        `,
        {
          replacements: {
            id: v.id,
            rating,
            count,
            eta,
            fee,
            img,
            cuisine,
            desc: `${v.name} — popular choice for ${cuisine.split(",")[0]}`,
          },
        }
      );
    });

    await Promise.all(updates);
    console.log("✅ Vendor enrichment complete!");
  },

  async down(queryInterface, Sequelize) {
    console.log("🔁 Reverting demo enrichment...");
    await queryInterface.sequelize.query(`
      UPDATE "Vendors"
      SET
        "ratingAvg" = 0,
        "ratingCount" = 0,
        "etaMins" = 30,
        "deliveryFee" = 0,
        "imageUrl" = NULL,
        "description" = NULL,
        "cuisine" = NULL;
    `);
    console.log("✅ Reverted vendor enrichment.");
  },
};