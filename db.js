// db.js
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: "localhost",
  port: 3306,
  user: "root",
  password: "qjarb73*",
  database: "stock_trading_system",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;
