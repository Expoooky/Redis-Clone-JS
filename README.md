# Redis-Like In-Memory Data Store - AI Development Guide

## Project Overview

Build a comprehensive Redis-like in-memory data store in JavaScript that supports various data structures, persistence, replication, and advanced features. This project is designed for assessment testing with CLI interaction and should replicate Redis functionality while maintaining complete originality.

## 🚨 CRITICAL REQUIREMENTS

- **Language**: JavaScript (Node.js)
- **Entry Point**: Main server file acting as standalone application
- **Originality**: NO copying from existing Redis implementations
- **Testing**: CLI-based manual testing (no production use)
- **Protocol**: Redis-compatible RESP (Redis Serialization Protocol)

## 📁 Project Directory Structure

```
redis-clone-js/
├── README.md
├── package.json
├── .gitignore
├── server.js                     # Main application entry point
├── src/
│   ├── core/
│   │   ├── DataStore.js          # Core key-value store implementation
│   │   ├── KeyExpiration.js      # Key expiration management
│   │   └── Database.js           # Multi-database support
│   ├── data-structures/
│   │   ├── StringOps.js          # String operations
│   │   ├── JsonOps.js            # JSON document operations
│   │   ├── ListOps.js            # List operations
│   │   ├── SetOps.js             # Set operations
│   │   ├── HashOps.js            # Hash operations
│   │   ├── SortedSetOps.js       # Sorted set operations
│   │   ├── StreamOps.js          # Stream operations
│   │   ├── GeospatialOps.js      # Geospatial operations
│   │   ├── BitmapOps.js          # Bitmap operations
│   │   ├── BitfieldOps.js        # Bitfield operations
│   │   ├── HyperLogLog.js        # HyperLogLog implementation
│   │   ├── BloomFilter.js        # Bloom filter implementation
│   │   └── TimeSeries.js         # Time series data structure
│   ├── vector-db/
│   │   ├── VectorStore.js        # Vector storage and indexing
│   │   ├── SimilaritySearch.js   # K-NN and similarity algorithms
│   │   └── VectorOps.js          # Vector mathematical operations
│   ├── document-db/
│   │   ├── DocumentStore.js      # Document storage engine
│   │   ├── QueryEngine.js        # Document query language
│   │   ├── IndexManager.js       # Document indexing
│   │   └── AggregationEngine.js  # Aggregation framework
│   ├── server/
│   │   ├── Server.js             # Main server implementation
│   │   ├── RESPParser.js         # RESP protocol parser
│   │   ├── CommandRouter.js      # Command routing and execution
│   │   ├── ClientManager.js      # Client connection management
│   │   └── PubSub.js             # Publish/Subscribe system
│   ├── transactions/
│   │   ├── Transaction.js        # Transaction management
│   │   └── MultiExec.js          # MULTI/EXEC implementation
│   ├── persistence/
│   │   ├── AOF.js                # Append-Only File persistence
│   │   ├── RDB.js                # Redis Database snapshots
│   │   └── PersistenceManager.js # Persistence coordination
│   ├── replication/
│   │   ├── Master.js             # Master server implementation
│   │   ├── Slave.js              # Slave server implementation
│   │   └── ReplicationManager.js # Replication coordination
│   ├── security/
│   │   ├── Authentication.js     # Auth mechanisms
│   │   ├── ACL.js                # Access Control Lists
│   │   └── TLS.js                # TLS/SSL support
│   ├── scripting/
│   │   ├── LuaEngine.js          # Lua scripting support
│   │   └── ScriptManager.js      # Script management
│   ├── clustering/
│   │   ├── HashSlots.js          # Hash slot implementation
│   │   ├── ClusterNode.js        # Cluster node management
│   │   └── ClusterManager.js     # Cluster coordination
│   ├── monitoring/
│   │   ├── Info.js               # Server info and statistics
│   │   ├── SlowLog.js            # Slow query logging
│   │   └── Metrics.js            # Performance metrics
│   ├── client/
│   │   ├── RedisClient.js        # Client library implementation
│   │   ├── Pipeline.js           # Pipelining support
│   │   └── ClientCache.js        # Client-side caching
│   └── utils/
│       ├── Logger.js             # Logging utilities
│       ├── Config.js             # Configuration management
│       ├── Helpers.js            # Common helper functions
│       └── Constants.js          # System constants
├── tests/
│   ├── unit/
│   │   ├── data-structures/      # Unit tests for data structures
│   │   ├── core/                 # Unit tests for core functionality
│   │   ├── server/               # Unit tests for server components
│   │   └── client/               # Unit tests for client library
│   ├── integration/
│   │   ├── server-client.test.js # Server-client integration tests
│   │   ├── persistence.test.js   # Persistence integration tests
│   │   └── replication.test.js   # Replication integration tests
│   ├── performance/
│   │   ├── benchmark.js          # Performance benchmarking
│   │   └── stress-test.js        # Stress testing
│   └── compatibility/
│       └── redis-compatibility.test.js # Redis compatibility tests
├── benchmarks/
│   ├── data-structure-bench.js   # Data structure benchmarks
│   ├── server-bench.js           # Server performance benchmarks
│   └── redis-comparison.js       # Redis comparison benchmarks
├── examples/
│   ├── basic-usage.js            # Basic usage examples
│   ├── advanced-features.js      # Advanced feature examples
│   ├── vector-search.js          # Vector database examples
│   └── document-queries.js       # Document database examples
├── docs/
│   ├── API.md                    # Complete API documentation
│   ├── PROTOCOL.md               # Communication protocol spec
│   ├── ARCHITECTURE.md           # System architecture
│   ├── PERFORMANCE.md            # Performance analysis
│   └── DEPLOYMENT.md             # Deployment guide
└── cli/
    ├── redis-cli.js              # Command-line interface
    └── interactive-shell.js      # Interactive shell implementation
```

## 🏗️ DEVELOPMENT PHASES

### Phase 1: Foundation & Core Infrastructure (Priority: CRITICAL)

**Timeline**: 2-3 days
**Dependencies**: None

#### 1.1 Project Setup
```bash
# Initialize the project structure
- Create package.json with required dependencies
- Set up .gitignore for Node.js projects
- Create basic directory structure
- Initialize logging system
```

#### 1.2 Core Data Store Implementation
**Files to create**:
- `src/core/DataStore.js` - Main hash table implementation
- `src/core/KeyExpiration.js` - TTL and expiration management
- `src/utils/Logger.js` - Logging utilities
- `src/utils/Config.js` - Configuration management

**Required functionality**:
- Hash table with O(1) average access time
- Basic operations: SET, GET, DEL, EXISTS
- Memory-efficient key storage
- Thread-safe operations preparation

#### 1.3 Basic String Operations
**Files to create**:
- `src/data-structures/StringOps.js`

**Commands to implement**:
- GET, SET, APPEND, STRLEN
- INCR, DECR, INCRBY, DECRBY
- GETRANGE, SETRANGE

#### 1.4 Server Foundation
**Files to create**:
- `server.js` - Main application entry point
- `src/server/Server.js` - Basic TCP server
- `src/server/RESPParser.js` - Basic RESP protocol parser

**Acceptance Criteria**:
- Server starts and listens on configurable port
- Basic telnet connection works
- SET/GET commands work via telnet
- Proper error handling and responses

### Phase 2: Essential Data Structures (Priority: HIGH)

**Timeline**: 3-4 days
**Dependencies**: Phase 1 complete

#### 2.1 List Implementation
**Files to create**:
- `src/data-structures/ListOps.js`

**Commands to implement**:
- LPUSH, RPUSH, LPOP, RPOP
- LRANGE, LINDEX, LSET, LLEN
- LTRIM, LINSERT, LREM

#### 2.2 Set Implementation
**Files to create**:
- `src/data-structures/SetOps.js`

**Commands to implement**:
- SADD, SREM, SISMEMBER, SMEMBERS
- SINTER, SUNION, SDIFF
- SCARD, SRANDMEMBER

#### 2.3 Hash Implementation
**Files to create**:
- `src/data-structures/HashOps.js`

**Commands to implement**:
- HSET, HGET, HMSET, HGETALL
- HDEL, HEXISTS, HKEYS, HVALS
- HINCRBY, HLEN

#### 2.4 Command Router Enhancement
**Files to enhance**:
- `src/server/CommandRouter.js` - Route commands to appropriate handlers

**Acceptance Criteria**:
- All list, set, and hash operations work correctly
- Memory usage is optimized
- Error handling for invalid operations
- Type checking and validation

### Phase 3: Advanced Data Structures (Priority: HIGH)

**Timeline**: 4-5 days
**Dependencies**: Phase 2 complete

#### 3.1 Sorted Sets Implementation
**Files to create**:
- `src/data-structures/SortedSetOps.js`

**Commands to implement**:
- ZADD, ZREM, ZRANGE, ZRANGEBYSCORE
- ZRANK, ZREVRANK, ZSCORE, ZCARD
- ZINCRBY, ZREMRANGEBYRANK, ZREMRANGEBYSCORE

**Technical Requirements**:
- Use balanced tree or skip list for O(log n) operations
- Support for lexicographical ordering
- Efficient range queries

#### 3.2 JSON Document Support
**Files to create**:
- `src/data-structures/JsonOps.js`

**Commands to implement**:
- JSON.SET, JSON.GET, JSON.DEL
- JSON.ARRAPPEND, JSON.ARRLEN, JSON.ARRPOP
- JSON.OBJKEYS, JSON.OBJLEN
- JSONPath-like queries

#### 3.3 Stream Implementation
**Files to create**:
- `src/data-structures/StreamOps.js`

**Commands to implement**:
- XADD, XREAD, XRANGE, XLEN
- XGROUP CREATE, XREADGROUP, XACK
- XPENDING, XCLAIM

**Technical Requirements**:
- Append-only log structure
- Consumer group management
- Message acknowledgment system

### Phase 4: Specialized Data Structures (Priority: MEDIUM)

**Timeline**: 3-4 days
**Dependencies**: Phase 3 complete

#### 4.1 Geospatial Operations
**Files to create**:
- `src/data-structures/GeospatialOps.js`

**Commands to implement**:
- GEOADD, GEODIST, GEOHASH
- GEOPOS, GEORADIUS, GEORADIUSBYMEMBER
- GEOSEARCH (Redis 6.2+ style)

**Technical Requirements**:
- Implement Geohash algorithm
- Efficient spatial indexing
- Distance calculations (haversine formula)

#### 4.2 Bitmap Operations
**Files to create**:
- `src/data-structures/BitmapOps.js`

**Commands to implement**:
- SETBIT, GETBIT, BITCOUNT
- BITOP (AND, OR, XOR, NOT)
- BITPOS, BITFIELD

#### 4.3 Bitfield Operations
**Files to create**:
- `src/data-structures/BitfieldOps.js`

**Commands to implement**:
- BITFIELD GET, BITFIELD SET
- BITFIELD INCRBY
- Support for signed/unsigned integers of various sizes

#### 4.4 Probabilistic Data Structures
**Files to create**:
- `src/data-structures/HyperLogLog.js`
- `src/data-structures/BloomFilter.js`

**Commands to implement**:
- PFADD, PFCOUNT, PFMERGE (HyperLogLog)
- Custom Bloom filter commands

### Phase 5: Time Series & Vector Database (Priority: MEDIUM)

**Timeline**: 4-5 days
**Dependencies**: Phase 4 complete

#### 5.1 Time Series Implementation
**Files to create**:
- `src/data-structures/TimeSeries.js`

**Commands to implement**:
- TS.CREATE, TS.ADD, TS.RANGE, TS.GET
- TS.MGET, TS.MRANGE
- Downsampling and aggregation functions

#### 5.2 Vector Database Foundation
**Files to create**:
- `src/vector-db/VectorStore.js`
- `src/vector-db/SimilaritySearch.js`
- `src/vector-db/VectorOps.js`

**Features to implement**:
- Vector storage and indexing (HNSW algorithm)
- K-nearest neighbor search
- Cosine similarity, Euclidean distance
- Vector addition, subtraction, dot product
- Integration interfaces for ML libraries

### Phase 6: Document Database Capabilities (Priority: MEDIUM)

**Timeline**: 3-4 days
**Dependencies**: Phase 3 complete (JSON support)

#### 6.1 Document Storage Engine
**Files to create**:
- `src/document-db/DocumentStore.js`
- `src/document-db/IndexManager.js`

**Features to implement**:
- Flexible JSON document storage
- Secondary indexing for efficient retrieval
- Partial updates and nested field access

#### 6.2 Query Engine
**Files to create**:
- `src/document-db/QueryEngine.js`
- `src/document-db/AggregationEngine.js`

**Features to implement**:
- Simple query language for documents
- Aggregation framework (count, sum, average, group by)
- Array operations and filtering

### Phase 7: Key Management & Expiration (Priority: HIGH)

**Timeline**: 2-3 days
**Dependencies**: Phase 1 complete

#### 7.1 Enhanced Key Expiration
**Files to enhance**:
- `src/core/KeyExpiration.js`

**Commands to implement**:
- EXPIRE, EXPIREAT, TTL, PTTL
- PERSIST, PEXPIRE, PEXPIREAT
- Background expiration cleanup

#### 7.2 Keyspace Management
**Files to create**:
- `src/core/Database.js`

**Commands to implement**:
- SELECT (database selection)
- FLUSHDB, FLUSHALL
- RANDOMKEY, KEYS (with pattern matching)
- SCAN (cursor-based iteration)

### Phase 8: Transactions & Pub/Sub (Priority: HIGH)

**Timeline**: 3-4 days
**Dependencies**: Phase 2 complete

#### 8.1 Transaction System
**Files to create**:
- `src/transactions/Transaction.js`
- `src/transactions/MultiExec.js`

**Commands to implement**:
- MULTI, EXEC, DISCARD
- WATCH, UNWATCH (optimistic locking)
- Command queuing and atomic execution

#### 8.2 Publish/Subscribe System
**Files to create**:
- `src/server/PubSub.js`

**Commands to implement**:
- PUBLISH, SUBSCRIBE, UNSUBSCRIBE
- PSUBSCRIBE, PUNSUBSCRIBE (pattern subscriptions)
- Channel management and message routing

### Phase 9: Server Enhancement & Protocol (Priority: HIGH)

**Timeline**: 3-4 days
**Dependencies**: Phase 1-2 complete

#### 9.1 RESP Protocol Implementation
**Files to enhance**:
- `src/server/RESPParser.js`

**Features to implement**:
- Complete RESP protocol support
- Bulk strings, arrays, integers, errors
- Pipeline command processing
- Binary data support

#### 9.2 Client Connection Management
**Files to create**:
- `src/server/ClientManager.js`

**Features to implement**:
- Multiple client connections
- Connection pooling and management
- Client timeout handling
- Memory usage per client tracking

### Phase 10: Persistence Systems (Priority: HIGH)

**Timeline**: 4-5 days
**Dependencies**: Phase 7 complete

#### 10.1 Append-Only File (AOF)
**Files to create**:
- `src/persistence/AOF.js`

**Features to implement**:
- Write operation logging
- AOF file rotation and compaction
- Configurable sync policies (always, every second, no)
- Recovery and replay on startup

#### 10.2 RDB Snapshots
**Files to create**:
- `src/persistence/RDB.js`

**Features to implement**:
- Point-in-time snapshots
- Efficient binary serialization
- Background saving (fork simulation)
- Incremental snapshots

#### 10.3 Persistence Coordination
**Files to create**:
- `src/persistence/PersistenceManager.js`

**Features to implement**:
- Hybrid persistence (AOF + RDB)
- Configurable persistence policies
- Data recovery strategies

### Phase 11: Replication System (Priority: MEDIUM)

**Timeline**: 4-5 days
**Dependencies**: Phase 10 complete

#### 11.1 Master-Slave Architecture
**Files to create**:
- `src/replication/Master.js`
- `src/replication/Slave.js`
- `src/replication/ReplicationManager.js`

**Features to implement**:
- Initial data synchronization
- Real-time command forwarding
- Slave promotion capabilities
- Network partition handling

### Phase 12: Client Library Development (Priority: HIGH)

**Timeline**: 3-4 days
**Dependencies**: Phase 9 complete

#### 12.1 Client Implementation
**Files to create**:
- `src/client/RedisClient.js`

**Features to implement**:
- All server operation methods
- Automatic connection management
- Error handling and retries
- Connection pooling

#### 12.2 Advanced Client Features
**Files to create**:
- `src/client/Pipeline.js`
- `src/client/ClientCache.js`

**Features to implement**:
- Command pipelining
- Client-side caching with invalidation
- Batch operations
- Async/await interface

### Phase 13: Performance Optimization (Priority: MEDIUM)

**Timeline**: 3-4 days
**Dependencies**: Phase 12 complete

#### 13.1 Caching and Pipelining
**Files to enhance**:
- Multiple files for optimization

**Features to implement**:
- Memory usage optimization
- Command batching
- Network optimization
- CPU usage profiling and optimization

#### 13.2 Vector and Document Optimization
**Features to implement**:
- High-dimensional vector optimization
- Efficient document serialization
- Index optimization
- Query performance tuning

### Phase 14: Security Implementation (Priority: MEDIUM)

**Timeline**: 3-4 days
**Dependencies**: Phase 9 complete

#### 14.1 Authentication and Authorization
**Files to create**:
- `src/security/Authentication.js`
- `src/security/ACL.js`

**Features to implement**:
- Basic authentication mechanisms
- Access Control Lists (ACL)
- Role-based permissions
- Command-level access control

#### 14.2 TLS/SSL Support
**Files to create**:
- `src/security/TLS.js`

**Features to implement**:
- Encrypted client-server communication
- Certificate management
- Secure connection establishment

### Phase 15: Advanced Features (Priority: LOW)

**Timeline**: 5-6 days
**Dependencies**: Phase 11 complete

#### 15.1 Lua Scripting
**Files to create**:
- `src/scripting/LuaEngine.js`
- `src/scripting/ScriptManager.js`

**Features to implement**:
- Lua script execution environment
- Script caching and management
- EVAL, EVALSHA commands
- Script debugging capabilities

#### 15.2 Basic Clustering
**Files to create**:
- `src/clustering/HashSlots.js`
- `src/clustering/ClusterNode.js`
- `src/clustering/ClusterManager.js`

**Features to implement**:
- Hash slot-based data distribution
- Node discovery and communication
- Data migration between nodes
- Failover mechanisms

### Phase 16: Monitoring & Management (Priority: MEDIUM)

**Timeline**: 2-3 days
**Dependencies**: Phase 8 complete

#### 16.1 Server Information
**Files to create**:
- `src/monitoring/Info.js`
- `src/monitoring/SlowLog.js`
- `src/monitoring/Metrics.js`

**Commands to implement**:
- INFO (server statistics and information)
- SLOWLOG (slow query identification)
- Real-time metrics collection
- Performance monitoring

### Phase 17: Keyspace Notifications (Priority: LOW)

**Timeline**: 2-3 days
**Dependencies**: Phase 8 complete

#### 17.1 Event System
**Features to implement**:
- Keyspace event notifications
- Configurable notification types
- Client-side event listeners
- Pattern-based event subscriptions

### Phase 18: Redis Patterns Implementation (Priority: LOW)

**Timeline**: 3-4 days
**Dependencies**: Phase 8 complete

#### 18.1 Common Patterns
**Files to create**:
- Examples and utilities for:
  - Distributed locks
  - Rate limiting
  - Message queues
  - Caching layer patterns

### Phase 19: CLI Development (Priority: HIGH)

**Timeline**: 2-3 days
**Dependencies**: Phase 12 complete

#### 19.1 Command Line Interface
**Files to create**:
- `cli/redis-cli.js`
- `cli/interactive-shell.js`

**Features to implement**:
- Interactive shell with command completion
- Batch command execution
- Output formatting options
- Connection management

### Phase 20: Testing & Quality Assurance (Priority: CRITICAL)

**Timeline**: 4-5 days
**Dependencies**: All phases

#### 20.1 Comprehensive Testing
**Files to create**:
- Complete test suite covering all functionality
- Performance benchmarking
- Redis compatibility testing
- Stress testing

#### 20.2 Documentation
**Files to create**:
- Complete API documentation
- Architecture documentation
- Performance analysis
- User guides

## 🧪 TESTING STRATEGY

### Unit Testing Requirements
- Test coverage > 90% for all core functionality
- Mock external dependencies
- Test edge cases and error conditions
- Performance regression testing

### Integration Testing Requirements
- Full server-client interaction testing
- Persistence and recovery testing
- Replication testing
- Cross-platform compatibility

### Performance Testing Requirements
- Benchmark against Redis for similar operations
- Memory usage profiling
- Throughput and latency measurements
- Stress testing with high concurrency

## 📋 ACCEPTANCE CRITERIA PER PHASE

Each phase must meet these criteria before proceeding:

1. **Functionality**: All specified commands work correctly
2. **Performance**: No major performance regressions
3. **Testing**: Unit tests pass with >90% coverage
4. **Documentation**: Code is well-documented
5. **Integration**: Integrates properly with existing codebase
6. **Error Handling**: Proper error handling and user feedback

## 🔧 DEVELOPMENT GUIDELINES

### Code Quality Standards
- Use ES6+ JavaScript features
- Implement proper error handling
- Follow consistent naming conventions
- Write comprehensive JSDoc comments
- Use async/await for asynchronous operations

### Performance Requirements
- Memory usage should be competitive with Redis
- Command execution should be within 2x of Redis performance
- Support for millions of keys without significant degradation
- Efficient network protocol implementation

### Security Considerations
- Input validation and sanitization
- Protection against command injection
- Secure default configurations
- Audit logging for security events

## 📦 DEPENDENCIES

### Core Dependencies
```json
{
  "dependencies": {
    "commander": "^9.0.0",
    "winston": "^3.8.0"
  },
  "devDependencies": {
    "jest": "^29.0.0",
    "benchmark": "^2.1.4",
    "eslint": "^8.0.0"
  }
}
```

### Optional Dependencies
- For Lua scripting: `lua-vm`
- For clustering: Custom networking utilities
- For TLS: Node.js built-in `tls` module

## 🚀 DEPLOYMENT CONSIDERATIONS

### Standalone Mode
- Single server instance
- All features available
- Suitable for development and testing

### Production Considerations
- Memory management and monitoring
- Proper logging and error handling
- Configuration management
- Health check endpoints

## 📊 SUCCESS METRICS

### Performance Targets
- **Throughput**: >50,000 ops/sec for simple operations
- **Memory**: <2x Redis memory usage for equivalent data
- **Latency**: <1ms for cache hits, <10ms for complex operations
- **Concurrent Connections**: Support >1000 concurrent clients

### Functionality Targets
- **Redis Compatibility**: >80% command compatibility
- **Data Structures**: All specified data types implemented
- **Persistence**: Both AOF and RDB working correctly
- **Replication**: Master-slave replication functional

## 🔄 ITERATIVE DEVELOPMENT APPROACH

1. **Build Incrementally**: Each phase builds on previous phases
2. **Test Continuously**: Run tests after each major feature
3. **Optimize Later**: Focus on functionality first, then performance
4. **Document as You Go**: Maintain documentation throughout development
5. **Benchmark Regularly**: Compare performance with Redis periodically

## 🎯 FINAL DELIVERABLES

1. **Complete Redis-like server** with all specified features
2. **Comprehensive client library** for JavaScript applications
3. **Command-line interface** for manual testing and administration
4. **Complete test suite** with high coverage
5. **Performance benchmarks** comparing to Redis
6. **Documentation** covering API, architecture, and deployment
7. **Example applications** demonstrating usage

---

**Start with Phase 1 and work systematically through each phase. Do not skip phases or rush implementation. Quality and correctness are more important than speed.**

## AI INSTRUCTIONS FOR IMPLEMENTATION

When implementing this project:

1. **Start with Phase 1** - Do not jump ahead to later phases
2. **Complete acceptance criteria** for each phase before moving to the next
3. **Test thoroughly** - Each feature should work correctly before moving on
4. **Maintain code quality** - Follow the guidelines and standards outlined
5. **Ask for clarification** if any requirements are unclear
6. **Document decisions** - Explain architectural choices and trade-offs
7. **Optimize incrementally** - Don't over-optimize early, focus on correctness first
8. **Use meaningful commits** - Each phase should have clear commit messages
9. **Handle errors gracefully** - Implement proper error handling throughout
10. **Stay original** - Do not copy code from existing Redis implementations

Remember: This is an assessment project, so code quality, architecture decisions, and implementation approach are as important as the final functionality.
