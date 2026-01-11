// routes/auth.js
const express = require("express");
const router = express.Router();
const {
  showLoginPage,
  showSignupPage,
  handleLogin,
  handleSignup,
  handleDeleteAccount,
  handleLogout
} = require("../controllers/authController");

// 로그인/회원가입 화면
router.get("/login", showLoginPage);
router.get("/signup", showSignupPage);

// 로그인/회원가입 요청
router.post("/login", handleLogin);
router.post("/signup", handleSignup);

// 회원 탈퇴
router.post("/delete-account", handleDeleteAccount);

// 로그아웃 처리 라우터 추가
router.get("/logout", handleLogout);

module.exports = router;
