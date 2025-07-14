// redis.js
const Redis = require('ioredis');
const redis = new Redis(); // 기본: localhost:6379

module.exports = redis;
