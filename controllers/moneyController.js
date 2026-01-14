// controllers/moneyController.js
const db = require("../models/db");
//const authState = require("../authState"); 


exports.handleDeposit = async (req, res) => {
  //const loggedInUserId = authState.getLoggedInUserId();
  const loggedInUserId = req.session.userId;
  const { amount } = req.body;
  if (!loggedInUserId) return res.redirect("/login");

  const conn = await db.getConnection();
  try {
    const query = "UPDATE User SET balance = balance + ? WHERE user_id = ?";
    await conn.query(query, [parseFloat(amount), loggedInUserId]);
    res.redirect("/mypage");
  } catch (err) {
    console.error(err);
    res.status(500).send("입금 실패");
  } finally {
    conn.release();
  }
};

exports.handleWithdraw = async (req, res) => {
  //const loggedInUserId = authState.getLoggedInUserId();
  const loggedInUserId = req.session.userId;
  const { amount } = req.body;
  if (!loggedInUserId) return res.redirect("/login");

  const conn = await db.getConnection();
  try {
    const balanceQuery = "SELECT balance FROM User WHERE user_id = ?";
    const [results] = await conn.query(balanceQuery, [loggedInUserId]);
    const currentBalance = results[0]?.balance ?? 0;

    if (parseFloat(amount) > currentBalance) {
      return res.send("<script>alert('출금 불가: 예수금이 부족합니다.'); window.location.href = '/mypage';</script>");
    }

    const withdrawQuery = "UPDATE User SET balance = balance - ? WHERE user_id = ?";
    await conn.query(withdrawQuery, [parseFloat(amount), loggedInUserId]);
    res.redirect("/mypage");
  } catch (err) {
    console.error(err);
    res.status(500).send("출금 실패");
  } finally {
    conn.release();
  }
};
