/**
 * Core DataStore implementation using hash table for O(1) operations
 * Supports multiple databases and basic key-value operations
 */

const logger = require('../utils/Logger')
const config = require('../utils/Config')

class DataStore {
  constructor() {
    this.databases = new Map()
    this.currentDb = 0
    this.maxDatabases = config.get('datastore.databases', 16)
    this.maxMemory = this.parseMemoryLimit(config.get('datastore.maxMemory', '1gb'))
    this.memoryUsage = 0
    
    // Initialize databases
    this.initializeDatabases()
    
    logger.info('DataStore initialized', {
      databases: this.maxDatabases,
      maxMemory: this.maxMemory
    })
  }

  /**
   * Initialize all databases
   */
  initializeDatabases() {
    for (let i = 0; i < this.maxDatabases; i++) {
      this.databases.set(i, {
        data: new Map(),
        keyCount: 0,
        expires: new Map() // Will be used by KeyExpiration
      })
    }
  }

  /**
   * Parse memory limit string to bytes
   * @param {string|number} limit - Memory limit
   * @returns {number} Memory limit in bytes
   */
  parseMemoryLimit(limit) {
    if (typeof limit === 'number') return limit
    
    const match = limit.toString().toLowerCase().match(/^(\d+)(b|kb|mb|gb)?$/)
    if (!match) return 1024 * 1024 * 1024 // 1GB default
    
    const size = parseInt(match[1], 10)
    const unit = match[2] || 'b'
    
    const multipliers = {
      b: 1,
      kb: 1024,
      mb: 1024 * 1024,
      gb: 1024 * 1024 * 1024
    }
    
    return size * multipliers[unit]
  }

  /**
   * Select database
   * @param {number} dbIndex - Database index (0-15)
   * @returns {boolean} Success status
   */
  select(dbIndex) {
    if (dbIndex < 0 || dbIndex >= this.maxDatabases) {
      logger.warn('Invalid database index', { dbIndex, maxDatabases: this.maxDatabases })
      return false
    }
    
    this.currentDb = dbIndex
    logger.debug('Database selected', { dbIndex })
    return true
  }

  /**
   * Get current database
   * @returns {Object} Current database object
   */
  getCurrentDatabase() {
    return this.databases.get(this.currentDb)
  }

  /**
   * Set a key-value pair
   * @param {string} key - Key to set
   * @param {*} value - Value to set
   * @param {Object} options - Additional options (ex, px, nx, xx)
   * @returns {Object} Result object with success status and message
   */
  set(key, value, options = {}) {
    if (!this.isValidKey(key)) {
      return { success: false, error: 'Invalid key' }
    }

    const db = this.getCurrentDatabase()
    const keyExists = db.data.has(key)

    // Handle NX (only if not exists) and XX (only if exists) options
    if (options.nx && keyExists) {
      return { success: false, error: 'Key already exists' }
    }
    if (options.xx && !keyExists) {
      return { success: false, error: 'Key does not exist' }
    }

    // Check memory usage before setting
    const valueSize = this.calculateSize(value)
    const existingSize = keyExists ? this.calculateSize(db.data.get(key)) : 0
    const memoryDelta = valueSize - existingSize + (keyExists ? 0 : this.calculateSize(key))

    if (this.memoryUsage + memoryDelta > this.maxMemory) {
      logger.warn('Memory limit would be exceeded', {
        currentUsage: this.memoryUsage,
        delta: memoryDelta,
        maxMemory: this.maxMemory
      })
      return { success: false, error: 'Out of memory' }
    }

    // Set the value
    db.data.set(key, value)
    
    // Update counters
    if (!keyExists) {
      db.keyCount++
    }
    this.memoryUsage += memoryDelta

    // Handle expiration options
    if (options.ex) {
      // EX: expire in seconds
      this.setExpiration(key, Date.now() + (options.ex * 1000))
    } else if (options.px) {
      // PX: expire in milliseconds
      this.setExpiration(key, Date.now() + options.px)
    }

    logger.debug('Key set successfully', {
      key,
      database: this.currentDb,
      keyExists,
      memoryUsage: this.memoryUsage
    })

    return { success: true, value: 'OK' }
  }

  /**
   * Get a value by key
   * @param {string} key - Key to get
   * @returns {Object} Result object with value or null
   */
  get(key) {
    if (!this.isValidKey(key)) {
      return { success: false, error: 'Invalid key' }
    }

    const db = this.getCurrentDatabase()
    
    // Check if key is expired (will be handled by KeyExpiration later)
    if (this.isExpired(key)) {
      this.del(key)
      return { success: true, value: null }
    }

    const value = db.data.get(key)
    
    logger.debug('Key retrieved', {
      key,
      database: this.currentDb,
      found: value !== undefined
    })

    return {
      success: true,
      value: value !== undefined ? value : null
    }
  }

  /**
   * Delete a key
   * @param {string} key - Key to delete
   * @returns {Object} Result object with number of deleted keys
   */
  del(key) {
    if (!this.isValidKey(key)) {
      return { success: false, error: 'Invalid key' }
    }

    const db = this.getCurrentDatabase()
    
    if (!db.data.has(key)) {
      return { success: true, value: 0 }
    }

    // Calculate memory to free
    const keySize = this.calculateSize(key)
    const valueSize = this.calculateSize(db.data.get(key))
    const memoryFreed = keySize + valueSize

    // Delete the key
    db.data.delete(key)
    db.expires.delete(key) // Remove expiration if any
    db.keyCount--
    this.memoryUsage -= memoryFreed

    logger.debug('Key deleted', {
      key,
      database: this.currentDb,
      memoryFreed,
      remainingKeys: db.keyCount
    })

    return { success: true, value: 1 }
  }

  /**
   * Check if a key exists
   * @param {string} key - Key to check
   * @returns {Object} Result object with existence status
   */
  exists(key) {
    if (!this.isValidKey(key)) {
      return { success: false, error: 'Invalid key' }
    }

    const db = this.getCurrentDatabase()
    
    // Check if key is expired
    if (this.isExpired(key)) {
      this.del(key)
      return { success: true, value: 0 }
    }

    const exists = db.data.has(key)
    
    logger.debug('Key existence checked', {
      key,
      database: this.currentDb,
      exists
    })

    return { success: true, value: exists ? 1 : 0 }
  }

  /**
   * Get the type of a key's value
   * @param {string} key - Key to check
   * @returns {Object} Result object with type
   */
  type(key) {
    if (!this.isValidKey(key)) {
      return { success: false, error: 'Invalid key' }
    }

    const result = this.get(key)
    if (!result.success || result.value === null) {
      return { success: true, value: 'none' }
    }

    const value = result.value
    let type = 'string' // Default type

    if (Array.isArray(value)) {
      type = 'list'
    } else if (value instanceof Set) {
      type = 'set'
    } else if (value instanceof Map) {
      type = 'hash'
    } else if (value && typeof value === 'object' && value.constructor.name === 'SortedSet') {
      type = 'zset'
    } else if (value && typeof value === 'object' && value.constructor.name === 'Stream') {
      type = 'stream'
    } else if (value && typeof value === 'object' && value !== null && value.constructor === Object) {
      type = 'hash' // JSON documents are stored as plain objects and treated as hashes
    }

    return { success: true, value: type }
  }

  /**
   * Flush current database
   * @returns {Object} Result object
   */
  flushdb() {
    const db = this.getCurrentDatabase()
    const deletedCount = db.keyCount

    // Calculate memory to free
    let memoryFreed = 0
    for (const [key, value] of db.data) {
      memoryFreed += this.calculateSize(key) + this.calculateSize(value)
    }

    // Clear the database
    db.data.clear()
    db.expires.clear()
    db.keyCount = 0
    this.memoryUsage -= memoryFreed

    logger.info('Database flushed', {
      database: this.currentDb,
      deletedKeys: deletedCount,
      memoryFreed
    })

    return { success: true, value: 'OK' }
  }

  /**
   * Flush all databases
   * @returns {Object} Result object
   */
  flushall() {
    let totalDeleted = 0
    let totalMemoryFreed = 0

    for (let i = 0; i < this.maxDatabases; i++) {
      const db = this.databases.get(i)
      totalDeleted += db.keyCount

      // Calculate memory to free for this database
      for (const [key, value] of db.data) {
        totalMemoryFreed += this.calculateSize(key) + this.calculateSize(value)
      }

      // Clear the database
      db.data.clear()
      db.expires.clear()
      db.keyCount = 0
    }

    this.memoryUsage = 0

    logger.info('All databases flushed', {
      totalDeletedKeys: totalDeleted,
      totalMemoryFreed
    })

    return { success: true, value: 'OK' }
  }

  /**
   * Get random key from current database
   * @returns {Object} Result object with random key or null
   */
  randomkey() {
    const db = this.getCurrentDatabase()
    
    if (db.keyCount === 0) {
      return { success: true, value: null }
    }

    // Get array of keys and pick random one
    const keys = Array.from(db.data.keys())
    const randomKey = keys[Math.floor(Math.random() * keys.length)]

    // Check if the random key is expired
    if (this.isExpired(randomKey)) {
      this.del(randomKey)
      return this.randomkey() // Try again recursively
    }

    return { success: true, value: randomKey }
  }

  /**
   * Get database size (number of keys)
   * @returns {Object} Result object with database size
   */
  dbsize() {
    const db = this.getCurrentDatabase()
    return { success: true, value: db.keyCount }
  }

  /**
   * Get keys matching a pattern
   * @param {string} pattern - Pattern to match (supports * and ? wildcards)
   * @returns {Object} Result object with matching keys
   */
  keys(pattern = '*') {
    const db = this.getCurrentDatabase()
    const allKeys = Array.from(db.data.keys())
    
    // Filter out expired keys and apply pattern matching
    const matchingKeys = []
    for (const key of allKeys) {
      if (this.isExpired(key)) {
        this.del(key)
        continue
      }
      
      if (this.matchesPattern(key, pattern)) {
        matchingKeys.push(key)
      }
    }
    
    logger.debug('Keys command executed', {
      pattern,
      database: this.currentDb,
      totalKeys: allKeys.length,
      matchingKeys: matchingKeys.length
    })
    
    return { success: true, value: matchingKeys }
  }

  /**
   * Scan keys with cursor-based iteration
   * @param {number} cursor - Cursor position (0 to start)
   * @param {Object} options - Scan options (match pattern, count)
   * @returns {Object} Result object with next cursor and keys
   */
  scan(cursor = 0, options = {}) {
    const db = this.getCurrentDatabase()
    const pattern = options.match || '*'
    const count = options.count || 10
    
    const allKeys = Array.from(db.data.keys())
    const totalKeys = allKeys.length
    
    // Validate cursor
    if (cursor < 0) {
      return { success: false, error: 'ERR invalid cursor' }
    }
    
    if (cursor >= totalKeys && totalKeys > 0) {
      // Cursor is beyond the end, return empty result
      return { success: true, value: { nextCursor: 0, keys: [] } }
    }
    
    const matchingKeys = []
    let scannedCount = 0
    let currentIndex = cursor
    
    // Scan from cursor position
    while (scannedCount < count && currentIndex < totalKeys) {
      const key = allKeys[currentIndex]
      currentIndex++
      
      // Skip expired keys
      if (this.isExpired(key)) {
        this.del(key)
        continue
      }
      
      // Check pattern match
      if (this.matchesPattern(key, pattern)) {
        matchingKeys.push(key)
      }
      
      scannedCount++
    }
    
    // Calculate next cursor (wrap around if at end)
    const nextCursor = currentIndex >= totalKeys ? 0 : currentIndex
    
    logger.debug('Scan command executed', {
      cursor,
      nextCursor,
      pattern,
      count,
      database: this.currentDb,
      keysFound: matchingKeys.length
    })
    
    return {
      success: true,
      value: {
        nextCursor,
        keys: matchingKeys
      }
    }
  }

  /**
   * Check if a key matches a pattern (supports * and ? wildcards)
   * @param {string} key - Key to check
   * @param {string} pattern - Pattern with wildcards
   * @returns {boolean} True if key matches pattern
   */
  matchesPattern(key, pattern) {
    // Handle simple cases
    if (pattern === '*') return true
    if (pattern === key) return true
    if (!pattern.includes('*') && !pattern.includes('?')) {
      return key === pattern
    }
    
    // Convert pattern to regex
    // Escape special regex characters except * and ?
    let regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape special chars
      .replace(/\*/g, '.*')                   // * becomes .*
      .replace(/\?/g, '.')                    // ? becomes .
    
    // Anchor the pattern to match the entire string
    regexPattern = `^${regexPattern}$`
    
    try {
      const regex = new RegExp(regexPattern)
      return regex.test(key)
    } catch (error) {
      logger.warn('Invalid pattern in keys/scan command', { pattern, error: error.message })
      return false
    }
  }

  /**
   * Set expiration for a key (used by KeyExpiration module)
   * @param {string} key - Key to set expiration for
   * @param {number} timestamp - Expiration timestamp in milliseconds
   */
  setExpiration(key, timestamp) {
    const db = this.getCurrentDatabase()
    db.expires.set(key, timestamp)
  }

  /**
   * Check if a key is expired
   * @param {string} key - Key to check
   * @returns {boolean} True if expired
   */
  isExpired(key) {
    const db = this.getCurrentDatabase()
    const expiration = db.expires.get(key)
    
    if (!expiration) return false
    
    return Date.now() > expiration
  }

  /**
   * Validate key format
   * @param {string} key - Key to validate
   * @returns {boolean} True if valid
   */
  isValidKey(key) {
    return typeof key === 'string' && key.length > 0 && key.length <= 512 * 1024 * 1024 // 512MB max key size
  }

  /**
   * Calculate approximate memory size of a value
   * @param {*} value - Value to calculate size for
   * @returns {number} Approximate size in bytes
   */
  calculateSize(value) {
    if (value === null || value === undefined) return 8
    
    if (typeof value === 'string') {
      return value.length * 2 // Approximate UTF-16 encoding
    }
    
    if (typeof value === 'number') {
      return 8 // 64-bit number
    }
    
    if (typeof value === 'boolean') {
      return 4
    }
    
    if (Array.isArray(value)) {
      return value.reduce((size, item) => size + this.calculateSize(item), 24) // Array overhead + items
    }
    
    if (value instanceof Set || value instanceof Map) {
      let size = 24 // Object overhead
      if (value instanceof Set) {
        for (const item of value) {
          size += this.calculateSize(item)
        }
      } else {
        for (const [key, val] of value) {
          size += this.calculateSize(key) + this.calculateSize(val)
        }
      }
      return size
    }
    
    if (typeof value === 'object') {
      return JSON.stringify(value).length * 2 + 24 // Rough estimate
    }
    
    return 24 // Default object overhead
  }

  /**
   * Get memory statistics
   * @returns {Object} Memory usage statistics
   */
  getMemoryStats() {
    return {
      used: this.memoryUsage,
      max: this.maxMemory,
      percentage: (this.memoryUsage / this.maxMemory) * 100,
      databases: this.maxDatabases,
      currentDb: this.currentDb
    }
  }

  /**
   * Get database information
   * @param {number} dbIndex - Database index (optional, defaults to current)
   * @returns {Object} Database information
   */
  getDbInfo(dbIndex = this.currentDb) {
    const db = this.databases.get(dbIndex)
    if (!db) return null

    return {
      index: dbIndex,
      keys: db.keyCount,
      expires: db.expires.size
    }
  }

  /**
   * Get comprehensive statistics about all databases
   * @returns {Object} Statistics about databases and keys
   */
  getStats() {
    let totalKeys = 0
    const databases = []
    
    for (let i = 0; i < this.maxDatabases; i++) {
      const db = this.databases.get(i)
      if (db) {
        totalKeys += db.data.size
        databases.push(db)
      } else {
        databases.push(null)
      }
    }
    
    return {
      databases,
      totalKeys,
      maxDatabases: this.maxDatabases,
      currentDb: this.currentDb,
      memoryUsage: this.memoryUsage,
      maxMemory: this.maxMemory
    }
  }
}

module.exports = DataStore
