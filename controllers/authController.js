// controllers/authController.js
const db = require("../models/db");
const bcrypt = require("bcrypt");
//const authState = require("../authState");

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
    // 1) 동일 이름 사용자 존재 여부 확인
    const [existingUsers] = await conn.query(
      "SELECT user_id FROM user WHERE name = ?",
      [name]
    );
    // 이러기 위해서는 이름이 유일해야함. -> 바꿔줘야 될듯. 이메일 같은걸로

    if (existingUsers.length > 0) {
      return res.send("회원가입 실패: 이미 존재하는 이름입니다.");
    }

    // 2) bcrypt 해시 생성
    const saltRounds = 12; // 10~12 권장 (서버 상황에 따라 조절)
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // 3) 새 user_id 생성 (※ 가능하면 AUTO_INCREMENT 권장)
    const [[{ max_id }]] = await conn.query(
      "SELECT MAX(user_id) AS max_id FROM user"
    );
    const newUserId = (max_id || 0) + 1;

    // 4) DB에 해시 저장 (password 대신 password_hash)
    await conn.query(
      "INSERT INTO user (user_id, name, password_hash, balance) VALUES (?, ?, ?, 0)",
      [newUserId, name, passwordHash]
    );

    return res.send(`
      <script>
        alert("회원가입 성공!");
        window.location.href = "/";
      </script>
    `);
  } catch (err) {
    console.error(err);
    return res.status(500).send("서버 오류 발생");
  } finally {
    conn.release();
  }
};

exports.handleLogin = async (req, res) => {
  const { name, password } = req.body;
  const conn = await db.getConnection();

  try {
    // 1) 이름으로 사용자 조회 (해시 가져오기)
    const [users] = await conn.query(
      "SELECT user_id, name, password_hash FROM User WHERE name = ?",
      [name]
    );

    if (users.length === 0) {
      return res.send("로그인 실패: 이름 또는 비밀번호가 잘못되었습니다.");
    }

    const user = users[0];

    // 2) bcrypt로 비밀번호 검증
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.send("로그인 실패: 이름 또는 비밀번호가 잘못되었습니다.");
    }

    // 3) 로그인 성공 -> 세션 저장
    req.session.userId = user.user_id;
    return res.redirect("/");
  } catch (err) {
    console.error(err);
    return res.status(500).send("서버 오류 발생");
  } finally {
    conn.release();
  }
};


exports.handleLogout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error(err);
      return res.status(500).send("로그아웃 실패");
    }
    res.clearCookie("connect.sid"); // 세션 쿠키 제거(기본 쿠키명)
    res.redirect("/");
  });
};


exports.handleDeleteAccount = async (req, res) => {
  const conn = await db.getConnection();

  try {
    //const userId = authState.getLoggedInUserId(); // 변경
    const userId = req.session.userId;
    await conn.query("DELETE FROM User WHERE user_id = ?", [userId]);
    req.session.destroy((err) => {
      if (err) {
        console.error(err);
        return res.status(500).send("로그아웃 실패");
      }
      res.clearCookie("connect.sid"); // 세션 쿠키 제거(기본 쿠키명)
      res.redirect("/");
    });
    //authState.clearLoggedInUserId(); // 로그아웃 처리
    //res.send("회원 탈퇴가 완료되었습니다.");
  } catch (err) {
    console.error(err);
    res.status(500).send("서버 오류 발생");
  } finally {
    conn.release();
  }
};
