// routes/stock.js
const express = require("express");
const router = express.Router();
const {
  getStockList,
  getStockTransactions,
  getOrderBook
} = require("../controllers/stockController");

// 주식 목록 조회
router.get("/stocks", getStockList);

// 개별 주식의 거래 내역
router.get("/stock/:stockId/transactions", getStockTransactions);

// 주문호가창 조회
router.get("/stock/:stockId/orderbook", getOrderBook);

module.exports = router;
