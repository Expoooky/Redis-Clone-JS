/**
 * CachingPatterns.js - Redis-based caching pattern implementations
 * 
 * This module provides various caching strategies and patterns using Redis,
 * including cache-aside, write-through, write-behind, and cache warming.
 */

const logger = require('../utils/Logger')

/**
 * Cache-Aside Pattern (Lazy Loading)
 * Application manages cache explicitly
 */
class CacheAside {
  constructor(redisClient, dataSource, options = {}) {
    this.redisClient = redisClient
    this.dataSource = dataSource // Function or object with data access methods
    this.options = {
      keyPrefix: options.keyPrefix || 'cache:aside:',
      defaultTTL: options.defaultTTL || 3600, // 1 hour
      serializeKey: options.serializeKey || ((key) => String(key)),
      serialize: options.serialize || JSON.stringify,
      deserialize: options.deserialize || JSON.parse,
      ...options
    }
    
    this.logger = logger.child({ component: 'CacheAside' })
  }

  /**
   * Get data with cache-aside pattern
   * @param {*} key - Data key
   * @param {Function} loader - Function to load data if not in cache
   * @param {Object} options - Options for this operation
   * @returns {Promise<*>} Data value
   */
  async get(key, loader, options = {}) {
    const cacheKey = this.options.keyPrefix + this.options.serializeKey(key)
    const ttl = options.ttl || this.options.defaultTTL

    try {
      // Try to get from cache first
      const cachedValue = await this.redisClient.sendCommand(`GET ${cacheKey}`)
      
      if (cachedValue !== null) {
        this.logger.debug('Cache hit', { key, cacheKey })
        try {
          // Check if the cached value is a string before decoding
          if (typeof cachedValue === 'string') {
            const decodedValue = Buffer.from(cachedValue, 'base64').toString('utf8')
            return {
              value: this.options.deserialize(decodedValue),
              fromCache: true,
              key
            }
          } else {
            // Handle non-string Redis responses (like numbers)
            this.logger.warn('Cache value is not a string, falling back to source', { key, valueType: typeof cachedValue })
            // Fall through to load from source
          }
        } catch (deserializeError) {
          this.logger.warn('Cache deserialization failed', { key, error: deserializeError.message })
          // Fall through to load from source
        }
      }

      // Cache miss - load from data source
      this.logger.debug('Cache miss', { key, cacheKey })
      
      const value = await loader(key)
      
      if (value !== null && value !== undefined) {
        // Store in cache
        await this.set(key, value, { ttl })
      }

      return {
        value,
        fromCache: false,
        key
      }
    } catch (error) {
      this.logger.error('Cache-aside get error', error, { key })
      
      // Fall back to data source on cache error
      try {
        const value = await loader(key)
        return {
          value,
          fromCache: false,
          key,
          error: error.message
        }
      } catch (loaderError) {
        throw loaderError
      }
    }
  }

  /**
   * Set data in cache
   * @param {*} key - Data key
   * @param {*} value - Data value
   * @param {Object} options - Set options
   * @returns {Promise<Object>} Set result
   */
  async set(key, value, options = {}) {
    const cacheKey = this.options.keyPrefix + this.options.serializeKey(key)
    const ttl = options.ttl || this.options.defaultTTL

    try {
      const serializedValue = this.options.serialize(value)
      const encodedValue = Buffer.from(serializedValue).toString('base64')
      
      await this.redisClient.sendCommand(`SET ${cacheKey} ${encodedValue}`)
      if (ttl > 0) {
        await this.redisClient.sendCommand(`EXPIRE ${cacheKey} ${ttl}`)
      }

      this.logger.debug('Cache set', { key, cacheKey, ttl })

      return {
        success: true,
        key,
        cached: true
      }
    } catch (error) {
      this.logger.error('Cache set error', error, { key })
      return {
        success: false,
        key,
        error: error.message
      }
    }
  }

  /**
   * Delete from cache
   * @param {*} key - Data key
   * @returns {Promise<Object>} Delete result
   */
  async delete(key) {
    const cacheKey = this.options.keyPrefix + this.options.serializeKey(key)

    try {
      const result = await this.redisClient.sendCommand(`DEL ${cacheKey}`)
      
      this.logger.debug('Cache delete', { key, cacheKey, deleted: result === 1 })

      return {
        success: true,
        key,
        deleted: result === 1
      }
    } catch (error) {
      this.logger.error('Cache delete error', error, { key })
      return {
        success: false,
        key,
        error: error.message
      }
    }
  }

  /**
   * Get multiple keys with cache-aside
   * @param {Array} keys - Array of keys
   * @param {Function} loader - Batch loader function
   * @param {Object} options - Options
   * @returns {Promise<Object>} Batch result
   */
  async getMultiple(keys, loader, options = {}) {
    const cacheKeys = keys.map(key => this.options.keyPrefix + this.options.serializeKey(key))
    
    try {
      // Get all cache values
      const cachedValues = await this.redisClient.sendCommand(`MGET ${cacheKeys.join(' ')}`)
      
      const results = {}
      const missingKeys = []
      
      keys.forEach((key, index) => {
        const cachedValue = cachedValues[index]
        
        if (cachedValue !== null) {
          try {
            results[key] = {
              value: this.options.deserialize(cachedValue),
              fromCache: true
            }
          } catch (deserializeError) {
            missingKeys.push(key)
          }
        } else {
          missingKeys.push(key)
        }
      })

      // Load missing keys
      if (missingKeys.length > 0) {
        this.logger.debug('Loading missing keys', { missingCount: missingKeys.length })
        
        const loadedValues = await loader(missingKeys)
        
        // Cache loaded values
        const cachePromises = []
        for (const [key, value] of Object.entries(loadedValues)) {
          if (value !== null && value !== undefined) {
            results[key] = {
              value,
              fromCache: false
            }
            cachePromises.push(this.set(key, value, options))
          }
        }
        
        await Promise.allSettled(cachePromises)
      }

      return {
        success: true,
        results,
        cacheHitRatio: (keys.length - missingKeys.length) / keys.length
      }
    } catch (error) {
      this.logger.error('Cache-aside getMultiple error', error)
      
      // Fall back to loading all from source
      const loadedValues = await loader(keys)
      const results = {}
      
      for (const [key, value] of Object.entries(loadedValues)) {
        results[key] = {
          value,
          fromCache: false,
          error: error.message
        }
      }

      return {
        success: false,
        results,
        error: error.message
      }
    }
  }
}

/**
 * Write-Through Cache Pattern
 * Writes go to cache and data source simultaneously
 */
class WriteThrough {
  constructor(redisClient, dataSource, options = {}) {
    this.redisClient = redisClient
    this.dataSource = dataSource
    this.options = {
      keyPrefix: options.keyPrefix || 'cache:write_through:',
      defaultTTL: options.defaultTTL || 3600,
      serializeKey: options.serializeKey || ((key) => String(key)),
      serialize: options.serialize || JSON.stringify,
      deserialize: options.deserialize || JSON.parse,
      ...options
    }
    
    this.logger = logger.child({ component: 'WriteThrough' })
  }

  /**
   * Get data (read-through)
   * @param {*} key - Data key
   * @returns {Promise<*>} Data value
   */
  async get(key) {
    const cacheKey = this.options.keyPrefix + this.options.serializeKey(key)

    try {
      // Try cache first
      const cachedValue = await this.redisClient.sendCommand(`GET ${cacheKey}`)
      
      if (cachedValue !== null) {
        this.logger.debug('Cache hit', { key })
        if (typeof cachedValue === 'string') {
          const decodedValue = Buffer.from(cachedValue, 'base64').toString('utf8')
          return {
            value: this.options.deserialize(decodedValue),
            fromCache: true,
            key
          }
        } else {
          this.logger.warn('Cache value is not a string, falling back to source', { key, valueType: typeof cachedValue })
          // Fall through to load from source
        }
      }

      // Load from data source
      this.logger.debug('Cache miss - loading from source', { key })
      const value = await this.dataSource.get(key)
      
      if (value !== null && value !== undefined) {
        // Cache the loaded value
        await this.cacheValue(key, value)
      }

      return {
        value,
        fromCache: false,
        key
      }
    } catch (error) {
      this.logger.error('Write-through get error', error, { key })
      throw error
    }
  }

  /**
   * Set data (write-through)
   * @param {*} key - Data key
   * @param {*} value - Data value
   * @param {Object} options - Set options
   * @returns {Promise<Object>} Set result
   */
  async set(key, value, options = {}) {
    try {
      // Write to data source first
      await this.dataSource.set(key, value)
      
      // Then update cache
      await this.cacheValue(key, value, options)

      this.logger.debug('Write-through set completed', { key })

      return {
        success: true,
        key,
        writtenToSource: true,
        cached: true
      }
    } catch (error) {
      this.logger.error('Write-through set error', error, { key })
      
      // If data source write fails, don't cache
      return {
        success: false,
        key,
        error: error.message
      }
    }
  }

  /**
   * Delete data (write-through)
   * @param {*} key - Data key
   * @returns {Promise<Object>} Delete result
   */
  async delete(key) {
    try {
      // Delete from data source first
      await this.dataSource.delete(key)
      
      // Then remove from cache
      const cacheKey = this.options.keyPrefix + this.options.serializeKey(key)
      await this.redisClient.sendCommand(`DEL ${cacheKey}`)

      this.logger.debug('Write-through delete completed', { key })

      return {
        success: true,
        key,
        deletedFromSource: true,
        removedFromCache: true
      }
    } catch (error) {
      this.logger.error('Write-through delete error', error, { key })
      return {
        success: false,
        key,
        error: error.message
      }
    }
  }

  /**
   * Cache a value
   * @private
   */
  async cacheValue(key, value, options = {}) {
    const cacheKey = this.options.keyPrefix + this.options.serializeKey(key)
    const ttl = options.ttl || this.options.defaultTTL
    const serializedValue = this.options.serialize(value)
    const encodedValue = Buffer.from(serializedValue).toString('base64')

    await this.redisClient.sendCommand(`SET ${cacheKey} ${encodedValue}`)
    if (ttl > 0) {
      await this.redisClient.sendCommand(`EXPIRE ${cacheKey} ${ttl}`)
    }
  }
}

/**
 * Write-Behind (Write-Back) Cache Pattern
 * Writes go to cache immediately, data source updated asynchronously
 */
class WriteBehind {
  constructor(redisClient, dataSource, options = {}) {
    this.redisClient = redisClient
    this.dataSource = dataSource
    this.options = {
      keyPrefix: options.keyPrefix || 'cache:write_behind:',
      dirtyKeyPrefix: options.dirtyKeyPrefix || 'dirty:write_behind:',
      defaultTTL: options.defaultTTL || 3600,
      flushInterval: options.flushInterval || 10000, // 10 seconds
      batchSize: options.batchSize || 100,
      serializeKey: options.serializeKey || ((key) => String(key)),
      serialize: options.serialize || JSON.stringify,
      deserialize: options.deserialize || JSON.parse,
      ...options
    }
    
    this.logger = logger.child({ component: 'WriteBehind' })
    this.flushTimer = null
    
    if (options.autoFlush !== false) {
      this.startAutoFlush()
    }
  }

  /**
   * Get data
   * @param {*} key - Data key
   * @returns {Promise<*>} Data value
   */
  async get(key) {
    const cacheKey = this.options.keyPrefix + this.options.serializeKey(key)

    try {
      // Try cache first
      const cachedValue = await this.redisClient.sendCommand(`GET ${cacheKey}`)
      
      if (cachedValue !== null) {
        if (typeof cachedValue === 'string') {
          const decodedValue = Buffer.from(cachedValue, 'base64').toString('utf8')
          return {
            value: this.options.deserialize(decodedValue),
            fromCache: true,
            key
          }
        } else {
          this.logger.warn('Cache value is not a string, falling back to source', { key, valueType: typeof cachedValue })
          // Fall through to load from source
        }
      }

      // Load from data source
      const value = await this.dataSource.get(key)
      
      if (value !== null && value !== undefined) {
        // Cache without marking as dirty
        await this.cacheValue(key, value, false)
      }

      return {
        value,
        fromCache: false,
        key
      }
    } catch (error) {
      this.logger.error('Write-behind get error', error, { key })
      throw error
    }
  }

  /**
   * Set data (write-behind)
   * @param {*} key - Data key
   * @param {*} value - Data value
   * @param {Object} options - Set options
   * @returns {Promise<Object>} Set result
   */
  async set(key, value, options = {}) {
    try {
      // Write to cache immediately
      await this.cacheValue(key, value, true, options)
      
      // Mark as dirty for later flush
      await this.markDirty(key)

      this.logger.debug('Write-behind set completed', { key })

      return {
        success: true,
        key,
        cached: true,
        markedDirty: true
      }
    } catch (error) {
      this.logger.error('Write-behind set error', error, { key })
      return {
        success: false,
        key,
        error: error.message
      }
    }
  }

  /**
   * Delete data (write-behind)
   * @param {*} key - Data key
   * @returns {Promise<Object>} Delete result
   */
  async delete(key) {
    try {
      // Remove from cache
      const cacheKey = this.options.keyPrefix + this.options.serializeKey(key)
      await this.redisClient.sendCommand(`DEL ${cacheKey}`)
      
      // Mark for deletion in data source
      await this.markForDeletion(key)

      this.logger.debug('Write-behind delete completed', { key })

      return {
        success: true,
        key,
        removedFromCache: true,
        markedForDeletion: true
      }
    } catch (error) {
      this.logger.error('Write-behind delete error', error, { key })
      return {
        success: false,
        key,
        error: error.message
      }
    }
  }

  /**
   * Flush dirty data to data source
   * @returns {Promise<Object>} Flush result
   */
  async flush() {
    try {
      // Get dirty keys
      const dirtyKeys = await this.getDirtyKeys(this.options.batchSize)
      
      if (dirtyKeys.length === 0) {
        return {
          success: true,
          flushedCount: 0
        }
      }

      const results = {
        success: true,
        flushedCount: 0,
        errors: []
      }

      // Process each dirty key
      for (const dirtyKey of dirtyKeys) {
        try {
          // Validate dirty key format
          if (!dirtyKey || typeof dirtyKey !== 'string' || dirtyKey.trim() === '') {
            this.logger.warn('Invalid dirty key format', { dirtyKey })
            continue
          }

          let keyData
          try {
            keyData = JSON.parse(dirtyKey)
          } catch (parseError) {
            this.logger.warn('Failed to parse dirty key JSON', { dirtyKey, error: parseError.message })
            // Remove invalid dirty key
            const dirtySetKey = this.options.dirtyKeyPrefix + 'set'
            await this.redisClient.sendCommand(`SREM ${dirtySetKey} "${dirtyKey}"`)
            continue
          }
          
          if (keyData.operation === 'set') {
            // Get value from cache and write to source
            const cacheKey = this.options.keyPrefix + keyData.key
            const cachedValue = await this.redisClient.sendCommand(`GET ${cacheKey}`)
            
            if (cachedValue !== null && typeof cachedValue === 'string') {
              try {
                const decodedValue = Buffer.from(cachedValue, 'base64').toString('utf8')
                const value = this.options.deserialize(decodedValue)
                await this.dataSource.set(keyData.originalKey, value)
              } catch (decodeError) {
                this.logger.warn('Failed to decode cached value', { cacheKey, error: decodeError.message })
                continue
              }
            }
          } else if (keyData.operation === 'delete') {
            await this.dataSource.delete(keyData.originalKey)
          }

          // Remove from dirty set
          const dirtySetKey = this.options.dirtyKeyPrefix + 'set'
          await this.redisClient.sendCommand(`SREM ${dirtySetKey} "${dirtyKey}"`)
          
          results.flushedCount++
        } catch (keyError) {
          this.logger.error('Error flushing key', keyError, { dirtyKey })
          results.errors.push({ key: dirtyKey, error: keyError.message })
        }
      }

      this.logger.debug('Write-behind flush completed', {
        flushedCount: results.flushedCount,
        errorCount: results.errors.length
      })

      return results
    } catch (error) {
      this.logger.error('Write-behind flush error', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Start automatic flushing
   * @private
   */
  startAutoFlush() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
    }

    this.flushTimer = setInterval(async () => {
      try {
        await this.flush()
      } catch (error) {
        this.logger.error('Auto-flush error', error)
      }
    }, this.options.flushInterval)

    this.logger.info('Auto-flush started', { interval: this.options.flushInterval })
  }

  /**
   * Stop automatic flushing
   */
  stopAutoFlush() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
      this.logger.info('Auto-flush stopped')
    }
  }

  /**
   * Cache a value
   * @private
   */
  async cacheValue(key, value, markDirty = false, options = {}) {
    const cacheKey = this.options.keyPrefix + this.options.serializeKey(key)
    const ttl = options.ttl || this.options.defaultTTL
    const serializedValue = this.options.serialize(value)
    const encodedValue = Buffer.from(serializedValue).toString('base64')

    await this.redisClient.sendCommand(`SET ${cacheKey} ${encodedValue}`)
    if (ttl > 0) {
      await this.redisClient.sendCommand(`EXPIRE ${cacheKey} ${ttl}`)
    }
  }

  /**
   * Mark key as dirty
   * @private
   */
  async markDirty(key) {
    const dirtySetKey = this.options.dirtyKeyPrefix + 'set'
    const dirtyData = JSON.stringify({
      key: this.options.serializeKey(key),
      originalKey: key,
      operation: 'set',
      timestamp: Date.now()
    })
    
    await this.redisClient.sendCommand(`SADD ${dirtySetKey} "${dirtyData}"`)
  }

  /**
   * Mark key for deletion
   * @private
   */
  async markForDeletion(key) {
    const dirtySetKey = this.options.dirtyKeyPrefix + 'set'
    const dirtyData = JSON.stringify({
      key: this.options.serializeKey(key),
      originalKey: key,
      operation: 'delete',
      timestamp: Date.now()
    })
    
    await this.redisClient.sendCommand(`SADD ${dirtySetKey} "${dirtyData}"`)
  }

  /**
   * Get dirty keys
   * @private
   */
  async getDirtyKeys(limit) {
    const dirtySetKey = this.options.dirtyKeyPrefix + 'set'
    const keys = await this.redisClient.sendCommand(`SRANDMEMBER ${dirtySetKey} ${limit}`)
    return Array.isArray(keys) ? keys : (keys ? [keys] : [])
  }
}

/**
 * Cache Warming Pattern
 * Proactively loads frequently accessed data into cache
 */
class CacheWarmer {
  constructor(redisClient, dataSource, options = {}) {
    this.redisClient = redisClient
    this.dataSource = dataSource
    this.options = {
      keyPrefix: options.keyPrefix || 'cache:warmed:',
      defaultTTL: options.defaultTTL || 3600,
      warmingBatchSize: options.warmingBatchSize || 50,
      serializeKey: options.serializeKey || ((key) => String(key)),
      serialize: options.serialize || JSON.stringify,
      deserialize: options.deserialize || JSON.parse,
      ...options
    }
    
    this.logger = logger.child({ component: 'CacheWarmer' })
  }

  /**
   * Warm cache with specific keys
   * @param {Array} keys - Keys to warm
   * @param {Object} options - Warming options
   * @returns {Promise<Object>} Warming result
   */
  async warmKeys(keys, options = {}) {
    const results = {
      success: true,
      warmedCount: 0,
      errors: [],
      totalKeys: keys.length
    }

    // Process in batches
    const batchSize = options.batchSize || this.options.warmingBatchSize
    
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize)
      
      try {
        const loadedData = await this.dataSource.getMultiple(batch)
        
        for (const [key, value] of Object.entries(loadedData)) {
          if (value !== null && value !== undefined) {
            await this.setCacheValue(key, value, options)
            results.warmedCount++
          }
        }
      } catch (error) {
        this.logger.error('Batch warming error', error, { batch })
        results.errors.push({ batch, error: error.message })
      }
    }

    this.logger.info('Cache warming completed', {
      totalKeys: results.totalKeys,
      warmedCount: results.warmedCount,
      errorCount: results.errors.length
    })

    return results
  }

  /**
   * Warm cache with data from a query
   * @param {Function} queryFn - Function that returns data to cache
   * @param {Function} keyExtractor - Function to extract keys from data
   * @param {Object} options - Warming options
   * @returns {Promise<Object>} Warming result
   */
  async warmFromQuery(queryFn, keyExtractor, options = {}) {
    try {
      const data = await queryFn()
      const entries = Array.isArray(data) ? data : [data]
      
      const results = {
        success: true,
        warmedCount: 0,
        errors: []
      }

      for (const entry of entries) {
        try {
          const key = keyExtractor(entry)
          await this.setCacheValue(key, entry, options)
          results.warmedCount++
        } catch (error) {
          this.logger.error('Entry warming error', error, { entry })
          results.errors.push({ entry, error: error.message })
        }
      }

      this.logger.info('Query-based warming completed', {
        warmedCount: results.warmedCount,
        errorCount: results.errors.length
      })

      return results
    } catch (error) {
      this.logger.error('Query warming error', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Schedule periodic cache warming
   * @param {Function} warmingFn - Function to call for warming
   * @param {number} interval - Interval in milliseconds
   * @returns {Object} Timer reference
   */
  scheduleWarming(warmingFn, interval) {
    const timer = setInterval(async () => {
      try {
        await warmingFn()
      } catch (error) {
        this.logger.error('Scheduled warming error', error)
      }
    }, interval)

    this.logger.info('Scheduled warming started', { interval })

    return {
      stop: () => {
        clearInterval(timer)
        this.logger.info('Scheduled warming stopped')
      }
    }
  }

  /**
   * Set cache value
   * @private
   */
  async setCacheValue(key, value, options = {}) {
    const cacheKey = this.options.keyPrefix + this.options.serializeKey(key)
    const ttl = options.ttl || this.options.defaultTTL
    const serializedValue = this.options.serialize(value)
    const encodedValue = Buffer.from(serializedValue).toString('base64')

    await this.redisClient.sendCommand(`SET ${cacheKey} ${encodedValue}`)
    if (ttl > 0) {
      await this.redisClient.sendCommand(`EXPIRE ${cacheKey} ${ttl}`)
    }
  }
}

/**
 * Caching Factory
 * Creates different caching patterns with common configurations
 */
class CachingFactory {
  constructor(redisClient) {
    this.redisClient = redisClient
  }

  /**
   * Create cache-aside instance
   */
  createCacheAside(dataSource, options = {}) {
    return new CacheAside(this.redisClient, dataSource, options)
  }

  /**
   * Create write-through instance
   */
  createWriteThrough(dataSource, options = {}) {
    return new WriteThrough(this.redisClient, dataSource, options)
  }

  /**
   * Create write-behind instance
   */
  createWriteBehind(dataSource, options = {}) {
    return new WriteBehind(this.redisClient, dataSource, options)
  }

  /**
   * Create cache warmer
   */
  createCacheWarmer(dataSource, options = {}) {
    return new CacheWarmer(this.redisClient, dataSource, options)
  }

  /**
   * Create session cache (short TTL, cache-aside)
   */
  createSessionCache(dataSource, options = {}) {
    return new CacheAside(this.redisClient, dataSource, {
      keyPrefix: 'cache:session:',
      defaultTTL: 1800, // 30 minutes
      ...options
    })
  }

  /**
   * Create long-term cache (long TTL, write-through)
   */
  createLongTermCache(dataSource, options = {}) {
    return new WriteThrough(this.redisClient, dataSource, {
      keyPrefix: 'cache:longterm:',
      defaultTTL: 86400, // 24 hours
      ...options
    })
  }
}

module.exports = {
  CacheAside,
  WriteThrough,
  WriteBehind,
  CacheWarmer,
  CachingFactory
}
