# Redis-like Data Store - Protocol & Commands

## RESP Protocol

The server uses Redis Serialization Protocol (RESP) for client-server communication:

### Data Types
- **Simple String**: `+OK\r\n` - Status replies
- **Error**: `-ERR message\r\n` - Error responses
- **Integer**: `:123\r\n` - Numeric replies
- **Bulk String**: `$<len>\r\n<payload>\r\n` - Binary-safe strings (or `$-1\r\n` for null)
- **Array**: `*<count>\r\n` followed by `<count>` RESP nodes - Collections

### Client Requests
Clients send commands as arrays of bulk strings:
```
*2\r\n$3\r\nSET\r\n$3\r\nkey\r\n$5\r\nvalue\r\n
```
This represents: `SET key value`

### Server Responses
- Success: `+OK\r\n`
- Integer: `:42\r\n`
- Bulk string: `$5\r\nhello\r\n`
- Null: `$-1\r\n`
- Array: `*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n`
- Error: `-ERR wrong number of arguments\r\n`

## Core Key-Value Operations

### SET key value [EX seconds] [PX milliseconds]
Set key to value with optional expiration.
- Response: `+OK\r\n`

### GET key
Get value of key.
- Response: Bulk string or null

### DEL key [key ...]
Delete keys.
- Response: Integer (count of deleted keys)

### EXISTS key [key ...]
Check if keys exist.
- Response: Integer (count of existing keys)

### EXPIRE key seconds
Set key expiration in seconds.
- Response: Integer (1 if set, 0 if key doesn't exist)

### TTL key
Get remaining TTL in seconds.
- Response: Integer (-2 if key doesn't exist, -1 if no expiration)

### PERSIST key
Remove expiration from key.
- Response: Integer (1 if removed, 0 if no expiration)

## String Operations

### APPEND key value
Append value to key.
- Response: Integer (new length)

### STRLEN key
Get string length.
- Response: Integer

### INCR key
Increment integer value by 1.
- Response: Integer (new value)

### DECR key
Decrement integer value by 1.
- Response: Integer (new value)

### INCRBY key increment
Increment by specified amount.
- Response: Integer (new value)

### DECRBY key decrement
Decrement by specified amount.
- Response: Integer (new value)

### GETRANGE key start end
Get substring.
- Response: Bulk string

### SETRANGE key offset value
Set substring at offset.
- Response: Integer (new length)

## JSON Operations

### JSON.SET key path json_value
Set JSON value at path.
- Response: `+OK\r\n`

### JSON.GET key [path]
Get JSON value at path (default: root).
- Response: Bulk string (JSON) or null

### JSON.DEL key [path]
Delete JSON value at path.
- Response: Integer (elements removed)

### JSON.ARRAPPEND key path value [value ...]
Append values to JSON array.
- Response: Integer (new array length)

## List Operations

### LPUSH key element [element ...]
Prepend elements to list.
- Response: Integer (new length)

### RPUSH key element [element ...]
Append elements to list.
- Response: Integer (new length)

### LPOP key
Remove and return first element.
- Response: Bulk string or null

### RPOP key
Remove and return last element.
- Response: Bulk string or null

### LRANGE key start stop
Get range of elements.
- Response: Array of bulk strings

### LINDEX key index
Get element at index.
- Response: Bulk string or null

### LSET key index element
Set element at index.
- Response: `+OK\r\n`

## Set Operations

### SADD key member [member ...]
Add members to set.
- Response: Integer (added count)

### SREM key member [member ...]
Remove members from set.
- Response: Integer (removed count)

### SISMEMBER key member
Check if member exists.
- Response: Integer (1 or 0)

### SMEMBERS key
Get all members.
- Response: Array of bulk strings

### SINTER key [key ...]
Intersection of sets.
- Response: Array of bulk strings

### SUNION key [key ...]
Union of sets.
- Response: Array of bulk strings

### SDIFF key [key ...]
Difference of sets.
- Response: Array of bulk strings

## Hash Operations

### HSET key field value [field value ...]
Set hash fields.
- Response: Integer (fields added)

### HGET key field
Get hash field value.
- Response: Bulk string or null

### HMSET key field value [field value ...]
Set multiple hash fields.
- Response: `+OK\r\n`

### HGETALL key
Get all hash fields and values.
- Response: Array [field1, value1, field2, value2, ...]

### HDEL key field [field ...]
Delete hash fields.
- Response: Integer (deleted count)

### HEXISTS key field
Check if hash field exists.
- Response: Integer (1 or 0)

## Sorted Set Operations

### ZADD key score member [score member ...]
Add members with scores.
- Response: Integer (added count)

### ZRANGE key start stop [WITHSCORES]
Get range of members by index.
- Response: Array of members [and scores if WITHSCORES]

### ZRANGEBYSCORE key min max
Get members by score range.
- Response: Array of members

### ZRANK key member
Get rank of member.
- Response: Integer or null

### ZREM key member [member ...]
Remove members.
- Response: Integer (removed count)

## Stream Operations

### XADD key ID field value [field value ...]
Add entry to stream with auto-generated ID (*).
- Response: Bulk string (generated ID)

### XRANGE key start end [COUNT count]
Get range of stream entries.
- Response: Array of [ID, [field, value, ...]]

### XLEN key
Get stream length.
- Response: Integer

### XREAD COUNT count STREAMS key [key ...] ID [ID ...]
Read from streams.
- Response: Array of [stream_key, [[ID, [field, value, ...]], ...]]

### XGROUP CREATE key groupname ID [$]
Create consumer group.
- Response: `+OK\r\n`

### XREADGROUP GROUP group consumer COUNT count STREAMS key ID [>]
Read from consumer group.
- Response: Array of [stream_key, [[ID, [field, value, ...]], ...]]

### XACK key group ID [ID ...]
Acknowledge processed entries.
- Response: Integer (acknowledged count)

## Geospatial Operations

### GEOADD key longitude latitude member [long lat member ...]
Add geospatial members.
- Response: Integer (added count)

### GEOSEARCH key FROMMEMBER|FROM member|LONLAT long lat BYRADIUS|BOX width height unit [ASC|DESC] [COUNT count]
Search geospatial data.
- Response: Array of members

### GEODIST key member1 member2 [unit]
Get distance between members.
- Response: Bulk string (formatted distance) or null

### GEOHASH key member [member ...]
Get geohash strings.
- Response: Array of geohash strings

### GEOPOS key member [member ...]
Get coordinates.
- Response: Array of [longitude, latitude] or null

## Bitmap Operations

### SETBIT key offset value
Set bit at offset.
- Response: Integer (previous bit value)

### GETBIT key offset
Get bit at offset.
- Response: Integer (0 or 1)

### BITCOUNT key [start end]
Count set bits.
- Response: Integer

### BITOP operation destkey key [key ...]
Perform bitwise operations.
- Response: Integer (result length)

## Bitfield Operations

### BITFIELD key GET type offset | SET type offset value | INCRBY type offset increment | OVERFLOW WRAP|SAT|FAIL
Manipulate multiple counters in a string.
- Response: Array of values

## HyperLogLog Operations

### PFADD key element [element ...]
Add elements to HyperLogLog.
- Response: Integer (1 if register changed, 0 otherwise)

### PFCOUNT key [key ...]
Get cardinality estimate.
- Response: Integer

### PFMERGE destkey sourcekey [sourcekey ...]
Merge HyperLogLog registers.
- Response: `+OK\r\n`

## Time Series Operations

### TS.CREATE key [RETENTION retention] [DUPLICATE_POLICY policy]
Create time series.
- Response: `+OK\r\n`

### TS.ADD key timestamp value [RETENTION retention] [ON_DUPLICATE policy]
Add data point.
- Response: Integer (timestamp used)

### TS.GET key
Get latest data point.
- Response: Array [timestamp, value] or null

### TS.RANGE key from_timestamp to_timestamp [COUNT count] [AGGREGATION aggregator bucket_duration]
Get data points in range.
- Response: Array of [timestamp, value] arrays

## Document Database Operations

### DOC.INDEXCREATE index_name PREFIX prefix SCHEMA field type [field type ...]
Create document index.
- Response: `+OK\r\n`

### DOC.INDEXADD index_name doc_id
Add document to index.
- Response: `+OK\r\n`

### DOC.SEARCH index_name query
Search documents.
- Response: Array of document IDs

## Vector Database Operations

### VEC.CREATEINDEX index_name DIMENSION dim DISTANCE_METRIC metric [HNSW_M n_links] [EF_CONSTRUCTION ef]
Create vector index.
- Response: `+OK\r\n`

### VEC.ADD index_name vector_id vector_values
Add vector to index.
- Response: `+OK\r\n`

### VEC.SEARCH index_name query_vector [K k] [EF_RUNTIME ef]
Search for similar vectors.
- Response: Array of [vector_id, distance] pairs

## Transaction Operations

### MULTI
Start transaction.
- Response: `+OK\r\n`

### EXEC
Execute transaction.
- Response: Array of command responses

### DISCARD
Discard transaction.
- Response: `+OK\r\n`

## Pub/Sub Operations

### SUBSCRIBE channel [channel ...]
Subscribe to channels.
- Response: Array of subscription messages

### PUBLISH channel message
Publish message to channel.
- Response: Integer (subscriber count)

## Persistence Operations

### SAVE
Synchronously save dataset to disk.
- Response: `+OK\r\n`

### BGSAVE
Asynchronously save dataset to disk.
- Response: `+OK\r\n`

## Replication Operations

### REPLICAOF host port
Make server a replica of another server.
- Response: `+OK\r\n`

### REPLICAOF NO ONE
Stop replication, become master.
- Response: `+OK\r\n`

## Security Operations

### AUTH password
Authenticate client.
- Response: `+OK\r\n`

## Monitoring Operations

### INFO [section]
Get server information.
- Response: Bulk string (formatted info)

### SLOWLOG LEN
Get slow log length.
- Response: Integer

### SLOWLOG GET [count]
Get slow log entries.
- Response: Array of slow log entries

## Error Responses

- `-ERR wrong number of arguments for 'command' command\r\n`
- `-ERR unknown command 'command'\r\n`
- `-WRONGTYPE Operation against a key holding the wrong kind of value\r\n`

## Notes

- All commands are case-insensitive
- TimeSeries timestamps and values return as integers when numeric
- GEO distances match Redis formatting (e.g., "166274.1516" for meters)
- Geohashes use 11-character format matching Redis
- Arrays are 0-indexed
- Negative indices count from end
- Null values are represented as `$-1\r\n`
