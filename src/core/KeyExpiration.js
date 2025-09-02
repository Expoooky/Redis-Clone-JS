/**
 * Key Expiration Management System
 * Handles TTL (Time To Live) for keys and background cleanup of expired keys
 */

const logger = require('../utils/Logger')
const config = require('../utils/Config')

class KeyExpiration {
  constructor(dataStore) {
    this.dataStore = dataStore
    this.cleanupInterval = null
    this.checkInterval = config.get('datastore.keyExpirationCheckInterval', 100) // milliseconds
    this.sampleSize = config.get('datastore.keyExpirationSampleSize', 20) // keys to check per interval
    this.isRunning = false
    
    logger.info('KeyExpiration system initialized', {
      checkInterval: this.checkInterval,
      sampleSize: this.sampleSize
    })
  }

  /**
   * Start the background expiration cleanup task
   */
  start() {
    if (this.isRunning) {
      logger.warn('KeyExpiration cleanup already running')
      return
    }

    this.isRunning = true
    this.cleanupInterval = setInterval(() => {
      this.performCleanup()
    }, this.checkInterval)

    logger.info('KeyExpiration cleanup started')
  }

  /**
   * Stop the background expiration cleanup task
   */
  stop() {
    if (!this.isRunning) {
      logger.warn('KeyExpiration cleanup not running')
      return
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }

    this.isRunning = false
    logger.info('KeyExpiration cleanup stopped')
  }

  /**
   * Set expiration time for a key
   * @param {string} key - Key to set expiration for
   * @param {number} timestamp - Expiration timestamp in milliseconds
   * @param {number} dbIndex - Database index (optional, defaults to current)
   * @returns {Object} Result object
   */
  expire(key, timestamp, dbIndex = null) {
    const originalDb = this.dataStore.currentDb
    
    try {
      // Switch to specified database if provided
      if (dbIndex !== null && !this.dataStore.select(dbIndex)) {
        return { success: false, error: 'Invalid database index' }
      }

      // Check if key exists
      const existsResult = this.dataStore.exists(key)
      if (!existsResult.success || existsResult.value === 0) {
        return { success: true, value: 0 } // Key doesn't exist
      }

      // Set the expiration
      this.dataStore.setExpiration(key, timestamp)

      logger.debug('Key expiration set', {
        key,
        database: this.dataStore.currentDb,
        expiresAt: new Date(timestamp).toISOString()
      })

      return { success: true, value: 1 }
    } finally {
      // Restore original database
      if (dbIndex !== null) {
        this.dataStore.select(originalDb)
      }
    }
  }

  /**
   * Set expiration time in seconds from now
   * @param {string} key - Key to expire
   * @param {number} seconds - Seconds from now
   * @returns {Object} Result object
   */
  expireIn(key, seconds) {
    const timestamp = Date.now() + (seconds * 1000)
    return this.expire(key, timestamp)
  }

  /**
   * Set expiration time at specific Unix timestamp
   * @param {string} key - Key to expire
   * @param {number} unixTimestamp - Unix timestamp in seconds
   * @returns {Object} Result object
   */
  expireAt(key, unixTimestamp) {
    const timestamp = unixTimestamp * 1000 // Convert to milliseconds
    return this.expire(key, timestamp)
  }

  /**
   * Set expiration time in milliseconds from now
   * @param {string} key - Key to expire
   * @param {number} milliseconds - Milliseconds from now
   * @returns {Object} Result object
   */
  pexpire(key, milliseconds) {
    const timestamp = Date.now() + milliseconds
    return this.expire(key, timestamp)
  }

  /**
   * Set expiration time at specific timestamp in milliseconds
   * @param {string} key - Key to expire
   * @param {number} timestamp - Timestamp in milliseconds
   * @returns {Object} Result object
   */
  pexpireAt(key, timestamp) {
    return this.expire(key, timestamp)
  }

  /**
   * Get TTL (Time To Live) for a key in seconds
   * @param {string} key - Key to check
   * @returns {Object} Result object with TTL in seconds
   */
  ttl(key) {
    const originalDb = this.dataStore.currentDb
    
    try {
      // Check if key exists
      const existsResult = this.dataStore.exists(key)
      if (!existsResult.success) {
        return existsResult
      }

      if (existsResult.value === 0) {
        return { success: true, value: -2 } // Key doesn't exist
      }

      const db = this.dataStore.getCurrentDatabase()
      const expiration = db.expires.get(key)

      if (!expiration) {
        return { success: true, value: -1 } // No expiration set
      }

      const now = Date.now()
      if (now >= expiration) {
        // Key is expired, delete it
        this.dataStore.del(key)
        return { success: true, value: -2 } // Key doesn't exist (expired)
      }

      const ttlMilliseconds = expiration - now
      const ttlSeconds = Math.ceil(ttlMilliseconds / 1000)

      return { success: true, value: ttlSeconds }
    } finally {
      // Database should already be correct, but just in case
      this.dataStore.select(originalDb)
    }
  }

  /**
   * Get TTL (Time To Live) for a key in milliseconds
   * @param {string} key - Key to check
   * @returns {Object} Result object with TTL in milliseconds
   */
  pttl(key) {
    const originalDb = this.dataStore.currentDb
    
    try {
      // Check if key exists
      const existsResult = this.dataStore.exists(key)
      if (!existsResult.success) {
        return existsResult
      }

      if (existsResult.value === 0) {
        return { success: true, value: -2 } // Key doesn't exist
      }

      const db = this.dataStore.getCurrentDatabase()
      const expiration = db.expires.get(key)

      if (!expiration) {
        return { success: true, value: -1 } // No expiration set
      }

      const now = Date.now()
      if (now >= expiration) {
        // Key is expired, delete it
        this.dataStore.del(key)
        return { success: true, value: -2 } // Key doesn't exist (expired)
      }

      const ttlMilliseconds = expiration - now

      return { success: true, value: ttlMilliseconds }
    } finally {
      // Database should already be correct, but just in case
      this.dataStore.select(originalDb)
    }
  }

  /**
   * Remove expiration from a key (make it persistent)
   * @param {string} key - Key to make persistent
   * @returns {Object} Result object
   */
  persist(key) {
    const originalDb = this.dataStore.currentDb
    
    try {
      // Check if key exists
      const existsResult = this.dataStore.exists(key)
      if (!existsResult.success) {
        return existsResult
      }

      if (existsResult.value === 0) {
        return { success: true, value: 0 } // Key doesn't exist
      }

      const db = this.dataStore.getCurrentDatabase()
      const hadExpiration = db.expires.has(key)

      if (hadExpiration) {
        db.expires.delete(key)
        logger.debug('Key expiration removed', {
          key,
          database: this.dataStore.currentDb
        })
        return { success: true, value: 1 }
      } else {
        return { success: true, value: 0 } // No expiration was set
      }
    } finally {
      this.dataStore.select(originalDb)
    }
  }

  /**
   * Perform background cleanup of expired keys
   * This method implements Redis-like adaptive expiration algorithm
   */
  performCleanup() {
    let totalExpiredKeys = 0
    let totalCheckedKeys = 0

    try {
      // Check each database
      for (let dbIndex = 0; dbIndex < this.dataStore.maxDatabases; dbIndex++) {
        const db = this.dataStore.databases.get(dbIndex)
        
        if (db.expires.size === 0) {
          continue // No expiring keys in this database
        }

        // Switch to this database
        const originalDb = this.dataStore.currentDb
        this.dataStore.select(dbIndex)

        const expiredInThisDb = this.cleanupDatabase(db)
        totalExpiredKeys += expiredInThisDb.expired
        totalCheckedKeys += expiredInThisDb.checked

        // Restore original database
        this.dataStore.select(originalDb)
      }

      if (totalExpiredKeys > 0) {
        logger.debug('Background expiration cleanup completed', {
          expiredKeys: totalExpiredKeys,
          checkedKeys: totalCheckedKeys,
          expirationRate: totalCheckedKeys > 0 ? (totalExpiredKeys / totalCheckedKeys) * 100 : 0
        })
      }
    } catch (error) {
      logger.error('Error during background expiration cleanup', error)
    }
  }

  /**
   * Clean up expired keys in a specific database
   * @param {Object} db - Database object
   * @returns {Object} Cleanup statistics
   */
  cleanupDatabase(db) {
    const now = Date.now()
    let expiredCount = 0
    let checkedCount = 0
    const expiredKeys = []

    // Get sample of keys with expiration
    const expiringKeys = Array.from(db.expires.keys())
    const sampleSize = Math.min(this.sampleSize, expiringKeys.length)
    
    // Randomly sample keys to check
    for (let i = 0; i < sampleSize; i++) {
      const randomIndex = Math.floor(Math.random() * expiringKeys.length)
      const key = expiringKeys[randomIndex]
      
      checkedCount++
      
      const expiration = db.expires.get(key)
      if (expiration && now >= expiration) {
        expiredKeys.push(key)
        expiredCount++
      }
    }

    // Delete expired keys
    for (const key of expiredKeys) {
      this.dataStore.del(key)
    }

    // Adaptive algorithm: if more than 25% of sampled keys were expired,
    // continue cleanup until we find fewer expired keys
    if (sampleSize > 0 && (expiredCount / sampleSize) > 0.25 && expiringKeys.length > sampleSize) {
      const additionalCleanup = this.cleanupDatabase(db)
      return {
        expired: expiredCount + additionalCleanup.expired,
        checked: checkedCount + additionalCleanup.checked
      }
    }

    return { expired: expiredCount, checked: checkedCount }
  }

  /**
   * Get expiration statistics
   * @returns {Object} Expiration statistics
   */
  getStats() {
    let totalKeysWithExpiration = 0
    let totalKeys = 0

    for (let i = 0; i < this.dataStore.maxDatabases; i++) {
      const db = this.dataStore.databases.get(i)
      totalKeys += db.keyCount
      totalKeysWithExpiration += db.expires.size
    }

    return {
      totalKeys,
      keysWithExpiration: totalKeysWithExpiration,
      expirationPercentage: totalKeys > 0 ? (totalKeysWithExpiration / totalKeys) * 100 : 0,
      cleanupInterval: this.checkInterval,
      sampleSize: this.sampleSize,
      isRunning: this.isRunning
    }
  }

  /**
   * Force cleanup of all expired keys across all databases
   * @returns {Object} Cleanup statistics
   */
  forceCleanup() {
    let totalExpiredKeys = 0
    let totalCheckedKeys = 0

    logger.info('Starting forced expiration cleanup')

    for (let dbIndex = 0; dbIndex < this.dataStore.maxDatabases; dbIndex++) {
      const db = this.dataStore.databases.get(dbIndex)
      
      if (db.expires.size === 0) {
        continue
      }

      const originalDb = this.dataStore.currentDb
      this.dataStore.select(dbIndex)

      // Check all keys with expiration in this database
      const now = Date.now()
      const expiredKeys = []

      for (const [key, expiration] of db.expires) {
        totalCheckedKeys++
        if (now >= expiration) {
          expiredKeys.push(key)
          totalExpiredKeys++
        }
      }

      // Delete expired keys
      for (const key of expiredKeys) {
        this.dataStore.del(key)
      }

      this.dataStore.select(originalDb)
    }

    logger.info('Forced expiration cleanup completed', {
      expiredKeys: totalExpiredKeys,
      checkedKeys: totalCheckedKeys
    })

    return {
      expired: totalExpiredKeys,
      checked: totalCheckedKeys
    }
  }
}

module.exports = KeyExpiration
