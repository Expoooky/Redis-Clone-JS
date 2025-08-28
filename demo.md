# Redis-Clone-JS Demo

## Quick Start

To start the Redis-compatible server:

```bash
node server.js
```

## Example Session

```
$ node server.js
Redis-Clone Server started. Type "help" for available commands.
Use QUIT or Ctrl+C to exit.

redis-clone> SET user:1 "John Doe"
OK
redis-clone> SET user:2 "Jane Smith"  
OK
redis-clone> SET config:timeout 30
OK
redis-clone> GET user:1
"John Doe"
redis-clone> EXISTS user:1 user:2 user:3
(integer) 2
redis-clone> KEYS user:*
1) "user:1"
2) "user:2"
redis-clone> KEYS *
1) "user:1"
2) "user:2"
3) "config:timeout"
redis-clone> DEL user:2
(integer) 1
redis-clone> KEYS user:*
1) "user:1"
redis-clone> FLUSHALL
OK
redis-clone> KEYS *
(empty list or set)
redis-clone> HELP
Available commands:
SET key value                 - Set key to hold string value
GET key                      - Get the value of key
DEL key [key ...]           - Delete one or more keys
EXISTS key [key ...]        - Check if one or more keys exist
KEYS pattern                - Find all keys matching pattern (* for all)
FLUSHALL                    - Remove all keys from all databases
HELP                        - Show this help message
QUIT/EXIT                   - Exit the server
redis-clone> QUIT
Goodbye!
```

## Error Handling

The server provides Redis-compatible error messages:

```
redis-clone> SET key
(error) ERR wrong number of arguments for 'set' command
redis-clone> UNKNOWN_COMMAND
(error) ERR unknown command 'UNKNOWN_COMMAND'
redis-clone> GET
(error) ERR wrong number of arguments for 'get' command
```

## Advanced Phase 2 Examples

### String Operations
```
redis-clone> SET message "Hello"
OK
redis-clone> APPEND message " World!"
(integer) 12
redis-clone> GET message
"Hello World!"
redis-clone> STRLEN message
(integer) 12
```

### Atomic Operations
```
redis-clone> SET counter 10
OK
redis-clone> INCR counter
(integer) 11
redis-clone> INCRBY counter 5
(integer) 16
redis-clone> DECR counter
(integer) 15
redis-clone> DECRBY counter 3
(integer) 12
redis-clone> INCRBYFLOAT counter 2.5
"14.5"
```

### Advanced String Operations
```
redis-clone> MSETNX name1 "Alice" name2 "Bob" name3 "Charlie"
(integer) 1
redis-clone> MSETNX name1 "Dave" name4 "Eve"
(integer) 0
redis-clone> SET temp "temporary value"
OK
redis-clone> GETDEL temp
"temporary value"
redis-clone> GET temp
(nil)
redis-clone> SET string1 "ABCDEFG"
OK
redis-clone> SET string2 "ABCFGH"
OK
redis-clone> LCS string1 string2
"ABCFG"
redis-clone> LCS string1 string2 LEN
(integer) 5
redis-clone> LCS string1 string2 IDX
1) "matches"
2) 1) 1) (integer) 0
     2) (integer) 4
   2) 1) (integer) 0
     2) (integer) 4
3) "len"  
4) (integer) 5
```

### Key Expiration
```
redis-clone> SET temp_key "temporary data"
OK
redis-clone> EXPIRE temp_key 30
(integer) 1
redis-clone> TTL temp_key
(integer) 29
redis-clone> PERSIST temp_key
(integer) 1
redis-clone> TTL temp_key
(integer) -1
```

### Key Management
```
redis-clone> SET old_name "value"
OK
redis-clone> RENAME old_name new_name
OK
redis-clone> GET new_name
"value"
redis-clone> GET old_name
(nil)
```

### Redis 7.x SET Command Features
```
redis-clone> SET key value EX 30
OK
redis-clone> SET key value PX 5000
OK
redis-clone> SET new_key value NX
OK
redis-clone> SET new_key value NX
(nil)
redis-clone> SET existing_key newvalue XX
OK
redis-clone> SET key newvalue GET
"value"
redis-clone> SET key value KEEPTTL
OK
```

### Millisecond Precision Expiration
```
redis-clone> SET key value
OK
redis-clone> PEXPIRE key 1500
(integer) 1
redis-clone> PTTL key
(integer) 1498
redis-clone> TTL key
(integer) 2
```

### List Operations
```
redis-clone> LPUSH mylist a b c
(integer) 3
redis-clone> LRANGE mylist 0 -1
1) "c"
2) "b" 
3) "a"
redis-clone> RPUSH mylist d e
(integer) 5
redis-clone> LRANGE mylist 0 -1
1) "c"
2) "b"
3) "a"
4) "d"
5) "e"
redis-clone> LPOP mylist
"c"
redis-clone> RPOP mylist
"e"
redis-clone> LLEN mylist
(integer) 3
redis-clone> LINDEX mylist 1
"b"
redis-clone> LINDEX mylist -1
"d"
redis-clone> LSET mylist 0 x
OK
redis-clone> LRANGE mylist 0 -1
1) "x"
2) "b"
3) "d"
redis-clone> LTRIM mylist 0 1
OK
redis-clone> LRANGE mylist 0 -1
1) "x"
2) "b"
```

### Advanced List Operations
```
redis-clone> LPUSH source a b c d e
(integer) 5
redis-clone> RPUSH dest x y z
(integer) 3
redis-clone> LRANGE source 0 -1
1) "e"
2) "d"
3) "c"
4) "b"
5) "a"
redis-clone> LRANGE dest 0 -1
1) "x"
2) "y"
3) "z"
redis-clone> LMOVE source dest LEFT RIGHT
"e"
redis-clone> LRANGE source 0 -1
1) "d"
2) "c"
3) "b"
4) "a"
redis-clone> LRANGE dest 0 -1
1) "x"
2) "y"
3) "z"
4) "e"
redis-clone> LMOVE source dest RIGHT LEFT
"a"
redis-clone> LRANGE dest 0 -1
1) "a"
2) "x"
3) "y"
4) "z"
5) "e"
redis-clone> LPUSH search_list apple banana apple cherry apple
(integer) 5
redis-clone> LPOS search_list apple
(integer) 0
redis-clone> LPOS search_list apple RANK 2
(integer) 2
redis-clone> LPOS search_list apple COUNT 3
1) (integer) 0
2) (integer) 2
3) (integer) 4
redis-clone> LPUSH pop1 1 2 3
(integer) 3
redis-clone> LPUSH pop2 4 5 6
(integer) 3
redis-clone> LMPOP 2 pop1 pop2 LEFT COUNT 2
1) "pop1"
2) 1) "3"
   2) "2"
```

### Blocking List Operations
```
redis-clone> LPUSH queue task1 task2 task3
(integer) 3
redis-clone> BLPOP queue 0
1) "queue"
2) "task3"
redis-clone> BRPOP queue 5
1) "queue"
2) "task1"
redis-clone> LPUSH blocking_list item1 item2
(integer) 2
redis-clone> BRPOPLPUSH blocking_list processed_list 0
"item1"
redis-clone> LRANGE processed_list 0 -1
1) "item1"
redis-clone> BLMOVE blocking_list processed_list LEFT RIGHT 0
"item2"
redis-clone> LRANGE processed_list 0 -1
1) "item1"
2) "item2"
redis-clone> BLPOP empty_list 1
(nil)
```

### Type Safety and Data Structure Isolation
```
redis-clone> SET stringkey "hello"
OK
redis-clone> LPUSH listkey item
(integer) 1
redis-clone> TYPE stringkey
string
redis-clone> TYPE listkey
list
redis-clone> LPUSH stringkey value
(error) WRONGTYPE Operation against a key holding the wrong kind of value
redis-clone> GET listkey
(error) WRONGTYPE Operation against a key holding the wrong kind of value
```

### Set Operations and Mathematics
```
redis-clone> SADD myset a b c
(integer) 3
redis-clone> SADD myset a d
(integer) 1
redis-clone> SMEMBERS myset
1) "a"
2) "b" 
3) "c"
4) "d"
redis-clone> SCARD myset
(integer) 4
redis-clone> SISMEMBER myset a
(integer) 1
redis-clone> SISMEMBER myset x
(integer) 0
redis-clone> SREM myset b
(integer) 1
redis-clone> SMEMBERS myset
1) "a"
2) "c"
3) "d"
```

### Set Mathematics Operations
```
redis-clone> SADD set1 a b c
(integer) 3
redis-clone> SADD set2 b c d
(integer) 3
redis-clone> SADD set3 c d e
(integer) 3
redis-clone> SUNION set1 set2
1) "a"
2) "b"
3) "c"
4) "d"
redis-clone> SINTER set1 set2
1) "b"
2) "c"
redis-clone> SDIFF set1 set2
1) "a"
redis-clone> SINTER set1 set2 set3
1) "c"
```

### Advanced Set Operations
```
redis-clone> SADD team1 alice bob charlie diana
(integer) 4
redis-clone> SADD team2 bob charlie eve frank
(integer) 4
redis-clone> SADD team3 charlie diana grace henry
(integer) 4
redis-clone> SINTERCARD 3 team1 team2 team3
(integer) 1
redis-clone> SINTERCARD 2 team1 team2 LIMIT 5
(integer) 2
redis-clone> SMISMEMBER team1 alice bob zoe
1) (integer) 1
2) (integer) 1
3) (integer) 0
redis-clone> SSCAN team1 0 MATCH *a* COUNT 10
1) "0"
2) 1) "alice"
   2) "diana"
redis-clone> SSCAN team2 0 COUNT 2
1) "2"  
2) 1) "bob"
   2) "charlie"
```

### Hash Operations and Field Management
```
redis-clone> HSET user:1001 name "John Doe" age 30 email "john@example.com"
(integer) 3
redis-clone> HGET user:1001 name
"John Doe"
redis-clone> HGETALL user:1001
1) "name"
2) "John Doe"
3) "age"
4) "30"
5) "email"
6) "john@example.com"
redis-clone> HLEN user:1001
(integer) 3
redis-clone> HEXISTS user:1001 name
(integer) 1
redis-clone> HEXISTS user:1001 phone
(integer) 0
redis-clone> HDEL user:1001 email
(integer) 1
redis-clone> HKEYS user:1001
1) "name"
2) "age"
redis-clone> HVALS user:1001
1) "John Doe"
2) "30"
```

### Hash Numeric Operations
```
redis-clone> HSET stats:user:1001 visits 0 score 100.5
(integer) 2
redis-clone> HINCRBY stats:user:1001 visits 1
(integer) 1
redis-clone> HINCRBY stats:user:1001 visits 5
(integer) 6
redis-clone> HINCRBYFLOAT stats:user:1001 score 25.75
"126.25"
redis-clone> HMGET stats:user:1001 visits score
1) "6"
2) "126.25"
redis-clone> HSETNX stats:user:1001 level 1
(integer) 1
redis-clone> HSETNX stats:user:1001 level 2
(integer) 0
```

### Advanced Hash Operations with Field Expiration (Redis 7.2+)
```
redis-clone> HSET user:session:123 token "abc123" ip "192.168.1.1" login_time "2024-01-01T00:00:00Z"
(integer) 3
redis-clone> HGETALL user:session:123
1) "token"
2) "abc123"
3) "ip"
4) "192.168.1.1"
5) "login_time"
6) "2024-01-01T00:00:00Z"
redis-clone> HEXPIRE user:session:123 30 token
1) (integer) 1
redis-clone> HPEXPIRE user:session:123 45000 ip
1) (integer) 1
redis-clone> HTTL user:session:123 token
1) (integer) 29
redis-clone> HPTTL user:session:123 ip
1) (integer) 44850
redis-clone> HGETDEL user:session:123 token
"abc123"
redis-clone> HGETALL user:session:123
1) "ip"
2) "192.168.1.1"
3) "login_time"
4) "2024-01-01T00:00:00Z"
redis-clone> HPERSIST user:session:123 ip
1) (integer) 1
redis-clone> HTTL user:session:123 ip
1) (integer) -1
```

### Sorted Set Operations and Score-Based Ranking
```
redis-clone> ZADD leaderboard 100 alice 200 bob 150 charlie 180 diana
(integer) 4
redis-clone> ZCARD leaderboard
(integer) 4
redis-clone> ZSCORE leaderboard alice
"100"
redis-clone> ZRANK leaderboard alice
(integer) 0
redis-clone> ZRANK leaderboard bob
(integer) 3
redis-clone> ZREVRANK leaderboard bob
(integer) 0
redis-clone> ZRANGE leaderboard 0 -1
1) "alice"
2) "charlie"
3) "diana"
4) "bob"
redis-clone> ZRANGE leaderboard 0 -1 WITHSCORES
1) "alice"
2) "100"
3) "charlie"
4) "150"
5) "diana"
6) "180"
7) "bob"
8) "200"
```

### Sorted Set Range Queries and Score Operations
```
redis-clone> ZREVRANGE leaderboard 0 2
1) "bob"
2) "diana"
3) "charlie"
redis-clone> ZRANGEBYSCORE leaderboard 150 200
1) "charlie"
2) "diana"
3) "bob"
redis-clone> ZRANGEBYSCORE leaderboard 100 180 WITHSCORES LIMIT 1 2
1) "charlie"
2) "150"
3) "diana"
4) "180"
redis-clone> ZCOUNT leaderboard 150 200
(integer) 3
redis-clone> ZINCRBY leaderboard 50 alice
"150"
redis-clone> ZRANK leaderboard alice
(integer) 1
redis-clone> ZREM leaderboard charlie
(integer) 1
redis-clone> ZCARD leaderboard
(integer) 3
```

### Advanced Sorted Set Operations
```
redis-clone> ZADD scores 10 a 20 b 30 c 40 d 50 e 60 f
(integer) 6
redis-clone> ZREMRANGEBYRANK scores 0 2
(integer) 3
redis-clone> ZRANGE scores 0 -1
1) "d"
2) "e"
3) "f"
redis-clone> ZADD products 1.5 apple 2.5 banana 3.5 cherry 4.5 date
(integer) 4
redis-clone> ZREMRANGEBYSCORE products 2.0 3.0
(integer) 1
redis-clone> ZRANGE products 0 -1 WITHSCORES
1) "apple"
2) "1.5"
3) "cherry"
4) "3.5"
5) "date"
6) "4.5"
redis-clone> ZREVRANGEBYSCORE products 4.0 2.0 WITHSCORES
1) "cherry"
2) "3.5"
```

### Lexicographical Operations (Equal Scores)
```
redis-clone> ZADD names 0 "Alice" 0 "Bob" 0 "Charlie" 0 "Diana" 0 "Eve"
(integer) 5
redis-clone> ZRANGE names 0 -1
1) "Alice"
2) "Bob"
3) "Charlie"
4) "Diana"
5) "Eve"
redis-clone> ZRANGEBYLEX names [A [D
1) "Alice"
2) "Bob"
3) "Charlie"
redis-clone> ZRANGEBYLEX names [C [Z
1) "Charlie"
2) "Diana"
3) "Eve"
redis-clone> ZLEXCOUNT names [A [Z
(integer) 5
redis-clone> ZLEXCOUNT names [B [D
(integer) 3
redis-clone> ZREVRANGEBYLEX names [Z [A
1) "Eve"
2) "Diana"
3) "Charlie"
4) "Bob"
5) "Alice"
redis-clone> ZREMRANGEBYLEX names [D [F
(integer) 2
redis-clone> ZRANGE names 0 -1
1) "Alice"
2) "Bob"
3) "Charlie"
```

### Advanced Sorted Set Operations
```
redis-clone> ZADD leaderboard 100 alice 200 bob 150 charlie 180 diana 120 eve
(integer) 5
redis-clone> ZPOPMIN leaderboard 2
1) "alice"
2) "100"
3) "eve"
4) "120"
redis-clone> ZPOPMAX leaderboard 1
1) "bob"
2) "200"
redis-clone> ZMSCORE leaderboard charlie diana eve
1) "150"
2) "180"
3) (nil)
redis-clone> ZRANDMEMBER leaderboard 2 WITHSCORES
1) "diana"
2) "180"
3) "charlie"
4) "150"
redis-clone> ZADD set1 1 a 2 b 3 c
(integer) 3
redis-clone> ZADD set2 2 b 3 c 4 d
(integer) 3
redis-clone> ZUNION 2 set1 set2
1) "a"
2) "b"
3) "c"
4) "d"
redis-clone> ZUNIONSTORE result 2 set1 set2
(integer) 4
redis-clone> ZRANGE result 0 -1 WITHSCORES
1) "a"
2) "1"
3) "b"
4) "4"
5) "c"
6) "6"
7) "d"
8) "4"
redis-clone> ZINTER 2 set1 set2
1) "b"
2) "c"
redis-clone> ZDIFF 2 set1 set2
1) "a"
redis-clone> ZINTERCARD 2 set1 set2
(integer) 2
redis-clone> ZMPOP 2 set1 set2 MIN COUNT 1
1) "set1"
2) 1) "a"
   2) "1"
redis-clone> ZRANGESTORE backup leaderboard 0 1
(integer) 2
redis-clone> ZRANGE backup 0 -1 WITHSCORES
1) "charlie"
2) "150"
3) "diana"
4) "180"
```

### Type Safety with Sorted Sets
```
redis-clone> ZADD myzset 1.0 member1 2.0 member2
(integer) 2
redis-clone> TYPE myzset
zset
redis-clone> SET stringkey "hello"
OK
redis-clone> ZADD stringkey 1 member
(error) WRONGTYPE Operation against a key holding the wrong kind of value
redis-clone> ZRANGE stringkey 0 -1
(error) WRONGTYPE Operation against a key holding the wrong kind of value
```

### JSON Operations and Native JSON Support
```
redis-clone> JSON.SET user $ '{"name":"John","age":30,"skills":["JavaScript","Redis"],"active":true}'
OK
redis-clone> JSON.GET user
"{"name":"John","age":30,"skills":["JavaScript","Redis"],"active":true}"
redis-clone> JSON.GET user $.name
""John""
redis-clone> JSON.GET user $.age
"30"
redis-clone> JSON.TYPE user
"object"
redis-clone> JSON.TYPE user $.name
"string"
redis-clone> JSON.TYPE user $.skills
"array"
```

### JSON Array Operations
```
redis-clone> JSON.ARRLEN user $.skills
(integer) 2
redis-clone> JSON.ARRAPPEND user $.skills "Python" "Go" "Docker"
(integer) 5
redis-clone> JSON.GET user $.skills
"["JavaScript","Redis","Python","Go","Docker"]"
redis-clone> JSON.ARRLEN user $.skills
(integer) 5
redis-clone> JSON.ARRINDEX user $.skills "Redis"
(integer) 1
redis-clone> JSON.ARRINSERT user $.skills 2 "TypeScript"
(integer) 6
redis-clone> JSON.ARRPOP user $.skills -1
""Docker""
redis-clone> JSON.ARRTRIM user $.skills 0 3
(integer) 4
```

### JSON Object Operations
```
redis-clone> JSON.OBJKEYS user $
1) "name"
2) "age"
3) "skills"
4) "active"
redis-clone> JSON.OBJLEN user $
(integer) 4
redis-clone> JSON.SET user $.location '{"city":"New York","country":"USA"}'
OK
redis-clone> JSON.OBJKEYS user $.location
1) "city"
2) "country"
redis-clone> JSON.OBJLEN user $.location
(integer) 2
```

### JSON Numeric Operations
```
redis-clone> JSON.NUMINCRBY user $.age 5
"35"
redis-clone> JSON.GET user $.age
"35"
redis-clone> JSON.NUMMULTBY user $.age 2
"70"
redis-clone> JSON.GET user $.age
"70"
```

### JSON Multi-Key Operations and Advanced Features
```
redis-clone> JSON.SET user2 $ '{"name":"Jane","age":25,"role":"Developer"}'
OK
redis-clone> JSON.MGET user user2 $.name
1) ""John""
2) ""Jane""
redis-clone> JSON.MGET user user2 $.age
1) "70"
2) "25"
redis-clone> JSON.STRLEN user $.name
(integer) 4
redis-clone> JSON.STRLEN user2 $.role
(integer) 9
```

### JSON Debug and Utility Operations
```
redis-clone> JSON.DEBUG MEMORY user
(integer) 98
redis-clone> JSON.SET user $.temp "temporary" NX
OK
redis-clone> JSON.SET user $.temp "updated" XX
OK
redis-clone> JSON.GET user $.temp
""updated""
redis-clone> JSON.CLEAR user $.location
(integer) 1
redis-clone> JSON.GET user $.location
"{}"
redis-clone> JSON.DEL user $.temp
(integer) 1
```

### Advanced JSON Operations (New Commands)
```
redis-clone> JSON.SET data $ '{"text":"Hello","flag":false,"extra":{"count":5}}'
OK
redis-clone> JSON.STRAPPEND data $.text " World!"
(integer) 12
redis-clone> JSON.GET data $.text
""Hello World!""
redis-clone> JSON.TOGGLE data $.flag
(integer) 1
redis-clone> JSON.GET data $.flag
"true"
redis-clone> JSON.MERGE data $.extra '{"count":10,"new":"added"}'
OK
redis-clone> JSON.GET data $.extra
"{"count":10,"new":"added"}"
redis-clone> JSON.MSET user1 $ '{"name":"Alice"}' user2 $ '{"name":"Bob"}' user3 $ '{"name":"Charlie"}'
OK
redis-clone> JSON.MGET user1 user2 user3 $.name
1) ""Alice""
2) ""Bob""
3) ""Charlie""
```

### Type Safety with JSON
```
redis-clone> JSON.SET jsonkey $ '{"data":"json"}'
OK
redis-clone> SET stringkey "string"
OK
redis-clone> TYPE jsonkey
json
redis-clone> TYPE stringkey
string
redis-clone> JSON.GET stringkey
(error) WRONGTYPE Operation against a key holding the wrong kind of value
redis-clone> GET jsonkey
(error) WRONGTYPE Operation against a key holding the wrong kind of value
```

## Features Implemented

✅ **Phase 1: Foundation & Basic Key-Value Store**
- Complete Redis-compatible CLI interface
- Core key-value operations with proper error handling
- Pattern matching for KEYS command
- Quoted string support in command parsing
- Redis-style response formatting

✅ **Phase 2: String Operations & Key Management**
- String manipulation (APPEND, STRLEN)
- Atomic increment/decrement operations (INCR, DECR, INCRBY, DECRBY)
- **Float increment operations (INCRBYFLOAT)**
- **Multiple key operations with existence checking (MSETNX)**
- **Atomic get-and-delete operations (GETDEL)**
- **Longest Common Subsequence analysis (LCS) with advanced options**
- Key expiration system with background cleanup
- Time-to-live functionality
- Key renaming with expiration preservation
- **Full Redis 7.x SET command compatibility**
- Millisecond precision expiration (PEXPIRE, PTTL)

✅ **Phase 3: List Data Structure**
- Complete list implementation with LPUSH, RPUSH, LPOP, RPOP
- List access operations (LLEN, LRANGE, LINDEX)
- List modification operations (LSET, LTRIM)
- Advanced list operations (LINSERT, LPUSHX, RPUSHX, LREM)
- List movement operations (RPOPLPUSH, LMOVE)  
- List search operations (LPOS with RANK, COUNT, MAXLEN)
- Multi-list operations (LMPOP)
- Blocking list operations (BLPOP, BRPOP, BRPOPLPUSH, BLMOVE, BLMPOP)
- Support for negative indexing
- Automatic key cleanup when lists become empty
- Full type checking and data structure isolation
- Memory-efficient operations

✅ **Phase 4: Set Data Structure**
- Complete set implementation with uniqueness guarantee
- Set manipulation operations (SADD, SREM, SMEMBERS, SCARD, SISMEMBER)
- Set mathematics operations (SUNION, SINTER, SDIFF)
- Advanced set operations (SPOP, SRANDMEMBER, SMOVE)
- Set storage operations (SUNIONSTORE, SINTERSTORE, SDIFFSTORE) 
- Multi-member operations (SMISMEMBER, SINTERCARD with LIMIT)
- Set iteration (SSCAN with MATCH and COUNT)
- Efficient O(1) operations using JavaScript Set
- Automatic key cleanup when sets become empty
- Full type checking and data structure isolation
- Redis-compatible behavior for set operations

✅ **Phase 5: Hash Data Structure**
- Complete hash implementation with field-value mapping
- Hash manipulation operations (HSET, HGET, HDEL, HEXISTS, HLEN)
- Bulk operations (HMGET, HGETALL, HKEYS, HVALS, HMSET)
- Numeric operations (HINCRBY, HINCRBYFLOAT)
- Conditional operations (HSETNX)
- Advanced operations (HRANDFIELD, HSTRLEN, HSCAN, HGETDEL)
- **Field-level expiration support (Redis 7.2+ feature)**
- Field TTL management with second/millisecond precision
- Atomic get-and-delete operations
- Automatic expired field cleanup with lazy expiration checking
- Efficient O(1) field operations using JavaScript Map
- Automatic key cleanup when hashes become empty
- Full type checking and data structure isolation

✅ **Phase 6: Sorted Set Data Structure**
- Complete sorted set implementation with score-based ordering
- Basic operations (ZADD, ZREM, ZSCORE, ZCARD, ZCOUNT)
- Rank operations (ZRANK, ZREVRANK) with position tracking
- Range operations (ZRANGE, ZREVRANGE) with optional WITHSCORES
- Score-based range queries (ZRANGEBYSCORE, ZREVRANGEBYSCORE) with LIMIT support
- Advanced operations (ZINCRBY, ZREMRANGEBYRANK, ZREMRANGEBYSCORE)
- Lexicographical operations (ZRANGEBYLEX, ZREVRANGEBYLEX, ZLEXCOUNT, ZREMRANGEBYLEX)
- **Advanced pop operations (ZPOPMIN, ZPOPMAX, ZMPOP)**
- **Multi-set operations (ZUNION, ZINTER, ZDIFF with STORE variants)**
- **Random member selection (ZRANDMEMBER with WITHSCORES)**
- **Cursor-based iteration (ZSCAN with MATCH and COUNT)**
- **Multi-member score retrieval (ZMSCORE)**
- **Set intersection cardinality (ZINTERCARD with LIMIT)**
- **Range storage operations (ZRANGESTORE)**
- **Blocking operations (BZPOPMIN, BZPOPMAX, BZMPOP)**
- Efficient binary search insertion maintaining sorted order
- Lexicographic ordering for members with equal scores
- Support for Redis-style lexicographical bounds ([, (, -, +)
- Floating-point score precision with proper arithmetic
- Full type checking and data structure isolation
- Automatic key cleanup when sorted sets become empty

✅ **Phase 7: JSON Data Structure**
- **Native JSON storage and manipulation** with full Redis JSON compatibility
- **JSONPath support** with dot notation and array indexing ($.field.subfield)
- **Complete array operations** (append, insert, pop, trim, search, length)
- **Complete object operations** (keys, length, nested access, manipulation)
- **Type-safe numeric operations** (increment, multiply) with float support
- **Multi-key bulk operations** (JSON.MGET for efficient retrieval)
- **Advanced path-based access** for deeply nested JSON structures
- **Conditional operations** (NX/XX options for existence checking)
- **Debug utilities** (memory tracking, RESP format conversion)
- **JSON formatting options** (INDENT, NEWLINE, SPACE)
- **Automatic type detection** and validation for all JSON types
- **Memory-efficient storage** with lazy evaluation and caching
- **Multi-key JSON operations** (JSON.MSET for bulk key setting)
- **String manipulation** (JSON.STRAPPEND for appending to strings)
- **Boolean toggling** (JSON.TOGGLE for flipping boolean values)
- **JSON merging** (JSON.MERGE for combining JSON objects)
- Full type checking and data structure isolation
- Automatic key cleanup when JSON objects become empty

All **Phase 1, 2, 3, 4, 5, 6, and 7** are complete with **full Redis compatibility** and ready for Phase 8 development!
