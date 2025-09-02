/**
 * Stream Operations Module
 * Implements Redis Streams functionality - append-only logs with consumer groups
 * Supports message acknowledgment, consumer groups, and pending entry lists
 */

const logger = require('../utils/Logger')

/**
 * Stream entry representation
 */
class StreamEntry {
  constructor(id, fields) {
    this.id = id
    this.fields = new Map(fields) // field -> value mapping
    this.timestamp = this.extractTimestamp(id)
  }

  extractTimestamp(id) {
    const parts = id.split('-')
    return parseInt(parts[0], 10)
  }

  getFieldsArray() {
    const result = []
    for (const [field, value] of this.fields) {
      result.push(field, value)
    }
    return result
  }
}

/**
 * Consumer representation
 */
class Consumer {
  constructor(name, group) {
    this.name = name
    this.group = group
    this.pendingEntries = new Map() // entryId -> { entry, deliveryTime, deliveryCount }
    this.lastDelivered = '0-0'
  }

  addPendingEntry(entry) {
    this.pendingEntries.set(entry.id, {
      entry,
      deliveryTime: Date.now(),
      deliveryCount: 1
    })
  }

  acknowledgePendingEntry(entryId) {
    return this.pendingEntries.delete(entryId)
  }

  getPendingCount() {
    return this.pendingEntries.size
  }

  getPendingEntries() {
    return Array.from(this.pendingEntries.values())
  }
}

/**
 * Consumer Group representation
 */
class ConsumerGroup {
  constructor(name, streamName, lastDeliveredId = '0-0') {
    this.name = name
    this.streamName = streamName
    this.lastDeliveredId = lastDeliveredId
    this.consumers = new Map() // consumerName -> Consumer
  }

  getOrCreateConsumer(consumerName) {
    if (!this.consumers.has(consumerName)) {
      this.consumers.set(consumerName, new Consumer(consumerName, this.name))
    }
    return this.consumers.get(consumerName)
  }

  getAllConsumers() {
    return Array.from(this.consumers.values())
  }

  getTotalPendingCount() {
    return Array.from(this.consumers.values())
      .reduce((sum, consumer) => sum + consumer.getPendingCount(), 0)
  }
}

/**
 * Stream data structure implementation
 */
class Stream {
  constructor() {
    this.entries = new Map() // entryId -> StreamEntry
    this.entriesOrdered = [] // Array of entry IDs in order
    this.groups = new Map() // groupName -> ConsumerGroup
    this.lastGeneratedId = '0-0'
    this.maxLen = null // Optional max length
  }

  /**
   * Generate next ID
   * @param {string} requestedId - Requested ID or '*' for auto-generation
   * @returns {string} Generated ID
   */
  generateId(requestedId = '*') {
    const now = Date.now()
    
    if (requestedId === '*') {
      // Auto-generate ID
      const lastParts = this.lastGeneratedId.split('-')
      const lastTimestamp = parseInt(lastParts[0], 10)
      const lastSequence = parseInt(lastParts[1], 10)
      
      if (now > lastTimestamp) {
        this.lastGeneratedId = `${now}-0`
      } else {
        this.lastGeneratedId = `${lastTimestamp}-${lastSequence + 1}`
      }
      
      return this.lastGeneratedId
    } else {
      // Validate and use provided ID
      const parts = requestedId.split('-')
      if (parts.length !== 2) {
        throw new Error('Invalid stream ID format')
      }
      
      const timestamp = parseInt(parts[0], 10)
      const sequence = parseInt(parts[1], 10)
      
      if (isNaN(timestamp) || isNaN(sequence)) {
        throw new Error('Invalid stream ID format')
      }
      
      const idStr = `${timestamp}-${sequence}`
      
      // Check if ID is greater than last ID
      if (this.compareIds(idStr, this.lastGeneratedId) <= 0) {
        throw new Error('ID is smaller than the last generated ID')
      }
      
      this.lastGeneratedId = idStr
      return idStr
    }
  }

  /**
   * Compare two stream IDs
   * @param {string} id1 - First ID
   * @param {string} id2 - Second ID
   * @returns {number} -1 if id1 < id2, 0 if equal, 1 if id1 > id2
   */
  compareIds(id1, id2) {
    const parts1 = id1.split('-').map(p => parseInt(p, 10))
    const parts2 = id2.split('-').map(p => parseInt(p, 10))
    
    if (parts1[0] !== parts2[0]) {
      return parts1[0] - parts2[0]
    }
    
    return parts1[1] - parts2[1]
  }

  /**
   * Add entry to stream
   * @param {string} id - Entry ID
   * @param {Array} fields - Array of field-value pairs
   * @returns {string} Generated entry ID
   */
  addEntry(id, fields) {
    const generatedId = this.generateId(id)
    const entry = new StreamEntry(generatedId, fields)
    
    this.entries.set(generatedId, entry)
    this.entriesOrdered.push(generatedId)
    
    // Apply max length if set
    if (this.maxLen && this.entriesOrdered.length > this.maxLen) {
      const removedId = this.entriesOrdered.shift()
      this.entries.delete(removedId)
    }
    
    return generatedId
  }

  /**
   * Get entries in range
   * @param {string} startId - Start ID (inclusive)
   * @param {string} endId - End ID (inclusive)
   * @param {number} count - Maximum number of entries
   * @returns {Array} Array of entries
   */
  getRange(startId = '-', endId = '+', count = -1) {
    const start = startId === '-' ? this.entriesOrdered[0] : startId
    const end = endId === '+' ? this.entriesOrdered[this.entriesOrdered.length - 1] : endId
    
    if (!start || !end) {
      return []
    }
    
    const result = []
    let foundCount = 0
    
    for (const entryId of this.entriesOrdered) {
      if (this.compareIds(entryId, start) >= 0 && this.compareIds(entryId, end) <= 0) {
        result.push(this.entries.get(entryId))
        foundCount++
        
        if (count > 0 && foundCount >= count) {
          break
        }
      }
    }
    
    return result
  }

  /**
   * Get entries after specified ID
   * @param {string} afterId - ID to start after
   * @param {number} count - Maximum number of entries
   * @returns {Array} Array of entries
   */
  getEntriesAfter(afterId, count = -1) {
    const result = []
    let foundCount = 0
    
    for (const entryId of this.entriesOrdered) {
      if (this.compareIds(entryId, afterId) > 0) {
        result.push(this.entries.get(entryId))
        foundCount++
        
        if (count > 0 && foundCount >= count) {
          break
        }
      }
    }
    
    return result
  }

  /**
   * Get stream length
   * @returns {number} Number of entries
   */
  length() {
    return this.entries.size
  }

  /**
   * Create consumer group
   * @param {string} groupName - Group name
   * @param {string} startId - Starting ID for the group
   * @returns {ConsumerGroup} Created group
   */
  createGroup(groupName, startId = '$') {
    if (this.groups.has(groupName)) {
      throw new Error('Consumer group already exists')
    }
    
    let lastDeliveredId = startId
    if (startId === '$') {
      // Start from end of stream
      lastDeliveredId = this.lastGeneratedId
    } else if (startId === '0') {
      lastDeliveredId = '0-0'
    }
    
    const group = new ConsumerGroup(groupName, 'stream', lastDeliveredId)
    this.groups.set(groupName, group)
    
    return group
  }

  /**
   * Delete consumer group
   * @param {string} groupName - Group name
   * @returns {boolean} True if group existed and was deleted
   */
  deleteGroup(groupName) {
    return this.groups.delete(groupName)
  }

  /**
   * Get consumer group
   * @param {string} groupName - Group name
   * @returns {ConsumerGroup|null} Group or null if not found
   */
  getGroup(groupName) {
    return this.groups.get(groupName) || null
  }

  /**
   * Read entries for consumer group
   * @param {string} groupName - Group name
   * @param {string} consumerName - Consumer name
   * @param {number} count - Maximum entries to read
   * @returns {Array} Array of entries
   */
  readGroup(groupName, consumerName, count = 1) {
    const group = this.getGroup(groupName)
    if (!group) {
      throw new Error('Consumer group does not exist')
    }
    
    const consumer = group.getOrCreateConsumer(consumerName)
    const entries = this.getEntriesAfter(group.lastDeliveredId, count)
    
    // Add entries to consumer's pending list
    for (const entry of entries) {
      consumer.addPendingEntry(entry)
      group.lastDeliveredId = entry.id
    }
    
    return entries
  }

  /**
   * Acknowledge entries for consumer
   * @param {string} groupName - Group name
   * @param {string} consumerName - Consumer name
   * @param {Array} entryIds - Array of entry IDs to acknowledge
   * @returns {number} Number of acknowledged entries
   */
  acknowledge(groupName, consumerName, entryIds) {
    const group = this.getGroup(groupName)
    if (!group) {
      return 0
    }
    
    const consumer = group.consumers.get(consumerName)
    if (!consumer) {
      return 0
    }
    
    let acknowledgedCount = 0
    
    for (const entryId of entryIds) {
      if (consumer.acknowledgePendingEntry(entryId)) {
        acknowledgedCount++
      }
    }
    
    return acknowledgedCount
  }
}

class StreamOps {
  constructor(dataStore) {
    this.dataStore = dataStore
    logger.info('StreamOps module initialized')
  }

  /**
   * Ensure key holds a stream, create if needed
   * @param {string} key - Key to check/create
   * @returns {Object} Result with stream or error
   */
  ensureStream(key) {
    const result = this.dataStore.get(key)
    
    if (!result.success) {
      return result
    }

    if (result.value === null) {
      // Key doesn't exist, will be created on first operation
      return { success: true, value: new Stream(), exists: false }
    }

    if (!(result.value instanceof Stream)) {
      return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
    }

    return { success: true, value: result.value, exists: true }
  }

  /**
   * XADD command - Add entry to stream
   * @param {string} key - Stream key
   * @param {string} id - Entry ID or '*' for auto-generation
   * @param {Array} fields - Array of field-value pairs
   * @param {Object} options - Options (MAXLEN)
   * @returns {Object} Result with generated entry ID
   */
  xadd(key, id, fields, options = {}) {
    if (!Array.isArray(fields) || fields.length === 0 || fields.length % 2 !== 0) {
      return { success: false, error: 'ERR wrong number of arguments for \'xadd\' command' }
    }

    try {
      const streamResult = this.ensureStream(key)
      if (!streamResult.success) {
        return streamResult
      }

      const stream = streamResult.value
      
      // Set max length if provided
      if (options.maxlen) {
        stream.maxLen = options.maxlen
      }

      // Convert fields array to pairs
      const fieldPairs = []
      for (let i = 0; i < fields.length; i += 2) {
        fieldPairs.push([fields[i], fields[i + 1]])
      }

      const generatedId = stream.addEntry(id, fieldPairs)

      const setResult = this.dataStore.set(key, stream)
      if (!setResult.success) {
        return setResult
      }

      logger.debug('XADD executed', {
        key,
        generatedId,
        fieldCount: fieldPairs.length,
        streamLength: stream.length()
      })

      return { success: true, value: generatedId }
    } catch (error) {
      return { success: false, error: `ERR ${error.message}` }
    }
  }

  /**
   * XREAD command - Read entries from stream
   * @param {Array} streamKeys - Array of stream keys
   * @param {Array} startIds - Array of start IDs for each stream
   * @param {Object} options - Options (COUNT, BLOCK)
   * @returns {Object} Result with stream entries
   */
  xread(streamKeys, startIds, options = {}) {
    if (!Array.isArray(streamKeys) || !Array.isArray(startIds) || streamKeys.length !== startIds.length) {
      return { success: false, error: 'ERR wrong number of arguments for \'xread\' command' }
    }

    const results = []

    for (let i = 0; i < streamKeys.length; i++) {
      const key = streamKeys[i]
      const startId = startIds[i]

      const streamResult = this.ensureStream(key)
      if (!streamResult.success) {
        continue // Skip non-existent streams
      }

      if (!streamResult.exists) {
        continue
      }

      const stream = streamResult.value
      const count = options.count || -1
      
      let entries
      if (startId === '$') {
        // Read from end of stream (only new entries)
        entries = stream.getEntriesAfter(stream.lastGeneratedId, count)
      } else {
        entries = stream.getEntriesAfter(startId, count)
      }

      if (entries.length > 0) {
        const streamEntries = entries.map(entry => [entry.id, entry.getFieldsArray()])
        results.push([key, streamEntries])
      }
    }

    logger.debug('XREAD executed', {
      streamCount: streamKeys.length,
      resultCount: results.length,
      totalEntries: results.reduce((sum, [, entries]) => sum + entries.length, 0)
    })

    return { success: true, value: results }
  }

  /**
   * XRANGE command - Get entries in range
   * @param {string} key - Stream key
   * @param {string} start - Start ID
   * @param {string} end - End ID
   * @param {number} count - Maximum entries to return
   * @returns {Object} Result with stream entries
   */
  xrange(key, start = '-', end = '+', count = -1) {
    const streamResult = this.ensureStream(key)
    if (!streamResult.success) {
      return streamResult
    }

    if (!streamResult.exists) {
      return { success: true, value: [] }
    }

    const stream = streamResult.value
    const entries = stream.getRange(start, end, count)
    
    const result = entries.map(entry => [entry.id, entry.getFieldsArray()])

    logger.debug('XRANGE executed', {
      key,
      start,
      end,
      count,
      resultCount: result.length
    })

    return { success: true, value: result }
  }

  /**
   * XLEN command - Get stream length
   * @param {string} key - Stream key
   * @returns {Object} Result with stream length
   */
  xlen(key) {
    const streamResult = this.ensureStream(key)
    if (!streamResult.success) {
      return streamResult
    }

    const length = streamResult.exists ? streamResult.value.length() : 0

    logger.debug('XLEN executed', { key, length })

    return { success: true, value: length }
  }

  /**
   * XGROUP CREATE command - Create consumer group
   * @param {string} key - Stream key
   * @param {string} groupName - Group name
   * @param {string} startId - Starting ID
   * @param {Object} options - Options (MKSTREAM)
   * @returns {Object} Result
   */
  xgroupCreate(key, groupName, startId = '$', options = {}) {
    const streamResult = this.ensureStream(key)
    if (!streamResult.success) {
      return streamResult
    }

    if (!streamResult.exists) {
      if (options.mkstream) {
        // Create stream if it doesn't exist
        const stream = new Stream()
        const setResult = this.dataStore.set(key, stream)
        if (!setResult.success) {
          return setResult
        }
        
        try {
          stream.createGroup(groupName, startId)
          this.dataStore.set(key, stream)
        } catch (error) {
          return { success: false, error: `ERR ${error.message}` }
        }
      } else {
        return { success: false, error: 'ERR The XGROUP subcommand requires the key to exist' }
      }
    } else {
      try {
        streamResult.value.createGroup(groupName, startId)
        this.dataStore.set(key, streamResult.value)
      } catch (error) {
        return { success: false, error: `ERR ${error.message}` }
      }
    }

    logger.debug('XGROUP CREATE executed', { key, groupName, startId })

    return { success: true, value: 'OK' }
  }

  /**
   * XREADGROUP command - Read entries as consumer group member
   * @param {string} groupName - Group name
   * @param {string} consumerName - Consumer name
   * @param {Array} streamKeys - Array of stream keys
   * @param {Array} startIds - Array of start IDs (should be '>' for new messages)
   * @param {Object} options - Options (COUNT)
   * @returns {Object} Result with stream entries
   */
  xreadgroup(groupName, consumerName, streamKeys, startIds, options = {}) {
    if (!Array.isArray(streamKeys) || !Array.isArray(startIds) || streamKeys.length !== startIds.length) {
      return { success: false, error: 'ERR wrong number of arguments for \'xreadgroup\' command' }
    }

    const results = []

    for (let i = 0; i < streamKeys.length; i++) {
      const key = streamKeys[i]
      const startId = startIds[i]

      const streamResult = this.ensureStream(key)
      if (!streamResult.success) {
        continue
      }

      if (!streamResult.exists) {
        continue
      }

      const stream = streamResult.value
      
      if (startId === '>') {
        // Read new messages for the group
        try {
          const count = options.count || 1
          const entries = stream.readGroup(groupName, consumerName, count)
          
          if (entries.length > 0) {
            const streamEntries = entries.map(entry => [entry.id, entry.getFieldsArray()])
            results.push([key, streamEntries])
            
            // Save updated stream
            this.dataStore.set(key, stream)
          }
        } catch (error) {
          return { success: false, error: `ERR ${error.message}` }
        }
      }
    }

    logger.debug('XREADGROUP executed', {
      groupName,
      consumerName,
      streamCount: streamKeys.length,
      resultCount: results.length
    })

    return { success: true, value: results }
  }

  /**
   * XACK command - Acknowledge processed entries
   * @param {string} key - Stream key
   * @param {string} groupName - Group name
   * @param {Array} entryIds - Array of entry IDs to acknowledge
   * @returns {Object} Result with acknowledgment count
   */
  xack(key, groupName, entryIds) {
    if (!Array.isArray(entryIds) || entryIds.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments for \'xack\' command' }
    }

    const streamResult = this.ensureStream(key)
    if (!streamResult.success) {
      return streamResult
    }

    if (!streamResult.exists) {
      return { success: true, value: 0 }
    }

    // For XACK, we need the consumer name. In a real implementation,
    // this would be tracked per connection. For now, we'll find any consumer
    // with these pending entries.
    const stream = streamResult.value
    const group = stream.getGroup(groupName)
    
    if (!group) {
      return { success: true, value: 0 }
    }

    let totalAcknowledged = 0
    
    // Try to acknowledge from any consumer that has these entries pending
    for (const consumer of group.getAllConsumers()) {
      const acknowledged = stream.acknowledge(groupName, consumer.name, entryIds)
      totalAcknowledged += acknowledged
    }

    if (totalAcknowledged > 0) {
      this.dataStore.set(key, stream)
    }

    logger.debug('XACK executed', {
      key,
      groupName,
      entryIds: entryIds.length,
      acknowledgedCount: totalAcknowledged
    })

    return { success: true, value: totalAcknowledged }
  }

  /**
   * XPENDING command - Get pending entries information
   * @param {string} key - Stream key
   * @param {string} groupName - Group name
   * @param {string} consumerName - Consumer name (optional)
   * @returns {Object} Result with pending entries info
   */
  xpending(key, groupName, consumerName = null) {
    const streamResult = this.ensureStream(key)
    if (!streamResult.success) {
      return streamResult
    }

    if (!streamResult.exists) {
      return { success: true, value: [] }
    }

    const stream = streamResult.value
    const group = stream.getGroup(groupName)
    
    if (!group) {
      return { success: false, error: 'ERR No such consumer group' }
    }

    if (consumerName) {
      // Get pending entries for specific consumer
      const consumer = group.consumers.get(consumerName)
      if (!consumer) {
        return { success: true, value: [] }
      }
      
      const pendingEntries = consumer.getPendingEntries()
      const result = pendingEntries.map(pending => [
        pending.entry.id,
        consumerName,
        pending.deliveryTime,
        pending.deliveryCount
      ])
      
      return { success: true, value: result }
    } else {
      // Get summary of pending entries for all consumers
      const totalPending = group.getTotalPendingCount()
      
      if (totalPending === 0) {
        return { success: true, value: [0] }
      }
      
      // Find range of pending IDs and consumer info
      let minId = null
      let maxId = null
      const consumerCounts = new Map()
      
      for (const consumer of group.getAllConsumers()) {
        const pendingEntries = consumer.getPendingEntries()
        consumerCounts.set(consumer.name, pendingEntries.length)
        
        for (const pending of pendingEntries) {
          if (!minId || stream.compareIds(pending.entry.id, minId) < 0) {
            minId = pending.entry.id
          }
          if (!maxId || stream.compareIds(pending.entry.id, maxId) > 0) {
            maxId = pending.entry.id
          }
        }
      }
      
      const consumerInfo = Array.from(consumerCounts.entries())
      
      return { success: true, value: [totalPending, minId, maxId, consumerInfo] }
    }
  }

  /**
   * Helper method to validate if a value is a valid stream
   * @param {*} value - Value to validate
   * @returns {boolean} True if valid stream
   */
  isValidStream(value) {
    return value instanceof Stream
  }
}

module.exports = StreamOps
