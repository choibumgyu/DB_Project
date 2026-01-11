// routes/trade.js
const express = require("express");
const router = express.Router();
const {
  handleMarketTrade,
  handleLimitBuy,
  handleLimitSell
} = require("../controllers/tradeController");

// 시장가 주문
router.post("/trade/market", handleMarketTrade);

// 지정가 매수
router.post("/trade/limit-buy", handleLimitBuy);

// 지정가 매도
router.post("/trade/limit-sell", handleLimitSell);

module.exports = router;
