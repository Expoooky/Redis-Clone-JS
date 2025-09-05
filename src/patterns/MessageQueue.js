/**
 * MessageQueue.js - Redis-based message queue implementations
 * 
 * This module provides various message queue patterns using Redis,
 * including FIFO queues, priority queues, delayed messaging, and reliable processing.
 */

const crypto = require('crypto')
const logger = require('../utils/Logger')

/**
 * Simple FIFO Message Queue
 * Basic first-in-first-out message processing
 */
class FIFOQueue {
  constructor(redisClient, queueName, options = {}) {
    this.redisClient = redisClient
    this.queueName = queueName
    this.options = {
      keyPrefix: options.keyPrefix || 'queue:fifo:',
      maxQueueSize: options.maxQueueSize || 10000,
      ...options
    }
    
    this.queueKey = this.options.keyPrefix + queueName
    this.logger = logger.child({ component: 'FIFOQueue', queue: queueName })
  }

  /**
   * Enqueue a message
   * @param {*} message - Message to enqueue (will be JSON stringified)
   * @param {Object} options - Enqueue options
   * @returns {Promise<Object>} Enqueue result
   */
  async enqueue(message, options = {}) {
    try {
      const messageData = {
        id: crypto.randomUUID(),
        data: message,
        enqueuedAt: Date.now(),
        attempts: 0,
        ...options.metadata
      }

      const serializedMessage = JSON.stringify(messageData)

      // Check queue size limit
      if (this.options.maxQueueSize > 0) {
        const currentSize = await this.redisClient.sendCommand(`LLEN ${this.queueKey}`)
        
        if (currentSize >= this.options.maxQueueSize) {
          return {
            success: false,
            error: 'Queue size limit exceeded',
            queueSize: currentSize,
            maxSize: this.options.maxQueueSize
          }
        }
      }

      // Add to queue (right push for FIFO)
      // Use base64 encoding to avoid JSON escaping issues
      const encodedMessage = Buffer.from(serializedMessage).toString('base64')
      const result = await this.redisClient.sendCommand(
        `RPUSH ${this.queueKey} ${encodedMessage}`
      )

      this.logger.debug('Message enqueued', {
        messageId: messageData.id,
        queueLength: result
      })

      return {
        success: true,
        messageId: messageData.id,
        queueLength: result,
        enqueuedAt: messageData.enqueuedAt
      }
    } catch (error) {
      this.logger.error('Error enqueuing message', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Dequeue a message
   * @param {Object} options - Dequeue options
   * @returns {Promise<Object>} Dequeue result
   */
  async dequeue(options = {}) {
    const timeout = options.timeout || 0

    try {
      let result
      if (timeout > 0) {
        // Blocking pop with timeout
        result = await this.redisClient.sendCommand(
          `BLPOP ${this.queueKey} ${Math.ceil(timeout / 1000)}`
        )
      } else {
        // Non-blocking pop
        result = await this.redisClient.sendCommand(`LPOP ${this.queueKey}`)
      }

      if (!result || (Array.isArray(result) && result.length === 0)) {
        return {
          success: true,
          message: null
        }
      }

      // Extract message (for BLPOP, result is [queueKey, message])
      const messageData = Array.isArray(result) ? result[1] : result
      
      if (!messageData) {
        return {
          success: true,
          message: null
        }
      }
      
      if (typeof messageData !== 'string' || messageData.trim() === '') {
        return {
          success: true,
          message: null
        }
      }
      
      // Decode base64 back to JSON
      let message
      try {
        // Additional validation for base64 data
        if (!messageData || messageData.length === 0) {
          throw new Error('Empty message data')
        }
        
        const decodedData = Buffer.from(messageData, 'base64').toString('utf8')
        if (!decodedData || decodedData.trim() === '') {
          throw new Error('Empty decoded data')
        }
        
        // Extra validation for JSON structure
        if (!decodedData.startsWith('{') && !decodedData.startsWith('[')) {
          throw new Error('Invalid JSON structure')
        }
        
        message = JSON.parse(decodedData)
        if (!message || typeof message !== 'object') {
          throw new Error('Invalid message object')
        }
      } catch (parseError) {
        // Log the problematic data for debugging
        console.log('Debug - Failed to parse message data:', messageData)
        console.log('Debug - Parse error:', parseError.message)
        return {
          success: true,
          message: null
        }
      }
      message.dequeuedAt = Date.now()

      this.logger.debug('Message dequeued', {
        messageId: message.id,
        waitTime: message.dequeuedAt - message.enqueuedAt
      })

      return {
        success: true,
        message
      }
    } catch (error) {
      this.logger.error('Error dequeuing message', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Get queue statistics
   * @returns {Promise<Object>} Queue stats
   */
  async getStats() {
    try {
      const length = await this.redisClient.sendCommand(`LLEN ${this.queueKey}`)
      
      return {
        success: true,
        queueName: this.queueName,
        length,
        maxSize: this.options.maxQueueSize
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Clear the queue
   * @returns {Promise<Object>} Clear result
   */
  async clear() {
    try {
      const result = await this.redisClient.sendCommand(`DEL ${this.queueKey}`)
      
      this.logger.info('Queue cleared', { queueName: this.queueName })
      
      return {
        success: true,
        cleared: result === 1
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      }
    }
  }
}

/**
 * Priority Queue
 * Messages are processed based on priority scores
 */
class PriorityQueue {
  constructor(redisClient, queueName, options = {}) {
    this.redisClient = redisClient
    this.queueName = queueName
    this.options = {
      keyPrefix: options.keyPrefix || 'queue:priority:',
      maxQueueSize: options.maxQueueSize || 10000,
      defaultPriority: options.defaultPriority || 0,
      ...options
    }
    
    this.queueKey = this.options.keyPrefix + queueName
    this.logger = logger.child({ component: 'PriorityQueue', queue: queueName })
  }

  /**
   * Enqueue a message with priority
   * @param {*} message - Message to enqueue
   * @param {number} priority - Message priority (higher = higher priority)
   * @param {Object} options - Enqueue options
   * @returns {Promise<Object>} Enqueue result
   */
  async enqueue(message, priority = null, options = {}) {
    try {
      const messagePriority = priority !== null ? priority : this.options.defaultPriority
      const messageData = {
        id: crypto.randomUUID(),
        data: message,
        priority: messagePriority,
        enqueuedAt: Date.now(),
        attempts: 0,
        ...options.metadata
      }

      const serializedMessage = JSON.stringify(messageData)

      // Check queue size limit
      if (this.options.maxQueueSize > 0) {
        const currentSize = await this.redisClient.sendCommand(`ZCARD ${this.queueKey}`)
        
        if (currentSize >= this.options.maxQueueSize) {
          return {
            success: false,
            error: 'Queue size limit exceeded',
            queueSize: currentSize,
            maxSize: this.options.maxQueueSize
          }
        }
      }

      // Add to sorted set with priority as score
      // Use negative priority for max-heap behavior (highest first)
      const score = -messagePriority
      const encodedMessage = Buffer.from(serializedMessage).toString('base64')
      await this.redisClient.sendCommand(
        `ZADD ${this.queueKey} ${score} ${encodedMessage}`
      )

      this.logger.debug('Priority message enqueued', {
        messageId: messageData.id,
        priority: messagePriority
      })

      return {
        success: true,
        messageId: messageData.id,
        priority: messagePriority,
        enqueuedAt: messageData.enqueuedAt
      }
    } catch (error) {
      this.logger.error('Error enqueuing priority message', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Dequeue highest priority message
   * @param {Object} options - Dequeue options
   * @returns {Promise<Object>} Dequeue result
   */
  async dequeue(options = {}) {
    try {
      // Get highest priority message (lowest score due to negation)
      const result = await this.redisClient.sendCommand(
        `ZRANGE ${this.queueKey} 0 0`
      )

      if (!result || result.length === 0) {
        return {
          success: true,
          message: null
        }
      }

      const messageData = result[0]
      
      if (!messageData) {
        return {
          success: true,
          message: null
        }
      }
      
      if (typeof messageData !== 'string' || messageData.trim() === '') {
        return {
          success: true,
          message: null
        }
      }
      
      // Remove the message from the queue
      await this.redisClient.sendCommand(
        `ZREM ${this.queueKey} ${messageData}`
      )

      // Decode base64 back to JSON
      let message
      try {
        // Additional validation for base64 data
        if (!messageData || messageData.length === 0) {
          throw new Error('Empty message data')
        }
        
        const decodedData = Buffer.from(messageData, 'base64').toString('utf8')
        if (!decodedData || decodedData.trim() === '') {
          throw new Error('Empty decoded data')
        }
        
        // Extra validation for JSON structure
        if (!decodedData.startsWith('{') && !decodedData.startsWith('[')) {
          throw new Error('Invalid JSON structure')
        }
        
        message = JSON.parse(decodedData)
        if (!message || typeof message !== 'object') {
          throw new Error('Invalid message object')
        }
      } catch (parseError) {
        // Log the problematic data for debugging
        console.log('Debug - Failed to parse message data:', messageData)
        console.log('Debug - Parse error:', parseError.message)
        return {
          success: true,
          message: null
        }
      }
      message.dequeuedAt = Date.now()

      this.logger.debug('Priority message dequeued', {
        messageId: message.id,
        priority: message.priority,
        waitTime: message.dequeuedAt - message.enqueuedAt
      })

      return {
        success: true,
        message
      }
    } catch (error) {
      this.logger.error('Error dequeuing priority message', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Peek at highest priority message without removing it
   * @returns {Promise<Object>} Peek result
   */
  async peek() {
    try {
      const result = await this.redisClient.sendCommand(
        `ZRANGE ${this.queueKey} 0 0 WITHSCORES`
      )

      if (!result || result.length === 0) {
        return {
          success: true,
          message: null
        }
      }

      const messageData = result[0]
      const message = JSON.parse(messageData)

      return {
        success: true,
        message
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      }
    }
  }
}

/**
 * Delayed Message Queue
 * Messages are processed only after a specified delay
 */
class DelayedQueue {
  constructor(redisClient, queueName, options = {}) {
    this.redisClient = redisClient
    this.queueName = queueName
    this.options = {
      keyPrefix: options.keyPrefix || 'queue:delayed:',
      maxQueueSize: options.maxQueueSize || 10000,
      ...options
    }
    
    this.queueKey = this.options.keyPrefix + queueName
    this.logger = logger.child({ component: 'DelayedQueue', queue: queueName })
  }

  /**
   * Enqueue a message with delay
   * @param {*} message - Message to enqueue
   * @param {number} delay - Delay in milliseconds
   * @param {Object} options - Enqueue options
   * @returns {Promise<Object>} Enqueue result
   */
  async enqueue(message, delay, options = {}) {
    try {
      // For immediate messages (delay=0), use a timestamp slightly in the past to ensure availability
      const now = Date.now()
      const executeAt = delay === 0 ? now - 1 : now + delay
      
      const messageData = {
        id: crypto.randomUUID(),
        data: message,
        delay,
        executeAt,
        enqueuedAt: now,
        attempts: 0,
        ...options.metadata
      }

      const serializedMessage = JSON.stringify(messageData)

      // Add to sorted set with execute time as score
      const encodedMessage = Buffer.from(serializedMessage).toString('base64')
      await this.redisClient.sendCommand(
        `ZADD ${this.queueKey} ${executeAt} ${encodedMessage}`
      )

      this.logger.debug('Delayed message enqueued', {
        messageId: messageData.id,
        delay,
        executeAt: new Date(executeAt).toISOString()
      })

      return {
        success: true,
        messageId: messageData.id,
        delay,
        executeAt,
        enqueuedAt: messageData.enqueuedAt
      }
    } catch (error) {
      this.logger.error('Error enqueuing delayed message', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Dequeue ready messages (delay has passed)
   * @param {number} batchSize - Maximum messages to dequeue
   * @returns {Promise<Object>} Dequeue result
   */
  async dequeueReady(batchSize = 1) {
    try {
      const now = Date.now()

      // Simple implementation: get ready messages and remove them
      const readyMessages = await this.redisClient.sendCommand(
        `ZRANGEBYSCORE ${this.queueKey} 0 ${now} LIMIT 0 ${batchSize}`
      )

      const messages = []
      
      if (readyMessages && readyMessages.length > 0) {
        for (const messageData of readyMessages) {
          // Remove from queue
          await this.redisClient.sendCommand(
            `ZREM ${this.queueKey} ${messageData}`
          )
          
          // Decode and parse message
          try {
            const decodedData = Buffer.from(messageData, 'base64').toString('utf8')
            const message = JSON.parse(decodedData)
            message.dequeuedAt = Date.now()
            messages.push(message)
          } catch (parseError) {
            this.logger.warn('Failed to parse delayed message', { parseError: parseError.message })
          }
        }
      }

      if (messages.length > 0) {
        this.logger.debug('Ready messages dequeued', {
          count: messages.length,
          messageIds: messages.map(m => m.id)
        })
      }

      return {
        success: true,
        messages,
        count: messages.length
      }
    } catch (error) {
      this.logger.error('Error dequeuing ready messages', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Get count of ready messages
   * @returns {Promise<Object>} Ready count
   */
  async getReadyCount() {
    try {
      const now = Date.now()
      // Use ZRANGEBYSCORE to get ready messages and count them
      const readyMessages = await this.redisClient.sendCommand(
        `ZRANGEBYSCORE ${this.queueKey} 0 ${now}`
      )

      const count = readyMessages ? readyMessages.length : 0

      return {
        success: true,
        readyCount: count
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      }
    }
  }
}

/**
 * Reliable Queue with acknowledgments
 * Ensures messages are processed successfully or retried
 */
class ReliableQueue {
  constructor(redisClient, queueName, options = {}) {
    this.redisClient = redisClient
    this.queueName = queueName
    this.options = {
      keyPrefix: options.keyPrefix || 'queue:reliable:',
      processingTimeout: options.processingTimeout || 300000, // 5 minutes
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 60000, // 1 minute
      ...options
    }
    
    this.queueKey = this.options.keyPrefix + queueName
    this.processingKey = this.queueKey + ':processing'
    this.failedKey = this.queueKey + ':failed'
    
    this.logger = logger.child({ component: 'ReliableQueue', queue: queueName })
  }

  /**
   * Enqueue a message
   * @param {*} message - Message to enqueue
   * @param {Object} options - Enqueue options
   * @returns {Promise<Object>} Enqueue result
   */
  async enqueue(message, options = {}) {
    try {
      const messageData = {
        id: crypto.randomUUID(),
        data: message,
        enqueuedAt: Date.now(),
        attempts: 0,
        maxRetries: options.maxRetries || this.options.maxRetries,
        ...options.metadata
      }

      const serializedMessage = JSON.stringify(messageData)
      const encodedMessage = Buffer.from(serializedMessage).toString('base64')
      
      const result = await this.redisClient.sendCommand(
        `RPUSH ${this.queueKey} ${encodedMessage}`
      )

      this.logger.debug('Reliable message enqueued', {
        messageId: messageData.id,
        queueLength: result
      })

      return {
        success: true,
        messageId: messageData.id,
        queueLength: result,
        enqueuedAt: messageData.enqueuedAt
      }
    } catch (error) {
      this.logger.error('Error enqueuing reliable message', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Dequeue a message for processing
   * @param {string} consumerId - Unique consumer identifier
   * @returns {Promise<Object>} Dequeue result
   */
  async dequeue(consumerId) {
    try {
      // Simple implementation without Lua scripts
      const result = await this.redisClient.sendCommand(`LPOP ${this.queueKey}`)

      if (!result) {
        return {
          success: true,
          message: null
        }
      }

      if (!result) {
        return {
          success: true,
          message: null
        }
      }
      
      if (typeof result !== 'string' || result.trim() === '') {
        return {
          success: true,
          message: null
        }
      }
      
      // Decode base64 and parse message
      let message
      try {
        const decodedData = Buffer.from(result, 'base64').toString('utf8')
        if (!decodedData || decodedData.trim() === '') {
          throw new Error('Empty decoded data')
        }
        message = JSON.parse(decodedData)
        if (!message || typeof message !== 'object') {
          throw new Error('Invalid message object')
        }
      } catch (parseError) {
        throw new Error(`Failed to parse message: ${parseError.message}`)
      }
      message.dequeuedAt = Date.now()
      message.consumerId = consumerId

      // Store in processing queue with timeout
      const processingData = {
        messageId: message.id,
        message: result,
        consumerId,
        startedAt: Date.now(),
        timeoutAt: Date.now() + this.options.processingTimeout
      }

      const processingEntry = Buffer.from(JSON.stringify(processingData)).toString('base64')
      await this.redisClient.sendCommand(
        `ZADD ${this.processingKey} ${processingData.timeoutAt} ${processingEntry}`
      )

      this.logger.debug('Reliable message dequeued', {
        messageId: message.id,
        consumerId
      })

      return {
        success: true,
        message
      }
    } catch (error) {
      this.logger.error('Error dequeuing reliable message', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Acknowledge successful message processing
   * @param {string} messageId - Message ID to acknowledge
   * @param {string} consumerId - Consumer ID
   * @returns {Promise<Object>} Ack result
   */
  async ack(messageId, consumerId) {
    try {
      // Simple implementation: get all processing entries and find the one to remove
      const processingEntries = await this.redisClient.sendCommand(
        `ZRANGE ${this.processingKey} 0 -1`
      )

      let acknowledged = false

      if (processingEntries && processingEntries.length > 0) {
        for (const entry of processingEntries) {
          try {
            const decodedEntry = Buffer.from(entry, 'base64').toString('utf8')
            const processingData = JSON.parse(decodedEntry)
            
            if (processingData.messageId === messageId && processingData.consumerId === consumerId) {
              await this.redisClient.sendCommand(
                `ZREM ${this.processingKey} ${entry}`
              )
              acknowledged = true
              break
            }
          } catch (parseError) {
            // Skip invalid entries
            continue
          }
        }
      }

      if (acknowledged) {
        this.logger.debug('Message acknowledged', {
          messageId,
          consumerId
        })
      }

      return {
        success: true,
        acknowledged
      }
    } catch (error) {
      this.logger.error('Error acknowledging message', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Reject a message (will be retried or moved to failed)
   * @param {string} messageId - Message ID to reject
   * @param {string} consumerId - Consumer ID
   * @param {string} reason - Rejection reason
   * @returns {Promise<Object>} Reject result
   */
  async reject(messageId, consumerId, reason = 'Processing failed') {
    try {
      // Find processing entry and handle retry logic
      const luaScript = `
        local processing_key = KEYS[1]
        local queue_key = KEYS[2]
        local failed_key = KEYS[3]
        local message_id = ARGV[1]
        local consumer_id = ARGV[2]
        local reason = ARGV[3]
        local now = tonumber(ARGV[4])
        local retry_delay = tonumber(ARGV[5])
        
        -- Find the processing entry
        local processing_entries = redis.call('ZRANGE', processing_key, 0, -1)
        for i = 1, #processing_entries do
          local entry = cjson.decode(processing_entries[i])
          local message = cjson.decode(entry.message)
          
          if message.id == message_id and entry.consumer_id == consumer_id then
            -- Remove from processing
            redis.call('ZREM', processing_key, processing_entries[i])
            
            -- Update message with rejection info
            message.attempts = (message.attempts or 0) + 1
            message.last_error = reason
            message.last_failed_at = now
            
            if message.attempts >= message.maxRetries then
              -- Move to failed queue
              redis.call('RPUSH', failed_key, cjson.encode(message))
              return "failed"
            else
              -- Retry with delay
              local delayed_message = message
              delayed_message.retry_at = now + retry_delay
              redis.call('RPUSH', queue_key, cjson.encode(delayed_message))
              return "retried"
            end
          end
        end
        return "not_found"
      `

      const result = await this.redisClient.sendCommand(
        `EVAL "${luaScript}" 3 ${this.processingKey} ${this.queueKey} ${this.failedKey} ${messageId} ${consumerId} "${reason}" ${Date.now()} ${this.options.retryDelay}`
      )

      this.logger.info('Message rejected', {
        messageId,
        consumerId,
        reason,
        result
      })

      return {
        success: true,
        result,
        messageId,
        reason
      }
    } catch (error) {
      this.logger.error('Error rejecting message', error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Process timed out messages
   * @returns {Promise<Object>} Cleanup result
   */
  async processTimeouts() {
    try {
      const now = Date.now()

      // Find timed out messages
      const luaScript = `
        local processing_key = KEYS[1]
        local queue_key = KEYS[2]
        local now = tonumber(ARGV[1])
        
        -- Get timed out entries
        local timed_out = redis.call('ZRANGEBYSCORE', processing_key, 0, now)
        local count = 0
        
        for i = 1, #timed_out do
          local entry = cjson.decode(timed_out[i])
          local message = cjson.decode(entry.message)
          
          -- Remove from processing
          redis.call('ZREM', processing_key, timed_out[i])
          
          -- Add back to queue for retry
          message.attempts = (message.attempts or 0) + 1
          message.last_error = "Processing timeout"
          message.timed_out_at = now
          
          redis.call('RPUSH', queue_key, cjson.encode(message))
          count = count + 1
        end
        
        return count
      `

      const count = await this.redisClient.sendCommand(
        `EVAL "${luaScript}" 2 ${this.processingKey} ${this.queueKey} ${now}`
      )

      if (count > 0) {
        this.logger.info('Processed timeout messages', { count })
      }

      return {
        success: true,
        timeoutCount: count
      }
    } catch (error) {
      this.logger.error('Error processing timeouts', error)
      return {
        success: false,
        error: error.message
      }
    }
  }
}

/**
 * Queue Factory
 * Creates different types of queues with common configurations
 */
class QueueFactory {
  constructor(redisClient) {
    this.redisClient = redisClient
  }

  /**
   * Create a simple FIFO queue
   */
  createFIFOQueue(name, options = {}) {
    return new FIFOQueue(this.redisClient, name, options)
  }

  /**
   * Create a priority queue
   */
  createPriorityQueue(name, options = {}) {
    return new PriorityQueue(this.redisClient, name, options)
  }

  /**
   * Create a delayed queue
   */
  createDelayedQueue(name, options = {}) {
    return new DelayedQueue(this.redisClient, name, options)
  }

  /**
   * Create a reliable queue
   */
  createReliableQueue(name, options = {}) {
    return new ReliableQueue(this.redisClient, name, options)
  }

  /**
   * Create a work queue (reliable + priority)
   */
  createWorkQueue(name, options = {}) {
    // This would combine reliable processing with priority
    return new ReliableQueue(this.redisClient, name, {
      ...options,
      keyPrefix: 'queue:work:'
    })
  }
}

module.exports = {
  FIFOQueue,
  PriorityQueue,
  DelayedQueue,
  ReliableQueue,
  QueueFactory
}
