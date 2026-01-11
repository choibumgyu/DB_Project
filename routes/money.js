// routes/money.js
const express = require("express");
const router = express.Router();
const {
  handleDeposit,
  handleWithdraw
} = require("../controllers/moneyController");

router.post("/deposit", handleDeposit);
router.post("/withdraw", handleWithdraw);

module.exports = router;
