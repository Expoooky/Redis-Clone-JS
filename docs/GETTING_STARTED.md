# Getting Started with Redis Clone JS

## Quick Start (5 minutes)

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/Expoooky/redis-clone-js.git
cd redis-clone-js

# Install dependencies
npm install
```

### 2. Start the Server

```bash
npm start
```

You should see:
```
🚀 Redis-Clone-JS server is ready!
📡 Server listening on port 6379
```

### 3. Test with CLI

Open a new terminal:
```bash
npm run cli
```

Try these commands:
```bash
redis-clone-js> SET hello "Hello, World!"
OK
redis-clone-js> GET hello
"Hello, World!"
redis-clone-js> INCR counter
1
redis-clone-js> INCR counter
2
```

## What You've Accomplished

✅ **Installed** Redis Clone JS  
✅ **Started** the server  
✅ **Connected** with the CLI  
✅ **Executed** your first commands  

## Next Steps

### Try Different Data Types

**Lists:**
```bash
LPUSH mylist "item1" "item2" "item3"
LRANGE mylist 0 -1
```

**Sets:**
```bash
SADD myset "member1" "member2"
SMEMBERS myset
```

**Hashes:**
```bash
HSET user:1 name "John" age "30"
HGETALL user:1
```

### Connect from Your Application

**Node.js:**
```javascript
const redis = require('redis');
const client = redis.createClient({ port: 6379 });

await client.set('mykey', 'Hello from Node.js!');
const value = await client.get('mykey');
console.log(value); // "Hello from Node.js!"
```

**Python:**
```python
import redis
r = redis.Redis(host='localhost', port=6379, decode_responses=True)
r.set('mykey', 'Hello from Python!')
print(r.get('mykey'))  # Hello from Python!
```

### Performance Testing

```bash
# Run unit tests
npm run test:unit

# Run performance benchmarks  
npm run test:performance

# Check server info
npm run cli -- INFO
```

## Common Use Cases

### 1. Simple Cache
```javascript
// Store in cache with expiration
await client.setex('user:123', 3600, JSON.stringify(userData));

// Retrieve from cache
const cached = await client.get('user:123');
if (cached) return JSON.parse(cached);
```

### 2. Session Storage
```javascript
// Store session
await client.hset('session:abc123', {
  userId: '123',
  username: 'john_doe'
});

// Set expiration
await client.expire('session:abc123', 86400); // 24 hours
```

### 3. Real-time Counters
```javascript
// Increment page views
await client.incr('page_views');

// Increment by custom amount
await client.incrby('downloads', 5);
```

## Configuration

Create `config/production.yml`:
```yaml
server:
  port: 6379
  maxConnections: 1000

memory:
  maxMemory: "512mb"
  policy: "allkeys-lru"

logging:
  level: "info"
  file: "./logs/redis.log"
```

## Monitoring

Access the built-in dashboard:
```
http://localhost:6379/dashboard
```

Or use CLI commands:
```bash
INFO stats
MEMORY USAGE mykey
SLOWLOG GET 10
```

## Production Deployment

### Docker
```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY . .
RUN npm install --production
EXPOSE 6379
CMD ["npm", "start"]
```

### Systemd Service
```ini
[Unit]
Description=Redis Clone JS
After=network.target

[Service]
Type=simple
User=redis
WorkingDirectory=/opt/redis-clone-js
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

## Need Help?

- 📖 [Full Documentation](./docs/)
- 🐛 [Report Issues](https://github.com/Expoooky/redis-clone-js/issues)
- 💬 [Community Discord](https://discord.gg/redis-clone-js)
- 📧 [Email Support](mailto:support@redis-clone-js.com)

## What's Next?

1. **Read the [User Guide](USER_GUIDE.md)** for detailed usage
2. **Check the [API Documentation](API.md)** for all commands
3. **Review [Architecture](ARCHITECTURE.md)** for system design
4. **Join our community** for questions and contributions

Welcome to Redis Clone JS! 🚀
