# Redis Clone JS - API Documentation

## Overview

Redis Clone JS is a comprehensive Redis-compatible in-memory data store implementation in JavaScript. This document provides complete API reference for all supported commands and features.

## Connection and Server Commands

### PING
Tests server connectivity.
```
PING [message]
```
**Returns:** PONG or the provided message

### ECHO
Returns the given string.
```
ECHO message
```
**Returns:** The message string

### INFO
Returns server information.
```
INFO [section]
```
**Returns:** Server information string

### FLUSHDB
Removes all keys from the current database.
```
FLUSHDB
```
**Returns:** OK

### FLUSHALL
Removes all keys from all databases.
```
FLUSHALL
```
**Returns:** OK

### DBSIZE
Returns the number of keys in the current database.
```
DBSIZE
```
**Returns:** Integer - number of keys

### SELECT
Selects the database with the specified zero-based numeric index.
```
SELECT index
```
**Returns:** OK

## String Commands

### SET
Sets the string value of a key.
```
SET key value [EX seconds] [PX milliseconds] [NX|XX]
```
**Options:**
- `EX seconds` - Set expiration time in seconds
- `PX milliseconds` - Set expiration time in milliseconds  
- `NX` - Only set if key doesn't exist
- `XX` - Only set if key exists

**Returns:** OK or NULL (if NX/XX conditions not met)

### GET
Gets the value of a key.
```
GET key
```
**Returns:** String value or NULL if key doesn't exist

### MSET
Sets multiple keys to multiple values.
```
MSET key1 value1 key2 value2 [key3 value3 ...]
```
**Returns:** OK

### MGET
Returns the values of all specified keys.
```
MGET key1 key2 [key3 ...]
```
**Returns:** Array of values (NULL for missing keys)

### STRLEN
Returns the length of the string value stored at key.
```
STRLEN key
```
**Returns:** Integer - length of string or 0 if key doesn't exist

### APPEND
Appends a value to a key.
```
APPEND key value
```
**Returns:** Integer - length of string after append

### GETRANGE
Returns a substring of the string value stored at key.
```
GETRANGE key start end
```
**Returns:** Substring

### SETRANGE
Overwrites part of the string stored at key.
```
SETRANGE key offset value
```
**Returns:** Integer - length of string after modification

### INCR
Increments the integer value of a key by one.
```
INCR key
```
**Returns:** Integer - value after increment

### DECR
Decrements the integer value of a key by one.
```
DECR key
```
**Returns:** Integer - value after decrement

### INCRBY
Increments the integer value of a key by the given amount.
```
INCRBY key increment
```
**Returns:** Integer - value after increment

### DECRBY
Decrements the integer value of a key by the given amount.
```
DECRBY key decrement
```
**Returns:** Integer - value after decrement

### INCRBYFLOAT
Increments the float value of a key by the given amount.
```
INCRBYFLOAT key increment
```
**Returns:** Float - value after increment

## List Commands

### LPUSH
Inserts elements at the head of the list.
```
LPUSH key element [element ...]
```
**Returns:** Integer - length of list after operation

### RPUSH
Inserts elements at the tail of the list.
```
RPUSH key element [element ...]
```
**Returns:** Integer - length of list after operation

### LPOP
Removes and returns the first element of the list.
```
LPOP key
```
**Returns:** String - popped element or NULL if list is empty

### RPOP
Removes and returns the last element of the list.
```
RPOP key
```
**Returns:** String - popped element or NULL if list is empty

### LLEN
Returns the length of the list.
```
LLEN key
```
**Returns:** Integer - length of list

### LINDEX
Returns the element at index in the list.
```
LINDEX key index
```
**Returns:** String - element at index or NULL

### LSET
Sets the list element at index to element.
```
LSET key index element
```
**Returns:** OK or error if index out of range

### LRANGE
Returns a range of elements from the list.
```
LRANGE key start stop
```
**Returns:** Array of elements

### LTRIM
Trims the list to the specified range.
```
LTRIM key start stop
```
**Returns:** OK

### LREM
Removes elements from the list.
```
LREM key count element
```
**Returns:** Integer - number of removed elements

### LINSERT
Inserts element before or after the pivot element.
```
LINSERT key BEFORE|AFTER pivot element
```
**Returns:** Integer - length of list after insertion

## Hash Commands

### HSET
Sets field in the hash stored at key to value.
```
HSET key field value [field value ...]
```
**Returns:** Integer - number of fields added

### HGET
Returns the value associated with field in the hash.
```
HGET key field
```
**Returns:** String - field value or NULL

### HMSET
Sets multiple hash fields to multiple values.
```
HMSET key field1 value1 field2 value2 [field3 value3 ...]
```
**Returns:** OK

### HMGET
Returns the values associated with the specified fields.
```
HMGET key field1 field2 [field3 ...]
```
**Returns:** Array of values

### HGETALL
Returns all fields and values of the hash.
```
HGETALL key
```
**Returns:** Array of field-value pairs

### HKEYS
Returns all field names in the hash.
```
HKEYS key
```
**Returns:** Array of field names

### HVALS
Returns all values in the hash.
```
HVALS key
```
**Returns:** Array of values

### HLEN
Returns the number of fields in the hash.
```
HLEN key
```
**Returns:** Integer - number of fields

### HEXISTS
Determines if a hash field exists.
```
HEXISTS key field
```
**Returns:** Integer - 1 if field exists, 0 otherwise

### HDEL
Deletes one or more hash fields.
```
HDEL key field [field ...]
```
**Returns:** Integer - number of fields removed

### HINCRBY
Increments the integer value of a hash field.
```
HINCRBY key field increment
```
**Returns:** Integer - value after increment

### HINCRBYFLOAT
Increments the float value of a hash field.
```
HINCRBYFLOAT key field increment
```
**Returns:** Float - value after increment

### HSTRLEN
Returns the string length of the value associated with field.
```
HSTRLEN key field
```
**Returns:** Integer - length of field value

## Set Commands

### SADD
Adds members to a set.
```
SADD key member [member ...]
```
**Returns:** Integer - number of elements added

### SREM
Removes members from a set.
```
SREM key member [member ...]
```
**Returns:** Integer - number of elements removed

### SMEMBERS
Returns all members of the set.
```
SMEMBERS key
```
**Returns:** Array of set members

### SCARD
Returns the number of elements in the set.
```
SCARD key
```
**Returns:** Integer - set cardinality

### SISMEMBER
Determines if a given value is a member of a set.
```
SISMEMBER key member
```
**Returns:** Integer - 1 if member exists, 0 otherwise

### SPOP
Removes and returns one or more random members from a set.
```
SPOP key [count]
```
**Returns:** String or Array - removed member(s)

### SRANDMEMBER
Returns one or more random members from a set.
```
SRANDMEMBER key [count]
```
**Returns:** String or Array - random member(s)

### SMOVE
Moves a member from one set to another.
```
SMOVE source destination member
```
**Returns:** Integer - 1 if successful, 0 otherwise

### SINTER
Returns the intersection of multiple sets.
```
SINTER key [key ...]
```
**Returns:** Array of intersecting members

### SUNION
Returns the union of multiple sets.
```
SUNION key [key ...]
```
**Returns:** Array of union members

### SDIFF
Returns the difference between sets.
```
SDIFF key [key ...]
```
**Returns:** Array of differing members

### SINTERSTORE
Stores the intersection of multiple sets in a key.
```
SINTERSTORE destination key [key ...]
```
**Returns:** Integer - number of elements in resulting set

### SUNIONSTORE
Stores the union of multiple sets in a key.
```
SUNIONSTORE destination key [key ...]
```
**Returns:** Integer - number of elements in resulting set

### SDIFFSTORE
Stores the difference between sets in a key.
```
SDIFFSTORE destination key [key ...]
```
**Returns:** Integer - number of elements in resulting set

## Sorted Set Commands

### ZADD
Adds members with scores to a sorted set.
```
ZADD key [NX|XX] [CH] [INCR] score member [score member ...]
```
**Returns:** Integer - number of elements added

### ZREM
Removes members from a sorted set.
```
ZREM key member [member ...]
```
**Returns:** Integer - number of elements removed

### ZRANGE
Returns a range of members from a sorted set.
```
ZRANGE key start stop [WITHSCORES]
```
**Returns:** Array of members (and scores if WITHSCORES)

### ZREVRANGE
Returns a range of members from a sorted set in reverse order.
```
ZREVRANGE key start stop [WITHSCORES]
```
**Returns:** Array of members (and scores if WITHSCORES)

### ZRANGEBYSCORE
Returns members with scores between min and max.
```
ZRANGEBYSCORE key min max [WITHSCORES] [LIMIT offset count]
```
**Returns:** Array of members (and scores if WITHSCORES)

### ZREVRANGEBYSCORE
Returns members with scores between max and min in reverse order.
```
ZREVRANGEBYSCORE key max min [WITHSCORES] [LIMIT offset count]
```
**Returns:** Array of members (and scores if WITHSCORES)

### ZRANK
Returns the rank of a member in a sorted set.
```
ZRANK key member
```
**Returns:** Integer - rank or NULL if member doesn't exist

### ZREVRANK
Returns the rank of a member in a sorted set in reverse order.
```
ZREVRANK key member
```
**Returns:** Integer - reverse rank or NULL

### ZSCORE
Returns the score of a member in a sorted set.
```
ZSCORE key member
```
**Returns:** Float - score or NULL if member doesn't exist

### ZCARD
Returns the number of elements in a sorted set.
```
ZCARD key
```
**Returns:** Integer - set cardinality

### ZCOUNT
Returns the number of elements with scores between min and max.
```
ZCOUNT key min max
```
**Returns:** Integer - count of elements

### ZINCRBY
Increments the score of a member in a sorted set.
```
ZINCRBY key increment member
```
**Returns:** Float - new score

### ZREMRANGEBYRANK
Removes members by rank range.
```
ZREMRANGEBYRANK key start stop
```
**Returns:** Integer - number of elements removed

### ZREMRANGEBYSCORE
Removes members by score range.
```
ZREMRANGEBYSCORE key min max
```
**Returns:** Integer - number of elements removed

## Key Management Commands

### EXISTS
Determines if one or more keys exist.
```
EXISTS key [key ...]
```
**Returns:** Integer - number of existing keys

### DEL
Deletes one or more keys.
```
DEL key [key ...]
```
**Returns:** Integer - number of keys deleted

### TYPE
Returns the data type of the value stored at key.
```
TYPE key
```
**Returns:** String - data type (string, list, set, zset, hash, none)

### KEYS
Returns all keys matching a pattern.
```
KEYS pattern
```
**Returns:** Array of matching keys

### SCAN
Incrementally iterates over a collection of keys.
```
SCAN cursor [MATCH pattern] [COUNT count]
```
**Returns:** Array with cursor and keys

### RENAME
Renames a key.
```
RENAME key newkey
```
**Returns:** OK

### RENAMENX
Renames a key only if the new key doesn't exist.
```
RENAMENX key newkey
```
**Returns:** Integer - 1 if renamed, 0 otherwise

### RANDOMKEY
Returns a random key from the keyspace.
```
RANDOMKEY
```
**Returns:** String - random key or NULL if database is empty

### SORT
Sorts the elements in a list, set, or sorted set.
```
SORT key [BY pattern] [LIMIT offset count] [GET pattern] [ASC|DESC] [ALPHA] [STORE destination]
```
**Returns:** Array of sorted elements

## Expiration Commands

### EXPIRE
Sets a timeout on a key.
```
EXPIRE key seconds
```
**Returns:** Integer - 1 if timeout set, 0 if key doesn't exist

### EXPIREAT
Sets an absolute timeout on a key.
```
EXPIREAT key timestamp
```
**Returns:** Integer - 1 if timeout set, 0 if key doesn't exist

### PEXPIRE
Sets a timeout on a key in milliseconds.
```
PEXPIRE key milliseconds
```
**Returns:** Integer - 1 if timeout set, 0 if key doesn't exist

### PEXPIREAT
Sets an absolute timeout on a key in milliseconds.
```
PEXPIREAT key milliseconds-timestamp
```
**Returns:** Integer - 1 if timeout set, 0 if key doesn't exist

### TTL
Returns the remaining time to live of a key.
```
TTL key
```
**Returns:** Integer - TTL in seconds (-1 if no expiry, -2 if key doesn't exist)

### PTTL
Returns the remaining time to live of a key in milliseconds.
```
PTTL key
```
**Returns:** Integer - TTL in milliseconds

### PERSIST
Removes the expiration from a key.
```
PERSIST key
```
**Returns:** Integer - 1 if expiration removed, 0 otherwise

## Pub/Sub Commands

### PUBLISH
Posts a message to a channel.
```
PUBLISH channel message
```
**Returns:** Integer - number of clients that received the message

### SUBSCRIBE
Subscribes to channels.
```
SUBSCRIBE channel [channel ...]
```
**Returns:** Subscription confirmation messages

### UNSUBSCRIBE
Unsubscribes from channels.
```
UNSUBSCRIBE [channel [channel ...]]
```
**Returns:** Unsubscription confirmation messages

### PSUBSCRIBE
Subscribes to channels matching patterns.
```
PSUBSCRIBE pattern [pattern ...]
```
**Returns:** Subscription confirmation messages

### PUNSUBSCRIBE
Unsubscribes from channel patterns.
```
PUNSUBSCRIBE [pattern [pattern ...]]
```
**Returns:** Unsubscription confirmation messages

### PUBSUB
Introspects the pub/sub subsystem.
```
PUBSUB CHANNELS [pattern]
PUBSUB NUMSUB [channel [channel ...]]
PUBSUB NUMPAT
```
**Returns:** Varies based on subcommand

## Transaction Commands

### MULTI
Marks the start of a transaction block.
```
MULTI
```
**Returns:** OK

### EXEC
Executes all commands issued after MULTI.
```
EXEC
```
**Returns:** Array of command results or NULL if transaction was discarded

### DISCARD
Discards all commands issued after MULTI.
```
DISCARD
```
**Returns:** OK

### WATCH
Watches keys for conditional execution of a transaction.
```
WATCH key [key ...]
```
**Returns:** OK

### UNWATCH
Forgets about all watched keys.
```
UNWATCH
```
**Returns:** OK

## Scripting Commands

### EVAL
Executes a Lua script server side.
```
EVAL script numkeys key [key ...] arg [arg ...]
```
**Returns:** Script execution result

### EVALSHA
Executes a Lua script by its SHA1 digest.
```
EVALSHA sha1 numkeys key [key ...] arg [arg ...]
```
**Returns:** Script execution result

### SCRIPT LOAD
Loads a script into the script cache.
```
SCRIPT LOAD script
```
**Returns:** SHA1 digest of the script

### SCRIPT EXISTS
Checks if scripts exist in the script cache.
```
SCRIPT EXISTS sha1 [sha1 ...]
```
**Returns:** Array of existence flags

### SCRIPT FLUSH
Removes all scripts from the script cache.
```
SCRIPT FLUSH
```
**Returns:** OK

### SCRIPT KILL
Kills the script currently in execution.
```
SCRIPT KILL
```
**Returns:** OK

## Error Handling

All commands return appropriate error messages for:
- Wrong number or type of arguments
- Invalid data types for operations  
- Out of range values
- Memory limitations
- Syntax errors

Error messages follow Redis conventions and include descriptive text to help diagnose issues.

## Data Types

### Strings
- Binary-safe strings up to 512MB
- Can contain any kind of data (JPEG image, serialized object, etc.)
- Automatic type conversion for numeric operations

### Lists
- Ordered collections of strings
- Support for push/pop operations at both ends
- Maximum length: 2^32 - 1 elements

### Sets
- Unordered collections of unique strings
- Fast membership testing and set operations
- Maximum members: 2^32 - 1

### Sorted Sets
- Sets with associated scores for ordering
- Fast range queries by score or rank
- Unique members with updatable scores

### Hashes
- Field-value pairs, like small dictionaries
- Efficient for representing objects
- Maximum fields: 2^32 - 1

## Performance Characteristics

- **Memory Usage**: Optimized data structures for minimal memory overhead
- **Throughput**: Thousands of operations per second
- **Latency**: Sub-millisecond response times for most operations
- **Scalability**: Linear performance scaling with data size

## Configuration

Server configuration options are available through the config system:
- Memory limits and policies
- Persistence settings
- Network configuration
- Logging levels
- Security settings

For complete configuration reference, see the Configuration Guide.
