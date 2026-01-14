// controllers/userController.js
const db = require("../models/db");
//const authState = require("../authState"); 

exports.showMyPage = async (req, res) => {
    //const userId = authState.getLoggedInUserId();
    const userId = req.session.userId;
    console.log("userId:", userId);

    const { holdingsSearch, transactionsSearch, startDate, endDate } = req.query;
    const userQuery = "SELECT name, balance FROM User WHERE user_id = ?";

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
        const [userResults] = await conn.query(userQuery, [userId]);

        if (userResults.length === 0) {
            return res.redirect("/login");
        }

        const holdingsParams = holdingsSearch ? [userId, `%${holdingsSearch}%`] : [userId];
        const [holdingsResults] = await conn.query(holdingsQuery, holdingsParams);

        const transactionParams = [userId];
        if (transactionsSearch) transactionParams.push(`%${transactionsSearch}%`);
        if (startDate) transactionParams.push(startDate);
        if (endDate) transactionParams.push(endDate);
        const [transactionsResults] = await conn.query(transactionsQuery, transactionParams);

        const [orderResults] = await conn.query(orderQuery, [userId]);

        res.render("mypage", {
            user: userResults[0],
            holdings: holdingsResults,
            transactions: transactionsResults,
            orders: orderResults,
            holdingsSearch,
            transactionsSearch,
            startDate,
            endDate,
            loggedIn: !!userId
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("서버 오류 발생");
    } finally {
        conn.release();
    }
};