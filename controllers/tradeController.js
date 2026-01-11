// controllers/tradeController.js
const db = require("../models/db");
const authState = require("../authState");

let loggedInUserId = 1; // 추후 세션 대체

exports.handleMarketTrade = async (req, res) => {
   const loggedInUserId = authState.getLoggedInUserId();
  const { stockId, tradeType, quantity } = req.body;
  const userId = loggedInUserId;
  const conn = await db.getConnection();

  try {
    const [stockResults] = await conn.query(
      "SELECT current_price FROM Stock WHERE stock_id = ?",
      [stockId]
    );

    if (stockResults.length === 0) {
      return res.status(404).send("해당 주식을 찾을 수 없습니다.");
    }

    const currentPrice = Number(stockResults[0].current_price);
    let orderPrice;

    if (tradeType === "1") {
      // 시장가 매수 = 현재가의 130%
      orderPrice = currentPrice * 1.3;

      const [userResults] = await conn.query("SELECT balance FROM User WHERE user_id = ?", [userId]);
      const userBalance = userResults[0]?.balance ?? 0;

      if (quantity * orderPrice > userBalance) {
        return res.send(`<script>alert('예수금 부족'); window.location.href = '/stock/${stockId}/orderbook';</script>`);
      }

      res.render("redirect-form", {
        action: "/trade/limit-buy",
        fields: { stockId, quantity, price: orderPrice }
      });

    } else if (tradeType === "2") {
      // 시장가 매도 = 현재가의 70%
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
        return res.send(`<script>alert('거래 가능 수량 부족'); window.location.href = '/stock/${stockId}/orderbook';</script>`);
      }

      res.render("redirect-form", {
        action: "/trade/limit-sell",
        fields: { stockId, quantity, price: orderPrice }
      });

    } else {
      res.status(400).send("잘못된 거래 유형");
    }

  } catch (err) {
    console.error(err);
    res.status(500).send("시장가 주문 실패");
  } finally {
    conn.release();
  }
};

exports.handleLimitBuy = async (req, res) => {
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
};

exports.handleLimitSell = async (req, res) => {
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
};

