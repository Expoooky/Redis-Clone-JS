/**
 * KeyspaceNotifications.js - Redis-like keyspace notifications system
 * 
 * This module implements keyspace notifications that allow clients to receive
 * notifications about changes to the Redis data set. It publishes events to
 * special channels when keys are modified.
 */

const EventEmitter = require('events')
const logger = require('../utils/Logger')

/**
 * Keyspace notifications system
 * Manages event generation and publication for key operations
 */
class KeyspaceNotifications extends EventEmitter {
  constructor(pubSubManager) {
    super()
    
    this.pubSubManager = pubSubManager
    this.enabled = false
    this.notificationTypes = new Set()
    this.logger = logger.child({ component: 'KeyspaceNotifications' })
    
    // Default configuration - no notifications enabled by default
    this.config = {
      // Event types configuration
      'notify-keyspace-events': '' // Empty means no notifications
    }
    
    // Event type mappings
    this.eventTypes = {
      // Administrative events
      'g': ['del', 'expire', 'rename', 'clear', 'sort', 'flushdb', 'flushall'],
      
      // String events  
      's': ['set', 'append', 'incr', 'decr', 'incrby', 'decrby', 'setrange'],
      
      // List events
      'l': ['lpush', 'rpush', 'lpop', 'rpop', 'lset', 'ltrim', 'linsert', 'lrem'],
      
      // Set events
      't': ['sadd', 'srem', 'spop', 'smove', 'sinter', 'sunion', 'sdiff'],
      
      // Hash events  
      'h': ['hset', 'hdel', 'hmset', 'hincrby', 'hincrbyfloat'],
      
      // Sorted set events
      'z': ['zadd', 'zrem', 'zincrby', 'zremrangebyscore', 'zremrangebyrank'],
      
      // Expiration events
      'x': ['expired'],
      
      // Eviction events
      'e': ['evicted'],
      
      // Stream events
      'm': ['xadd', 'xdel', 'xtrim', 'xgroup'],
      
      // Key miss events (when a key doesn't exist)
      'd': ['keymiss']
    }
    
    this.logger.info('Keyspace notifications system initialized', {
      enabled: this.enabled,
      types: Array.from(this.notificationTypes)
    })
  }

  /**
   * Configure keyspace notifications
   * @param {string} config - Notification configuration string (e.g., 'KEg')
   */
  configure(config) {
    this.config['notify-keyspace-events'] = config || ''
    this.notificationTypes.clear()
    this.enabled = config && config.length > 0
    
    if (this.enabled) {
      // Parse configuration string
      for (const char of config) {
        this.notificationTypes.add(char.toLowerCase())
      }
      
      this.logger.info('Keyspace notifications configured', {
        config,
        enabled: this.enabled,
        types: Array.from(this.notificationTypes)
      })
    } else {
      this.logger.info('Keyspace notifications disabled')
    }
  }

  /**
   * Check if notifications are enabled
   */
  isEnabled() {
    return this.enabled
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return this.config['notify-keyspace-events']
  }

  /**
   * Notify about a key operation
   * @param {string} operation - The operation performed (e.g., 'set', 'del')
   * @param {string} key - The key that was operated on
   * @param {number} database - Database number (default 0)
   * @param {*} additionalData - Additional data about the operation
   */
  notify(operation, key, database = 0, additionalData = null) {
    if (!this.enabled || !this.pubSubManager) {
      return
    }

    const opLower = operation.toLowerCase()
    
    try {
      // Determine if we should send keyspace notifications (K)
      const shouldSendKeyspace = this.notificationTypes.has('k')
      
      // Determine if we should send keyevent notifications (E)  
      const shouldSendKeyevent = this.notificationTypes.has('e')
      
      // Check if this operation type should be notified
      const shouldNotifyOperation = this.shouldNotifyOperation(opLower)
      
      if (!shouldNotifyOperation) {
        return
      }

      // Send keyspace notification: __keyspace@<db>__:<key>
      if (shouldSendKeyspace) {
        const keyspaceChannel = `__keyspace@${database}__:${key}`
        this.publishNotification(keyspaceChannel, operation, additionalData)
      }

      // Send keyevent notification: __keyevent@<db>__:<operation>  
      if (shouldSendKeyevent) {
        const keyeventChannel = `__keyevent@${database}__:${operation}`
        this.publishNotification(keyeventChannel, key, additionalData)
      }

      this.logger.debug('Keyspace notification sent', {
        operation: opLower,
        key,
        database,
        keyspace: shouldSendKeyspace,
        keyevent: shouldSendKeyevent
      })

    } catch (error) {
      this.logger.error('Error sending keyspace notification', error, {
        operation: opLower,
        key,
        database
      })
    }
  }

  /**
   * Check if an operation should trigger notifications
   * @param {string} operation - Operation name in lowercase
   */
  shouldNotifyOperation(operation) {
    // Check each enabled event type
    for (const [typeCode, operations] of Object.entries(this.eventTypes)) {
      if (this.notificationTypes.has(typeCode) && operations.includes(operation)) {
        return true
      }
    }
    return false
  }

  /**
   * Publish a notification to a channel
   * @param {string} channel - Channel name
   * @param {string} message - Message to publish
   * @param {*} additionalData - Additional data (currently unused but available for extension)
   */
  publishNotification(channel, message, additionalData = null) {
    if (!this.pubSubManager) {
      this.logger.warn('PubSub manager not available for notifications')
      return
    }

    try {
      // Use the existing pub/sub system to publish notifications
      this.pubSubManager.publish(channel, message)
      
      // Emit internal event for testing/monitoring
      this.emit('notification', {
        channel,
        message,
        timestamp: Date.now(),
        additionalData
      })

    } catch (error) {
      this.logger.error('Failed to publish notification', error, {
        channel,
        message
      })
    }
  }

  /**
   * Notify about key expiration
   * @param {string} key - The expired key
   * @param {number} database - Database number
   */
  notifyExpired(key, database = 0) {
    this.notify('expired', key, database)
  }

  /**
   * Notify about key eviction
   * @param {string} key - The evicted key  
   * @param {number} database - Database number
   */
  notifyEvicted(key, database = 0) {
    this.notify('evicted', key, database)
  }

  /**
   * Notify about key miss (when a key doesn't exist during a read operation)
   * @param {string} key - The missing key
   * @param {number} database - Database number
   */
  notifyKeyMiss(key, database = 0) {
    this.notify('keymiss', key, database)
  }

  /**
   * Get statistics about notifications
   */
  getStats() {
    return {
      enabled: this.enabled,
      config: this.config['notify-keyspace-events'],
      enabledTypes: Array.from(this.notificationTypes),
      supportedEventTypes: Object.keys(this.eventTypes),
      totalListeners: this.listenerCount('notification')
    }
  }

  /**
   * Get detailed information about event types
   */
  getEventTypeInfo() {
    const info = {}
    
    for (const [typeCode, operations] of Object.entries(this.eventTypes)) {
      const typeName = this.getEventTypeName(typeCode)
      info[typeCode] = {
        name: typeName,
        operations: operations,
        enabled: this.notificationTypes.has(typeCode)
      }
    }

    // Add special types
    info['K'] = {
      name: 'Keyspace events',
      description: 'Published to __keyspace@<db>__:<key> channels',
      enabled: this.notificationTypes.has('k')
    }

    info['E'] = {
      name: 'Keyevent events', 
      description: 'Published to __keyevent@<db>__:<event> channels',
      enabled: this.notificationTypes.has('e')
    }

    return info
  }

  /**
   * Get human-readable name for event type code
   */
  getEventTypeName(typeCode) {
    const names = {
      'g': 'Generic commands',
      's': 'String commands', 
      'l': 'List commands',
      't': 'Set commands',
      'h': 'Hash commands',
      'z': 'Sorted set commands',
      'x': 'Expired events',
      'e': 'Evicted events', 
      'm': 'Stream commands',
      'd': 'Key miss events'
    }
    
    return names[typeCode] || `Unknown type: ${typeCode}`
  }

  /**
   * Enable all notification types (useful for testing)
   */
  enableAll() {
    this.configure('KEgslthzxemd')
  }

  /**
   * Disable all notifications
   */
  disable() {
    this.configure('')
  }

  /**
   * Check if a specific event type is enabled
   */
  isEventTypeEnabled(typeCode) {
    return this.notificationTypes.has(typeCode.toLowerCase())
  }

  /**
   * Add a custom event type and operations
   * @param {string} typeCode - Single character type code
   * @param {Array} operations - Array of operation names
   * @param {string} description - Description of the event type
   */
  addCustomEventType(typeCode, operations, description = '') {
    if (typeCode.length !== 1) {
      throw new Error('Event type code must be a single character')
    }

    this.eventTypes[typeCode.toLowerCase()] = operations
    
    this.logger.info('Custom event type added', {
      typeCode,
      operations,
      description
    })
  }

  /**
   * Remove a custom event type
   */
  removeCustomEventType(typeCode) {
    delete this.eventTypes[typeCode.toLowerCase()]
    this.notificationTypes.delete(typeCode.toLowerCase())
    
    this.logger.info('Custom event type removed', { typeCode })
  }

  /**
   * Get configuration help/documentation
   */
  getConfigHelp() {
    return {
      description: 'Keyspace notifications configuration string',
      format: 'String of characters representing event types to enable',
      specialTypes: {
        'K': 'Keyspace events, published with __keyspace@<db>__: prefix',
        'E': 'Keyevent events, published with __keyevent@<db>__: prefix'
      },
      eventTypes: this.getEventTypeInfo(),
      examples: {
        'KEg': 'Enable keyspace and keyevent notifications for generic commands',
        'KEs': 'Enable keyspace and keyevent notifications for string commands',  
        'K': 'Enable only keyspace notifications for all operations',
        'E': 'Enable only keyevent notifications for all operations',
        '': 'Disable all notifications'
      }
    }
  }

  /**
   * Validate configuration string
   */
  validateConfig(config) {
    const errors = []
    const warnings = []

    if (typeof config !== 'string') {
      errors.push('Configuration must be a string')
      return { valid: false, errors, warnings }
    }

    // Check for invalid characters
    const validChars = new Set(['k', 'e', ...Object.keys(this.eventTypes)])
    
    for (const char of config.toLowerCase()) {
      if (!validChars.has(char)) {
        warnings.push(`Unknown event type: '${char}'`)
      }
    }

    // Check for conflicting configurations
    if (config.toLowerCase().includes('k') && config.toLowerCase().includes('e')) {
      // This is actually fine - both can be enabled
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    }
  }
}

module.exports = KeyspaceNotifications
