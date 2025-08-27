#!/usr/bin/env node

/**
 * Redis-like In-Memory Data Store
 * Phase 5: Hash Data Structure
 * 
 * Entry point: node server.js
 */

const readline = require('readline');

/**
 * Redis List implementation with efficient operations
 */
class RedisList {
    constructor() {
        this.elements = [];
    }

    /**
     * Push elements to the left (beginning) of the list
     * @param {...any} elements - Elements to push
     * @returns {number} - New length of the list
     */
    lpush(...elements) {
        // Elements should be added one by one from left to right
        // So if we LPUSH a b c, the result should be [c, b, a, ...existing]
        for (const element of elements) {
            this.elements.unshift(element);
        }
        return this.elements.length;
    }

    /**
     * Push elements to the right (end) of the list
     * @param {...any} elements - Elements to push
     * @returns {number} - New length of the list
     */
    rpush(...elements) {
        this.elements.push(...elements);
        return this.elements.length;
    }

    /**
     * Pop element from the left (beginning) of the list
     * @returns {any} - Popped element or undefined if empty
     */
    lpop() {
        return this.elements.shift();
    }

    /**
     * Pop element from the right (end) of the list
     * @returns {any} - Popped element or undefined if empty
     */
    rpop() {
        return this.elements.pop();
    }

    /**
     * Get the length of the list
     * @returns {number} - Length of the list
     */
    length() {
        return this.elements.length;
    }

    /**
     * Get element at specific index
     * @param {number} index - Index (can be negative for reverse indexing)
     * @returns {any} - Element at index or undefined
     */
    index(index) {
        const len = this.elements.length;
        if (len === 0) return undefined;

        // Handle negative indices
        if (index < 0) {
            index = len + index;
        }

        if (index < 0 || index >= len) {
            return undefined;
        }

        return this.elements[index];
    }

    /**
     * Set element at specific index
     * @param {number} index - Index to set
     * @param {any} value - Value to set
     * @returns {boolean} - True if successful, false if index out of range
     */
    set(index, value) {
        const len = this.elements.length;
        if (len === 0) return false;

        // Handle negative indices
        if (index < 0) {
            index = len + index;
        }

        if (index < 0 || index >= len) {
            return false;
        }

        this.elements[index] = value;
        return true;
    }

    /**
     * Get range of elements
     * @param {number} start - Start index (inclusive)
     * @param {number} stop - Stop index (inclusive)
     * @returns {Array} - Array of elements in range
     */
    range(start, stop) {
        const len = this.elements.length;
        if (len === 0) return [];

        // Handle negative indices
        if (start < 0) start = len + start;
        if (stop < 0) stop = len + stop;

        // Clamp to valid range
        start = Math.max(0, start);
        stop = Math.min(len - 1, stop);

        if (start > stop) return [];

        return this.elements.slice(start, stop + 1);
    }

    /**
     * Trim list to specified range
     * @param {number} start - Start index (inclusive)
     * @param {number} stop - Stop index (inclusive)
     */
    trim(start, stop) {
        const len = this.elements.length;
        if (len === 0) return;

        // Handle negative indices
        if (start < 0) start = len + start;
        if (stop < 0) stop = len + stop;

        // Clamp to valid range
        start = Math.max(0, start);
        stop = Math.min(len - 1, stop);

        if (start > stop) {
            this.elements = [];
        } else {
            this.elements = this.elements.slice(start, stop + 1);
        }
    }

    /**
     * Convert to array (for serialization)
     * @returns {Array} - Array representation
     */
    toArray() {
        return [...this.elements];
    }
}

/**
 * Redis Set implementation with uniqueness guarantee and set operations
 */
class RedisSet {
    constructor() {
        // Use Set for O(1) add/remove/has operations and automatic uniqueness
        this.members = new Set();
    }

    /**
     * Add members to the set
     * @param {...any} members - Members to add
     * @returns {number} - Number of new members added
     */
    sadd(...members) {
        let addedCount = 0;
        for (const member of members) {
            if (!this.members.has(member)) {
                this.members.add(member);
                addedCount++;
            }
        }
        return addedCount;
    }

    /**
     * Remove members from the set
     * @param {...any} members - Members to remove
     * @returns {number} - Number of members removed
     */
    srem(...members) {
        let removedCount = 0;
        for (const member of members) {
            if (this.members.has(member)) {
                this.members.delete(member);
                removedCount++;
            }
        }
        return removedCount;
    }

    /**
     * Get all members of the set
     * @returns {Array} - Array of all members
     */
    smembers() {
        return Array.from(this.members);
    }

    /**
     * Get the cardinality (size) of the set
     * @returns {number} - Number of members in the set
     */
    scard() {
        return this.members.size;
    }

    /**
     * Check if a member exists in the set
     * @param {any} member - Member to check
     * @returns {boolean} - True if member exists
     */
    sismember(member) {
        return this.members.has(member);
    }

    /**
     * Get union with other sets
     * @param {...RedisSet} otherSets - Other sets to union with
     * @returns {RedisSet} - New set containing union
     */
    sunion(...otherSets) {
        const unionSet = new RedisSet();
        
        // Add all members from this set
        for (const member of this.members) {
            unionSet.members.add(member);
        }
        
        // Add all members from other sets
        for (const otherSet of otherSets) {
            for (const member of otherSet.members) {
                unionSet.members.add(member);
            }
        }
        
        return unionSet;
    }

    /**
     * Get intersection with other sets
     * @param {...RedisSet} otherSets - Other sets to intersect with
     * @returns {RedisSet} - New set containing intersection
     */
    sinter(...otherSets) {
        const intersectionSet = new RedisSet();
        
        if (otherSets.length === 0) {
            // If no other sets, return copy of this set
            for (const member of this.members) {
                intersectionSet.members.add(member);
            }
            return intersectionSet;
        }
        
        // Find members that exist in all sets
        for (const member of this.members) {
            let existsInAll = true;
            for (const otherSet of otherSets) {
                if (!otherSet.members.has(member)) {
                    existsInAll = false;
                    break;
                }
            }
            if (existsInAll) {
                intersectionSet.members.add(member);
            }
        }
        
        return intersectionSet;
    }

    /**
     * Get difference with other sets (members in this set but not in others)
     * @param {...RedisSet} otherSets - Other sets to subtract
     * @returns {RedisSet} - New set containing difference
     */
    sdiff(...otherSets) {
        const diffSet = new RedisSet();
        
        // Add members from this set that don't exist in any other set
        for (const member of this.members) {
            let existsInOther = false;
            for (const otherSet of otherSets) {
                if (otherSet.members.has(member)) {
                    existsInOther = true;
                    break;
                }
            }
            if (!existsInOther) {
                diffSet.members.add(member);
            }
        }
        
        return diffSet;
    }

    /**
     * Check if set is empty
     * @returns {boolean} - True if set is empty
     */
    isEmpty() {
        return this.members.size === 0;
    }

    /**
     * Convert to array (for serialization)
     * @returns {Array} - Array representation
     */
    toArray() {
        return Array.from(this.members);
    }
}

/**
 * Redis Hash implementation with field-value operations
 */
class RedisHash {
    constructor() {
        // Use Map for O(1) field operations and proper key ordering
        this.fields = new Map();
    }

    /**
     * Set field(s) in hash
     * @param {...any} args - Alternating field-value pairs
     * @returns {number} - Number of new fields added
     */
    hset(...args) {
        if (args.length === 0 || args.length % 2 !== 0) {
            throw new Error("ERR wrong number of arguments for HSET");
        }

        let newFieldsCount = 0;
        for (let i = 0; i < args.length; i += 2) {
            const field = args[i];
            const value = args[i + 1];
            
            if (!this.fields.has(field)) {
                newFieldsCount++;
            }
            this.fields.set(field, value);
        }
        
        return newFieldsCount;
    }

    /**
     * Get field value from hash
     * @param {string} field - Field name
     * @returns {any} - Field value or undefined
     */
    hget(field) {
        return this.fields.get(field);
    }

    /**
     * Get multiple field values
     * @param {...string} fields - Field names
     * @returns {Array} - Array of values (undefined for non-existent fields)
     */
    hmget(...fields) {
        return fields.map(field => this.fields.get(field));
    }

    /**
     * Get all field-value pairs
     * @returns {Array} - Flat array of alternating field-value pairs
     */
    hgetall() {
        const result = [];
        for (const [field, value] of this.fields.entries()) {
            result.push(field, value);
        }
        return result;
    }

    /**
     * Delete field(s) from hash
     * @param {...string} fields - Field names to delete
     * @returns {number} - Number of fields deleted
     */
    hdel(...fields) {
        let deletedCount = 0;
        for (const field of fields) {
            if (this.fields.delete(field)) {
                deletedCount++;
            }
        }
        return deletedCount;
    }

    /**
     * Check if field exists in hash
     * @param {string} field - Field name
     * @returns {boolean} - True if field exists
     */
    hexists(field) {
        return this.fields.has(field);
    }

    /**
     * Get all field names
     * @returns {Array} - Array of field names
     */
    hkeys() {
        return Array.from(this.fields.keys());
    }

    /**
     * Get all values
     * @returns {Array} - Array of values
     */
    hvals() {
        return Array.from(this.fields.values());
    }

    /**
     * Get number of fields
     * @returns {number} - Number of fields in hash
     */
    hlen() {
        return this.fields.size;
    }

    /**
     * Increment field by integer value
     * @param {string} field - Field name
     * @param {number} increment - Integer increment
     * @returns {number} - New value after increment
     */
    hincrby(field, increment) {
        const currentValue = this.fields.get(field) || '0';
        const numValue = parseInt(currentValue, 10);
        
        if (isNaN(numValue)) {
            throw new Error("ERR hash value is not an integer");
        }
        
        const newValue = numValue + increment;
        this.fields.set(field, newValue.toString());
        return newValue;
    }

    /**
     * Increment field by float value
     * @param {string} field - Field name
     * @param {number} increment - Float increment
     * @returns {number} - New value after increment
     */
    hincrbyfloat(field, increment) {
        const currentValue = this.fields.get(field) || '0';
        const numValue = parseFloat(currentValue);
        
        if (isNaN(numValue)) {
            throw new Error("ERR hash value is not a float");
        }
        
        const newValue = numValue + increment;
        this.fields.set(field, newValue.toString());
        return newValue;
    }

    /**
     * Set field only if it doesn't exist
     * @param {string} field - Field name
     * @param {any} value - Value to set
     * @returns {boolean} - True if field was set, false if it already existed
     */
    hsetnx(field, value) {
        if (this.fields.has(field)) {
            return false;
        }
        this.fields.set(field, value);
        return true;
    }

    /**
     * Check if hash is empty
     * @returns {boolean} - True if hash is empty
     */
    isEmpty() {
        return this.fields.size === 0;
    }

    /**
     * Convert to object (for serialization)
     * @returns {Object} - Object representation
     */
    toObject() {
        const obj = {};
        for (const [field, value] of this.fields.entries()) {
            obj[field] = value;
        }
        return obj;
    }
}

class RedisClone {
    constructor() {
        // In-memory storage for key-value pairs
        this.data = new Map();
        
        // Storage for data types (key -> type string)
        this.types = new Map();
        
        // Storage for key expiration times (key -> timestamp)
        this.expiration = new Map();
        
        // Start background cleanup for expired keys
        this.startExpirationCleanup();
        
        // Initialize CLI interface
        this.setupCLI();
        
        console.log('Redis-Clone Server started. Type "help" for available commands.');
        console.log('Use QUIT or Ctrl+C to exit.\n');
    }

    /**
     * Start background cleanup for expired keys
     */
    startExpirationCleanup() {
        // Check for expired keys every 1 second
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredKeys();
        }, 1000);
    }

    /**
     * Clean up expired keys from storage
     */
    cleanupExpiredKeys() {
        const now = Date.now();
        for (const [key, expireTime] of this.expiration.entries()) {
            if (now >= expireTime) {
                this.deleteKey(key);
            }
        }
    }

    /**
     * Check if a key has expired
     * @param {string} key - Key to check
     * @returns {boolean} - True if key has expired
     */
    isKeyExpired(key) {
        if (!this.expiration.has(key)) {
            return false;
        }
        
        const expireTime = this.expiration.get(key);
        const now = Date.now();
        
        if (now >= expireTime) {
            // Key has expired, clean it up immediately
            this.deleteKey(key);
            return true;
        }
        
        return false;
    }

    /**
     * Get value checking for expiration
     * @param {string} key - Key to get
     * @returns {any} - Value or undefined if expired/missing
     */
    getValue(key) {
        if (this.isKeyExpired(key)) {
            return undefined;
        }
        return this.data.get(key);
    }

    /**
     * Get the type of a key
     * @param {string} key - Key to check
     * @returns {string} - Type name or 'none' if key doesn't exist
     */
    getType(key) {
        if (this.isKeyExpired(key) || !this.data.has(key)) {
            return 'none';
        }
        return this.types.get(key) || 'string';
    }

    /**
     * Check if key exists and is of expected type
     * @param {string} key - Key to check
     * @param {string} expectedType - Expected type
     * @returns {boolean} - True if key exists and matches type
     */
    checkType(key, expectedType) {
        const actualType = this.getType(key);
        return actualType === 'none' || actualType === expectedType;
    }

    /**
     * Set value with type tracking
     * @param {string} key - Key to set
     * @param {any} value - Value to set
     * @param {string} type - Type of the value
     */
    setValue(key, value, type = 'string') {
        this.data.set(key, value);
        this.types.set(key, type);
    }

    /**
     * Delete key and clean up all related data
     * @param {string} key - Key to delete
     */
    deleteKey(key) {
        this.data.delete(key);
        this.types.delete(key);
        this.expiration.delete(key);
    }

    /**
     * Set up the command line interface
     */
    setupCLI() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: 'redis-clone> '
        });

        this.rl.prompt();

        this.rl.on('line', (input) => {
            const result = this.processCommand(input.trim());
            if (result !== null) {
                console.log(result);
            }
            this.rl.prompt();
        });

        this.rl.on('close', () => {
            // Clean up background timer
            if (this.cleanupInterval) {
                clearInterval(this.cleanupInterval);
            }
            console.log('\nGoodbye!');
            process.exit(0);
        });

        // Handle Ctrl+C gracefully
        process.on('SIGINT', () => {
            this.rl.close();
        });
    }

    /**
     * Process incoming commands
     * @param {string} input - Raw command input
     * @returns {string|null} - Command result or null for quit
     */
    processCommand(input) {
        if (!input) {
            return '';
        }

        // Parse command and arguments
        const args = this.parseCommand(input);
        if (args.length === 0) {
            return '';
        }

        const command = args[0].toUpperCase();
        const commandArgs = args.slice(1);

        try {
            switch (command) {
                case 'HELP':
                    return this.help();
                case 'QUIT':
                case 'EXIT':
                    this.rl.close();
                    return null;
                // Phase 1 commands
                case 'SET':
                    return this.set(commandArgs);
                case 'GET':
                    return this.get(commandArgs);
                case 'DEL':
                    return this.del(commandArgs);
                case 'EXISTS':
                    return this.exists(commandArgs);
                case 'KEYS':
                    return this.keys(commandArgs);
                case 'FLUSHALL':
                    return this.flushall();
                // Phase 2 commands - String Operations
                case 'APPEND':
                    return this.append(commandArgs);
                case 'STRLEN':
                    return this.strlen(commandArgs);
                // Phase 2 commands - Atomic Operations
                case 'INCR':
                    return this.incr(commandArgs);
                case 'DECR':
                    return this.decr(commandArgs);
                case 'INCRBY':
                    return this.incrby(commandArgs);
                case 'DECRBY':
                    return this.decrby(commandArgs);
                // Phase 2 commands - Expiration
                case 'EXPIRE':
                    return this.expire(commandArgs);
                case 'PEXPIRE':
                    return this.pexpire(commandArgs);
                case 'TTL':
                    return this.ttl(commandArgs);
                case 'PTTL':
                    return this.pttl(commandArgs);
                case 'PERSIST':
                    return this.persist(commandArgs);
                // Phase 2 commands - Key Management
                case 'RENAME':
                    return this.rename(commandArgs);
                // Phase 3 commands - List Operations
                case 'LPUSH':
                    return this.lpush(commandArgs);
                case 'RPUSH':
                    return this.rpush(commandArgs);
                case 'LPOP':
                    return this.lpop(commandArgs);
                case 'RPOP':
                    return this.rpop(commandArgs);
                case 'LLEN':
                    return this.llen(commandArgs);
                case 'LRANGE':
                    return this.lrange(commandArgs);
                case 'LINDEX':
                    return this.lindex(commandArgs);
                case 'LSET':
                    return this.lset(commandArgs);
                case 'LTRIM':
                    return this.ltrim(commandArgs);
                // Phase 4 commands - Set Operations
                case 'SADD':
                    return this.sadd(commandArgs);
                case 'SREM':
                    return this.srem(commandArgs);
                case 'SMEMBERS':
                    return this.smembers(commandArgs);
                case 'SCARD':
                    return this.scard(commandArgs);
                case 'SISMEMBER':
                    return this.sismember(commandArgs);
                case 'SUNION':
                    return this.sunion(commandArgs);
                case 'SINTER':
                    return this.sinter(commandArgs);
                case 'SDIFF':
                    return this.sdiff(commandArgs);
                // Phase 5 commands - Hash Operations
                case 'HSET':
                    return this.hset(commandArgs);
                case 'HGET':
                    return this.hget(commandArgs);
                case 'HMGET':
                    return this.hmget(commandArgs);
                case 'HGETALL':
                    return this.hgetall(commandArgs);
                case 'HDEL':
                    return this.hdel(commandArgs);
                case 'HEXISTS':
                    return this.hexists(commandArgs);
                case 'HKEYS':
                    return this.hkeys(commandArgs);
                case 'HVALS':
                    return this.hvals(commandArgs);
                case 'HLEN':
                    return this.hlen(commandArgs);
                case 'HINCRBY':
                    return this.hincrby(commandArgs);
                case 'HINCRBYFLOAT':
                    return this.hincrbyfloat(commandArgs);
                case 'HSETNX':
                    return this.hsetnx(commandArgs);
                // Debug command
                case 'TYPE':
                    return this.type(commandArgs);
                default:
                    return `(error) ERR unknown command '${command}'`;
            }
        } catch (error) {
            return `(error) ${error.message}`;
        }
    }

    /**
     * Parse command string into arguments, handling quoted strings
     * @param {string} input - Command string
     * @returns {Array<string>} - Array of command arguments
     */
    parseCommand(input) {
        const args = [];
        let current = '';
        let inQuotes = false;
        let quoteChar = '';

        for (let i = 0; i < input.length; i++) {
            const char = input[i];
            
            if ((char === '"' || char === "'") && !inQuotes) {
                inQuotes = true;
                quoteChar = char;
            } else if (char === quoteChar && inQuotes) {
                inQuotes = false;
                quoteChar = '';
            } else if (char === ' ' && !inQuotes) {
                if (current) {
                    args.push(current);
                    current = '';
                }
            } else {
                current += char;
            }
        }

        if (current) {
            args.push(current);
        }

        return args;
    }

    /**
     * Display help information
     */
    help() {
        return `Available commands:

=== Basic Key-Value Operations ===
SET key value [EX seconds] [PX milliseconds] [EXAT timestamp] [PXAT milliseconds-timestamp] [NX] [XX] [KEEPTTL] [GET]
                             - Set key to hold string value with optional expiration and conditions
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
PEXPIRE key milliseconds     - Set timeout on key in milliseconds
TTL key                      - Get time to live for key in seconds
PTTL key                     - Get time to live for key in milliseconds
PERSIST key                  - Remove timeout from key

=== Key Management ===
RENAME key newkey            - Rename key to newkey

=== List Operations ===
LPUSH key element [element...] - Push elements to the left (beginning) of list
RPUSH key element [element...] - Push elements to the right (end) of list
LPOP key                     - Pop element from the left (beginning) of list
RPOP key                     - Pop element from the right (end) of list
LLEN key                     - Get the length of list
LRANGE key start stop        - Get range of elements from list
LINDEX key index             - Get element at index from list
LSET key index element       - Set element at index in list
LTRIM key start stop         - Trim list to specified range

=== Set Operations ===
SADD key member [member...]  - Add members to set
SREM key member [member...]  - Remove members from set
SMEMBERS key                 - Get all members of set
SCARD key                    - Get number of members in set
SISMEMBER key member         - Check if member exists in set
SUNION key [key ...]         - Union of sets
SINTER key [key ...]         - Intersection of sets
SDIFF key [key ...]          - Difference of sets (first set minus others)

=== Hash Operations ===
HSET key field value [field value...] - Set field(s) in hash
HGET key field               - Get field value from hash
HMGET key field [field...]   - Get multiple field values
HGETALL key                  - Get all field-value pairs
HDEL key field [field...]    - Delete field(s) from hash
HEXISTS key field            - Check if field exists in hash
HKEYS key                    - Get all field names
HVALS key                    - Get all values
HLEN key                     - Get number of fields in hash
HINCRBY key field increment  - Increment field by integer
HINCRBYFLOAT key field increment - Increment field by float
HSETNX key field value       - Set field only if it doesn't exist

=== System ===
TYPE key                     - Get the type of key (string, list, set, hash, none)
HELP                        - Show this help message
QUIT/EXIT                   - Exit the server`;
    }

    /**
     * SET key value [EX seconds] [PX milliseconds] [EXAT timestamp] [PXAT milliseconds-timestamp] [NX] [XX] [KEEPTTL] [GET]
     * Set key to hold string value with optional expiration and conditions
     * @param {Array<string>} args - Command arguments
     */
    set(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'set' command");
        }

        const [key, value] = args;
        const options = args.slice(2);

        // Parse options
        let expirationMs = null;
        let onlyIfExists = false;     // XX option
        let onlyIfNotExists = false;  // NX option
        let keepTtl = false;          // KEEPTTL option
        let returnOldValue = false;   // GET option

        for (let i = 0; i < options.length; i++) {
            const option = options[i].toUpperCase();
            
            switch (option) {
                case 'EX':
                    if (i + 1 >= options.length) {
                        throw new Error("ERR syntax error");
                    }
                    const seconds = parseInt(options[i + 1], 10);
                    if (isNaN(seconds) || seconds <= 0) {
                        throw new Error("ERR invalid expire time in set");
                    }
                    expirationMs = seconds * 1000;
                    i++; // Skip next argument
                    break;
                    
                case 'PX':
                    if (i + 1 >= options.length) {
                        throw new Error("ERR syntax error");
                    }
                    const milliseconds = parseInt(options[i + 1], 10);
                    if (isNaN(milliseconds) || milliseconds <= 0) {
                        throw new Error("ERR invalid expire time in set");
                    }
                    expirationMs = milliseconds;
                    i++; // Skip next argument
                    break;
                    
                case 'EXAT':
                    if (i + 1 >= options.length) {
                        throw new Error("ERR syntax error");
                    }
                    const timestamp = parseInt(options[i + 1], 10);
                    if (isNaN(timestamp) || timestamp <= 0) {
                        throw new Error("ERR invalid expire time in set");
                    }
                    expirationMs = (timestamp * 1000) - Date.now();
                    if (expirationMs <= 0) {
                        throw new Error("ERR invalid expire time in set");
                    }
                    i++; // Skip next argument
                    break;
                    
                case 'PXAT':
                    if (i + 1 >= options.length) {
                        throw new Error("ERR syntax error");
                    }
                    const timestampMs = parseInt(options[i + 1], 10);
                    if (isNaN(timestampMs) || timestampMs <= 0) {
                        throw new Error("ERR invalid expire time in set");
                    }
                    expirationMs = timestampMs - Date.now();
                    if (expirationMs <= 0) {
                        throw new Error("ERR invalid expire time in set");
                    }
                    i++; // Skip next argument
                    break;
                    
                case 'NX':
                    onlyIfNotExists = true;
                    break;
                    
                case 'XX':
                    onlyIfExists = true;
                    break;
                    
                case 'KEEPTTL':
                    keepTtl = true;
                    break;
                    
                case 'GET':
                    returnOldValue = true;
                    break;
                    
                default:
                    throw new Error("ERR syntax error");
            }
        }

        // Check conflicting options
        if (onlyIfExists && onlyIfNotExists) {
            throw new Error("ERR syntax error");
        }
        
        if (keepTtl && expirationMs !== null) {
            throw new Error("ERR syntax error");
        }

        // Get current value for return (if GET option is used)
        const currentValue = this.getValue(key);
        const keyExists = currentValue !== undefined;

        // Check conditions
        if (onlyIfNotExists && keyExists) {
            return returnOldValue ? (currentValue ? `"${currentValue}"` : '(nil)') : '(nil)';
        }
        
        if (onlyIfExists && !keyExists) {
            return returnOldValue ? '(nil)' : '(nil)';
        }

        // Store old value for return
        const oldValue = returnOldValue ? (currentValue || null) : null;

        // Set the value
        this.setValue(key, value, 'string');

        // Handle expiration
        if (keepTtl && keyExists && this.expiration.has(key)) {
            // Keep existing TTL - do nothing with expiration
        } else if (expirationMs !== null) {
            // Set new expiration
            const expireTime = Date.now() + expirationMs;
            this.expiration.set(key, expireTime);
        } else {
            // Remove any existing expiration if no expiration specified
            this.expiration.delete(key);
        }

        // Return appropriate response
        if (returnOldValue) {
            return oldValue ? `"${oldValue}"` : '(nil)';
        }
        
        return 'OK';
    }

    /**
     * GET key - Get the value of key
     * @param {Array<string>} args - Command arguments
     */
    get(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'get' command");
        }

        const key = args[0];
        const value = this.getValue(key);
        
        if (value === undefined) {
            return '(nil)';
        }

        // Check if it's a string
        if (this.getType(key) !== 'string') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }
        
        return `"${value}"`;
    }

    /**
     * DEL key [key ...] - Delete one or more keys
     * @param {Array<string>} args - Command arguments
     */
    del(args) {
        if (args.length === 0) {
            throw new Error("ERR wrong number of arguments for 'del' command");
        }

        let deletedCount = 0;
        for (const key of args) {
            if (this.getValue(key) !== undefined) {
                this.deleteKey(key);
                deletedCount++;
            }
        }

        return `(integer) ${deletedCount}`;
    }

    /**
     * EXISTS key [key ...] - Check if one or more keys exist
     * @param {Array<string>} args - Command arguments
     */
    exists(args) {
        if (args.length === 0) {
            throw new Error("ERR wrong number of arguments for 'exists' command");
        }

        let existCount = 0;
        for (const key of args) {
            // Check if key exists and is not expired
            if (this.getValue(key) !== undefined) {
                existCount++;
            }
        }

        return `(integer) ${existCount}`;
    }

    /**
     * KEYS pattern - Find all keys matching pattern
     * @param {Array<string>} args - Command arguments
     */
    keys(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'keys' command");
        }

        const pattern = args[0];
        const allKeys = Array.from(this.data.keys());
        
        if (pattern === '*') {
            // Return all keys
            if (allKeys.length === 0) {
                return '(empty list or set)';
            }
            return allKeys.map((key, index) => `${index + 1}) "${key}"`).join('\n');
        }

        // Convert Redis pattern to JavaScript regex
        const regexPattern = pattern
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
        
        const regex = new RegExp(`^${regexPattern}$`);
        const matchingKeys = allKeys.filter(key => regex.test(key));
        
        if (matchingKeys.length === 0) {
            return '(empty list or set)';
        }
        
        return matchingKeys.map((key, index) => `${index + 1}) "${key}"`).join('\n');
    }

    /**
     * FLUSHALL - Remove all keys from all databases
     */
    flushall() {
        this.data.clear();
        this.types.clear();
        this.expiration.clear();
        return 'OK';
    }

    /**
     * Get current database size (for debugging)
     */
    dbsize() {
        return `(integer) ${this.data.size}`;
    }

    // ===== PHASE 2 COMMANDS =====

    /**
     * APPEND key value - Append value to key
     * @param {Array<string>} args - Command arguments
     */
    append(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'append' command");
        }

        const [key, value] = args;
        const existingValue = this.getValue(key);
        
        // Check if key exists and is a string
        if (existingValue !== undefined && this.getType(key) !== 'string') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        if (existingValue === undefined) {
            // Key doesn't exist, create it with the value
            this.setValue(key, value, 'string');
            return `(integer) ${value.length}`;
        } else {
            // Key exists, append to existing value
            const newValue = existingValue + value;
            this.setValue(key, newValue, 'string');
            return `(integer) ${newValue.length}`;
        }
    }

    /**
     * STRLEN key - Get the length of the value stored in key
     * @param {Array<string>} args - Command arguments
     */
    strlen(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'strlen' command");
        }

        const key = args[0];
        const value = this.getValue(key);
        
        if (value === undefined) {
            return '(integer) 0';
        }

        // Check if it's a string
        if (this.getType(key) !== 'string') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }
        
        return `(integer) ${value.length}`;
    }

    /**
     * INCR key - Increment the integer value of key by one
     * @param {Array<string>} args - Command arguments
     */
    incr(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'incr' command");
        }

        const key = args[0];
        const value = this.getValue(key);
        
        let numValue;
        if (value === undefined) {
            numValue = 0;
        } else {
            numValue = parseInt(value, 10);
            if (isNaN(numValue)) {
                throw new Error("ERR value is not an integer or out of range");
            }
        }
        
        const newValue = numValue + 1;
        this.data.set(key, newValue.toString());
        return `(integer) ${newValue}`;
    }

    /**
     * DECR key - Decrement the integer value of key by one
     * @param {Array<string>} args - Command arguments
     */
    decr(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'decr' command");
        }

        const key = args[0];
        const value = this.getValue(key);
        
        let numValue;
        if (value === undefined) {
            numValue = 0;
        } else {
            numValue = parseInt(value, 10);
            if (isNaN(numValue)) {
                throw new Error("ERR value is not an integer or out of range");
            }
        }
        
        const newValue = numValue - 1;
        this.data.set(key, newValue.toString());
        return `(integer) ${newValue}`;
    }

    /**
     * INCRBY key increment - Increment the integer value of key by increment
     * @param {Array<string>} args - Command arguments
     */
    incrby(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'incrby' command");
        }

        const [key, incrementStr] = args;
        const increment = parseInt(incrementStr, 10);
        
        if (isNaN(increment)) {
            throw new Error("ERR value is not an integer or out of range");
        }
        
        const value = this.getValue(key);
        
        let numValue;
        if (value === undefined) {
            numValue = 0;
        } else {
            numValue = parseInt(value, 10);
            if (isNaN(numValue)) {
                throw new Error("ERR value is not an integer or out of range");
            }
        }
        
        const newValue = numValue + increment;
        this.data.set(key, newValue.toString());
        return `(integer) ${newValue}`;
    }

    /**
     * DECRBY key decrement - Decrement the integer value of key by decrement
     * @param {Array<string>} args - Command arguments
     */
    decrby(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'decrby' command");
        }

        const [key, decrementStr] = args;
        const decrement = parseInt(decrementStr, 10);
        
        if (isNaN(decrement)) {
            throw new Error("ERR value is not an integer or out of range");
        }
        
        const value = this.getValue(key);
        
        let numValue;
        if (value === undefined) {
            numValue = 0;
        } else {
            numValue = parseInt(value, 10);
            if (isNaN(numValue)) {
                throw new Error("ERR value is not an integer or out of range");
            }
        }
        
        const newValue = numValue - decrement;
        this.data.set(key, newValue.toString());
        return `(integer) ${newValue}`;
    }

    /**
     * EXPIRE key seconds - Set timeout on key in seconds
     * @param {Array<string>} args - Command arguments
     */
    expire(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'expire' command");
        }

        const [key, secondsStr] = args;
        const seconds = parseInt(secondsStr, 10);
        
        if (isNaN(seconds) || seconds < 0) {
            throw new Error("ERR invalid expire time in 'expire' command");
        }
        
        // Check if key exists (and is not expired)
        if (this.getValue(key) === undefined) {
            return '(integer) 0';
        }
        
        // Set expiration time
        const expireTime = Date.now() + (seconds * 1000);
        this.expiration.set(key, expireTime);
        
        return '(integer) 1';
    }

    /**
     * TTL key - Get time to live for key in seconds
     * @param {Array<string>} args - Command arguments
     */
    ttl(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'ttl' command");
        }

        const key = args[0];
        
        // Check if key exists
        if (this.getValue(key) === undefined) {
            return '(integer) -2';  // Key does not exist
        }
        
        // Check if key has expiration
        if (!this.expiration.has(key)) {
            return '(integer) -1';  // Key exists but has no expiration
        }
        
        const expireTime = this.expiration.get(key);
        const now = Date.now();
        const ttlMs = expireTime - now;
        
        if (ttlMs <= 0) {
            // Key has expired
            this.data.delete(key);
            this.expiration.delete(key);
            return '(integer) -2';
        }
        
        const ttlSeconds = Math.ceil(ttlMs / 1000);
        return `(integer) ${ttlSeconds}`;
    }

    /**
     * PEXPIRE key milliseconds - Set timeout on key in milliseconds
     * @param {Array<string>} args - Command arguments
     */
    pexpire(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'pexpire' command");
        }

        const [key, millisecondsStr] = args;
        const milliseconds = parseInt(millisecondsStr, 10);
        
        if (isNaN(milliseconds) || milliseconds < 0) {
            throw new Error("ERR invalid expire time in 'pexpire' command");
        }
        
        // Check if key exists (and is not expired)
        if (this.getValue(key) === undefined) {
            return '(integer) 0';
        }
        
        // Set expiration time
        const expireTime = Date.now() + milliseconds;
        this.expiration.set(key, expireTime);
        
        return '(integer) 1';
    }

    /**
     * PTTL key - Get time to live for key in milliseconds
     * @param {Array<string>} args - Command arguments
     */
    pttl(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'pttl' command");
        }

        const key = args[0];
        
        // Check if key exists
        if (this.getValue(key) === undefined) {
            return '(integer) -2';  // Key does not exist
        }
        
        // Check if key has expiration
        if (!this.expiration.has(key)) {
            return '(integer) -1';  // Key exists but has no expiration
        }
        
        const expireTime = this.expiration.get(key);
        const now = Date.now();
        const ttlMs = expireTime - now;
        
        if (ttlMs <= 0) {
            // Key has expired
            this.data.delete(key);
            this.expiration.delete(key);
            return '(integer) -2';
        }
        
        return `(integer) ${Math.ceil(ttlMs)}`;
    }

    /**
     * PERSIST key - Remove timeout from key
     * @param {Array<string>} args - Command arguments
     */
    persist(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'persist' command");
        }

        const key = args[0];
        
        // Check if key exists
        if (this.getValue(key) === undefined) {
            return '(integer) 0';
        }
        
        // Check if key has expiration
        if (!this.expiration.has(key)) {
            return '(integer) 0';  // Key has no timeout
        }
        
        // Remove expiration
        this.expiration.delete(key);
        return '(integer) 1';
    }

    /**
     * RENAME key newkey - Rename key to newkey
     * @param {Array<string>} args - Command arguments
     */
    rename(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'rename' command");
        }

        const [oldKey, newKey] = args;
        
        // Check if source key exists
        const value = this.getValue(oldKey);
        if (value === undefined) {
            throw new Error("ERR no such key");
        }
        
        // Copy value to new key
        this.setValue(newKey, value, this.getType(oldKey));
        
        // Copy expiration if it exists
        if (this.expiration.has(oldKey)) {
            const expireTime = this.expiration.get(oldKey);
            this.expiration.set(newKey, expireTime);
        }
        
        // Delete old key
        this.deleteKey(oldKey);
        
        return 'OK';
    }

    // ===== PHASE 3 COMMANDS - LIST OPERATIONS =====

    /**
     * LPUSH key element [element ...] - Push elements to the left (beginning) of the list
     * @param {Array<string>} args - Command arguments
     */
    lpush(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'lpush' command");
        }

        const [key, ...elements] = args;
        
        // Check if key exists and ensure it's a list or doesn't exist
        if (!this.checkType(key, 'list')) {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        let list = this.getValue(key);
        if (list === undefined) {
            list = new RedisList();
            this.setValue(key, list, 'list');
        }

        const newLength = list.lpush(...elements);
        return `(integer) ${newLength}`;
    }

    /**
     * RPUSH key element [element ...] - Push elements to the right (end) of the list
     * @param {Array<string>} args - Command arguments
     */
    rpush(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'rpush' command");
        }

        const [key, ...elements] = args;
        
        // Check if key exists and ensure it's a list or doesn't exist
        if (!this.checkType(key, 'list')) {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        let list = this.getValue(key);
        if (list === undefined) {
            list = new RedisList();
            this.setValue(key, list, 'list');
        }

        const newLength = list.rpush(...elements);
        return `(integer) ${newLength}`;
    }

    /**
     * LPOP key - Pop element from the left (beginning) of the list
     * @param {Array<string>} args - Command arguments
     */
    lpop(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'lpop' command");
        }

        const key = args[0];
        const list = this.getValue(key);

        if (list === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const element = list.lpop();
        
        // If list becomes empty, remove the key
        if (list.length() === 0) {
            this.deleteKey(key);
        }

        return element === undefined ? '(nil)' : `"${element}"`;
    }

    /**
     * RPOP key - Pop element from the right (end) of the list
     * @param {Array<string>} args - Command arguments
     */
    rpop(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'rpop' command");
        }

        const key = args[0];
        const list = this.getValue(key);

        if (list === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const element = list.rpop();
        
        // If list becomes empty, remove the key
        if (list.length() === 0) {
            this.deleteKey(key);
        }

        return element === undefined ? '(nil)' : `"${element}"`;
    }

    /**
     * LLEN key - Get the length of the list
     * @param {Array<string>} args - Command arguments
     */
    llen(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'llen' command");
        }

        const key = args[0];
        const list = this.getValue(key);

        if (list === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        return `(integer) ${list.length()}`;
    }

    /**
     * LRANGE key start stop - Get range of elements from list
     * @param {Array<string>} args - Command arguments
     */
    lrange(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'lrange' command");
        }

        const [key, startStr, stopStr] = args;
        const start = parseInt(startStr, 10);
        const stop = parseInt(stopStr, 10);

        if (isNaN(start) || isNaN(stop)) {
            throw new Error("ERR value is not an integer or out of range");
        }

        const list = this.getValue(key);

        if (list === undefined) {
            return '(empty list or set)';
        }

        if (this.getType(key) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const elements = list.range(start, stop);
        
        if (elements.length === 0) {
            return '(empty list or set)';
        }

        return elements.map((element, index) => `${index + 1}) "${element}"`).join('\n');
    }

    /**
     * LINDEX key index - Get element at index from list
     * @param {Array<string>} args - Command arguments
     */
    lindex(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'lindex' command");
        }

        const [key, indexStr] = args;
        const index = parseInt(indexStr, 10);

        if (isNaN(index)) {
            throw new Error("ERR value is not an integer or out of range");
        }

        const list = this.getValue(key);

        if (list === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const element = list.index(index);
        return element === undefined ? '(nil)' : `"${element}"`;
    }

    /**
     * LSET key index element - Set element at index in list
     * @param {Array<string>} args - Command arguments
     */
    lset(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'lset' command");
        }

        const [key, indexStr, element] = args;
        const index = parseInt(indexStr, 10);

        if (isNaN(index)) {
            throw new Error("ERR value is not an integer or out of range");
        }

        const list = this.getValue(key);

        if (list === undefined) {
            throw new Error("ERR no such key");
        }

        if (this.getType(key) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const success = list.set(index, element);
        if (!success) {
            throw new Error("ERR index out of range");
        }

        return 'OK';
    }

    /**
     * LTRIM key start stop - Trim list to specified range
     * @param {Array<string>} args - Command arguments
     */
    ltrim(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'ltrim' command");
        }

        const [key, startStr, stopStr] = args;
        const start = parseInt(startStr, 10);
        const stop = parseInt(stopStr, 10);

        if (isNaN(start) || isNaN(stop)) {
            throw new Error("ERR value is not an integer or out of range");
        }

        const list = this.getValue(key);

        if (list === undefined) {
            return 'OK'; // Redis behavior: LTRIM on non-existent key is OK
        }

        if (this.getType(key) !== 'list') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        list.trim(start, stop);

        // If list becomes empty, remove the key
        if (list.length() === 0) {
            this.deleteKey(key);
        }

        return 'OK';
    }

    /**
     * TYPE key - Get the type of key (debug command)
     * @param {Array<string>} args - Command arguments
     */
    type(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'type' command");
        }

        const key = args[0];
        const type = this.getType(key);
        return type;
    }

    // ===== PHASE 4 COMMANDS - SET OPERATIONS =====

    /**
     * SADD key member [member ...] - Add members to set
     * @param {Array<string>} args - Command arguments
     */
    sadd(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'sadd' command");
        }

        const [key, ...members] = args;
        
        // Check if key exists and ensure it's a set or doesn't exist
        if (!this.checkType(key, 'set')) {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        let set = this.getValue(key);
        if (set === undefined) {
            set = new RedisSet();
            this.setValue(key, set, 'set');
        }

        const addedCount = set.sadd(...members);
        return `(integer) ${addedCount}`;
    }

    /**
     * SREM key member [member ...] - Remove members from set
     * @param {Array<string>} args - Command arguments
     */
    srem(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'srem' command");
        }

        const [key, ...members] = args;
        const set = this.getValue(key);

        if (set === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'set') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const removedCount = set.srem(...members);

        // If set becomes empty, remove the key
        if (set.isEmpty()) {
            this.deleteKey(key);
        }

        return `(integer) ${removedCount}`;
    }

    /**
     * SMEMBERS key - Get all members of set
     * @param {Array<string>} args - Command arguments
     */
    smembers(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'smembers' command");
        }

        const key = args[0];
        const set = this.getValue(key);

        if (set === undefined) {
            return '(empty list or set)';
        }

        if (this.getType(key) !== 'set') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const members = set.smembers();
        
        if (members.length === 0) {
            return '(empty list or set)';
        }

        return members.map((member, index) => `${index + 1}) "${member}"`).join('\n');
    }

    /**
     * SCARD key - Get number of members in set
     * @param {Array<string>} args - Command arguments
     */
    scard(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'scard' command");
        }

        const key = args[0];
        const set = this.getValue(key);

        if (set === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'set') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        return `(integer) ${set.scard()}`;
    }

    /**
     * SISMEMBER key member - Check if member exists in set
     * @param {Array<string>} args - Command arguments
     */
    sismember(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'sismember' command");
        }

        const [key, member] = args;
        const set = this.getValue(key);

        if (set === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'set') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        return `(integer) ${set.sismember(member) ? 1 : 0}`;
    }

    /**
     * SUNION key [key ...] - Union of sets
     * @param {Array<string>} args - Command arguments
     */
    sunion(args) {
        if (args.length === 0) {
            throw new Error("ERR wrong number of arguments for 'sunion' command");
        }

        const keys = args;
        const sets = [];

        // Get all sets, checking types
        for (const key of keys) {
            const set = this.getValue(key);
            if (set !== undefined) {
                if (this.getType(key) !== 'set') {
                    throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
                }
                sets.push(set);
            }
            // Non-existent keys are treated as empty sets in Redis
        }

        // If no sets exist, return empty
        if (sets.length === 0) {
            return '(empty list or set)';
        }

        // Calculate union
        const firstSet = sets[0];
        const otherSets = sets.slice(1);
        const unionSet = firstSet.sunion(...otherSets);

        const members = unionSet.smembers();
        
        if (members.length === 0) {
            return '(empty list or set)';
        }

        return members.map((member, index) => `${index + 1}) "${member}"`).join('\n');
    }

    /**
     * SINTER key [key ...] - Intersection of sets
     * @param {Array<string>} args - Command arguments
     */
    sinter(args) {
        if (args.length === 0) {
            throw new Error("ERR wrong number of arguments for 'sinter' command");
        }

        const keys = args;
        const sets = [];

        // Get all sets, checking types
        for (const key of keys) {
            const set = this.getValue(key);
            if (set !== undefined) {
                if (this.getType(key) !== 'set') {
                    throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
                }
                sets.push(set);
            } else {
                // If any set doesn't exist, intersection is empty
                return '(empty list or set)';
            }
        }

        // If no sets exist, return empty
        if (sets.length === 0) {
            return '(empty list or set)';
        }

        // Calculate intersection
        const firstSet = sets[0];
        const otherSets = sets.slice(1);
        const intersectionSet = firstSet.sinter(...otherSets);

        const members = intersectionSet.smembers();
        
        if (members.length === 0) {
            return '(empty list or set)';
        }

        return members.map((member, index) => `${index + 1}) "${member}"`).join('\n');
    }

    /**
     * SDIFF key [key ...] - Difference of sets (first set minus others)
     * @param {Array<string>} args - Command arguments
     */
    sdiff(args) {
        if (args.length === 0) {
            throw new Error("ERR wrong number of arguments for 'sdiff' command");
        }

        const keys = args;
        const firstKey = keys[0];
        const otherKeys = keys.slice(1);

        // Get first set
        const firstSet = this.getValue(firstKey);
        if (firstSet === undefined) {
            return '(empty list or set)';
        }

        if (this.getType(firstKey) !== 'set') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        // Get other sets
        const otherSets = [];
        for (const key of otherKeys) {
            const set = this.getValue(key);
            if (set !== undefined) {
                if (this.getType(key) !== 'set') {
                    throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
                }
                otherSets.push(set);
            }
            // Non-existent keys are treated as empty sets
        }

        // Calculate difference
        const diffSet = firstSet.sdiff(...otherSets);

        const members = diffSet.smembers();
        
        if (members.length === 0) {
            return '(empty list or set)';
        }

        return members.map((member, index) => `${index + 1}) "${member}"`).join('\n');
    }

    // ===== PHASE 5 COMMANDS - HASH OPERATIONS =====

    /**
     * HSET key field value [field value ...] - Set field(s) in hash
     * @param {Array<string>} args - Command arguments
     */
    hset(args) {
        if (args.length < 3 || args.length % 2 === 0) {
            throw new Error("ERR wrong number of arguments for 'hset' command");
        }

        const [key, ...fieldValuePairs] = args;
        
        // Check if key exists and ensure it's a hash or doesn't exist
        if (!this.checkType(key, 'hash')) {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        let hash = this.getValue(key);
        if (hash === undefined) {
            hash = new RedisHash();
            this.setValue(key, hash, 'hash');
        }

        const newFieldsCount = hash.hset(...fieldValuePairs);
        return `(integer) ${newFieldsCount}`;
    }

    /**
     * HGET key field - Get field value from hash
     * @param {Array<string>} args - Command arguments
     */
    hget(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'hget' command");
        }

        const [key, field] = args;
        const hash = this.getValue(key);

        if (hash === undefined) {
            return '(nil)';
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const value = hash.hget(field);
        return value === undefined ? '(nil)' : `"${value}"`;
    }

    /**
     * HMGET key field [field ...] - Get multiple field values
     * @param {Array<string>} args - Command arguments
     */
    hmget(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'hmget' command");
        }

        const [key, ...fields] = args;
        const hash = this.getValue(key);

        if (hash === undefined) {
            // Return nil for all fields if hash doesn't exist
            return fields.map(() => '(nil)').map((nil, index) => `${index + 1}) ${nil}`).join('\n');
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const values = hash.hmget(...fields);
        return values.map((value, index) => 
            `${index + 1}) ${value === undefined ? '(nil)' : `"${value}"`}`
        ).join('\n');
    }

    /**
     * HGETALL key - Get all field-value pairs
     * @param {Array<string>} args - Command arguments
     */
    hgetall(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'hgetall' command");
        }

        const key = args[0];
        const hash = this.getValue(key);

        if (hash === undefined) {
            return '(empty list or set)';
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const fieldValuePairs = hash.hgetall();
        
        if (fieldValuePairs.length === 0) {
            return '(empty list or set)';
        }

        return fieldValuePairs.map((item, index) => `${index + 1}) "${item}"`).join('\n');
    }

    /**
     * HDEL key field [field ...] - Delete field(s) from hash
     * @param {Array<string>} args - Command arguments
     */
    hdel(args) {
        if (args.length < 2) {
            throw new Error("ERR wrong number of arguments for 'hdel' command");
        }

        const [key, ...fields] = args;
        const hash = this.getValue(key);

        if (hash === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const deletedCount = hash.hdel(...fields);

        // If hash becomes empty, remove the key
        if (hash.isEmpty()) {
            this.deleteKey(key);
        }

        return `(integer) ${deletedCount}`;
    }

    /**
     * HEXISTS key field - Check if field exists in hash
     * @param {Array<string>} args - Command arguments
     */
    hexists(args) {
        if (args.length !== 2) {
            throw new Error("ERR wrong number of arguments for 'hexists' command");
        }

        const [key, field] = args;
        const hash = this.getValue(key);

        if (hash === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        return `(integer) ${hash.hexists(field) ? 1 : 0}`;
    }

    /**
     * HKEYS key - Get all field names
     * @param {Array<string>} args - Command arguments
     */
    hkeys(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'hkeys' command");
        }

        const key = args[0];
        const hash = this.getValue(key);

        if (hash === undefined) {
            return '(empty list or set)';
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const fields = hash.hkeys();
        
        if (fields.length === 0) {
            return '(empty list or set)';
        }

        return fields.map((field, index) => `${index + 1}) "${field}"`).join('\n');
    }

    /**
     * HVALS key - Get all values
     * @param {Array<string>} args - Command arguments
     */
    hvals(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'hvals' command");
        }

        const key = args[0];
        const hash = this.getValue(key);

        if (hash === undefined) {
            return '(empty list or set)';
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        const values = hash.hvals();
        
        if (values.length === 0) {
            return '(empty list or set)';
        }

        return values.map((value, index) => `${index + 1}) "${value}"`).join('\n');
    }

    /**
     * HLEN key - Get number of fields in hash
     * @param {Array<string>} args - Command arguments
     */
    hlen(args) {
        if (args.length !== 1) {
            throw new Error("ERR wrong number of arguments for 'hlen' command");
        }

        const key = args[0];
        const hash = this.getValue(key);

        if (hash === undefined) {
            return '(integer) 0';
        }

        if (this.getType(key) !== 'hash') {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        return `(integer) ${hash.hlen()}`;
    }

    /**
     * HINCRBY key field increment - Increment field by integer
     * @param {Array<string>} args - Command arguments
     */
    hincrby(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'hincrby' command");
        }

        const [key, field, incrementStr] = args;
        const increment = parseInt(incrementStr, 10);
        
        if (isNaN(increment)) {
            throw new Error("ERR value is not an integer or out of range");
        }
        
        // Check if key exists and ensure it's a hash or doesn't exist
        if (!this.checkType(key, 'hash')) {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        let hash = this.getValue(key);
        if (hash === undefined) {
            hash = new RedisHash();
            this.setValue(key, hash, 'hash');
        }

        const newValue = hash.hincrby(field, increment);
        return `(integer) ${newValue}`;
    }

    /**
     * HINCRBYFLOAT key field increment - Increment field by float
     * @param {Array<string>} args - Command arguments
     */
    hincrbyfloat(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'hincrbyfloat' command");
        }

        const [key, field, incrementStr] = args;
        const increment = parseFloat(incrementStr);
        
        if (isNaN(increment)) {
            throw new Error("ERR value is not a valid float");
        }
        
        // Check if key exists and ensure it's a hash or doesn't exist
        if (!this.checkType(key, 'hash')) {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        let hash = this.getValue(key);
        if (hash === undefined) {
            hash = new RedisHash();
            this.setValue(key, hash, 'hash');
        }

        const newValue = hash.hincrbyfloat(field, increment);
        return `"${newValue}"`;
    }

    /**
     * HSETNX key field value - Set field only if it doesn't exist
     * @param {Array<string>} args - Command arguments
     */
    hsetnx(args) {
        if (args.length !== 3) {
            throw new Error("ERR wrong number of arguments for 'hsetnx' command");
        }

        const [key, field, value] = args;
        
        // Check if key exists and ensure it's a hash or doesn't exist
        if (!this.checkType(key, 'hash')) {
            throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
        }

        let hash = this.getValue(key);
        if (hash === undefined) {
            hash = new RedisHash();
            this.setValue(key, hash, 'hash');
        }

        const wasSet = hash.hsetnx(field, value);
        return `(integer) ${wasSet ? 1 : 0}`;
    }
}

// Start the Redis clone server
new RedisClone();
