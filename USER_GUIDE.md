# Redis-like Data Store - User Guide

A comprehensive, Redis-compatible data store built in Node.js with RESP protocol support, rich data structures, persistence, replication, and monitoring.

## Quick Start

### Prerequisites
- Node.js 18 or higher
- Optional: Configure environment variables (see Configuration section)

### Installation
```bash
git clone <your-repo-url>
cd redis-like-project
npm install
```

### Start the Server
```bash
npm start
```
Server starts on `127.0.0.1:6379` by default.

### Use the CLI Client
```bash
# Interactive mode
npm run cli

# One-off commands
npm run cli -- --eval "SET name John"
npm run cli -- --eval "GET name"
```

## Configuration

Create a `.env` file in the project root:

```env
# Server
REDISJS_PORT=6379
REDISJS_PASSWORD=your_password

# Monitoring Dashboard
REDISJS_MONITOR_PORT=8128

# TLS (optional)
REDISJS_TLS_PORT=6380
REDISJS_TLS_KEY_FILE=./certs/key.pem
REDISJS_TLS_CERT_FILE=./certs/cert.pem
REDISJS_TLS_CA_CERT_FILE=./certs/ca.pem

# Persistence
REDISJS_AOF_FILE=./data/aof.log
REDISJS_SNAPSHOT_FILE=./data/dump.json

# Keyspace Notifications
REDISJS_NOTIFY_KEYSPACE_EVENTS=KEA
```

## Core Key-Value Operations

### Basic Operations
```bash
# Set and get values
SET user:1000 "John Doe"
GET user:1000

# Check existence and delete
EXISTS user:1000
DEL user:1000

# Multiple operations
DEL key1 key2 key3
EXISTS key1 key2 key3
```

### Expiration
```bash
# Set with expiration (seconds)
SET session:abc "active" EX 3600

# Check TTL
TTL session:abc

# Remove expiration
PERSIST session:abc

# Set expiration separately
EXPIRE user:1000 86400
```

## String Operations

```bash
# Basic string operations
SET counter "100"
GET counter
APPEND counter "200"
STRLEN counter

# Numeric operations
INCR counter
DECR counter
INCRBY counter 10
DECRBY counter 5

# Substring operations
SETRANGE message 6 "world"
GETRANGE message 0 4
```

## JSON Operations

```bash
# Set JSON document
JSON.SET user:1000 . '{"name":"John","age":30,"city":"NYC"}'

# Get entire document
JSON.GET user:1000

# Get specific fields
JSON.GET user:1000 .name
JSON.GET user:1000 .age

# Array operations
JSON.ARRAPPEND user:1000 .hobbies '"reading"'
JSON.ARRLEN user:1000 .hobbies

# Delete fields
JSON.DEL user:1000 .age
```

## List Operations

```bash
# Create and populate list
LPUSH mylist "world"
LPUSH mylist "hello"
RPUSH mylist "!"

# Get elements
LRANGE mylist 0 -1
LINDEX mylist 1

# Modify list
LSET mylist 1 "there"

# Remove elements
LPOP mylist
RPOP mylist
```

## Set Operations

```bash
# Add members
SADD fruits "apple" "banana" "orange"

# Check membership
SISMEMBER fruits "apple"
SISMEMBER fruits "grape"

# Get all members
SMEMBERS fruits

# Set operations
SADD vegetables "carrot" "broccoli"
SUNION fruits vegetables
SINTER fruits vegetables
SDIFF fruits vegetables

# Remove members
SREM fruits "banana"
```

## Hash Operations

```bash
# Set hash fields
HSET user:1000 name "John" age "30" city "NYC"

# Get fields
HGET user:1000 name
HGETALL user:1000

# Multiple field operations
HMSET user:1001 name "Jane" age "25"
HDEL user:1000 age

# Check existence
HEXISTS user:1000 city
```

## Sorted Set Operations

```bash
# Add members with scores
ZADD leaderboard 100 "player1" 150 "player2" 75 "player3"

# Get ranges
ZRANGE leaderboard 0 -1
ZRANGE leaderboard 0 2 WITHSCORES

# Score-based queries
ZRANGEBYSCORE leaderboard 80 200

# Get ranks
ZRANK leaderboard "player2"

# Remove members
ZREM leaderboard "player1"
```

## Stream Operations

```bash
# Add events to stream
XADD events * sensor_id "temp1" temperature "23.5"
XADD events * sensor_id "temp2" temperature "24.1"

# Read stream
XRANGE events - +
XLEN events

# Consumer groups
XGROUP CREATE events mygroup $
XREADGROUP GROUP mygroup consumer1 COUNT 1 STREAMS events >

# Acknowledge processing
XACK events mygroup 1640995200000-0
```

## Geospatial Operations

```bash
# Add locations
GEOADD cities 13.361389 38.115556 "Palermo" 15.087269 37.502669 "Catania"

# Calculate distances
GEODIST cities Palermo Catania
GEODIST cities Palermo Catania km
GEODIST cities Palermo Catania mi

# Search by radius
GEORADIUS cities 15 37 100 km
GEORADIUSBYMEMBER cities Palermo 50 km

# Get geohash
GEOHASH cities Palermo Catania

# Search with options
GEOSEARCH cities FROMLONLAT 15 37 BYRADIUS 200 km ASC
```

## Bitmap Operations

```bash
# Set bits
SETBIT user:1000:login_days 0 1
SETBIT user:1000:login_days 1 1
SETBIT user:1000:login_days 30 1

# Get bits
GETBIT user:1000:login_days 0
GETBIT user:1000:login_days 15

# Count bits
BITCOUNT user:1000:login_days

# Bitwise operations
BITOP OR result_days user:1000:login_days user:1001:login_days
```

## Bitfield Operations

```bash
# Create bitfield with counters
BITFIELD user:1000:counters SET u8 0 5 SET u16 8 1000 INCRBY u8 0 1

# Get values
BITFIELD user:1000:counters GET u8 0 GET u16 8

# Increment with overflow control
BITFIELD user:1000:counters OVERFLOW SAT INCRBY u8 0 100
```

## HyperLogLog Operations

```bash
# Add elements
PFADD visitors:2024-01 "user1" "user2" "user3"

# Count unique elements
PFCOUNT visitors:2024-01

# Merge multiple HLLs
PFMERGE visitors:2024 visitors:2024-01 visitors:2024-02
PFCOUNT visitors:2024
```

## Time Series Operations

```bash
# Create time series
TS.CREATE temperature:sensor1

# Add data points
TS.ADD temperature:sensor1 1640995200 23.5
TS.ADD temperature:sensor1 1640995260 24.1
TS.ADD temperature:sensor1 1640995320 23.8

# Get latest value
TS.GET temperature:sensor1

# Query range
TS.RANGE temperature:sensor1 1640995200 1640995320
```

## Document Database Operations

```bash
# First, store JSON document
JSON.SET doc:1 . '{"title":"Hello World","author":"John","tags":["tech","blog"]}'

# Create document index
DOC.INDEXCREATE articles PREFIX doc: SCHEMA title TEXT author TEXT tags TAG

# Add document to index
DOC.INDEXADD articles doc:1

# Search documents
DOC.SEARCH articles "@title:(Hello) @tags:{tech}"
```

## Vector Database Operations

```bash
# Create vector index
VEC.CREATEINDEX products DIMENSION 128 DISTANCE_METRIC COSINE

# Add vectors
VEC.ADD products "prod1" "0.1,0.2,0.3,..."

# Search similar vectors
VEC.SEARCH products "0.15,0.25,0.35,..." K 5
```

## Transactions

```bash
# Start transaction
MULTI

# Queue commands
SET balance:1000 1000
INCR balance:1000
GET balance:1000

# Execute atomically
EXEC

# Or discard
DISCARD
```

## Pub/Sub

```bash
# In one client - subscribe
SUBSCRIBE news sports

# In another client - publish
PUBLISH news "Breaking news!"
PUBLISH sports "Game started!"
```

## Keyspace Operations

```bash
# Select database
SELECT 1

# Clear current database
FLUSHDB

# Get random key
RANDOMKEY

# Count keys
DBSIZE

# Pattern matching
KEYS user:*
```

## Persistence

### AOF (Append Only File)
- Automatically logs all write operations
- Configured via `REDISJS_AOF_FILE`
- Replayed on server restart

### Snapshots
```bash
# Manual snapshot
SAVE

# Background snapshot
BGSAVE
```

## Replication

### Master-Slave Setup
```bash
# On slave server
REPLICAOF 127.0.0.1 6379

# Stop replication
REPLICAOF NO ONE
```

## Security

### Authentication
```bash
# Set password
AUTH mypassword

# Check if authenticated
PING
```

### ACL (Access Control Lists)
```bash
# List users
ACL USERS

# Get user info
ACL GETUSER default

# Create user
ACL SETUSER newuser +SET +GET ~keys:* >password

# Delete user
ACL DELUSER newuser
```

## Monitoring

### Server Information
```bash
INFO
INFO server
INFO clients
INFO memory
INFO persistence
INFO stats
INFO replication
INFO cpu
INFO cluster
INFO modules
INFO keyspace
INFO modules
```

### Slow Log
```bash
# Get slow log entries
SLOWLOG GET
SLOWLOG GET 10

# Get slow log length
SLOWLOG LEN

# Reset slow log
SLOWLOG RESET
```

### Web Dashboard
```bash
# Enable monitoring
export REDISJS_MONITOR_PORT=8128
npm start

# Open in browser
# http://127.0.0.1:8128
```

## Client-side Caching

```bash
# Enable tracking
CLIENT TRACKING on

# Control caching
CLIENT CACHING yes
CLIENT CACHING no

# Broadcast mode
CLIENT TRACKING on BCAST
```

## Pipelining

Send multiple commands without waiting for responses:

```bash
# Pipeline example
SET key1 value1
SET key2 value2
GET key1
GET key2
INCR counter
```

## Keyspace Notifications

```bash
# Subscribe to key events
PSUBSCRIBE __keyspace@0__:user:*

# Events: set, expired, del, etc.
```

## Testing

### Run All Tests
```bash
npm run test:all
```

### Run Specific Test Suites
```bash
node --test test/core_kv.test.js
node --test test/strings.test.js
node --test test/lists.test.js
```

## Error Handling

### Common Errors
- `ERR wrong number of arguments for 'command' command`
- `ERR unknown command 'command'`
- `WRONGTYPE Operation against a key holding the wrong kind of value`
- `ERR value is not an integer or out of range`

### Best Practices
- Always check return values
- Use appropriate data types
- Handle connection errors gracefully
- Use transactions for atomic operations
- Monitor slow queries with SLOWLOG

## Performance Tips

- Use pipelining for multiple operations
- Enable client-side caching when appropriate
- Monitor memory usage with INFO command
- Use appropriate data structures for your use case
- Consider key expiration for temporary data
- Use connection pooling for high-throughput applications

## Troubleshooting

### Connection Issues
- Check server port and host
- Verify authentication if enabled
- Check firewall settings

### Memory Issues
- Use INFO memory to check usage
- Consider key expiration policies
- Monitor for memory leaks

### Performance Issues
- Use SLOWLOG to identify slow commands
- Consider data structure optimization
- Monitor client connections

For more detailed protocol information, see `PROTOCOL.md`.

