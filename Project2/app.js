const express = require('express'); 
const app = express();
const mysql = require('mysql2');

app.set("view engine", "ejs"); 
app.set("views", "./views"); 

const db_info = {
    host: "localhost",
    port: 3306,
    user: "root",
    password: "qjarb73*",
    database: "stock_trading_system"
};      

const sql_connection=mysql.createConnection(db_info);
sql_connection.connect();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let loggedInUserId = null;

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
app.post("/signup", (req, res) => {
    const { name, password } = req.body; // 회원가입 정보
    const checkQuery = "SELECT * FROM user WHERE name = ? AND password = ?";
    const getMaxIdQuery = "SELECT MAX(user_id) AS max_id FROM user"; // 현재 가장 큰 user_id 가져오기

    // 동일한 이름과 비밀번호를 가진 사용자가 있는지 확인
    sql_connection.query(checkQuery, [name, password], (err, results) => {
        if (err) throw err;

        if (results.length > 0) {
            res.send("회원가입 실패: 이미 존재하는 회원입니다.");
        } else {
            // 가장 큰 user_id 가져오기
            sql_connection.query(getMaxIdQuery, (err, maxIdResult) => {
                if (err) throw err;
                
                const newUserId = maxIdResult[0].max_id + 1; // 가장 큰 user_id에 1을 더해 새로운 user_id 생성
                const insertQuery = "INSERT INTO user (user_id, name, password, balance) VALUES (?, ?, ?, 0)";
                
                // 새로운 사용자 추가
                sql_connection.query(insertQuery, [newUserId, name, password], (err) => {
                    if (err) throw err;
                    res.send("회원가입 성공");
                });
            });
        }
    });
});



// 로그인 처리
app.post("/login", (req, res) => {
    const { name, password } = req.body;
    const query = "SELECT * FROM User WHERE name = ? AND password = ?";

    sql_connection.query(query, [name, password], (err, results) => {
        if (err) throw err;

        if (results.length > 0) {
            loggedInUserId = results[0].user_id;
            res.redirect("/");
        } else {
            res.send("로그인 실패: 이름 또는 비밀번호가 잘못되었습니다.");
        }
    });
});

// 로그아웃 처리
app.get("/logout", (req, res) => {
    loggedInUserId = null;
    res.redirect("/");
});

// 마이페이지 (예수금 관리, 보유 주식 현황, 주식 거래 내역, 주문 내역 포함)
app.get("/mypage", (req, res) => {
    if (!loggedInUserId) return res.redirect("/login");

    const { holdingsSearch, transactionsSearch, startDate, endDate } = req.query; // 각 검색어와 기간 검색어
    const userQuery = "SELECT name, password, balance FROM User WHERE user_id = ?";

    // 보유 주식 현황 조회
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

    // 거래 내역 조회
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

    // 주문 내역 조회
    const orderQuery = `
        SELECT Stock.stock_name, Orders.order_type, Orders.order_category, 
               Orders.order_quantity, Orders.order_price, Orders.order_date 
        FROM Orders 
        JOIN Stock ON Orders.stock_id = Stock.stock_id 
        WHERE Orders.user_id = ?
        ORDER BY Orders.order_date DESC`;

    sql_connection.query(userQuery, [loggedInUserId], (err, userResults) => {
        if (err) throw err;

        const holdingsParams = holdingsSearch ? [loggedInUserId, `%${holdingsSearch}%`] : [loggedInUserId];
        sql_connection.query(holdingsQuery, holdingsParams, (err, holdingsResults) => {
            if (err) throw err;

            const transactionParams = [loggedInUserId];
            if (transactionsSearch) transactionParams.push(`%${transactionsSearch}%`);
            if (startDate) transactionParams.push(startDate);
            if (endDate) transactionParams.push(endDate);

            sql_connection.query(transactionsQuery, transactionParams, (err, transactionsResults) => {
                if (err) throw err;

                sql_connection.query(orderQuery, [loggedInUserId], (err, orderResults) => {
                    if (err) throw err;

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
                });
            });
        });
    });
});


// 예수금 입금 처리
app.post("/deposit", (req, res) => {
    const { amount } = req.body; // 입금할 금액
    if (!loggedInUserId) return res.redirect("/login");

    // 현재 예수금에 입금 금액을 더하여 업데이트
    const depositQuery = "UPDATE User SET balance = balance + ? WHERE user_id = ?";
    sql_connection.query(depositQuery, [parseFloat(amount), loggedInUserId], (err) => {
        if (err) throw err;
        res.redirect("/mypage"); // 입금 후 마이페이지로 돌아가기
    });
});

// 예수금 출금 처리
app.post("/withdraw", (req, res) => {
    const { amount } = req.body; // 출금할 금액
    if (!loggedInUserId) return res.redirect("/login");

    // 출금 요청을 처리하기 전에 현재 예수금을 확인
    const balanceQuery = "SELECT balance FROM User WHERE user_id = ?";
    sql_connection.query(balanceQuery, [loggedInUserId], (err, results) => {
        if (err) throw err;

        const currentBalance = results[0].balance;
        if (parseFloat(amount) > currentBalance) {
            // 출금 금액이 현재 예수금보다 많을 경우 경고 메시지 출력
            res.send("<script>alert('출금 불가: 예수금이 부족합니다.'); window.location.href = '/mypage';</script>");
        } else {
            // 예수금 업데이트: 현재 예수금에서 출금 금액만큼 차감
            const withdrawQuery = "UPDATE User SET balance = balance - ? WHERE user_id = ?";
            sql_connection.query(withdrawQuery, [parseFloat(amount), loggedInUserId], (err) => {
                if (err) throw err;
                res.redirect("/mypage"); // 출금 후 마이페이지로 돌아가기
            });
        }
    });
});

// 주식 정보 페이지
app.get("/stocks", (req, res) => {
    const { search } = req.query;

    // 검색된 주식 또는 전체 주식 정보 가져오기 + 거래량 및 등락률 계산
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

    // stockQuery 실행 및 결과 처리
    sql_connection.query(stockQuery, [`%${search}%`], (err, stockResults) => {
        if (err) throw err;

        // 순위 매기기
        stockResults.forEach((stock, index) => {
            stock.rank = index + 1; // 거래량 순위 계산
        });

        res.render("stocks", { stocks: stockResults, search, loggedIn: !!loggedInUserId });
    });
});


// 특정 주식의 거래내역 페이지
app.get("/stock/:stockId/transactions", (req, res) => {
    const { stockId } = req.params;

    const transactionsQuery = `
        SELECT Transaction.transaction_date, Transaction.transaction_type,
               Transaction.transaction_price, Transaction.transaction_quantity,
               User.name AS user_name
        FROM Transaction
        JOIN User ON Transaction.user_id = User.user_id
        WHERE Transaction.stock_id = ?
        ORDER BY Transaction.transaction_date DESC
    `;

    sql_connection.query(transactionsQuery, [stockId], (err, transactionResults) => {
        if (err) throw err;

        res.render("transactions", { transactions: transactionResults });
    });
});




// 회원 탈퇴 처리
app.post("/delete-account", (req, res) => {
    if (!loggedInUserId) return res.redirect("/login");

    const query = "DELETE FROM User WHERE user_id = ?";
    sql_connection.query(query, [loggedInUserId], (err) => {
        if (err) throw err;
        loggedInUserId = null;
        res.send("회원 탈퇴가 완료되었습니다.");
    });
});

// 주식 정보 페이지 (호가창 기능 추가)
app.get("/stock/:stockId/orderbook", (req, res) => {
    const stockId = req.params.stockId;

    // 주식의 현재 가격, price_tick, 주식 이름 가져오기
    const stockQuery = "SELECT stock_name, current_price, price_tick FROM Stock WHERE stock_id = ?";
    sql_connection.query(stockQuery, [stockId], (err, stockResults) => {
        if (err) throw err;

        if (stockResults.length > 0) {
            const stockName = stockResults[0].stock_name;
            const currentPrice = Math.round(Number(stockResults[0].current_price));
            const priceTick = Math.round(Number(stockResults[0].price_tick));

            if (isNaN(currentPrice) || isNaN(priceTick)) {
                return res.status(500).send("현재 가격 또는 price_tick이 유효하지 않습니다.");
            }

            // 호가창의 가격대를 계산 (현재가 - 4*price_tick ~ 현재가 + 5*price_tick)
            const priceLevels = [];
            for (let i = -4; i <= 5; i++) {
                const price = currentPrice + i * priceTick;
                priceLevels.push(price); // 자연수 형태로 저장
            }

            // 각 가격대에서의 매도/매수 주문 개수를 조회하는 쿼리
            const orderQuery = `
                SELECT ROUND(order_price) AS order_price, order_type, SUM(order_quantity) AS total_quantity 
                FROM Orders 
                WHERE stock_id = ? AND ROUND(order_price) IN (${priceLevels.join(",")}) 
                GROUP BY order_price, order_type
            `;
            
            sql_connection.query(orderQuery, [stockId], (err, orderResults) => {
                if (err) throw err;

                // 가격별로 매도 및 매수 주문 개수를 매핑
                const orderBook = priceLevels.map(price => {
                    const orderCounts = orderResults.reduce((acc, order) => {
                        if (Math.round(order.order_price) === price) {
                            if (order.order_type === 2) acc.sellCount = order.total_quantity;
                            else if (order.order_type === 1) acc.buyCount = order.total_quantity;
                        }
                        return acc;
                    }, { 
                        price, 
                        isCurrentPrice: price === currentPrice,
                        sellCount: 0, 
                        buyCount: 0 
                    });

                    return orderCounts;
                });

                res.render("orderbook", { stockName, currentPrice, orderBook, stockId });
            });
        } else {
            res.status(404).send("해당 주식을 찾을 수 없습니다.");
        }
    });
});



app.post("/trade/market", (req, res) => {
    const { stockId, tradeType, quantity } = req.body;
    const userId = loggedInUserId;

    const stockQuery = "SELECT current_price FROM Stock WHERE stock_id = ?";
    sql_connection.query(stockQuery, [stockId], (err, stockResults) => {
        if (err) throw err;

        const currentPrice = Number(stockResults[0].current_price);
        let orderPrice;

        if (tradeType === "1") { // 시장가 매수는 현재가의 130%
            orderPrice = currentPrice * 1.3;
            const totalCost = quantity * orderPrice;

            // 예수금 확인
            const balanceQuery = "SELECT balance FROM User WHERE user_id = ?";
            sql_connection.query(balanceQuery, [userId], (err, userResults) => {
                if (err) throw err;

                const userBalance = userResults[0].balance;
                if (totalCost > userBalance) {
                    return res.send("<script>alert('예수금이 부족하여 주문을 넣을 수 없습니다.'); window.location.href = '/stock/" + stockId + "/orderbook';</script>");
                } else {
                    // 예수금 충분할 경우 지정가 매수로 리다이렉트
                    res.render('redirect-form', {
                        action: '/trade/limit-buy',
                        fields: {
                            stockId,
                            quantity,
                            price: orderPrice,
                        }
                    });
                }
            });

        } else if (tradeType === "2") { // 시장가 매도는 현재가의 70%
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
            sql_connection.query(holdingQuery, [userId, stockId], (err, holdingResults) => {
                if (err) throw err;

                const tradableQuantity = holdingResults[0]?.tradable_quantity || 0;
                if (quantity > tradableQuantity) {
                    return res.send("<script>alert('거래 가능 수량이 부족하여 주문을 넣을 수 없습니다.'); window.location.href = '/stock/" + stockId + "/orderbook';</script>");
                } else {
                    // 거래 가능 수량 충분할 경우 지정가 매도로 리다이렉트
                    res.render('redirect-form', {
                        action: '/trade/limit-sell',
                        fields: {
                            stockId,
                            quantity,
                            price: orderPrice,
                        }
                    });
                }
            });
        }
    });
});

// 현재가 업데이트 로직 수정 및 거래 가능 수량 확인 개선

// 매수 지정가 주문 체결 로직
app.post("/trade/limit-buy", (req, res) => {
    const { stockId, quantity, price } = req.body;
    const userId = loggedInUserId;
    const totalCost = quantity * price;

    // 예수금 확인
    const balanceQuery = "SELECT balance FROM User WHERE user_id = ?";
    sql_connection.query(balanceQuery, [userId], (err, userResults) => {
        if (err) throw err;

        const userBalance = userResults[0].balance;
        if (totalCost > userBalance) {
            return res.send("<script>alert('예수금이 부족하여 주문을 넣을 수 없습니다.'); window.location.href = '/stock/" + stockId + "/orderbook';</script>");
        }

        // 예수금 충분한 경우 매수 주문 추가
        const updateBalanceQuery = "UPDATE User SET balance = balance - ? WHERE user_id = ?";
        sql_connection.query(updateBalanceQuery, [totalCost, userId], (err) => {
            if (err) throw err;

            const buyOrderQuery = `
                INSERT INTO Orders (user_id, stock_id, order_type, order_category, order_price, order_quantity, order_date)
                VALUES (?, ?, 1, 2, ?, ?, NOW())
            `;
            sql_connection.query(buyOrderQuery, [userId, stockId, price, quantity], (err, buyOrderResult) => {
                if (err) throw err;

                let remainingQuantity = quantity;
                let lastTradePrice = price;
                let tradeOccurred = false;
                let refundAmount = 0; // 차액 환불 금액

                const matchingSellOrdersQuery = `
                    SELECT * FROM Orders 
                    WHERE stock_id = ? AND order_type = 2 AND order_price <= ? 
                    ORDER BY order_price ASC, order_date ASC
                `;
                
                sql_connection.query(matchingSellOrdersQuery, [stockId, price], (err, sellOrders) => {
                    if (err) throw err;

                    sellOrders.forEach(sellOrder => {
                        if (remainingQuantity > 0) {
                            const tradeQuantity = Math.min(remainingQuantity, sellOrder.order_quantity);
                            lastTradePrice = sellOrder.order_price;
                            tradeOccurred = true;

                            const sellUserId = sellOrder.user_id;
                            const creditAmount = tradeQuantity * lastTradePrice;
                            const creditBalanceQuery = "UPDATE User SET balance = balance + ? WHERE user_id = ?";
                            sql_connection.query(creditBalanceQuery, [creditAmount, sellUserId], (err) => {
                                if (err) throw err;
                            });

                            // 주문 가격과 실제 거래 가격 간 차이 계산 후 환불
                            refundAmount += (price - lastTradePrice) * tradeQuantity;

                            // 거래 내역 추가
                            const transactionQuery = `
                                INSERT INTO Transaction (user_id, stock_id, transaction_type, transaction_price, transaction_quantity, transaction_date)
                                VALUES (?, ?, ?, ?, ?, NOW()), (?, ?, ?, ?, ?, NOW())
                            `;
                            sql_connection.query(transactionQuery, [
                                userId, stockId, 1, lastTradePrice, tradeQuantity,
                                sellOrder.user_id, stockId, 2, lastTradePrice, tradeQuantity
                            ], (err) => {
                                if (err) throw err;
                            });

                            remainingQuantity -= tradeQuantity;
                            const updatedSellQuantity = sellOrder.order_quantity - tradeQuantity;

                            if (updatedSellQuantity === 0) {
                                const deleteOrderQuery = "DELETE FROM Orders WHERE order_id = ?";
                                sql_connection.query(deleteOrderQuery, [sellOrder.order_id], (err) => {
                                    if (err) throw err;
                                });
                            } else {
                                const updateOrderQuery = "UPDATE Orders SET order_quantity = ? WHERE order_id = ?";
                                sql_connection.query(updateOrderQuery, [updatedSellQuantity, sellOrder.order_id], (err) => {
                                    if (err) throw err;
                                });
                            }

                            // **User_Holdings 업데이트**
                            const holdingsQuery = `
                                INSERT INTO User_Holdings (user_id, stock_id, average_price, quantity)
                                VALUES (?, ?, ?, ?)
                                ON DUPLICATE KEY UPDATE 
                                    average_price = ((average_price * quantity) + (? * ?)) / (quantity + ?),
                                    quantity = quantity + VALUES(quantity)
                                    
                            `;
                            sql_connection.query(holdingsQuery, [
                                userId, stockId, lastTradePrice, tradeQuantity, 
                                lastTradePrice, tradeQuantity, tradeQuantity
                            ], (err) => {
                                if (err) throw err;
                            });
                        }
                    });

                    if (remainingQuantity > 0) {
                        const updateBuyOrderQuery = "UPDATE Orders SET order_quantity = ? WHERE order_id = ?";
                        sql_connection.query(updateBuyOrderQuery, [remainingQuantity, buyOrderResult.insertId], (err) => {
                            if (err) throw err;
                        });
                    } else {
                        const deleteBuyOrderQuery = "DELETE FROM Orders WHERE order_id = ?";
                        sql_connection.query(deleteBuyOrderQuery, [buyOrderResult.insertId], (err) => {
                            if (err) throw err;
                        });
                    }

                    // **조건부 현재가 업데이트**: 거래 발생 시에만 현재가 업데이트
                    if (tradeOccurred) {
                        const updateCurrentPriceQuery = "UPDATE Stock SET current_price = ? WHERE stock_id = ?";
                        sql_connection.query(updateCurrentPriceQuery, [lastTradePrice, stockId], (err) => {
                            if (err) throw err;

                            // **예수금 환불**
                            if (refundAmount > 0) {
                                const refundBalanceQuery = "UPDATE User SET balance = balance + ? WHERE user_id = ?";
                                sql_connection.query(refundBalanceQuery, [refundAmount, userId], (err) => {
                                    if (err) throw err;
                                    res.redirect(`/stock/${stockId}/orderbook`);
                                });
                            } else {
                                res.redirect(`/stock/${stockId}/orderbook`);
                            }
                        });
                    } else {
                        res.redirect(`/stock/${stockId}/orderbook`);
                    }
                });
            });
        });
    });
});

// 매도 지정가 주문 체결 로직에 User_Holdings 업데이트 추가
app.post("/trade/limit-sell", (req, res) => {
    const { stockId, quantity, price } = req.body;
    const userId = loggedInUserId;

    // 현재 사용자의 거래 가능 수량 확인
    const holdingQuery = `
        SELECT User_Holdings.quantity AS total_quantity, 
               User_Holdings.quantity - IFNULL(SUM(Orders.order_quantity), 0) AS tradable_quantity
        FROM User_Holdings 
        LEFT JOIN Orders ON User_Holdings.stock_id = Orders.stock_id 
                         AND Orders.user_id = User_Holdings.user_id 
                         AND Orders.order_type = 2 
        WHERE User_Holdings.user_id = ? AND User_Holdings.stock_id = ? 
        GROUP BY User_Holdings.quantity
    `;
    
    sql_connection.query(holdingQuery, [userId, stockId], (err, holdingResults) => {
        if (err) throw err;

        const tradableQuantity = parseInt(holdingResults[0]?.tradable_quantity || 0, 10);
        const orderQuantity = parseInt(quantity, 10);

        if (orderQuantity > tradableQuantity) {
            return res.send(`<script>alert('거래 가능 수량이 부족합니다. 주문 수량: ${orderQuantity}, 거래 가능 수량: ${tradableQuantity}'); window.location.href = '/stock/${stockId}/orderbook';</script>`);
        }

        // 매도 주문 추가
        const sellOrderQuery = `
            INSERT INTO Orders (user_id, stock_id, order_type, order_category, order_price, order_quantity, order_date)
            VALUES (?, ?, 2, 2, ?, ?, NOW())
        `;
        sql_connection.query(sellOrderQuery, [userId, stockId, price, quantity], (err, sellOrderResult) => {
            if (err) throw err;

            let remainingQuantity = quantity;
            let lastTradePrice = price;
            let tradeOccurred = false; // 거래 발생 여부
            let totalCredit = 0; // 체결 후 충전될 예수금

            // 매도 주문과 맞출 매수 주문 조회 (가격 높은 순, 오래된 순)
            const matchingBuyOrdersQuery = `
                SELECT * FROM Orders 
                WHERE stock_id = ? AND order_type = 1 AND order_price >= ? 
                ORDER BY order_price DESC, order_date ASC
            `;
            sql_connection.query(matchingBuyOrdersQuery, [stockId, price], (err, buyOrders) => {
                if (err) throw err;

                buyOrders.forEach(buyOrder => {
                    if (remainingQuantity > 0) {
                        const tradeQuantity = Math.min(remainingQuantity, buyOrder.order_quantity);
                        lastTradePrice = buyOrder.order_price;
                        tradeOccurred = true;

                        // 예수금에 충전할 금액 계산 (체결된 수량 * 체결된 가격)
                        totalCredit += tradeQuantity * lastTradePrice;

                        // 거래 내역 추가
                        const transactionQuery = `
                            INSERT INTO Transaction (user_id, stock_id, transaction_type, transaction_price, transaction_quantity, transaction_date)
                            VALUES (?, ?, ?, ?, ?, NOW()), (?, ?, ?, ?, ?, NOW())
                        `;
                        sql_connection.query(transactionQuery, [
                            buyOrder.user_id, stockId, 1, lastTradePrice, tradeQuantity,
                            userId, stockId, 2, lastTradePrice, tradeQuantity
                        ], (err) => {
                            if (err) throw err;
                        });

                        remainingQuantity -= tradeQuantity;
                        const updatedBuyQuantity = buyOrder.order_quantity - tradeQuantity;

                        if (updatedBuyQuantity === 0) {
                            const deleteOrderQuery = "DELETE FROM Orders WHERE order_id = ?";
                            sql_connection.query(deleteOrderQuery, [buyOrder.order_id], (err) => {
                                if (err) throw err;
                            });
                        } else {
                            const updateOrderQuery = "UPDATE Orders SET order_quantity = ? WHERE order_id = ?";
                            sql_connection.query(updateOrderQuery, [updatedBuyQuantity, buyOrder.order_id], (err) => {
                                if (err) throw err;
                            });
                        }

                        // **User_Holdings 업데이트 (매수자)**
                        const holdingsQuery = `
                            INSERT INTO User_Holdings (user_id, stock_id, average_price, quantity)
                            VALUES (?, ?, ?, ?)
                            ON DUPLICATE KEY UPDATE 
                                average_price = ((average_price * quantity) + (? * ?)) / (quantity + ?),
                                quantity = quantity + VALUES(quantity)                               
                        `;
                        sql_connection.query(holdingsQuery, [
                            buyOrder.user_id, stockId, lastTradePrice, tradeQuantity,
                            lastTradePrice, tradeQuantity, tradeQuantity
                        ], (err) => {
                            if (err) throw err;
                        });

                        // **User_Holdings 업데이트 (매도자)**
                        const updateSellerHoldingsQuery = `
                            UPDATE User_Holdings 
                            SET quantity = quantity - ? 
                            WHERE user_id = ? AND stock_id = ?
                        `;
                        sql_connection.query(updateSellerHoldingsQuery, [
                            tradeQuantity, userId, stockId
                        ], (err) => {
                            if (err) throw err;
                        });
                    }
                });

                if (remainingQuantity > 0) {
                    const updateSellOrderQuery = "UPDATE Orders SET order_quantity = ? WHERE order_id = ?";
                    sql_connection.query(updateSellOrderQuery, [remainingQuantity, sellOrderResult.insertId], (err) => {
                        if (err) throw err;
                    });
                } else {
                    const deleteSellOrderQuery = "DELETE FROM Orders WHERE order_id = ?";
                    sql_connection.query(deleteSellOrderQuery, [sellOrderResult.insertId], (err) => {
                        if (err) throw err;
                    });
                }

                // 조건부 현재가 업데이트: 거래 발생 시에만 현재가 업데이트
                if (tradeOccurred) {
                    const updateCurrentPriceQuery = "UPDATE Stock SET current_price = ? WHERE stock_id = ?";
                    sql_connection.query(updateCurrentPriceQuery, [lastTradePrice, stockId], (err) => {
                        if (err) throw err;
                    });
                }

                // **예수금 업데이트**: 체결 후 충전할 금액만큼 예수금 추가
                if (totalCredit > 0) {
                    const updateBalanceQuery = "UPDATE User SET balance = balance + ? WHERE user_id = ?";
                    sql_connection.query(updateBalanceQuery, [totalCredit, userId], (err) => {
                        if (err) throw err;
                        res.redirect(`/stock/${stockId}/orderbook`);
                    });
                } else {
                    res.redirect(`/stock/${stockId}/orderbook`);
                }
            });
        });
    });
});



app.listen(3000, () => {
    console.log('서버 실행 중');
});