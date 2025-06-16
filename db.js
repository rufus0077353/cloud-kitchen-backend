const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME,  // Render DB name
  process.env.DB_USER,  // Render DB User
  process.env.DB_PASSWORD, //Render password
  {
    host: process.env.DB_HOST, //Render host
    dialect: 'mysql',
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    },
    
    logging: false
  }
);


module.exports = sequelize;
