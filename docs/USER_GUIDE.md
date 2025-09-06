# Redis Clone JS - User Guide

## Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/Expoooky/redis-clone-js.git
cd redis-clone-js

# Install dependencies
npm install

# Start the server
npm start
```

The server will start on port 6379 by default and you should see:
```
🚀 Redis-Clone-JS server is ready!
📡 Server listening on port 6379
```

### Basic Usage

#### Using the CLI

Start the interactive CLI:
```bash
npm run cli
```

Or run commands directly:
```bash
npm run cli -- SET mykey "Hello World"
npm run cli -- GET mykey
```

#### Connecting with Redis Clients

You can connect using any Redis-compatible client:

**Node.js:**
```javascript
const redis = require('redis');
const client = redis.createClient({
  host: 'localhost',
  port: 6379
});

client.set('mykey', 'Hello World');
client.get('mykey', (err, result) => {
  console.log(result); // "Hello World"
});
```

**Python:**
```python
import redis

r = redis.Redis(host='localhost', port=6379, decode_responses=True)
r.set('mykey', 'Hello World')
print(r.get('mykey'))  # Hello World
```

**curl (HTTP interface):**
```bash
curl -X POST http://localhost:6379/command \
  -H "Content-Type: application/json" \
  -d '{"command": "SET", "args": ["mykey", "Hello World"]}'
```

## Core Concepts

### Data Types

Redis Clone JS supports all major Redis data types:

#### Strings
Store and manipulate string values:
```bash
SET user:1:name "John Doe"
GET user:1:name
INCR counter
APPEND message " World"
```

#### Lists
Ordered collections of strings:
```bash
LPUSH mylist "item1"
RPUSH mylist "item2"
LRANGE mylist 0 -1
LPOP mylist
```

#### Sets
Unordered collections of unique strings:
```bash
SADD myset "member1"
SADD myset "member2"
SMEMBERS myset
SINTER set1 set2
```

#### Hashes
Field-value pairs (like objects):
```bash
HSET user:1 name "John" age "30"
HGET user:1 name
HGETALL user:1
```

#### Sorted Sets
Sets with scores for ordering:
```bash
ZADD leaderboard 100 "player1"
ZADD leaderboard 200 "player2"
ZRANGE leaderboard 0 -1 WITHSCORES
```

### Key Management

#### Expiration
Set keys to expire automatically:
```bash
SET session:abc123 "user_data"
EXPIRE session:abc123 3600  # Expires in 1 hour
TTL session:abc123          # Check remaining time
```

#### Pattern Matching
Find keys using patterns:
```bash
KEYS user:*        # All keys starting with "user:"
KEYS *:email       # All keys ending with ":email"
KEYS user:?:name   # user:1:name, user:2:name, etc.
```

## Common Use Cases

### 1. Caching

Use Redis Clone JS as a cache layer:

```javascript
// Check cache first
const cachedData = await client.get('user:123');
if (cachedData) {
  return JSON.parse(cachedData);
}

// Cache miss - fetch from database
const userData = await database.getUser(123);
await client.setex('user:123', 3600, JSON.stringify(userData));
return userData;
```

### 2. Session Storage

Store user sessions:

```javascript
// Store session
await client.hset('session:abc123', {
  userId: '123',
  username: 'john_doe',
  loginTime: Date.now()
});
await client.expire('session:abc123', 86400); // 24 hours

// Retrieve session
const session = await client.hgetall('session:abc123');
```

### 3. Real-time Analytics

Track events and metrics:

```javascript
// Increment counters
await client.incr('page_views:today');
await client.incr('unique_visitors:today');
await client.hincrby('page_views_by_hour', currentHour, 1);

// Store recent events
await client.lpush('recent_events', JSON.stringify(event));
await client.ltrim('recent_events', 0, 99); // Keep last 100
```

### 4. Queue Management

Implement simple queues:

```javascript
// Producer
await client.lpush('job_queue', JSON.stringify({
  type: 'email',
  recipient: 'user@example.com',
  data: { ... }
}));

// Consumer
const job = await client.brpop('job_queue', 0);
if (job) {
  const jobData = JSON.parse(job[1]);
  await processJob(jobData);
}
```

### 5. Rate Limiting

Implement rate limiting:

```javascript
const key = `rate_limit:${userId}:${action}`;
const count = await client.incr(key);

if (count === 1) {
  await client.expire(key, 3600); // 1 hour window
}

if (count > 100) {
  throw new Error('Rate limit exceeded');
}
```

## Configuration

### Server Configuration

Create a `config.yml` file:

```yaml
server:
  port: 6379
  host: "0.0.0.0"
  maxConnections: 10000

memory:
  maxMemory: "1gb"
  policy: "allkeys-lru"

persistence:
  enabled: true
  interval: 900  # 15 minutes
  directory: "./data"

security:
  auth:
    enabled: false
    password: ""
  tls:
    enabled: false
    cert: "./certs/server.crt"
    key: "./certs/server.key"

logging:
  level: "info"
  file: "./logs/redis-clone.log"
```

### Environment Variables

Override configuration with environment variables:

```bash
export REDIS_PORT=6380
export REDIS_MAX_MEMORY=2gb
export REDIS_AUTH_PASSWORD=mysecretpassword
npm start
```

### Command Line Options

```bash
node server.js --port 6380 --max-memory 2gb --auth-password secret
```

## Performance Optimization

### Memory Management

1. **Set appropriate max memory**:
   ```yaml
   memory:
     maxMemory: "1gb"
     policy: "allkeys-lru"  # Evict least recently used keys
   ```

2. **Use efficient data types**:
   - Use hashes for objects instead of multiple string keys
   - Use sets for unique collections
   - Use sorted sets for ranked data

3. **Set expiration on temporary data**:
   ```bash
   SETEX cache_key 3600 "cached_data"  # Expires in 1 hour
   ```

### Network Optimization

1. **Use pipelining for bulk operations**:
   ```javascript
   const pipeline = client.pipeline();
   for (let i = 0; i < 1000; i++) {
     pipeline.set(`key_${i}`, `value_${i}`);
   }
   await pipeline.exec();
   ```

2. **Batch related operations**:
   ```javascript
   // Instead of multiple HSET calls
   await client.hmset('user:123', {
     name: 'John',
     email: 'john@example.com',
     age: '30'
   });
   ```

### Data Structure Optimization

1. **Use appropriate data types**:
   ```bash
   # For counters
   INCR page_views
   
   # For unique visitors
   SADD unique_visitors:today user123
   
   # For leaderboards
   ZADD leaderboard 1000 player1
   ```

2. **Optimize list operations**:
   ```bash
   # Use LPUSH/RPOP for FIFO queue
   # Use LPUSH/LPOP for LIFO stack
   ```

## Monitoring and Debugging

### Built-in Monitoring

1. **Check server info**:
   ```bash
   INFO
   INFO memory
   INFO stats
   ```

2. **Monitor commands**:
   ```bash
   MONITOR  # Real-time command monitoring
   ```

3. **Check slow queries**:
   ```bash
   SLOWLOG GET 10  # Get last 10 slow queries
   ```

### Performance Metrics

Access metrics via the built-in dashboard:
```
http://localhost:6379/metrics
```

Key metrics to monitor:
- Operations per second
- Memory usage
- Connection count
- Cache hit rate
- Average response time

### Debugging Commands

1. **Check key information**:
   ```bash
   TYPE mykey
   TTL mykey
   MEMORY USAGE mykey
   ```

2. **Analyze memory usage**:
   ```bash
   MEMORY STATS
   MEMORY DOCTOR
   ```

3. **Debug client connections**:
   ```bash
   CLIENT LIST
   CLIENT INFO
   ```

## Security Best Practices

### Authentication

1. **Enable password authentication**:
   ```yaml
   security:
     auth:
       enabled: true
       password: "strong_password_here"
   ```

2. **Use ACL for fine-grained control**:
   ```bash
   ACL SETUSER alice +@read ~user:* on >password
   ACL SETUSER bob +@write ~temp:* on >password
   ```

### Network Security

1. **Bind to specific interfaces**:
   ```yaml
   server:
     host: "127.0.0.1"  # Localhost only
   ```

2. **Enable TLS encryption**:
   ```yaml
   security:
     tls:
       enabled: true
       cert: "./certs/server.crt"
       key: "./certs/server.key"
   ```

3. **Use firewall rules**:
   ```bash
   # Allow only specific IPs
   iptables -A INPUT -p tcp --dport 6379 -s 192.168.1.0/24 -j ACCEPT
   iptables -A INPUT -p tcp --dport 6379 -j DROP
   ```

### Data Protection

1. **Regular backups**:
   ```bash
   # Manual backup
   BGSAVE
   
   # Automated backups
   crontab -e
   0 2 * * * /usr/local/bin/redis-cli BGSAVE
   ```

2. **Enable persistence**:
   ```yaml
   persistence:
     enabled: true
     interval: 900  # Save every 15 minutes
   ```

## Troubleshooting

### Common Issues

1. **High memory usage**:
   - Check for large keys: `MEMORY USAGE keyname`
   - Review expiration policies
   - Consider data structure optimization

2. **Slow performance**:
   - Monitor slow log: `SLOWLOG GET`
   - Check memory fragmentation
   - Review command patterns

3. **Connection issues**:
   - Verify firewall settings
   - Check connection limits
   - Review authentication settings

4. **Data loss**:
   - Verify persistence settings
   - Check disk space
   - Review backup procedures

### Debugging Steps

1. **Check server status**:
   ```bash
   INFO server
   PING
   ```

2. **Monitor real-time activity**:
   ```bash
   MONITOR
   ```

3. **Check logs**:
   ```bash
   tail -f logs/redis-clone.log
   ```

4. **Analyze configuration**:
   ```bash
   CONFIG GET "*"
   ```

### Getting Help

- **Documentation**: Check the `/docs` directory
- **Issues**: Report bugs on GitHub
- **Community**: Join our Discord server
- **Email**: support@redis-clone-js.com

## Migration from Redis

### Compatibility

Redis Clone JS is designed to be drop-in compatible with Redis. Most applications should work without modification.

### Migration Steps

1. **Backup existing data**:
   ```bash
   redis-cli --rdb backup.rdb
   ```

2. **Start Redis Clone JS**:
   ```bash
   npm start
   ```

3. **Import data** (if needed):
   ```bash
   # Use redis-cli with Redis Clone JS
   redis-cli -h localhost -p 6379 --rdb backup.rdb
   ```

4. **Update connection strings**:
   ```javascript
   // No changes needed if using same host/port
   const client = redis.createClient({
     host: 'localhost',
     port: 6379
   });
   ```

### Compatibility Notes

- All core Redis commands are supported
- Pub/Sub functionality is available
- Lua scripting is supported
- Clustering features are available
- Some advanced modules may not be available

## Advanced Features

### Clustering

Enable clustering for horizontal scaling:

```yaml
cluster:
  enabled: true
  nodes:
    - host: "10.0.0.1"
      port: 6379
    - host: "10.0.0.2"
      port: 6379
    - host: "10.0.0.3"
      port: 6379
```

### Pub/Sub

Real-time messaging:

```javascript
// Publisher
await client.publish('news', 'Breaking news!');

// Subscriber
client.subscribe('news');
client.on('message', (channel, message) => {
  console.log(`Received: ${message} on ${channel}`);
});
```

### Lua Scripting

Execute atomic operations:

```javascript
const script = `
  local current = redis.call('GET', KEYS[1])
  if current == false then
    redis.call('SET', KEYS[1], ARGV[1])
    return 1
  else
    return 0
  end
`;

const result = await client.eval(script, 1, 'mykey', 'myvalue');
```

This user guide provides comprehensive information for getting started and using Redis Clone JS effectively. For more detailed technical information, refer to the API documentation and architecture guide.
