/**
 * RateLimiter.js - Redis-based rate limiting implementations
 * 
 * This module provides various rate limiting algorithms using Redis,
 * including token bucket, sliding window, and fixed window implementations.
 */

const logger = require('../utils/Logger')

/**
 * Token Bucket Rate Limiter
 * Allows bursts up to bucket capacity while maintaining average rate
 */
class TokenBucketLimiter {
  constructor(redisClient, options = {}) {
    this.redisClient = redisClient
    this.options = {
      capacity: options.capacity || 10, // Maximum tokens in bucket
      refillRate: options.refillRate || 1, // Tokens added per second
      windowSize: options.windowSize || 1000, // Window size in milliseconds
      keyPrefix: options.keyPrefix || 'rate_limit:token_bucket:',
      ...options
    }
    
    this.logger = logger.child({ component: 'TokenBucketLimiter' })
  }

  /**
   * Check if action is allowed and consume tokens
   * @param {string} key - Unique identifier (user ID, IP, etc.)
   * @param {number} tokens - Number of tokens to consume (default: 1)
   * @returns {Promise<Object>} Rate limit result
   */
  async isAllowed(key, tokens = 1) {
    const bucketKey = this.options.keyPrefix + key
    const now = Date.now()
    
    try {
      // Simple implementation without Lua scripts
      
      // Get current bucket state
      const currentTokensResult = await this.redisClient.sendCommand(`HGET ${bucketKey} tokens`)
      const lastRefillResult = await this.redisClient.sendCommand(`HGET ${bucketKey} last_refill`)
      
      const currentTokens = currentTokensResult ? parseFloat(currentTokensResult) : this.options.capacity
      const lastRefill = lastRefillResult ? parseInt(lastRefillResult) : now
      
      // Calculate tokens to add based on time elapsed
      const timeElapsed = Math.max(0, now - lastRefill)
      const tokensToAdd = (timeElapsed / this.options.windowSize) * this.options.refillRate
      const newTokens = Math.min(this.options.capacity, currentTokens + tokensToAdd)
      
      // Check if request can be satisfied
      let allowed = false
      let remainingTokens = newTokens
      
      if (newTokens >= tokens) {
        // Consume tokens
        remainingTokens = newTokens - tokens
        allowed = true
        
        // Update bucket state
        await this.redisClient.sendCommand(`HSET ${bucketKey} tokens ${remainingTokens} last_refill ${now}`)
        const expireTime = Math.ceil(this.options.capacity / this.options.refillRate * 2)
        await this.redisClient.sendCommand(`EXPIRE ${bucketKey} ${expireTime}`)
      } else {
        // Request denied, update refill time but don't consume
        await this.redisClient.sendCommand(`HSET ${bucketKey} tokens ${remainingTokens} last_refill ${now}`)
        const expireTime = Math.ceil(this.options.capacity / this.options.refillRate * 2)
        await this.redisClient.sendCommand(`EXPIRE ${bucketKey} ${expireTime}`)
      }

      const usedTokens = this.options.capacity - remainingTokens

      // Calculate retry after time if request was denied
      let retryAfter = null
      if (!allowed) {
        const tokensNeeded = tokens - remainingTokens
        retryAfter = Math.ceil((tokensNeeded / this.options.refillRate) * this.options.windowSize)
      }

      this.logger.debug('Token bucket rate limit check', {
        key,
        allowed,
        tokensRequested: tokens,
        remainingTokens,
        usedTokens,
        retryAfter
      })

      return {
        allowed,
        tokensRequested: tokens,
        remainingTokens,
        usedTokens,
        capacity: this.options.capacity,
        retryAfter,
        algorithm: 'token_bucket'
      }
    } catch (error) {
      this.logger.error('Token bucket rate limit error', error, { key })
      
      // Fail open - allow request on error
      return {
        allowed: true,
        error: error.message,
        algorithm: 'token_bucket'
      }
    }
  }
}

/**
 * Sliding Window Rate Limiter
 * Provides smooth rate limiting using a sliding time window
 */
class SlidingWindowLimiter {
  constructor(redisClient, options = {}) {
    this.redisClient = redisClient
    this.options = {
      limit: options.limit || 100, // Maximum requests per window
      windowSize: options.windowSize || 60000, // Window size in milliseconds
      precision: options.precision || 1000, // Granularity in milliseconds
      keyPrefix: options.keyPrefix || 'rate_limit:sliding:',
      ...options
    }
    
    this.logger = logger.child({ component: 'SlidingWindowLimiter' })
  }

  /**
   * Check if request is allowed within sliding window
   * @param {string} key - Unique identifier
   * @param {number} weight - Request weight (default: 1)
   * @returns {Promise<Object>} Rate limit result
   */
  async isAllowed(key, weight = 1) {
    const limitKey = this.options.keyPrefix + key
    const now = Date.now()
    const windowStart = now - this.options.windowSize
    const bucketSize = this.options.precision
    
    try {
      // Simple implementation without Lua scripts
      
      // Remove old entries first
      await this.redisClient.sendCommand(
        `ZREMRANGEBYSCORE ${limitKey} 0 ${windowStart}`
      )
      
      // Get current count in window
      const currentEntries = await this.redisClient.sendCommand(
        `ZRANGEBYSCORE ${limitKey} ${windowStart} ${now}`
      )
      
      let currentCount = 0
      if (currentEntries && currentEntries.length > 0) {
        // Each entry represents a request, count them all
        currentCount = currentEntries.length
      }

      // Check if request can be allowed
      let allowed = false
      let remaining = this.options.limit - currentCount
      
      if (currentCount + weight <= this.options.limit) {
        allowed = true
        
        // Add current request with unique timestamp to avoid collisions
        const uniqueScore = now + Math.random() * 0.001 // Add small random factor
        await this.redisClient.sendCommand(
          `ZADD ${limitKey} ${uniqueScore} ${now}:${weight}:${Math.random()}`
        )
        
        const expireTime = Math.ceil(this.options.windowSize / 1000) + 1
        await this.redisClient.sendCommand(`EXPIRE ${limitKey} ${expireTime}`)
        
        currentCount += weight
        remaining = this.options.limit - currentCount
      }

      // Calculate reset time (when the oldest request will expire)
      let resetTime = null
      if (!allowed) {
        resetTime = now + this.options.windowSize
      }

      this.logger.debug('Sliding window rate limit check', {
        key,
        allowed,
        weight,
        currentCount,
        remaining,
        limit: this.options.limit,
        windowSize: this.options.windowSize
      })

      return {
        allowed,
        weight,
        currentCount,
        remaining,
        limit: this.options.limit,
        windowSize: this.options.windowSize,
        resetTime,
        algorithm: 'sliding_window'
      }
    } catch (error) {
      this.logger.error('Sliding window rate limit error', error, { key })
      
      return {
        allowed: true,
        error: error.message,
        algorithm: 'sliding_window'
      }
    }
  }
}

/**
 * Fixed Window Rate Limiter
 * Simple counter-based rate limiting with fixed time windows
 */
class FixedWindowLimiter {
  constructor(redisClient, options = {}) {
    this.redisClient = redisClient
    this.options = {
      limit: options.limit || 100, // Maximum requests per window
      windowSize: options.windowSize || 60000, // Window size in milliseconds
      keyPrefix: options.keyPrefix || 'rate_limit:fixed:',
      ...options
    }
    
    this.logger = logger.child({ component: 'FixedWindowLimiter' })
  }

  /**
   * Check if request is allowed within fixed window
   * @param {string} key - Unique identifier
   * @param {number} increment - Counter increment (default: 1)
   * @returns {Promise<Object>} Rate limit result
   */
  async isAllowed(key, increment = 1) {
    const now = Date.now()
    const windowStart = Math.floor(now / this.options.windowSize) * this.options.windowSize
    const limitKey = `${this.options.keyPrefix}${key}:${windowStart}`
    
    try {
      // Simple implementation without Lua scripts
      
      // Get current count
      const currentResult = await this.redisClient.sendCommand(`GET ${limitKey}`)
      const current = currentResult ? parseInt(currentResult) : 0
      
      let allowed = false
      let currentCount = current
      let remaining = this.options.limit - current
      
      if (current + increment <= this.options.limit) {
        // Allow request and increment counter
        const newValue = await this.redisClient.sendCommand(`INCRBY ${limitKey} ${increment}`)
        currentCount = newValue
        remaining = this.options.limit - newValue
        allowed = true
        
        // Set expiration
        const ttl = Math.ceil(this.options.windowSize / 1000)
        await this.redisClient.sendCommand(`EXPIRE ${limitKey} ${ttl}`)
      }

      // Calculate reset time (end of current window)
      const resetTime = windowStart + this.options.windowSize

      this.logger.debug('Fixed window rate limit check', {
        key,
        allowed,
        increment,
        currentCount,
        remaining,
        limit: this.options.limit,
        windowStart,
        resetTime
      })

      return {
        allowed,
        increment,
        currentCount,
        remaining,
        limit: this.options.limit,
        windowSize: this.options.windowSize,
        resetTime,
        algorithm: 'fixed_window'
      }
    } catch (error) {
      this.logger.error('Fixed window rate limit error', error, { key })
      
      return {
        allowed: true,
        error: error.message,
        algorithm: 'fixed_window'
      }
    }
  }
}

/**
 * Composite Rate Limiter
 * Combines multiple rate limiting strategies
 */
class CompositeRateLimiter {
  constructor(redisClient, limiters = []) {
    this.redisClient = redisClient
    this.limiters = limiters
    this.logger = logger.child({ component: 'CompositeRateLimiter' })
  }

  /**
   * Add a rate limiter to the composite
   * @param {Object} limiter - Rate limiter instance
   * @param {string} name - Limiter name
   */
  addLimiter(limiter, name) {
    this.limiters.push({ limiter, name })
  }

  /**
   * Check all rate limiters (all must pass)
   * @param {string} key - Unique identifier
   * @param {Object} params - Parameters for each limiter
   * @returns {Promise<Object>} Composite result
   */
  async isAllowed(key, params = {}) {
    const results = []
    let overallAllowed = true
    let restrictiveLimiter = null

    for (const { limiter, name } of this.limiters) {
      try {
        const param = params[name] || 1
        const result = await limiter.isAllowed(key, param)
        
        results.push({
          name,
          ...result
        })

        if (!result.allowed) {
          overallAllowed = false
          if (!restrictiveLimiter) {
            restrictiveLimiter = { name, ...result }
          }
        }
      } catch (error) {
        this.logger.error('Composite limiter error', error, { limiter: name, key })
        results.push({
          name,
          allowed: true,
          error: error.message
        })
      }
    }

    this.logger.debug('Composite rate limit check', {
      key,
      overallAllowed,
      limiterCount: this.limiters.length,
      restrictiveLimiter: restrictiveLimiter?.name
    })

    return {
      allowed: overallAllowed,
      results,
      restrictiveLimiter,
      algorithm: 'composite'
    }
  }
}

/**
 * Rate Limiter Factory
 * Creates rate limiters with common configurations
 */
class RateLimiterFactory {
  constructor(redisClient) {
    this.redisClient = redisClient
  }

  /**
   * Create API rate limiter (requests per minute)
   */
  createAPILimiter(requestsPerMinute = 60) {
    return new SlidingWindowLimiter(this.redisClient, {
      limit: requestsPerMinute,
      windowSize: 60000, // 1 minute
      precision: 1000, // 1 second buckets
      keyPrefix: 'rate_limit:api:'
    })
  }

  /**
   * Create login rate limiter (attempts per hour)
   */
  createLoginLimiter(attemptsPerHour = 5) {
    return new FixedWindowLimiter(this.redisClient, {
      limit: attemptsPerHour,
      windowSize: 3600000, // 1 hour
      keyPrefix: 'rate_limit:login:'
    })
  }

  /**
   * Create burst-tolerant limiter (token bucket)
   */
  createBurstLimiter(capacity = 10, refillRate = 1) {
    return new TokenBucketLimiter(this.redisClient, {
      capacity,
      refillRate,
      windowSize: 1000, // 1 second
      keyPrefix: 'rate_limit:burst:'
    })
  }

  /**
   * Create composite API protection
   */
  createAPIProtection() {
    const composite = new CompositeRateLimiter(this.redisClient)
    
    // Burst protection
    composite.addLimiter(this.createBurstLimiter(20, 5), 'burst')
    
    // Per-minute limit
    composite.addLimiter(this.createAPILimiter(100), 'api_minute')
    
    // Per-hour limit
    composite.addLimiter(new SlidingWindowLimiter(this.redisClient, {
      limit: 1000,
      windowSize: 3600000,
      keyPrefix: 'rate_limit:api_hour:'
    }), 'api_hour')

    return composite
  }
}

module.exports = {
  TokenBucketLimiter,
  SlidingWindowLimiter,
  FixedWindowLimiter,
  CompositeRateLimiter,
  RateLimiterFactory
}
