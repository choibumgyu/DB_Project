// models/redis.js
const Redis = require("ioredis");

const redis = new Redis({
  host: "127.0.0.1",
  port: 6379 // 기존 6379 → 변경
});

redis.on("connect", () => {
  console.log("✅ Redis 연결 성공");
});

redis.on("error", (err) => {
  console.error("❌ Redis 연결 실패:", err);
});

module.exports = redis;
