/**
 * NotificationManager.js - Manages keyspace notification subscriptions and delivery
 * 
 * This module manages client subscriptions to keyspace notifications,
 * handles pattern-based subscriptions, and coordinates with the PubSub system.
 */

const EventEmitter = require('events')
const logger = require('../utils/Logger')

/**
 * Notification subscription manager
 * Coordinates keyspace notifications with client subscriptions
 */
class NotificationManager extends EventEmitter {
  constructor(pubSubManager, keyspaceNotifications) {
    super()
    
    this.pubSubManager = pubSubManager
    this.keyspaceNotifications = keyspaceNotifications
    this.logger = logger.child({ component: 'NotificationManager' })
    
    // Track notification subscriptions separately from regular pub/sub
    this.notificationSubscriptions = new Map() // clientId -> Set of patterns
    this.patternSubscriptions = new Map() // pattern -> Set of clientIds
    
    // Statistics
    this.stats = {
      totalSubscriptions: 0,
      keyspaceSubscriptions: 0,
      keyeventSubscriptions: 0,
      patternSubscriptions: 0,
      notificationsSent: 0,
      subscriptionChanges: 0
    }
    
    this.logger.info('Notification manager initialized')
  }

  /**
   * Subscribe a client to keyspace notifications using patterns
   * @param {string} clientId - Client identifier
   * @param {string} pattern - Pattern to subscribe to (supports * and ?)
   * @returns {Object} Subscription result
   */
  subscribe(clientId, pattern) {
    try {
      // Validate pattern
      if (!this.isValidNotificationPattern(pattern)) {
        return {
          success: false,
          error: 'Invalid notification pattern'
        }
      }

      // Initialize client subscriptions if needed
      if (!this.notificationSubscriptions.has(clientId)) {
        this.notificationSubscriptions.set(clientId, new Set())
      }

      // Initialize pattern subscriptions if needed
      if (!this.patternSubscriptions.has(pattern)) {
        this.patternSubscriptions.set(pattern, new Set())
      }

      // Add subscription
      const clientPatterns = this.notificationSubscriptions.get(clientId)
      const patternClients = this.patternSubscriptions.get(pattern)

      const wasNewSubscription = !clientPatterns.has(pattern)
      
      clientPatterns.add(pattern)
      patternClients.add(clientId)

      if (wasNewSubscription) {
        this.stats.totalSubscriptions++
        this.stats.subscriptionChanges++
        
        // Track subscription types
        if (this.isKeyspacePattern(pattern)) {
          this.stats.keyspaceSubscriptions++
        } else if (this.isKeyeventPattern(pattern)) {
          this.stats.keyeventSubscriptions++
        }
        
        if (this.isWildcardPattern(pattern)) {
          this.stats.patternSubscriptions++
        }
      }

      // Use the existing PubSub system for the actual subscription
      const pubsubResult = this.pubSubManager.psubscribe(clientId, pattern)

      this.logger.info('Notification subscription added', {
        clientId,
        pattern,
        totalPatterns: clientPatterns.size,
        wasNew: wasNewSubscription
      })

      this.emit('subscribed', {
        clientId,
        pattern,
        timestamp: Date.now()
      })

      return {
        success: true,
        pattern,
        subscriptionCount: clientPatterns.size
      }

    } catch (error) {
      this.logger.error('Error adding notification subscription', error, {
        clientId,
        pattern
      })
      
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Unsubscribe a client from keyspace notification patterns
   * @param {string} clientId - Client identifier  
   * @param {string} pattern - Pattern to unsubscribe from (optional, if null unsubscribes from all)
   * @returns {Object} Unsubscription result
   */
  unsubscribe(clientId, pattern = null) {
    try {
      if (!this.notificationSubscriptions.has(clientId)) {
        return {
          success: true,
          removedCount: 0,
          remainingCount: 0
        }
      }

      const clientPatterns = this.notificationSubscriptions.get(clientId)
      let removedCount = 0
      const patternsToRemove = pattern ? [pattern] : Array.from(clientPatterns)

      for (const patternToRemove of patternsToRemove) {
        if (clientPatterns.has(patternToRemove)) {
          // Remove from client's patterns
          clientPatterns.delete(patternToRemove)
          removedCount++
          
          // Remove client from pattern's subscribers
          if (this.patternSubscriptions.has(patternToRemove)) {
            const patternClients = this.patternSubscriptions.get(patternToRemove)
            patternClients.delete(clientId)
            
            // Clean up empty pattern subscriptions
            if (patternClients.size === 0) {
              this.patternSubscriptions.delete(patternToRemove)
            }
          }

          // Update statistics
          this.stats.totalSubscriptions = Math.max(0, this.stats.totalSubscriptions - 1)
          this.stats.subscriptionChanges++
          
          if (this.isKeyspacePattern(patternToRemove)) {
            this.stats.keyspaceSubscriptions = Math.max(0, this.stats.keyspaceSubscriptions - 1)
          } else if (this.isKeyeventPattern(patternToRemove)) {
            this.stats.keyeventSubscriptions = Math.max(0, this.stats.keyeventSubscriptions - 1)
          }
          
          if (this.isWildcardPattern(patternToRemove)) {
            this.stats.patternSubscriptions = Math.max(0, this.stats.patternSubscriptions - 1)
          }

          // Use PubSub system to unsubscribe
          this.pubSubManager.punsubscribe(clientId, patternToRemove)
        }
      }

      // Clean up empty client subscriptions
      if (clientPatterns.size === 0) {
        this.notificationSubscriptions.delete(clientId)
      }

      this.logger.info('Notification subscriptions removed', {
        clientId,
        pattern: pattern || 'all',
        removedCount,
        remainingCount: clientPatterns.size
      })

      this.emit('unsubscribed', {
        clientId,
        pattern,
        removedCount,
        timestamp: Date.now()
      })

      return {
        success: true,
        removedCount,
        remainingCount: clientPatterns.size
      }

    } catch (error) {
      this.logger.error('Error removing notification subscription', error, {
        clientId,
        pattern
      })
      
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Remove all subscriptions for a client (called when client disconnects)
   * @param {string} clientId - Client identifier
   */
  removeAllSubscriptions(clientId) {
    return this.unsubscribe(clientId, null)
  }

  /**
   * Get subscriptions for a client
   * @param {string} clientId - Client identifier
   * @returns {Array} Array of patterns the client is subscribed to
   */
  getClientSubscriptions(clientId) {
    const clientPatterns = this.notificationSubscriptions.get(clientId)
    return clientPatterns ? Array.from(clientPatterns) : []
  }

  /**
   * Get all clients subscribed to a pattern
   * @param {string} pattern - Pattern to check
   * @returns {Array} Array of client IDs subscribed to the pattern
   */
  getPatternSubscribers(pattern) {
    const patternClients = this.patternSubscriptions.get(pattern)
    return patternClients ? Array.from(patternClients) : []
  }

  /**
   * Check if a pattern is a valid notification pattern
   * @param {string} pattern - Pattern to validate
   */
  isValidNotificationPattern(pattern) {
    if (typeof pattern !== 'string' || pattern.length === 0) {
      return false
    }

    // Must be for keyspace or keyevent notifications
    return this.isKeyspacePattern(pattern) || this.isKeyeventPattern(pattern)
  }

  /**
   * Check if pattern is for keyspace notifications
   * @param {string} pattern - Pattern to check
   */
  isKeyspacePattern(pattern) {
    return pattern.includes('__keyspace@') || pattern.startsWith('__keyspace@')
  }

  /**
   * Check if pattern is for keyevent notifications  
   * @param {string} pattern - Pattern to check
   */
  isKeyeventPattern(pattern) {
    return pattern.includes('__keyevent@') || pattern.startsWith('__keyevent@')
  }

  /**
   * Check if pattern contains wildcards
   * @param {string} pattern - Pattern to check
   */
  isWildcardPattern(pattern) {
    return pattern.includes('*') || pattern.includes('?')
  }

  /**
   * Get comprehensive statistics about notification subscriptions
   */
  getStats() {
    const clientCount = this.notificationSubscriptions.size
    const patternCount = this.patternSubscriptions.size
    
    // Analyze subscription patterns
    const subscriptionsByType = {
      keyspace: 0,
      keyevent: 0, 
      mixed: 0
    }

    for (const patterns of this.notificationSubscriptions.values()) {
      let hasKeyspace = false
      let hasKeyevent = false
      
      for (const pattern of patterns) {
        if (this.isKeyspacePattern(pattern)) {
          hasKeyspace = true
        } else if (this.isKeyeventPattern(pattern)) {
          hasKeyevent = true
        }
      }
      
      if (hasKeyspace && hasKeyevent) {
        subscriptionsByType.mixed++
      } else if (hasKeyspace) {
        subscriptionsByType.keyspace++
      } else if (hasKeyevent) {
        subscriptionsByType.keyevent++
      }
    }

    return {
      ...this.stats,
      activeClients: clientCount,
      activePatterns: patternCount,
      subscriptionsByType,
      averageSubscriptionsPerClient: clientCount > 0 ? this.stats.totalSubscriptions / clientCount : 0
    }
  }

  /**
   * Get detailed subscription information
   */
  getDetailedInfo() {
    const info = {
      enabled: this.keyspaceNotifications.isEnabled(),
      config: this.keyspaceNotifications.getConfig(),
      stats: this.getStats(),
      clients: {},
      patterns: {}
    }

    // Client details
    for (const [clientId, patterns] of this.notificationSubscriptions.entries()) {
      info.clients[clientId] = {
        patterns: Array.from(patterns),
        subscriptionCount: patterns.size
      }
    }

    // Pattern details  
    for (const [pattern, clients] of this.patternSubscriptions.entries()) {
      info.patterns[pattern] = {
        subscribers: Array.from(clients),
        subscriberCount: clients.size,
        type: this.getPatternType(pattern)
      }
    }

    return info
  }

  /**
   * Get the type of a notification pattern
   */
  getPatternType(pattern) {
    if (this.isKeyspacePattern(pattern)) {
      return 'keyspace'
    } else if (this.isKeyeventPattern(pattern)) {
      return 'keyevent'
    }
    return 'unknown'
  }

  /**
   * Generate common notification patterns for easy subscription
   */
  getCommonPatterns() {
    return {
      allKeyspaceEvents: '__keyspace@*__:*',
      allKeyeventEvents: '__keyevent@*__:*',
      keyspaceDb0: '__keyspace@0__:*',
      keyeventDb0: '__keyevent@0__:*',
      specificKeyspace: (key) => `__keyspace@0__:${key}`,
      specificKeyevent: (operation) => `__keyevent@0__:${operation}`,
      keyspacePattern: (pattern) => `__keyspace@0__:${pattern}`,
      keyeventPattern: (operation) => `__keyevent@0__:${operation}`,
      databaseKeyspace: (db) => `__keyspace@${db}__:*`,
      databaseKeyevent: (db) => `__keyevent@${db}__:*`
    }
  }

  /**
   * Test pattern matching (useful for debugging)
   * @param {string} pattern - Pattern to test
   * @param {string} channel - Channel name to test against
   */
  testPattern(pattern, channel) {
    // Use the same pattern matching logic as the PubSub system
    return this.pubSubManager.matchesPattern ? 
      this.pubSubManager.matchesPattern(pattern, channel) :
      this.simplePatternMatch(pattern, channel)
  }

  /**
   * Simple pattern matching implementation
   * @param {string} pattern - Pattern with * and ? wildcards
   * @param {string} text - Text to match against
   */
  simplePatternMatch(pattern, text) {
    // Convert pattern to regex
    const regexPattern = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/\\\*/g, '.*') // Convert * to .*  
      .replace(/\\\?/g, '.') // Convert ? to .
    
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(text)
  }

  /**
   * Enable keyspace notifications if not already enabled
   * @param {string} config - Configuration string (e.g., 'KEg')
   */
  ensureEnabled(config = 'KEg') {
    if (!this.keyspaceNotifications.isEnabled()) {
      this.keyspaceNotifications.configure(config)
      this.logger.info('Keyspace notifications auto-enabled for subscriptions', { config })
    }
  }

  /**
   * Reset all subscriptions and statistics
   */
  reset() {
    const oldStats = { ...this.stats }
    
    this.notificationSubscriptions.clear()
    this.patternSubscriptions.clear()
    
    this.stats = {
      totalSubscriptions: 0,
      keyspaceSubscriptions: 0,
      keyeventSubscriptions: 0,
      patternSubscriptions: 0,
      notificationsSent: 0,
      subscriptionChanges: oldStats.subscriptionChanges // Keep the change counter
    }

    this.logger.info('Notification manager reset', {
      previousStats: oldStats
    })
  }
}

module.exports = NotificationManager
