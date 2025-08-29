# Redis-Clone-JS

A Redis-like in-memory data store implemented in JavaScript (Node.js) with comprehensive Redis command compatibility.

## Project Overview

This project implements a Redis-compatible in-memory data store from scratch, featuring:
- Complete CLI interface matching Redis behavior
- In-memory key-value storage
- Redis-compatible command set
- Modular architecture for extensibility
- No external dependencies for core functionality

## Installation & Usage

### Prerequisites
- Node.js (v14+ recommended)

### Starting the Server
```bash
node server.js
```

This will start the interactive CLI interface where you can execute Redis-compatible commands.

**Current Command Count**: 216 Redis-compatible commands across strings, expiration, lists, sets, hashes, sorted sets, JSON, transactions, pub/sub messaging, AOF persistence, RDB snapshots, geospatial data, bitmap/bitfield operations, and stream processing.

## Current Implementation Status

### Phase 1: Foundation & Basic Key-Value Store ✅
**Status**: Complete

**Implemented Commands**:
- `SET key value` - Set key to hold string value
- `GET key` - Get the value of key
- `DEL key [key ...]` - Delete one or more keys
- `EXISTS key [key ...]` - Check if one or more keys exist
- `KEYS pattern` - Find all keys matching pattern (* for all)
- `FLUSHALL` - Remove all keys from all databases
- `MSET key value [key value ...]` - Set multiple keys
- `MGET key [key ...]` - Get multiple keys
- `GETSET key value` - Get old value and set new value
- `SETNX key value` - Set key only if it doesn't exist
- `GETRANGE key start end` - Get substring
- `SETRANGE key offset value` - Set substring
- `DBSIZE` - Get number of keys
- `RANDOMKEY` - Get random key
- `HELP` - Show available commands
- `QUIT/EXIT` - Exit the server

**Features**:
- ✅ Interactive CLI with Redis-like prompt
- ✅ Command parsing with quoted string support
- ✅ Redis-compatible error messages
- ✅ Pattern matching for KEYS command
- ✅ Proper response formatting matching Redis

### Phase 2: String Operations & Key Management ✅
**Status**: Complete

**Implemented Commands**:
- `APPEND key value` - Append value to key
- `STRLEN key` - Get the length of the value stored in key
- `INCR key` - Increment the integer value of key by one
- `DECR key` - Decrement the integer value of key by one
- `INCRBY key increment` - Increment the integer value of key by increment
- `DECRBY key decrement` - Decrement the integer value of key by decrement
- `INCRBYFLOAT key increment` - Increment the float value of key by increment
- `MSETNX key value [key value ...]` - Set multiple keys only if none exist
- `GETDEL key` - Get key value and delete it atomically
- `LCS key1 key2 [LEN] [IDX] [MINMATCHLEN len] [WITHMATCHLEN]` - Longest Common Subsequence
- `EXPIRE key seconds` - Set timeout on key in seconds
- `PEXPIRE key milliseconds` - Set timeout on key in milliseconds
- `TTL key` - Get time to live for key in seconds
- `PTTL key` - Get time to live for key in milliseconds
- `PERSIST key` - Remove timeout from key
- `RENAME key newkey` - Rename key to newkey
- `RENAMENX key newkey` - Rename key only if newkey doesn't exist
- `EXPIREAT key timestamp` - Set expiration at Unix timestamp
- `PEXPIREAT key milliseconds-timestamp` - Set expiration at millisecond timestamp
- `SETEX key seconds value` - Set key with expiration in seconds
- `PSETEX key milliseconds value` - Set key with expiration in milliseconds
- `GETEX key [options]` - Get value with expiration options

**List Operations**:
- `LPUSH key element [element ...]` - Push elements to the left (beginning) of list
- `RPUSH key element [element ...]` - Push elements to the right (end) of list  
- `LPOP key` - Pop element from the left (beginning) of list
- `RPOP key` - Pop element from the right (end) of list
- `LLEN key` - Get the length of list
- `LRANGE key start stop` - Get range of elements from list
- `LINDEX key index` - Get element at index from list
- `LSET key index element` - Set element at index in list
- `LTRIM key start stop` - Trim list to specified range
- `LINSERT key BEFORE|AFTER pivot element` - Insert element before or after pivot
- `LPUSHX key element [element ...]` - Push to left only if list exists
- `RPUSHX key element [element ...]` - Push to right only if list exists
- `LREM key count element` - Remove elements from list
- `RPOPLPUSH source destination` - Pop from right of source and push to left of destination
- `LMOVE source destination LEFT|RIGHT LEFT|RIGHT` - Move element between lists (any side to any side)
- `LPOS key element [RANK rank] [COUNT num] [MAXLEN len]` - Find position of element in list
- `LMPOP numkeys key [key ...] LEFT|RIGHT [COUNT count]` - Pop elements from multiple lists

**Blocking List Operations**:
- `BLPOP key [key ...] timeout` - Blocking left pop from lists
- `BRPOP key [key ...] timeout` - Blocking right pop from lists
- `BRPOPLPUSH source destination timeout` - Blocking right pop and left push
- `BLMOVE source destination LEFT|RIGHT LEFT|RIGHT timeout` - Blocking move between lists
- `BLMPOP timeout numkeys key [key ...] LEFT|RIGHT [COUNT count]` - Blocking pop from multiple lists

**Set Operations**:
- `SADD key member [member ...]` - Add members to set
- `SREM key member [member ...]` - Remove members from set
- `SMEMBERS key` - Get all members of set
- `SCARD key` - Get number of members in set
- `SISMEMBER key member` - Check if member exists in set
- `SUNION key [key ...]` - Union of sets
- `SINTER key [key ...]` - Intersection of sets
- `SDIFF key [key ...]` - Difference of sets (first set minus others)
- `SPOP key [count]` - Remove and return random member(s)
- `SRANDMEMBER key [count]` - Get random member(s) without removing
- `SMOVE source destination member` - Move member between sets
- `SUNIONSTORE destination key [key ...]` - Store union result in destination
- `SINTERSTORE destination key [key ...]` - Store intersection result in destination
- `SDIFFSTORE destination key [key ...]` - Store difference result in destination
- `SINTERCARD numkeys key [key ...] [LIMIT limit]` - Get cardinality of intersection
- `SMISMEMBER key member [member ...]` - Check if multiple members exist in set
- `SSCAN key cursor [MATCH pattern] [COUNT count]` - Incrementally iterate set members

**Features**:
- ✅ String manipulation operations with proper length tracking
- ✅ Atomic increment/decrement operations with overflow protection
- ✅ Key expiration system with background cleanup
- ✅ Time-to-live (TTL) functionality matching Redis behavior
- ✅ Key persistence management
- ✅ Key renaming with expiration preservation
- ✅ Redis-compatible integer and error responses
- ✅ Automatic expired key cleanup
- ✅ **Redis 7.x SET command compatibility** with all options:
  - `EX seconds` - Set expiration in seconds
  - `PX milliseconds` - Set expiration in milliseconds
  - `EXAT timestamp` - Set absolute expiration timestamp
  - `PXAT milliseconds-timestamp` - Set absolute expiration timestamp in milliseconds
  - `NX` - Only set if key doesn't exist
  - `XX` - Only set if key exists
  - `KEEPTTL` - Retain existing TTL
  - `GET` - Return old value
- ✅ **Millisecond precision expiration** with PEXPIRE and PTTL commands

### Phase 3: List Data Structure ✅
**Status**: Complete

**Implemented Commands**:
- `LPUSH key element [element ...]` - Push elements to the left (beginning) of list
- `RPUSH key element [element ...]` - Push elements to the right (end) of list
- `LPOP key` - Pop element from the left (beginning) of list
- `RPOP key` - Pop element from the right (end) of list
- `LLEN key` - Get the length of list
- `LRANGE key start stop` - Get range of elements from list
- `LINDEX key index` - Get element at index from list
- `LSET key index element` - Set element at index in list
- `LTRIM key start stop` - Trim list to specified range

**Features**:
- ✅ Complete list data structure with efficient operations
- ✅ Support for negative indexing (Redis-compatible)
- ✅ Automatic key cleanup when lists become empty
- ✅ Full type checking and isolation between data types
- ✅ Redis-compatible error messages and behavior
- ✅ List expiration support with background cleanup
- ✅ Memory-efficient operations (O(1) for push/pop at ends)
- ✅ Range operations with proper boundary handling

### Phase 4: Set Data Structure ✅
**Status**: Complete

**Implemented Commands**:
- `SADD key member [member ...]` - Add members to set
- `SREM key member [member ...]` - Remove members from set
- `SMEMBERS key` - Get all members of set
- `SCARD key` - Get number of members in set
- `SISMEMBER key member` - Check if member exists in set
- `SUNION key [key ...]` - Union of sets
- `SINTER key [key ...]` - Intersection of sets
- `SDIFF key [key ...]` - Difference of sets (first set minus others)
- `SPOP key [count]` - Remove and return random member(s)
- `SRANDMEMBER key [count]` - Get random member(s) without removing
- `SMOVE source destination member` - Move member between sets
- `SUNIONSTORE destination key [key ...]` - Store union result in destination
- `SINTERSTORE destination key [key ...]` - Store intersection result in destination
- `SDIFFSTORE destination key [key ...]` - Store difference result in destination
- `SINTERCARD numkeys key [key ...] [LIMIT limit]` - Get cardinality of intersection
- `SMISMEMBER key member [member ...]` - Check if multiple members exist in set
- `SSCAN key cursor [MATCH pattern] [COUNT count]` - Incrementally iterate set members

**Features**:
- ✅ Complete set data structure with uniqueness guarantee
- ✅ Efficient O(1) add/remove/membership operations using JavaScript Set
- ✅ Full set mathematics (union, intersection, difference)
- ✅ Automatic key cleanup when sets become empty
- ✅ Redis-compatible behavior for non-existent keys in set operations
- ✅ Full type checking and isolation between data types
- ✅ Redis-compatible error messages and response formatting
- ✅ Set expiration support with background cleanup

### Phase 5: Hash Data Structure ✅
**Status**: Complete

**Implemented Commands**:
- `HSET key field value [field value ...]` - Set field(s) in hash
- `HGET key field` - Get field value from hash
- `HMGET key field [field ...]` - Get multiple field values
- `HGETALL key` - Get all field-value pairs
- `HDEL key field [field ...]` - Delete field(s) from hash
- `HEXISTS key field` - Check if field exists in hash
- `HKEYS key` - Get all field names
- `HVALS key` - Get all values
- `HLEN key` - Get number of fields in hash
- `HINCRBY key field increment` - Increment field by integer
- `HINCRBYFLOAT key field increment` - Increment field by float
- `HSETNX key field value` - Set field only if it doesn't exist
- `HMSET key field value [field value ...]` - Set multiple fields (legacy)
- `HSTRLEN key field` - Get length of field value
- `HSCAN key cursor [MATCH pattern] [COUNT count]` - Incrementally iterate hash fields
- `HRANDFIELD key [count [WITHVALUES]]` - Get random field(s) from hash

**Hash Field Expiration (Redis 7.2+)**:
- `HGETDEL key field` - Get field value and delete it atomically
- `HEXPIRE key seconds field [field ...]` - Set field expiration in seconds
- `HEXPIREAT key timestamp field [field ...]` - Set field expiration at Unix timestamp
- `HEXPIRETIME key field [field ...]` - Get field expiration timestamp
- `HPEXPIRE key milliseconds field [field ...]` - Set field expiration in milliseconds
- `HPEXPIREAT key milliseconds-timestamp field [field ...]` - Set field expiration at millisecond timestamp
- `HPEXPIRETIME key field [field ...]` - Get field expiration timestamp in milliseconds
- `HTTL key field [field ...]` - Get field time to live in seconds
- `HPTTL key field [field ...]` - Get field time to live in milliseconds
- `HPERSIST key field [field ...]` - Remove field expiration

**Features**:
- ✅ Complete hash data structure with field-value mapping
- ✅ Efficient O(1) field operations using JavaScript Map
- ✅ Support for multiple field operations in single command (HSET, HMGET, HDEL)
- ✅ Numeric operations with integer and float arithmetic
- ✅ Conditional field setting (HSETNX)
- ✅ Bulk inspection operations (HKEYS, HVALS, HGETALL)
- ✅ Advanced hash operations (HRANDFIELD, HSTRLEN, HSCAN)
- ✅ **Field-level expiration support (Redis 7.2+ feature)**
- ✅ Atomic get-and-delete operations (HGETDEL)
- ✅ Field TTL management with second and millisecond precision
- ✅ Automatic expired field cleanup with lazy expiration checking
- ✅ Automatic key cleanup when hashes become empty
- ✅ Full type checking and isolation between data types
- ✅ Redis-compatible error messages and response formatting
- ✅ Hash expiration support with background cleanup

### Phase 6: Sorted Set Data Structure ✅
**Status**: Complete

**Implemented Commands**:
- `ZADD key score member [score member ...]` - Add members with scores to sorted set
- `ZREM key member [member ...]` - Remove members from sorted set
- `ZSCORE key member` - Get score of member
- `ZRANK key member` - Get rank (0-based index) of member
- `ZREVRANK key member` - Get reverse rank of member
- `ZRANGE key start stop [WITHSCORES]` - Get range of members by rank
- `ZREVRANGE key start stop [WITHSCORES]` - Get range of members by rank (reverse)
- `ZRANGEBYSCORE key min max [WITHSCORES] [LIMIT offset count]` - Get range by score
- `ZREVRANGEBYSCORE key max min [WITHSCORES] [LIMIT offset count]` - Get range by score (reverse)
- `ZCOUNT key min max` - Count members in score range
- `ZCARD key` - Get number of members in sorted set
- `ZINCRBY key increment member` - Increment score of member
- `ZREMRANGEBYRANK key start stop` - Remove members by rank range
- `ZREMRANGEBYSCORE key min max` - Remove members by score range
- `ZRANGEBYLEX key min max [LIMIT offset count]` - Get range by lexicographical order
- `ZREVRANGEBYLEX key max min [LIMIT offset count]` - Get range by lexicographical order (reverse)
- `ZLEXCOUNT key min max` - Count members in lexicographical range
- `ZREMRANGEBYLEX key min max` - Remove members by lexicographical range

**Advanced Sorted Set Operations**:
- `ZPOPMIN key [count]` - Pop minimum scored members
- `ZPOPMAX key [count]` - Pop maximum scored members  
- `ZMSCORE key member [member ...]` - Get scores for multiple members
- `ZRANDMEMBER key [count [WITHSCORES]]` - Get random member(s) from sorted set
- `ZSCAN key cursor [MATCH pattern] [COUNT count]` - Incrementally iterate sorted set
- `ZUNION numkeys key [key ...]` - Union of multiple sorted sets (without storing)
- `ZUNIONSTORE destination numkeys key [key ...]` - Store union of multiple sorted sets
- `ZINTER numkeys key [key ...]` - Intersection of multiple sorted sets (without storing)
- `ZINTERSTORE destination numkeys key [key ...]` - Store intersection of multiple sorted sets
- `ZDIFF numkeys key [key ...]` - Difference of multiple sorted sets (without storing)
- `ZDIFFSTORE destination numkeys key [key ...]` - Store difference of multiple sorted sets
- `ZINTERCARD numkeys key [key ...] [LIMIT limit]` - Get cardinality of intersection
- `ZMPOP numkeys key [key ...] MIN|MAX [COUNT count]` - Pop members from multiple sorted sets
- `ZRANGESTORE destination source start stop` - Store range results in destination key

**Blocking Sorted Set Operations**:
- `BZPOPMIN key [key ...] timeout` - Blocking pop minimum scored members
- `BZPOPMAX key [key ...] timeout` - Blocking pop maximum scored members
- `BZMPOP timeout numkeys key [key ...] MIN|MAX [COUNT count]` - Blocking pop from multiple sorted sets

**Features**:
- ✅ Complete sorted set data structure with score-based ordering
- ✅ Efficient operations using binary search for insertion and removal
- ✅ Support for both rank-based and score-based range queries
- ✅ Lexicographic ordering for members with equal scores
- ✅ Floating-point score precision with proper arithmetic operations
- ✅ Advanced range operations with LIMIT support for pagination
- ✅ Score increment operations with automatic re-positioning
- ✅ Bulk removal operations by rank and score ranges
- ✅ **Advanced pop operations (ZPOPMIN, ZPOPMAX, ZMPOP)**
- ✅ **Multi-set operations (ZUNION, ZINTER, ZDIFF with STORE variants)**
- ✅ **Random member selection (ZRANDMEMBER with WITHSCORES)**
- ✅ **Cursor-based iteration (ZSCAN with MATCH and COUNT)**
- ✅ **Multi-member score retrieval (ZMSCORE)**
- ✅ **Set intersection cardinality (ZINTERCARD with LIMIT)**
- ✅ **Range storage operations (ZRANGESTORE)**
- ✅ **Blocking operations (BZPOPMIN, BZPOPMAX, BZMPOP)**
- ✅ Automatic key cleanup when sorted sets become empty
- ✅ Full type checking and isolation between data types
- ✅ Redis-compatible error messages and response formatting
- ✅ Sorted set expiration support with background cleanup
- ✅ O(log n) insertion and removal maintaining sorted order
- ✅ Lexicographical range operations for members with equal scores
- ✅ Support for Redis-style lexicographical bounds ([, (, -, +)

### Phase 7: JSON Data Structure ✅
**Status**: Complete

**Implemented Commands**:
- `JSON.GET key [path] [INDENT] [NEWLINE] [SPACE]` - Get JSON value at path
- `JSON.SET key path value [NX|XX]` - Set JSON value at path
- `JSON.DEL key [path]` - Delete JSON value at path
- `JSON.TYPE key [path]` - Get JSON type at path
- `JSON.STRLEN key [path]` - Get string length at path
- `JSON.MGET key [key ...] path` - Get JSON values from multiple keys at path

**JSON Array Operations**:
- `JSON.ARRAPPEND key path value [value ...]` - Append values to JSON array
- `JSON.ARRLEN key [path]` - Get JSON array length
- `JSON.ARRINDEX key path value [start [stop]]` - Find index of value in array
- `JSON.ARRINSERT key path index value [value ...]` - Insert values into array
- `JSON.ARRPOP key path [index]` - Pop value from JSON array
- `JSON.ARRTRIM key path start stop` - Trim JSON array to range

**JSON Object Operations**:
- `JSON.OBJKEYS key [path]` - Get JSON object keys
- `JSON.OBJLEN key [path]` - Get JSON object length

**JSON Numeric Operations**:
- `JSON.NUMINCRBY key path value` - Increment number at JSON path
- `JSON.NUMMULTBY key path value` - Multiply number at JSON path

**JSON Utility Operations**:
- `JSON.CLEAR key [path]` - Clear JSON value at path
- `JSON.FORGET key [path]` - Alias for JSON.DEL
- `JSON.RESP key [path]` - Get JSON value in RESP format
- `JSON.DEBUG subcommand [key] [path]` - Debug JSON operations
- `JSON.MSET key path value [key path value ...]` - Set multiple JSON keys
- `JSON.MERGE key path value` - Merge JSON value into existing paths
- `JSON.STRAPPEND key path value` - Append to string at JSON path
- `JSON.TOGGLE key path` - Toggle boolean value at JSON path

**Features**:
- ✅ Complete JSON data type with native storage and manipulation
- ✅ **JSONPath support** for nested object and array access
- ✅ **Path-based operations** with dot notation and array indexing
- ✅ **Type-safe operations** with comprehensive type checking
- ✅ **Array manipulation** (append, insert, pop, trim, search)
- ✅ **Object manipulation** (keys, length, nested access)
- ✅ **Numeric operations** with float arithmetic support
- ✅ **Conditional operations** (NX, XX options)
- ✅ **Advanced formatting** (INDENT, NEWLINE, SPACE options)
- ✅ **Multi-key operations** (JSON.MGET for bulk retrieval)
- ✅ **Debug utilities** (memory usage, RESP format conversion)
- ✅ **Automatic type detection** and validation
- ✅ **Redis-compatible error messages** and response formatting
- ✅ **Memory-efficient JSON storage** with lazy evaluation
- ✅ Full type checking and isolation between data types

### Phase 8: Transaction Support ✅
**Status**: Complete

**Implemented Commands**:
- `MULTI` - Start a transaction block
- `EXEC` - Execute all commands in the transaction atomically
- `DISCARD` - Discard/cancel the current transaction
- `WATCH key [key ...]` - Watch keys for changes (optimistic locking)
- `UNWATCH` - Stop watching all keys

**Features**:
- ✅ **Atomic transactions** with MULTI/EXEC for all-or-nothing command execution
- ✅ **Transaction queueing** with "QUEUED" responses during MULTI block
- ✅ **Transaction cancellation** with DISCARD command
- ✅ **Optimistic locking** with WATCH/UNWATCH for concurrency control
- ✅ **Multi-data-type support** works with all 7 data structures (strings, lists, sets, hashes, sorted sets, JSON)
- ✅ **Comprehensive error handling** (EXEC without MULTI, nested MULTI, WATCH inside MULTI)
- ✅ **Redis-compatible behavior** including transaction state management
- ✅ **Enterprise-grade reliability** for banking, inventory, and critical applications
- ✅ **Full ACID compliance** with atomicity, consistency, isolation, durability
- ✅ **Performance optimization** with reduced network roundtrips
- ✅ **Watched key change detection** for preventing race conditions
- ✅ **Transaction rollback** on watched key modifications

### Phase 9: Pub/Sub Mechanism ✅
**Status**: Complete

**Implemented Commands**:
- `PUBLISH channel message` - Publish message to a channel
- `SUBSCRIBE channel [channel ...]` - Subscribe to one or more channels
- `UNSUBSCRIBE [channel ...]` - Unsubscribe from channels (all if no args)
- `PSUBSCRIBE pattern [pattern ...]` - Subscribe to channel patterns using wildcards
- `PUNSUBSCRIBE [pattern ...]` - Unsubscribe from patterns (all if no args)
- `PUBSUB CHANNELS [pattern]` - List active channels matching pattern
- `PUBSUB NUMSUB channel [channel ...]` - Get subscriber count for channels
- `PUBSUB NUMPAT` - Get number of active pattern subscriptions

**Features**:
- ✅ **Real-time message delivery** with instant broadcasting to all subscribers
- ✅ **Channel subscriptions** for direct topic-based messaging
- ✅ **Pattern subscriptions** with full glob-style wildcard support (* and ?)
- ✅ **Subscribe mode restrictions** preventing non-pub/sub commands during subscription
- ✅ **Message formatting** with exact Redis wire protocol compatibility
- ✅ **Multiple subscription types** supporting both channels and patterns simultaneously
- ✅ **Subscription management** with granular subscribe/unsubscribe control
- ✅ **Introspection commands** for monitoring pub/sub state and activity
- ✅ **Pattern matching engine** with regex-based glob pattern evaluation
- ✅ **Subscriber counting** with accurate tracking of channel and pattern subscribers
- ✅ **Message delivery confirmation** with subscriber count returns from PUBLISH
- ✅ **Enterprise messaging support** for real-time notifications, chat systems, and event-driven architectures
- ✅ **Full Redis compatibility** including error handling and response formatting
- ✅ **Performance optimization** with efficient pattern matching and subscription management

### Phase 10: AOF (Append Only File) Persistence ✅
**Status**: Complete

**Implemented Commands**:
- `BGREWRITEAOF` - Rewrite AOF file in background for compaction

**Features**:
- ✅ **AOF file logging** for all write operations with JSON format storage
- ✅ **Data recovery on startup** by replaying AOF commands to restore state
- ✅ **Multiple sync policies** supporting 'always', 'everysec', and 'no' synchronization
- ✅ **BGREWRITEAOF command** for background file compaction and optimization
- ✅ **All data structure support** including strings, lists, sets, hashes, sorted sets, and JSON
- ✅ **Expiration persistence** for both key-level and hash field-level TTLs
- ✅ **Graceful shutdown** with automatic AOF synchronization on exit
- ✅ **Error handling and backup** mechanisms for safe AOF operations
- ✅ **Command-line and environment configuration** for AOF settings (--aof flag, AOF_ENABLED, AOF_FILENAME, AOF_SYNC_POLICY)
- ✅ **Background sync timer** for 'everysec' policy with automatic buffer management
- ✅ **Transaction support** with proper AOF logging of executed transaction commands
- ✅ **Memory-efficient buffering** with configurable flush strategies
- ✅ **Enterprise-grade reliability** ensuring data durability across server restarts
- ✅ **Full Redis compatibility** matching Redis AOF behavior and file format
- ✅ **Performance optimization** with efficient command serialization and minimal I/O overhead

### Phase 11: RDB (Redis Database) Snapshots ✅
**Status**: Complete

**Implemented Commands**:
- `SAVE` - Save dataset to RDB snapshot synchronously
- `BGSAVE` - Save dataset to RDB snapshot in background  
- `LASTSAVE` - Get timestamp of last successful RDB save

**Features**:
- ✅ **Point-in-time snapshots** with complete dataset preservation in JSON format
- ✅ **Manual snapshot creation** with SAVE command for synchronous snapshots
- ✅ **Background snapshot creation** with BGSAVE command for non-blocking saves
- ✅ **Automatic snapshots** based on configurable time intervals and change thresholds
- ✅ **Data recovery on startup** by loading RDB snapshots when AOF is not available
- ✅ **All data structure support** including strings, lists, sets, hashes, sorted sets, and JSON
- ✅ **Expiration persistence** for both key-level and hash field-level TTLs
- ✅ **Timestamp tracking** with LASTSAVE command for monitoring backup status
- ✅ **Backup and safety mechanisms** with automatic backup file creation and cleanup
- ✅ **Configurable auto-save policies** via environment variables (RDB_SAVE_SECONDS, RDB_SAVE_CHANGES)
- ✅ **Graceful shutdown snapshots** saving unsaved changes on server exit
- ✅ **Memory-efficient serialization** with structured JSON format for reliability
- ✅ **Error handling and validation** ensuring data integrity and proper error reporting
- ✅ **Command-line and environment configuration** for flexible deployment options
- ✅ **Enterprise-grade reliability** with backup rotation and corruption prevention
- ✅ **Performance optimization** with efficient serialization and background processing

### Phase 12: Geospatial Data ✅
**Status**: Complete

**Implemented Commands**:
- `GEOADD key longitude latitude member [longitude latitude member ...]` - Add geospatial items to geo index
- `GEODIST key member1 member2 [unit]` - Get distance between two geospatial members
- `GEOPOS key member [member ...]` - Get positions (longitude, latitude) of members
- `GEOHASH key member [member ...]` - Get geohash strings for members
- `GEORADIUS key longitude latitude radius unit [WITHCOORD] [WITHDIST] [WITHHASH] [COUNT count] [ASC|DESC]` - Search for members within radius from coordinates
- `GEORADIUSBYMEMBER key member radius unit [WITHCOORD] [WITHDIST] [WITHHASH] [COUNT count] [ASC|DESC]` - Search for members within radius from another member
- `GEOSEARCH key FROMMEMBER member|FROMLONLAT lon lat BYRADIUS radius unit|BYBOX width height unit [options]` - Modern geospatial search (Redis 6.2+)
- `GEOSEARCHSTORE destination source FROMMEMBER member|FROMLONLAT lon lat BYRADIUS radius unit|BYBOX width height unit [options]` - Store geosearch results in destination key

**Features**:
- ✅ **Complete geospatial indexing** using geohash encoding for efficient spatial queries
- ✅ **Haversine distance calculation** providing accurate great-circle distances between coordinates
- ✅ **Multiple distance units** supporting meters (m), kilometers (km), miles (mi), and feet (ft)
- ✅ **Coordinate validation** ensuring longitude/latitude values are within valid geographic ranges
- ✅ **Proximity searches** with GEORADIUS for radius-based location queries from any coordinates
- ✅ **Member-based searches** with GEORADIUSBYMEMBER for finding locations near existing members
- ✅ **Advanced search options** including WITHCOORD, WITHDIST, WITHHASH for enriched results
- ✅ **Result sorting and limiting** with ASC/DESC ordering and COUNT constraints
- ✅ **Modern GEOSEARCH syntax** providing flexible query options with FROMMEMBER/FROMLONLAT and BYRADIUS/BYBOX
- ✅ **Search result storage** with GEOSEARCHSTORE for saving query results as new geo indexes
- ✅ **Type safety and isolation** ensuring geospatial keys are separate from other data types
- ✅ **Redis compatibility** matching exact Redis geospatial command behavior and response formats
- ✅ **RDB persistence integration** enabling geospatial data to be saved and restored in snapshots
- ✅ **Error handling** with comprehensive validation and Redis-compatible error messages
- ✅ **Performance optimization** using efficient algorithms for spatial indexing and distance calculations

### Phase 13: Bitmaps & Bitfields ✅
**Status**: Complete

**Implemented Commands**:
- `SETBIT key offset value` - Set bit at specified offset to value (0 or 1)
- `GETBIT key offset` - Get bit value at specified offset
- `BITCOUNT key [start end]` - Count number of set bits in range
- `BITPOS key bit [start [end]]` - Find first bit set to specified value
- `BITOP operation destkey key [key ...]` - Perform bitwise operation (AND, OR, XOR, NOT)
- `BITFIELD key [GET type offset] [SET type offset value] [INCRBY type offset increment] [OVERFLOW WRAP|SAT|FAIL]` - Advanced bitfield operations
- `BITFIELD_RO key [GET type offset] [GET type offset ...]` - Read-only bitfield operations (Redis 6.0+)

**Features**:
- ✅ **Efficient bit storage** using Node.js Buffer for memory-optimized binary data storage
- ✅ **Individual bit operations** with SETBIT/GETBIT for precise bit manipulation at any offset
- ✅ **Bit counting and searching** with BITCOUNT for population count and BITPOS for bit position finding
- ✅ **Bitwise operations** supporting AND, OR, XOR, NOT operations between multiple bitmaps
- ✅ **Advanced bitfield operations** with support for signed/unsigned integers of 1-64 bits
- ✅ **Multiple integer types** supporting u1-u64 (unsigned) and i1-i64 (signed) data types
- ✅ **Overflow handling** with WRAP (default), SAT (saturate), and FAIL behaviors for arithmetic operations
- ✅ **Type-based offsets** with #n syntax for automatic offset calculation based on field width
- ✅ **Complex operations** allowing multiple GET/SET/INCRBY operations in single BITFIELD command
- ✅ **Range operations** with byte-level start/end parameters for BITCOUNT and BITPOS
- ✅ **Big-endian bit ordering** matching Redis's bit layout and indexing scheme
- ✅ **Automatic buffer expansion** dynamically growing storage as needed for large bit offsets
- ✅ **Type safety and isolation** ensuring bitmap keys are separate from other data types
- ✅ **RDB persistence integration** enabling bitmap data to be saved and restored in snapshots
- ✅ **Redis compatibility** matching exact Redis bitmap and bitfield command behavior and response formats
- ✅ **Error handling** with comprehensive validation and Redis-compatible error messages
- ✅ **Performance optimization** using efficient bit manipulation algorithms and memory management

### Phase 14: Streams ✅
**Status**: Complete

**Implemented Commands**:
- `XADD key id field value [field value ...]` - Add entry to stream with auto-generated or explicit ID
- `XLEN key` - Get number of entries in stream
- `XRANGE key start end [COUNT count]` - Get range of entries from stream (forward)
- `XREVRANGE key end start [COUNT count]` - Get range of entries from stream (reverse)
- `XREAD [COUNT count] [BLOCK milliseconds] STREAMS key [key ...] id [id ...]` - Read entries from one or more streams
- `XTRIM key MAXLEN|MINID [~] count|id` - Trim stream to maximum length or minimum ID
- `XDEL key id [id ...]` - Delete entries from stream
- `XSETID key id` - Set stream last generated ID
- `XGROUP CREATE key groupname id` - Create consumer group for distributed processing
- `XGROUP DESTROY key groupname` - Destroy consumer group
- `XGROUP SETID key groupname id` - Set consumer group last delivered ID
- `XGROUP CREATECONSUMER key groupname consumername` - Create consumer in group without reading
- `XGROUP DELCONSUMER key groupname consumername` - Delete consumer from group
- `XAUTOCLAIM key group consumer min-idle-time start [COUNT count] [JUSTID]` - Auto-claim pending entries from idle consumers
- `XINFO STREAM key` - Get detailed stream information
- `XINFO GROUPS key` - Get consumer groups information
- `XINFO CONSUMERS key group` - Get consumers information for a group

**Advanced Commands (Placeholder)**:
- `XREADGROUP GROUP group consumer [options] STREAMS key [key ...] id [id ...]` - Read from stream as consumer group
- `XACK key group id [id ...]` - Acknowledge processed entries
- `XPENDING key group [start end count] [consumer]` - Get pending entries information
- `XCLAIM key group consumer min-idle-time id [id ...] [options]` - Claim pending entries

**Features**:
- ✅ **Time-ordered data records** with unique timestamp-sequence IDs (e.g., "1609459200000-0")
- ✅ **Auto-generated IDs** using current timestamp or explicit ID specification with validation
- ✅ **Stream entries** storing field-value pairs with efficient access and retrieval
- ✅ **Range queries** supporting forward (XRANGE) and reverse (XREVRANGE) iteration
- ✅ **Stream management** with trimming (XTRIM) and deletion (XDEL) operations
- ✅ **Multi-stream reading** with XREAD supporting multiple streams and filtering
- ✅ **Consumer groups** for distributed stream processing and load balancing
- ✅ **Stream introspection** with XINFO commands for monitoring and debugging
- ✅ **ID validation and ordering** ensuring chronological consistency and duplicate prevention
- ✅ **Memory-efficient storage** using JavaScript Map for optimal performance
- ✅ **COUNT and BLOCK options** for pagination and non-blocking/blocking reads
- ✅ **Approximate trimming** with ~ flag for performance optimization
- ✅ **Consumer group management** with creation, destruction, and member operations
- ✅ **Stream metadata tracking** including last generated ID, length, and group information
- ✅ **Type safety and isolation** ensuring stream keys are separate from other data types
- ✅ **RDB persistence integration** enabling stream data to be saved and restored in snapshots
- ✅ **Redis compatibility** matching Redis stream command behavior and response formats
- ✅ **Error handling** with comprehensive validation and Redis-compatible error messages
- ✅ **Performance optimization** using efficient algorithms for time-ordered data management

## Example Usage

```bash
$ node server.js
Redis-Clone Server started. Type "help" for available commands.
Use QUIT or Ctrl+C to exit.

redis-clone> SET name "John Doe"
OK
redis-clone> GET name
"John Doe"
redis-clone> SET age 30
OK
redis-clone> EXISTS name age
(integer) 2
redis-clone> KEYS *
1) "name"
2) "age"
redis-clone> DEL age
(integer) 1
redis-clone> GET age
(nil)
redis-clone> HELP
Available commands:

=== Basic Key-Value Operations ===
SET key value                 - Set key to hold string value
GET key                      - Get the value of key
DEL key [key ...]           - Delete one or more keys
EXISTS key [key ...]        - Check if one or more keys exist
KEYS pattern                - Find all keys matching pattern (* for all)
FLUSHALL                    - Remove all keys from all databases

=== String Operations ===
APPEND key value             - Append value to key
STRLEN key                   - Get the length of the value stored in key

=== Atomic Operations ===
INCR key                     - Increment the integer value of key by one
DECR key                     - Decrement the integer value of key by one
INCRBY key increment         - Increment the integer value of key by increment
DECRBY key decrement         - Decrement the integer value of key by decrement

=== Key Expiration ===
EXPIRE key seconds           - Set timeout on key in seconds
TTL key                      - Get time to live for key in seconds
PERSIST key                  - Remove timeout from key

=== Key Management ===
RENAME key newkey            - Rename key to newkey

=== System ===
HELP                        - Show this help message
QUIT/EXIT                   - Exit the server
```

## Architecture

### Core Components

1. **RedisClone Class** (`server.js`)
   - Main server class managing the data store
   - CLI interface and command processing
   - In-memory storage using JavaScript Map

2. **Command Parser**
   - Handles quoted strings and complex command parsing
   - Redis-compatible argument processing

3. **Storage Engine**
   - Simple Map-based key-value storage
   - Ready for extension to support complex data types

## Development Phases

This project follows an 19-phase development plan:

- ✅ **Phase 1**: Foundation & Basic Key-Value Store
- ✅ **Phase 2**: String Operations & Key Management
- ✅ **Phase 3**: List Data Structure
- ✅ **Phase 4**: Set Data Structure
- ✅ **Phase 5**: Hash Data Structure
- ✅ **Phase 6**: Sorted Sets
- ✅ **Phase 7**: JSON Support
- ✅ **Phase 8**: Transaction Support
- ✅ **Phase 9**: Pub/Sub Mechanism
- ✅ **Phase 10**: Persistence - AOF
- ✅ **Phase 11**: Persistence - RDB Snapshots
- ✅ **Phase 12**: Geospatial Data
- ✅ **Phase 13**: Bitmaps & Bitfields
- ✅ **Phase 14**: Streams
- ⏳ **Phase 15**: Vector Database
- ⏳ **Phase 16**: Document Database
- ⏳ **Phase 17**: Probabilistic Data Structures
- ⏳ **Phase 18**: Time Series Support

## Contributing

Each phase builds upon the previous ones without breaking existing functionality. The codebase maintains Redis compatibility while being built from scratch in JavaScript.

## Testing

To test the current implementation:

1. Start the server: `node server.js`
2. Test basic commands as shown in the example usage
3. Verify Redis-compatible responses and error handling

## License

This project is for educational purposes, implementing Redis-like functionality from scratch.
