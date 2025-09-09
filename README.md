Redis-like Data Store (Node.js)

High-compat, Redis-inspired server written in Node.js with RESP protocol, rich data structures, persistence, replication, monitoring UI, and a small client SDK.

Features

- Protocol: RESP (Simple Strings, Errors, Integers, Bulk Strings, Arrays)
- Core KV: SET, GET, DEL, EXISTS, APPEND, STRLEN, INCR/DECR/INCRBY/DECRBY, GETRANGE, SETRANGE
- Lists: LPUSH, RPUSH, LPOP, RPOP, LRANGE, LINDEX, LSET
- Sets: SADD, SREM, SISMEMBER, SMEMBERS, SINTER, SUNION, SDIFF
- Hashes: HSET, HGET, HMSET, HGETALL, HDEL, HEXISTS
- ZSets: ZADD, ZRANGE, ZRANGEBYSCORE, ZRANK, ZREM
- Streams: XADD, XRANGE, XLEN, XREAD, XGROUP, XREADGROUP, XACK
- Geo: GEOADD, GEOSEARCH, GEODIST, GEOPOS, GEOHASH
- Bitmaps/Bitfields: SETBIT, GETBIT, BITCOUNT, BITOP, BITFIELD (GET/SET/INCRBY)
- Probabilistic: HyperLogLog (PFADD, PFCOUNT, PFMERGE)
- TimeSeries: TS.CREATE, TS.ADD, TS.RANGE, TS.GET (+ rules/aggregation)
- Documents: Simple document index (DOC.INDEXCREATE/ADD/UPDATE/SEARCH/AGGREGATE)
- Vector DB: VEC.CREATEINDEX, VEC.ADD, VEC.SEARCH (+ arithmetic, dot)
- TTL & Keyspace: EXPIRE, TTL, PERSIST, SELECT, FLUSHDB, RANDOMKEY
- Pub/Sub: SUBSCRIBE, PUBLISH (incl. keyspace notifications)
- Transactions: MULTI, EXEC, DISCARD
- Replication: REPLICAOF / NO ONE, PSYNC/CONTINUE
- Persistence: Point-in-time snapshots (SAVE/BGSAVE); AOF (append-only log)
- Security: AUTH, ACL (subset), optional TLS
- Monitoring: INFO, SLOWLOG, optional web dashboard
- Client-side caching: CLIENT TRACKING (bcast/prefix)

Quickstart

1) Requirements: Node.js 18+

2) Start the server
```bash
npm start
```
Defaults to 127.0.0.1:6379. Configure via .env (see below).

3) Use the CLI
- One-off eval:
```bash
npm run cli -- --eval SET name John
npm run cli -- --eval GET name
```
- Interactive:
```bash
npm run cli
127.0.0.1:6379> SET name John
OK
127.0.0.1:6379> GET name
John
```

Client SDK (optional)

```js
const { RedisClient } = require('./src/client/sdk');

(async () => {
  const client = new RedisClient({ host: '127.0.0.1', port: 6379 });
  await client.connect();
  await client.set('k', 'v');
  console.log(await client.get('k')); // => 'v'
  await client.disconnect();
})();
```

Configuration (.env)

```env
REDISJS_PORT=6379
REDISJS_PASSWORD=
REDISJS_NOTIFY_KEYSPACE_EVENTS=KEA
REDISJS_MONITOR_PORT=8128
# TLS (optional)
# REDISJS_TLS_PORT=6380
# REDISJS_TLS_KEY_FILE=./certs/key.pem
# REDISJS_TLS_CERT_FILE=./certs/cert.pem
# REDISJS_TLS_CA_CERT_FILE=./certs/ca.pem
# Persistence
REDISJS_AOF_FILE=./data/aof.log
REDISJS_SNAPSHOT_FILE=./data/dump.json
```

Replication

```bash
# On the replica instance (while server is running):
REPLICAOF 127.0.0.1 6379
# Back to master:
REPLICAOF NO ONE
```

Monitoring Dashboard

Set a port and start the server:
```bash
export REDISJS_MONITOR_PORT=8128
npm start
```
Open: http://127.0.0.1:8128

Docs and Protocol

- User Guide: USER_GUIDE.md
- Protocol & commands: PROTOCOL.md

Testing

- Run all tests sequentially:
```bash
npm run test:all
```

Project Structure

```
src/
  core/        # RESP, datastore, data types
  server/      # TCP/TLS server, AOF, snapshots, ACL, monitor
  client/      # CLI and tiny SDK
test/          # Unit & integration tests
```

License

MIT (see LICENSE if present).