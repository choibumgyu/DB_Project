// controllers/authController.js
const db = require("../models/db");
const authState = require("../authState"); 

//let loggedInUserId = 1; // 추후 세션 또는 JWT 방식으로 대체 가능

// 로그인 페이지 렌더
exports.showLoginPage = (req, res) => {
  res.render("login");
};

// 회원가입 페이지 렌더
exports.showSignupPage = (req, res) => {
  res.render("signup");
};

// 회원가입 처리
exports.handleSignup = async (req, res) => {
  const { name, password } = req.body;
  const conn = await db.getConnection();

  try {
    const [existingUsers] = await conn.query(
      "SELECT * FROM user WHERE name = ? AND password = ?",
      [name, password]
    );

    if (existingUsers.length > 0) {
      return res.send("회원가입 실패: 이미 존재하는 회원입니다.");
    }

    const [[{ max_id }]] = await conn.query(
      "SELECT MAX(user_id) AS max_id FROM user"
    );
    const newUserId = (max_id || 0) + 1;

    await conn.query(
      "INSERT INTO user (user_id, name, password, balance) VALUES (?, ?, ?, 0)",
      [newUserId, name, password]
    );

    res.send("회원가입 성공");
  } catch (err) {
    console.error(err);
    res.status(500).send("서버 오류 발생");
  } finally {
    conn.release();
  }
};

exports.handleLogin = async (req, res) => {
  const { name, password } = req.body;
  const conn = await db.getConnection();

  try {
    const [users] = await conn.query(
      "SELECT * FROM User WHERE name = ? AND password = ?",
      [name, password]
    );

    if (users.length > 0) {
      authState.setLoggedInUserId(users[0].user_id); // 변경
      res.redirect("/");
    } else {
      res.send("로그인 실패: 이름 또는 비밀번호가 잘못되었습니다.");
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("서버 오류 발생");
  } finally {
    conn.release();
  }
};

exports.handleLogout = (req, res) => {
  authState.clearLoggedInUserId(); // 변경
  res.redirect("/");
};

exports.handleDeleteAccount = async (req, res) => {
  const conn = await db.getConnection();

  try {
    const userId = authState.getLoggedInUserId(); // 변경
    await conn.query("DELETE FROM User WHERE user_id = ?", [userId]);
    authState.clearLoggedInUserId(); // 로그아웃 처리
    res.send("회원 탈퇴가 완료되었습니다.");
  } catch (err) {
    console.error(err);
    res.status(500).send("서버 오류 발생");
  } finally {
    conn.release();
  }
};
