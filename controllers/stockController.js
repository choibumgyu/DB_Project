// controllers/stockController.js
const db = require("../models/db");
const authState = require("../authState"); 

//let loggedInUserId = 1; // 추후 세션/쿠키로 대체

// 주식 목록
exports.getStockList = async (req, res) => {
  //const loggedInUserId = authState.getLoggedInUserId();
  const loggedInUserId = req.session.userId;
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
};

// 거래 내역
exports.getStockTransactions = async (req, res) => {
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
};

// 주문호가창
exports.getOrderBook = async (req, res) => {
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
};
