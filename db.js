const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  {
    host: process.env.DB_HOST, //Render host
    port: process.env.DB_PORT || 3306,
    dialect: process.env.DB_DIALECT || "postgres",
    logging: false
  },

  process.env.DB_NAME,  // Render DB name
  process.env.DB_PASSWORD,  // Render DB password
  process.env.DB_USER, //Render DB USER


);


module.exports = sequelize;
