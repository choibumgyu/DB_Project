// routes/user.js
const express = require("express");
const router = express.Router();
const { showMyPage } = require("../controllers/userController");

router.get("/mypage", showMyPage);

module.exports = router;
