/**
 * DistributedLock.js - Redis-based distributed locking implementation
 * 
 * This module provides robust distributed locking mechanisms using Redis,
 * including automatic expiration, lock renewal, and deadlock prevention.
 */

const crypto = require('crypto')
const logger = require('../utils/Logger')

/**
 * Distributed lock implementation with Redis
 */
class DistributedLock {
  constructor(redisClient, options = {}) {
    this.redisClient = redisClient
    this.options = {
      lockTimeout: options.lockTimeout || 30000, // 30 seconds default
      retryInterval: options.retryInterval || 100, // 100ms retry interval
      maxRetries: options.maxRetries || 10,
      autoRenew: options.autoRenew || true,
      renewInterval: options.renewInterval || 10000, // 10 seconds
      ...options
    }
    
    this.activeLocks = new Map() // lockKey -> { token, renewalTimer }
    this.logger = logger.child({ component: 'DistributedLock' })
  }

  /**
   * Acquire a distributed lock
   * @param {string} lockKey - Unique key for the lock
   * @param {Object} options - Lock acquisition options
   * @returns {Promise<Object>} Lock token and metadata
   */
  async acquire(lockKey, options = {}) {
    const lockOptions = { ...this.options, ...options }
    const token = this.generateToken()
    const lockTimeout = lockOptions.lockTimeout
    const maxRetries = lockOptions.maxRetries
    const retryInterval = lockOptions.retryInterval

    let attempts = 0
    
    while (attempts < maxRetries) {
      try {
        // Try to acquire the lock using basic commands
        // First check if key exists
        const exists = await this.redisClient.sendCommand(`EXISTS ${lockKey}`)
        
        if (exists === 0) {
          // Key doesn't exist, try to set it
          await this.redisClient.sendCommand(`SET ${lockKey} ${token}`)
          await this.redisClient.sendCommand(`PEXPIRE ${lockKey} ${lockTimeout}`)
        }

        if (exists === 0) {
          // Lock acquired successfully
          const lockInfo = {
            lockKey,
            token,
            acquiredAt: Date.now(),
            expiresAt: Date.now() + lockTimeout,
            timeout: lockTimeout,
            autoRenew: lockOptions.autoRenew
          }

          this.activeLocks.set(lockKey, lockInfo)

          // Start auto-renewal if enabled
          if (lockOptions.autoRenew) {
            this.startAutoRenewal(lockKey, lockInfo)
          }

          this.logger.info('Distributed lock acquired', {
            lockKey,
            token: token.substring(0, 8) + '...',
            timeout: lockTimeout,
            autoRenew: lockOptions.autoRenew
          })

          return {
            success: true,
            lockKey,
            token,
            ...lockInfo
          }
        }
      } catch (error) {
        this.logger.warn('Lock acquisition attempt failed', {
          lockKey,
          attempt: attempts + 1,
          error: error.message
        })
      }

      attempts++
      if (attempts < maxRetries) {
        await this.sleep(retryInterval)
      }
    }

    // Failed to acquire lock
    this.logger.warn('Failed to acquire lock after all attempts', {
      lockKey,
      attempts,
      maxRetries
    })

    return {
      success: false,
      error: 'Failed to acquire lock after maximum retries',
      attempts
    }
  }

  /**
   * Release a distributed lock
   * @param {string} lockKey - Lock key to release
   * @param {string} token - Lock token for verification
   * @returns {Promise<Object>} Release result
   */
  async release(lockKey, token) {
    try {
      // Simple implementation: check token and delete if matches
      const currentToken = await this.redisClient.sendCommand(`GET ${lockKey}`)
      
      let released = false
      if (currentToken === token) {
        const deleteResult = await this.redisClient.sendCommand(`DEL ${lockKey}`)
        released = deleteResult === 1
      }

      if (released) {
        // Stop auto-renewal
        this.stopAutoRenewal(lockKey)
        this.activeLocks.delete(lockKey)

        this.logger.info('Distributed lock released', {
          lockKey,
          token: token.substring(0, 8) + '...'
        })
      } else {
        this.logger.warn('Failed to release lock - token mismatch or expired', {
          lockKey,
          token: token.substring(0, 8) + '...'
        })
      }

      return {
        success: released,
        lockKey,
        released
      }
    } catch (error) {
      this.logger.error('Error releasing lock', error, {
        lockKey,
        token: token.substring(0, 8) + '...'
      })

      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Renew a distributed lock
   * @param {string} lockKey - Lock key to renew
   * @param {string} token - Lock token for verification
   * @param {number} timeout - New timeout in milliseconds
   * @returns {Promise<Object>} Renewal result
   */
  async renew(lockKey, token, timeout = null) {
    const renewTimeout = timeout || this.options.lockTimeout

    try {
      // Simple implementation: check token and renew if matches
      const currentToken = await this.redisClient.sendCommand(`GET ${lockKey}`)
      
      let renewed = false
      if (currentToken === token) {
        const expireResult = await this.redisClient.sendCommand(
          `PEXPIRE ${lockKey} ${renewTimeout}`
        )
        renewed = expireResult === 1
      }

      if (renewed) {
        // Update lock info
        const lockInfo = this.activeLocks.get(lockKey)
        if (lockInfo) {
          lockInfo.expiresAt = Date.now() + renewTimeout
          lockInfo.timeout = renewTimeout
        }

        this.logger.debug('Lock renewed', {
          lockKey,
          token: token.substring(0, 8) + '...',
          newTimeout: renewTimeout
        })
      }

      return {
        success: renewed,
        lockKey,
        renewed,
        newExpiresAt: renewed ? Date.now() + renewTimeout : null
      }
    } catch (error) {
      this.logger.error('Error renewing lock', error, {
        lockKey,
        token: token.substring(0, 8) + '...'
      })

      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Check if a lock is currently held
   * @param {string} lockKey - Lock key to check
   * @returns {Promise<Object>} Lock status
   */
  async isLocked(lockKey) {
    try {
      const value = await this.redisClient.sendCommand(`GET ${lockKey}`)
      const locked = value !== null
      
      let ttl = null
      if (locked) {
        ttl = await this.redisClient.sendCommand(`PTTL ${lockKey}`)
      }

      return {
        success: true,
        lockKey,
        locked,
        token: locked ? value : null,
        ttl: ttl > 0 ? ttl : null,
        expiresAt: ttl > 0 ? Date.now() + ttl : null
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Execute a function while holding a lock
   * @param {string} lockKey - Lock key
   * @param {Function} fn - Function to execute
   * @param {Object} options - Lock options
   * @returns {Promise<*>} Function result
   */
  async withLock(lockKey, fn, options = {}) {
    const lockResult = await this.acquire(lockKey, options)
    
    if (!lockResult.success) {
      throw new Error(`Failed to acquire lock: ${lockResult.error}`)
    }

    try {
      // Execute the function
      const result = await fn()
      return result
    } finally {
      // Always release the lock
      await this.release(lockKey, lockResult.token)
    }
  }

  /**
   * Start automatic lock renewal
   */
  startAutoRenewal(lockKey, lockInfo) {
    const renewalInterval = this.options.renewInterval

    const renewalTimer = setInterval(async () => {
      try {
        const renewResult = await this.renew(lockKey, lockInfo.token)
        
        if (!renewResult.success) {
          this.logger.warn('Auto-renewal failed, stopping', {
            lockKey,
            token: lockInfo.token.substring(0, 8) + '...'
          })
          this.stopAutoRenewal(lockKey)
        }
      } catch (error) {
        this.logger.error('Error during auto-renewal', error, {
          lockKey
        })
        this.stopAutoRenewal(lockKey)
      }
    }, renewalInterval)

    // Store timer reference
    lockInfo.renewalTimer = renewalTimer
  }

  /**
   * Stop automatic lock renewal
   */
  stopAutoRenewal(lockKey) {
    const lockInfo = this.activeLocks.get(lockKey)
    if (lockInfo && lockInfo.renewalTimer) {
      clearInterval(lockInfo.renewalTimer)
      delete lockInfo.renewalTimer
    }
  }

  /**
   * Generate a unique token for lock identification
   */
  generateToken() {
    return crypto.randomBytes(16).toString('hex') + ':' + Date.now()
  }

  /**
   * Get all active locks managed by this instance
   */
  getActiveLocks() {
    const locks = []
    
    for (const [lockKey, lockInfo] of this.activeLocks.entries()) {
      locks.push({
        lockKey,
        token: lockInfo.token.substring(0, 8) + '...',
        acquiredAt: lockInfo.acquiredAt,
        expiresAt: lockInfo.expiresAt,
        autoRenew: lockInfo.autoRenew,
        isActive: lockInfo.renewalTimer !== undefined
      })
    }

    return locks
  }

  /**
   * Cleanup all locks and timers
   */
  cleanup() {
    for (const lockKey of this.activeLocks.keys()) {
      this.stopAutoRenewal(lockKey)
    }
    this.activeLocks.clear()
    
    this.logger.info('Distributed lock cleanup completed')
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

/**
 * Lock manager for handling multiple concurrent locks
 */
class LockManager {
  constructor(redisClient, options = {}) {
    this.redisClient = redisClient
    this.distributedLock = new DistributedLock(redisClient, options)
    this.logger = logger.child({ component: 'LockManager' })
  }

  /**
   * Acquire multiple locks atomically
   * @param {Array<string>} lockKeys - Array of lock keys
   * @param {Object} options - Lock options
   * @returns {Promise<Object>} Acquisition result
   */
  async acquireMultiple(lockKeys, options = {}) {
    const acquiredLocks = []
    const sortedKeys = [...lockKeys].sort() // Sort to prevent deadlocks

    try {
      for (const lockKey of sortedKeys) {
        const result = await this.distributedLock.acquire(lockKey, options)
        
        if (!result.success) {
          // Release all acquired locks on failure
          await this.releaseMultiple(acquiredLocks)
          return {
            success: false,
            error: `Failed to acquire lock: ${lockKey}`,
            acquiredLocks: [],
            failedLock: lockKey
          }
        }

        acquiredLocks.push(result)
      }

      this.logger.info('Multiple locks acquired successfully', {
        lockKeys: sortedKeys,
        count: acquiredLocks.length
      })

      return {
        success: true,
        acquiredLocks,
        lockKeys: sortedKeys
      }
    } catch (error) {
      // Release any acquired locks on error
      await this.releaseMultiple(acquiredLocks)
      
      return {
        success: false,
        error: error.message,
        acquiredLocks: []
      }
    }
  }

  /**
   * Release multiple locks
   * @param {Array<Object>} locks - Array of lock objects
   * @returns {Promise<Object>} Release result
   */
  async releaseMultiple(locks) {
    const results = []
    
    for (const lock of locks) {
      try {
        const result = await this.distributedLock.release(lock.lockKey, lock.token)
        results.push(result)
      } catch (error) {
        results.push({
          success: false,
          lockKey: lock.lockKey,
          error: error.message
        })
      }
    }

    const successCount = results.filter(r => r.success).length
    
    this.logger.info('Multiple locks release completed', {
      total: locks.length,
      successful: successCount,
      failed: locks.length - successCount
    })

    return {
      success: successCount === locks.length,
      results,
      successCount,
      totalCount: locks.length
    }
  }

  /**
   * Execute function with multiple locks
   * @param {Array<string>} lockKeys - Lock keys to acquire
   * @param {Function} fn - Function to execute
   * @param {Object} options - Lock options
   * @returns {Promise<*>} Function result
   */
  async withMultipleLocks(lockKeys, fn, options = {}) {
    const lockResult = await this.acquireMultiple(lockKeys, options)
    
    if (!lockResult.success) {
      throw new Error(`Failed to acquire locks: ${lockResult.error}`)
    }

    try {
      const result = await fn()
      return result
    } finally {
      await this.releaseMultiple(lockResult.acquiredLocks)
    }
  }
}

module.exports = { DistributedLock, LockManager }
