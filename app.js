const express = require('express');
const app = express();
const db = require('./models/db');        // db.js
const redis = require('./models/redis');  // redis.js
const authState = require("./authState");

app.set("view engine", "ejs");
app.set("views", "./views");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let loggedInUserId = 1;

const userRoutes = require("./routes/user");
app.use("/", userRoutes);

const authRoutes = require("./routes/auth");
app.use("/", authRoutes);

const moneyRoutes = require("./routes/money");
app.use("/", moneyRoutes); // /deposit, /withdraw 그대로 작동

const stockRoutes = require("./routes/stock");
app.use("/", stockRoutes);

const tradeRoutes = require("./routes/trade");
app.use("/", tradeRoutes);

app.get("/", (req, res) => {
  const loggedInUserId = authState.getLoggedInUserId(); // 변경
  res.render("app", { loggedIn: !!loggedInUserId });
});

app.listen(3000, () => {
    console.log('서버 실행 중');
});

/*

//7월14일 수정중.
// 임시 로그인 유저 (실제 구현 시 세션/로그인 처리 필요)
const loggedInUserId = 1;
// 메인 페이지
app.get("/", (req, res) => {
    res.render("app", { loggedIn: !!loggedInUserId });
});

// 로그인 페이지
app.get("/login", (req, res) => {
    res.render("login");
});

// 회원가입 페이지
app.get("/signup", (req, res) => {
    res.render("signup");
});

// 회원가입 처리 라우팅
app.post("/signup", async (req, res) => {
    const { name, password } = req.body;
    const checkQuery = "SELECT * FROM user WHERE name = ? AND password = ?";
    const getMaxIdQuery = "SELECT MAX(user_id) AS max_id FROM user";
    const insertQuery = "INSERT INTO user (user_id, name, password, balance) VALUES (?, ?, ?, 0)";

    const conn = await db.getConnection();
    try {
        const [results] = await conn.query(checkQuery, [name, password]);
        if (results.length > 0) {
            res.send("회원가입 실패: 이미 존재하는 회원입니다.");
        } else {
            const [maxIdResult] = await conn.query(getMaxIdQuery);
            const newUserId = (maxIdResult[0].max_id || 0) + 1;
            await conn.query(insertQuery, [newUserId, name, password]);
            res.send("회원가입 성공");
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("서버 오류 발생");
    } finally {
        conn.release();
    }
});

// 로그인
app.post("/login", async (req, res) => {
    const { name, password } = req.body;
    const query = "SELECT * FROM User WHERE name = ? AND password = ?";

    const conn = await db.getConnection();
    try {
        const [results] = await conn.query(query, [name, password]);
        if (results.length > 0) {
            loggedInUserId = results[0].user_id;
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
});

// 마이페이지
app.get("/mypage", async (req, res) => {
    if (!loggedInUserId) return res.redirect("/login");

    const { holdingsSearch, transactionsSearch, startDate, endDate } = req.query;
    const userQuery = "SELECT name, password, balance FROM User WHERE user_id = ?";

    const holdingsQuery = `
        SELECT 
            Stock.stock_name,
            Stock.current_price,
            ROUND(((Stock.current_price - Stock.previous_price) / Stock.previous_price) * 100, 2) AS change_rate,
            User_Holdings.average_price,
            User_Holdings.quantity,
            (User_Holdings.quantity - IFNULL(SUM(Orders.order_quantity), 0)) AS tradable_quantity,
            (Stock.current_price - User_Holdings.average_price) * User_Holdings.quantity AS profit_loss
        FROM User_Holdings
        JOIN Stock ON User_Holdings.stock_id = Stock.stock_id
        LEFT JOIN Orders ON User_Holdings.stock_id = Orders.stock_id 
                          AND Orders.user_id = User_Holdings.user_id 
                          AND Orders.order_type = 2
        WHERE User_Holdings.user_id = ? 
        ${holdingsSearch ? "AND Stock.stock_name LIKE ?" : ""}
        GROUP BY Stock.stock_id, User_Holdings.average_price, User_Holdings.quantity`;

    let transactionsQuery = `
        SELECT Stock.stock_name, Transaction.transaction_type, Transaction.transaction_price, 
               Transaction.transaction_quantity, Transaction.transaction_date 
        FROM Transaction 
        JOIN Stock ON Transaction.stock_id = Stock.stock_id 
        WHERE Transaction.user_id = ? 
        ${transactionsSearch ? "AND Stock.stock_name LIKE ?" : ""}
        ${startDate ? "AND Transaction.transaction_date >= ?" : ""}
        ${endDate ? "AND Transaction.transaction_date <= ?" : ""}
        ORDER BY Transaction.transaction_date DESC`;

    const orderQuery = `
        SELECT Stock.stock_name, Orders.order_type, Orders.order_category, 
               Orders.order_quantity, Orders.order_price, Orders.order_date 
        FROM Orders 
        JOIN Stock ON Orders.stock_id = Stock.stock_id 
        WHERE Orders.user_id = ?
        ORDER BY Orders.order_date DESC`;

    const conn = await db.getConnection();
    try {
        const [userResults] = await conn.query(userQuery, [loggedInUserId]);

        const holdingsParams = holdingsSearch ? [loggedInUserId, `%${holdingsSearch}%`] : [loggedInUserId];
        const [holdingsResults] = await conn.query(holdingsQuery, holdingsParams);

        const transactionParams = [loggedInUserId];
        if (transactionsSearch) transactionParams.push(`%${transactionsSearch}%`);
        if (startDate) transactionParams.push(startDate);
        if (endDate) transactionParams.push(endDate);
        const [transactionsResults] = await conn.query(transactionsQuery, transactionParams);

        const [orderResults] = await conn.query(orderQuery, [loggedInUserId]);

        res.render("mypage", {
            user: userResults[0],
            holdings: holdingsResults,
            transactions: transactionsResults,
            orders: orderResults,
            holdingsSearch,
            transactionsSearch,
            startDate,
            endDate,
            loggedIn: !!loggedInUserId
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("서버 오류 발생");
    } finally {
        conn.release();
    }
});
app.post("/deposit", async (req, res) => {
    const { amount } = req.body;
    if (!loggedInUserId) return res.redirect("/login");

    const conn = await db.getConnection();
    try {
        const depositQuery = "UPDATE User SET balance = balance + ? WHERE user_id = ?";
        await conn.query(depositQuery, [parseFloat(amount), loggedInUserId]);
        res.redirect("/mypage");
    } catch (err) {
        console.error(err);
        res.status(500).send("서버 오류 발생");
    } finally {
        conn.release();
    }
});
app.post("/withdraw", async (req, res) => {
    const { amount } = req.body;
    if (!loggedInUserId) return res.redirect("/login");

    const conn = await db.getConnection();
    try {
        const balanceQuery = "SELECT balance FROM User WHERE user_id = ?";
        const [results] = await conn.query(balanceQuery, [loggedInUserId]);
        const currentBalance = results[0].balance;

        if (parseFloat(amount) > currentBalance) {
            res.send("<script>alert('출금 불가: 예수금이 부족합니다.'); window.location.href = '/mypage';</script>");
        } else {
            const withdrawQuery = "UPDATE User SET balance = balance - ? WHERE user_id = ?";
            await conn.query(withdrawQuery, [parseFloat(amount), loggedInUserId]);
            res.redirect("/mypage");
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("서버 오류 발생");
    } finally {
        conn.release();
    }
});
app.get("/stocks", async (req, res) => {
    const { search } = req.query;
    const conn = await db.getConnection();
    try {
        const stockQuery = `
            SELECT Stock.*, 
                ROUND(((Stock.current_price - Stock.previous_price) / Stock.previous_price) * 100, 2) AS change_rate,
                COALESCE(ROUND(SUM(Transaction.transaction_quantity)/2), 0) AS volume 
            FROM Stock
            LEFT JOIN Transaction ON Stock.stock_id = Transaction.stock_id 
                AND DATE(Transaction.transaction_date) = CURDATE()
            ${search ? "WHERE stock_name LIKE ?" : ""}
            GROUP BY Stock.stock_id
            ORDER BY volume DESC
        `;
        const [stockResults] = await conn.query(stockQuery, search ? [`%${search}%`] : []);
        stockResults.forEach((stock, index) => stock.rank = index + 1);
        res.render("stocks", { stocks: stockResults, search, loggedIn: !!loggedInUserId });
    } catch (err) {
        console.error(err);
        res.status(500).send("서버 오류 발생");
    } finally {
        conn.release();
    }
});
app.get("/stock/:stockId/transactions", async (req, res) => {
    const { stockId } = req.params;
    const conn = await db.getConnection();
    try {
        const transactionsQuery = `
            SELECT Transaction.transaction_date, Transaction.transaction_type,
                   Transaction.transaction_price, Transaction.transaction_quantity,
                   User.name AS user_name
            FROM Transaction
            JOIN User ON Transaction.user_id = User.user_id
            WHERE Transaction.stock_id = ?
            ORDER BY Transaction.transaction_date DESC
        `;
        const [transactionResults] = await conn.query(transactionsQuery, [stockId]);
        res.render("transactions", { transactions: transactionResults });
    } catch (err) {
        console.error(err);
        res.status(500).send("서버 오류 발생");
    } finally {
        conn.release();
    }
});
app.post("/delete-account", async (req, res) => {
    if (!loggedInUserId) return res.redirect("/login");

    const conn = await db.getConnection();
    try {
        const query = "DELETE FROM User WHERE user_id = ?";
        await conn.query(query, [loggedInUserId]);
        loggedInUserId = null;
        res.send("회원 탈퇴가 완료되었습니다.");
    } catch (err) {
        console.error(err);
        res.status(500).send("서버 오류 발생");
    } finally {
        conn.release();
    }
});
app.get("/stock/:stockId/orderbook", async (req, res) => {
    const stockId = req.params.stockId;
    const conn = await db.getConnection();

    try {
        const stockQuery = "SELECT stock_name, current_price, price_tick FROM Stock WHERE stock_id = ?";
        const [stockResults] = await conn.query(stockQuery, [stockId]);

        if (stockResults.length === 0) {
            return res.status(404).send("해당 주식을 찾을 수 없습니다.");
        }

        const { stock_name, current_price, price_tick } = stockResults[0];
        const currentPrice = Math.round(current_price);
        const priceTick = Math.round(price_tick);

        if (isNaN(currentPrice) || isNaN(priceTick)) {
            return res.status(500).send("현재 가격 또는 price_tick이 유효하지 않습니다.");
        }

        const priceLevels = [];
        for (let i = -4; i <= 5; i++) {
            priceLevels.push(currentPrice + i * priceTick);
        }

        const orderQuery = `
            SELECT ROUND(order_price) AS order_price, order_type, SUM(order_quantity) AS total_quantity 
            FROM Orders 
            WHERE stock_id = ? AND ROUND(order_price) IN (${priceLevels.join(",")}) 
            GROUP BY order_price, order_type
        `;
        const [orderResults] = await conn.query(orderQuery, [stockId]);

        const orderBook = priceLevels.map(price => {
            const entry = orderResults.reduce((acc, order) => {
                if (Math.round(order.order_price) === price) {
                    if (order.order_type === 2) acc.sellCount = order.total_quantity;
                    else if (order.order_type === 1) acc.buyCount = order.total_quantity;
                }
                return acc;
            }, { price, isCurrentPrice: price === currentPrice, sellCount: 0, buyCount: 0 });

            return entry;
        });

        res.render("orderbook", { stockName: stock_name, currentPrice, orderBook, stockId });
    } catch (err) {
        console.error(err);
        res.status(500).send("서버 오류 발생");
    } finally {
        conn.release();
    }
});



app.post("/trade/market", async (req, res) => {
    const { stockId, tradeType, quantity } = req.body;
    const userId = loggedInUserId;

    const conn = await db.getConnection();
    try {
        const [stockResults] = await conn.query("SELECT current_price FROM Stock WHERE stock_id = ?", [stockId]);

        if (stockResults.length === 0) {
            return res.status(404).send("해당 주식을 찾을 수 없습니다.");
        }

        const currentPrice = Number(stockResults[0].current_price);
        let orderPrice;

        if (tradeType === "1") {
            // 시장가 매수: 현재가의 130%
            orderPrice = currentPrice * 1.3;
            const totalCost = quantity * orderPrice;

            const [userResults] = await conn.query("SELECT balance FROM User WHERE user_id = ?", [userId]);
            const userBalance = userResults[0]?.balance ?? 0;

            if (totalCost > userBalance) {
                return res.send(`<script>alert('예수금이 부족하여 주문을 넣을 수 없습니다.'); window.location.href = '/stock/${stockId}/orderbook';</script>`);
            } else {
                return res.render('redirect-form', {
                    action: '/trade/limit-buy',
                    fields: {
                        stockId,
                        quantity,
                        price: orderPrice,
                    }
                });
            }

        } else if (tradeType === "2") {
            // 시장가 매도: 현재가의 70%
            orderPrice = currentPrice * 0.7;

            const holdingQuery = `
                SELECT User_Holdings.quantity - IFNULL(SUM(Orders.order_quantity), 0) AS tradable_quantity 
                FROM User_Holdings 
                LEFT JOIN Orders ON User_Holdings.stock_id = Orders.stock_id 
                                 AND Orders.user_id = User_Holdings.user_id 
                                 AND Orders.order_type = 2 
                WHERE User_Holdings.user_id = ? AND User_Holdings.stock_id = ? 
                GROUP BY User_Holdings.quantity
            `;
            const [holdingResults] = await conn.query(holdingQuery, [userId, stockId]);
            const tradableQuantity = holdingResults[0]?.tradable_quantity ?? 0;

            if (quantity > tradableQuantity) {
                return res.send(`<script>alert('거래 가능 수량이 부족하여 주문을 넣을 수 없습니다.'); window.location.href = '/stock/${stockId}/orderbook';</script>`);
            } else {
                return res.render('redirect-form', {
                    action: '/trade/limit-sell',
                    fields: {
                        stockId,
                        quantity,
                        price: orderPrice,
                    }
                });
            }
        } else {
            return res.status(400).send("잘못된 거래 유형입니다.");
        }

    } catch (err) {
        console.error(err);
        res.status(500).send("서버 오류가 발생했습니다.");
    } finally {
        conn.release(); // 항상 연결 해제
    }
});
// 현재가 업데이트 로직 수정 및 거래 가능 수량 확인 개선
const router = express.Router();

// 매수 지정가 주문
router.post('/trade/limit-buy', async (req, res) => {
  const { stockId, quantity, price } = req.body;
  const userId = req.session.userId;
  const totalCost = quantity * price;
  const conn = await db.getConnection();

  const redisOps = [];

  try {
    await conn.beginTransaction();

    const [user] = await conn.query(
      'SELECT balance FROM User WHERE user_id = ? FOR UPDATE',
      [userId]
    );
    if (user[0].balance < totalCost) throw new Error('예수금 부족');

    await conn.query(
      'UPDATE User SET balance = balance - ? WHERE user_id = ?',
      [totalCost, userId]
    );

    const [buyRes] = await conn.query(
      `INSERT INTO Orders (user_id, stock_id, order_type, order_category, order_price, order_quantity, order_date) 
       VALUES (?, ?, 1, 2, ?, ?, NOW())`,
      [userId, stockId, price, quantity]
    );
    const orderId = buyRes.insertId;
    let remaining = quantity;

    const sellKey = `sell:stock:${stockId}`;
    let candidates = await redis.zrangebyscore(sellKey, '-inf', price);

    // ✅ 동일 가격대에서 시간 순 정렬 (timestamp 기준 오름차순)
    candidates.sort((a, b) => {
      const aTime = Number(a.split(':')[1]);
      const bTime = Number(b.split(':')[1]);
      return aTime - bTime;
    });

    for (const key of candidates) {
      if (remaining <= 0) break;

      const [sellOrderId] = key.split(':');
      const sell = await redis.hgetall(`order:${sellOrderId}`);
      const sellQty = parseInt(sell.quantity);
      const tradeQty = Math.min(sellQty, remaining);
      const tradePrice = parseFloat(sell.price);

      await conn.query(
        `INSERT INTO Transaction 
         (user_id, stock_id, transaction_type, transaction_price, transaction_quantity, transaction_date) 
         VALUES (?, ?, ?, ?, ?, NOW()), (?, ?, ?, ?, ?, NOW())`,
        [
          userId, stockId, 1, tradePrice, tradeQty,
          sell.userId, stockId, 2, tradePrice, tradeQty
        ]
      );

      await conn.query(
        `UPDATE User SET balance = balance + ? WHERE user_id = ?`,
        [tradeQty * tradePrice, sell.userId]
      );

      await conn.query(
        `INSERT INTO User_Holdings 
         (user_id, stock_id, average_price, quantity) 
         VALUES (?, ?, ?, ?) 
         ON DUPLICATE KEY UPDATE 
           average_price = ((average_price * quantity) + (? * ?)) / (quantity + ?), 
           quantity = quantity + VALUES(quantity)`,
        [userId, stockId, tradePrice, tradeQty, tradePrice, tradeQty, tradeQty]
      );

      await conn.query(
        `UPDATE User_Holdings SET quantity = quantity - ? WHERE user_id = ? AND stock_id = ?`,
        [tradeQty, sell.userId, stockId]
      );

      remaining -= tradeQty;

      if (sellQty > tradeQty) {
        await conn.query(
          `UPDATE Orders SET order_quantity = ? WHERE order_id = ?`,
          [sellQty - tradeQty, sellOrderId]
        );
        redisOps.push(() =>
          redis.hset(`order:${sellOrderId}`, 'quantity', sellQty - tradeQty)
        );
      } else {
        await conn.query(`DELETE FROM Orders WHERE order_id = ?`, [sellOrderId]);
        redisOps.push(() => redis.zrem(sellKey, key));
        redisOps.push(() => redis.del(`order:${sellOrderId}`));
      }
    }

    if (remaining > 0) {
      await conn.query(
        `UPDATE Orders SET order_quantity = ? WHERE order_id = ?`,
        [remaining, orderId]
      );
      redisOps.push(() =>
        redis.zadd(`buy:stock:${stockId}`, price, `${orderId}:${Date.now()}`)
      );
      redisOps.push(() =>
        redis.hset(`order:${orderId}`, {
          userId,
          price,
          quantity: remaining,
          stockId,
          type: 'buy'
        })
      );
    } else {
      await conn.query(`DELETE FROM Orders WHERE order_id = ?`, [orderId]);
    }

    await conn.commit();

    for (const op of redisOps) {
      try {
        await op();
      } catch (e) {
        console.error('[Redis 오류] 일부 주문북 갱신 실패:', e);
      }
    }

    res.redirect(`/stock/${stockId}/orderbook`);
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).send('매수 주문 실패: ' + err.message);
  } finally {
    conn.release();
  }
});

router.post('/trade/limit-sell', async (req, res) => {
  const { stockId, quantity, price } = req.body;
  const userId = req.session.userId;
  const conn = await db.getConnection();

  const redisOps = [];

  try {
    await conn.beginTransaction();

    const [hold] = await conn.query(
      `SELECT quantity FROM User_Holdings 
       WHERE user_id = ? AND stock_id = ? FOR UPDATE`,
      [userId, stockId]
    );
    if (!hold.length || hold[0].quantity < quantity)
      throw new Error('보유 수량 부족');

    const [sellRes] = await conn.query(
      `INSERT INTO Orders 
       (user_id, stock_id, order_type, order_category, order_price, order_quantity, order_date) 
       VALUES (?, ?, 2, 2, ?, ?, NOW())`,
      [userId, stockId, price, quantity]
    );
    const orderId = sellRes.insertId;
    let remaining = quantity;

    const buyKey = `buy:stock:${stockId}`;
    let candidates = await redis.zrevrangebyscore(buyKey, '+inf', price);

    // ✅ 동일 가격대 시간순 정렬 (timestamp 기준 오름차순)
    candidates.sort((a, b) => {
      const aTime = Number(a.split(':')[1]);
      const bTime = Number(b.split(':')[1]);
      return aTime - bTime;
    });

    for (const key of candidates) {
      if (remaining <= 0) break;

      const [buyOrderId] = key.split(':');
      const buy = await redis.hgetall(`order:${buyOrderId}`);
      const buyQty = parseInt(buy.quantity);
      const tradeQty = Math.min(buyQty, remaining);
      const tradePrice = parseFloat(buy.price);

      await conn.query(
        `INSERT INTO Transaction 
         (user_id, stock_id, transaction_type, transaction_price, transaction_quantity, transaction_date) 
         VALUES (?, ?, ?, ?, ?, NOW()), (?, ?, ?, ?, ?, NOW())`,
        [
          userId, stockId, 2, tradePrice, tradeQty,
          buy.userId, stockId, 1, tradePrice, tradeQty
        ]
      );

      await conn.query(
        `UPDATE User SET balance = balance + ? WHERE user_id = ?`,
        [tradeQty * tradePrice, userId]
      );

      await conn.query(
        `INSERT INTO User_Holdings 
         (user_id, stock_id, average_price, quantity) 
         VALUES (?, ?, ?, ?) 
         ON DUPLICATE KEY UPDATE 
           average_price = ((average_price * quantity) + (? * ?)) / (quantity + ?), 
           quantity = quantity + VALUES(quantity)`,
        [buy.userId, stockId, tradePrice, tradeQty, tradePrice, tradeQty, tradeQty]
      );

      await conn.query(
        `UPDATE User_Holdings SET quantity = quantity - ? 
         WHERE user_id = ? AND stock_id = ?`,
        [tradeQty, userId, stockId]
      );

      remaining -= tradeQty;

      if (buyQty > tradeQty) {
        await conn.query(
          `UPDATE Orders SET order_quantity = ? WHERE order_id = ?`,
          [buyQty - tradeQty, buyOrderId]
        );
        redisOps.push(() =>
          redis.hset(`order:${buyOrderId}`, 'quantity', buyQty - tradeQty)
        );
      } else {
        await conn.query(`DELETE FROM Orders WHERE order_id = ?`, [buyOrderId]);
        redisOps.push(() => redis.zrem(buyKey, key));
        redisOps.push(() => redis.del(`order:${buyOrderId}`));
      }
    }

    if (remaining > 0) {
      await conn.query(
        `UPDATE Orders SET order_quantity = ? WHERE order_id = ?`,
        [remaining, orderId]
      );
      redisOps.push(() =>
        redis.zadd(`sell:stock:${stockId}`, price, `${orderId}:${Date.now()}`)
      );
      redisOps.push(() =>
        redis.hset(`order:${orderId}`, {
          userId,
          price,
          quantity: remaining,
          stockId,
          type: 'sell'
        })
      );
    } else {
      await conn.query(`DELETE FROM Orders WHERE order_id = ?`, [orderId]);
    }

    await conn.commit();

    for (const op of redisOps) {
      try {
        await op();
      } catch (e) {
        console.error('[Redis 오류] 매도 주문 후 갱신 실패:', e);
      }
    }

    res.redirect(`/stock/${stockId}/orderbook`);
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).send('매도 주문 실패: ' + err.message);
  } finally {
    conn.release();
  }
});


module.exports = router;

app.listen(3000, () => {
    console.log('서버 실행 중');
});

*/