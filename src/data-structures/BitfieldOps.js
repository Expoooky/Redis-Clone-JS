/**
 * Bitfield Operations Module
 * Implements Redis BITFIELD command for efficient storage and manipulation
 * of multiple counters in a single string using various integer sizes
 */

const logger = require('../utils/Logger')

class BitfieldOps {
  constructor(dataStore) {
    this.dataStore = dataStore
    logger.info('BitfieldOps module initialized')
  }

  /**
   * Ensure key holds a string value for bitfield operations
   * @param {string} key - Key to check/create
   * @returns {Object} Result with string buffer or error
   */
  ensureBitfield(key) {
    const result = this.dataStore.get(key)
    
    if (!result.success) {
      return result
    }

    if (result.value === null) {
      // Key doesn't exist, will be created as empty string
      return { success: true, value: Buffer.alloc(0), exists: false }
    }

    // Must be a string
    if (typeof result.value !== 'string') {
      return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
    }

    // Convert string to buffer for bit operations
    const buffer = Buffer.from(result.value, 'binary')
    return { success: true, value: buffer, exists: true }
  }

  /**
   * BITFIELD command - Perform multiple bitfield operations atomically
   * @param {string} key - Bitfield key
   * @param {Array} operations - Array of operation objects
   * @returns {Object} Result with array of operation results
   */
  bitfield(key, operations) {
    if (!Array.isArray(operations) || operations.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments for \'bitfield\' command' }
    }

    const bitfieldResult = this.ensureBitfield(key)
    if (!bitfieldResult.success) {
      return bitfieldResult
    }

    let buffer = bitfieldResult.value
    const results = []
    let bufferModified = false

    // Process each operation
    for (const operation of operations) {
      try {
        const result = this.executeOperation(buffer, operation)
        
        if (result.error) {
          return { success: false, error: result.error }
        }
        
        results.push(result.value)
        
        if (result.buffer) {
          buffer = result.buffer
          bufferModified = true
        }
      } catch (error) {
        return { success: false, error: `ERR ${error.message}` }
      }
    }

    // Store buffer back if modified
    if (bufferModified) {
      const stringValue = buffer.toString('binary')
      const setResult = this.dataStore.set(key, stringValue)
      if (!setResult.success) {
        return setResult
      }
    }

    logger.debug('BITFIELD executed', {
      key,
      operationCount: operations.length,
      bufferModified,
      bufferLength: buffer.length
    })

    return { success: true, value: results }
  }

  /**
   * Execute a single bitfield operation
   * @param {Buffer} buffer - Current buffer
   * @param {Object} operation - Operation object
   * @returns {Object} Operation result
   */
  executeOperation(buffer, operation) {
    const { command, type, offset } = operation
    
    // Parse type specification (e.g., "u8", "i16", "u32")
    const typeInfo = this.parseTypeSpec(type)
    if (!typeInfo) {
      return { error: 'ERR Invalid bitfield type' }
    }

    // Parse offset
    const offsetInfo = this.parseOffset(offset, typeInfo.bits)
    if (offsetInfo.error) {
      return { error: offsetInfo.error }
    }

    switch (command.toUpperCase()) {
      case 'GET':
        return this.getBitfield(buffer, typeInfo, offsetInfo)
      
      case 'SET':
        if (!operation.hasOwnProperty('value')) {
          return { error: 'ERR SET requires a value' }
        }
        return this.setBitfield(buffer, typeInfo, offsetInfo, operation.value)
      
      case 'INCRBY':
        if (!operation.hasOwnProperty('increment')) {
          return { error: 'ERR INCRBY requires an increment value' }
        }
        return this.incrByBitfield(buffer, typeInfo, offsetInfo, operation.increment, operation.overflow)
      
      default:
        return { error: `ERR Unknown bitfield command: ${command}` }
    }
  }

  /**
   * Parse type specification (e.g., "u8", "i16")
   * @param {string} typeSpec - Type specification
   * @returns {Object|null} Type information
   */
  parseTypeSpec(typeSpec) {
    const match = typeSpec.match(/^([ui])(\d+)$/)
    if (!match) {
      return null
    }

    const signed = match[1] === 'i'
    const bits = parseInt(match[2], 10)

    // Validate bit count
    if (bits < 1 || bits > 64) {
      return null
    }

    const maxValue = signed ? Math.pow(2, bits - 1) - 1 : Math.pow(2, bits) - 1
    const minValue = signed ? -Math.pow(2, bits - 1) : 0

    return {
      signed,
      bits,
      maxValue,
      minValue,
      typeSpec
    }
  }

  /**
   * Parse offset specification
   * @param {string|number} offsetSpec - Offset specification
   * @param {number} bits - Field bit width
   * @returns {Object} Offset information
   */
  parseOffset(offsetSpec, bits) {
    let offset

    if (typeof offsetSpec === 'string' && offsetSpec.startsWith('#')) {
      // Element-based offset (e.g., "#0", "#1")
      const elementIndex = parseInt(offsetSpec.slice(1), 10)
      if (isNaN(elementIndex) || elementIndex < 0) {
        return { error: 'ERR Invalid element offset' }
      }
      offset = elementIndex * bits
    } else {
      // Bit-based offset
      offset = parseInt(offsetSpec, 10)
      if (isNaN(offset) || offset < 0) {
        return { error: 'ERR Invalid bit offset' }
      }
    }

    // Check maximum offset (512MB * 8 bits)
    const maxOffset = 512 * 1024 * 1024 * 8
    if (offset >= maxOffset) {
      return { error: 'ERR bit offset is out of range' }
    }

    return { offset }
  }

  /**
   * Get bitfield value
   * @param {Buffer} buffer - Buffer to read from
   * @param {Object} typeInfo - Type information
   * @param {Object} offsetInfo - Offset information
   * @returns {Object} Operation result
   */
  getBitfield(buffer, typeInfo, offsetInfo) {
    const { bits, signed } = typeInfo
    const { offset } = offsetInfo

    // Check if field extends beyond buffer
    const endBit = offset + bits - 1
    const endByte = Math.floor(endBit / 8)
    
    if (endByte >= buffer.length) {
      // Field extends beyond buffer, return 0
      return { value: 0 }
    }

    // Extract bits
    let value = 0
    for (let i = 0; i < bits; i++) {
      const bitPos = offset + i
      const byteIndex = Math.floor(bitPos / 8)
      const bitIndex = 7 - (bitPos % 8) // Big-endian bit ordering
      
      if (byteIndex < buffer.length) {
        const bit = (buffer[byteIndex] >> bitIndex) & 1
        value |= (bit << (bits - 1 - i))
      }
    }

    // Handle signed values
    if (signed && (value & (1 << (bits - 1)))) {
      // Negative number in two's complement
      value -= Math.pow(2, bits)
    }

    return { value }
  }

  /**
   * Set bitfield value
   * @param {Buffer} buffer - Buffer to modify
   * @param {Object} typeInfo - Type information
   * @param {Object} offsetInfo - Offset information
   * @param {number} value - Value to set
   * @returns {Object} Operation result
   */
  setBitfield(buffer, typeInfo, offsetInfo, value) {
    const { bits, signed, maxValue, minValue } = typeInfo
    const { offset } = offsetInfo

    // Validate value range
    if (value > maxValue || value < minValue) {
      return { error: 'ERR value is out of range for field type' }
    }

    // Convert negative values to unsigned representation
    let unsignedValue = value
    if (signed && value < 0) {
      unsignedValue = Math.pow(2, bits) + value
    }

    // Get original value for return
    const originalResult = this.getBitfield(buffer, typeInfo, offsetInfo)
    const originalValue = originalResult.value

    // Extend buffer if necessary
    const endBit = offset + bits - 1
    const endByte = Math.floor(endBit / 8)
    
    if (endByte >= buffer.length) {
      const newBuffer = Buffer.alloc(endByte + 1)
      buffer.copy(newBuffer)
      buffer = newBuffer
    }

    // Clear existing bits in the field
    for (let i = 0; i < bits; i++) {
      const bitPos = offset + i
      const byteIndex = Math.floor(bitPos / 8)
      const bitIndex = 7 - (bitPos % 8)
      
      buffer[byteIndex] &= ~(1 << bitIndex)
    }

    // Set new bits
    for (let i = 0; i < bits; i++) {
      const bitPos = offset + i
      const byteIndex = Math.floor(bitPos / 8)
      const bitIndex = 7 - (bitPos % 8)
      
      const bit = (unsignedValue >> (bits - 1 - i)) & 1
      if (bit) {
        buffer[byteIndex] |= (1 << bitIndex)
      }
    }

    return { 
      value: originalValue,
      buffer
    }
  }

  /**
   * Increment bitfield value
   * @param {Buffer} buffer - Buffer to modify
   * @param {Object} typeInfo - Type information
   * @param {Object} offsetInfo - Offset information
   * @param {number} increment - Increment value
   * @param {string} overflow - Overflow behavior (WRAP, SAT, FAIL)
   * @returns {Object} Operation result
   */
  incrByBitfield(buffer, typeInfo, offsetInfo, increment, overflow = 'WRAP') {
    const { maxValue, minValue } = typeInfo
    
    // Get current value
    const currentResult = this.getBitfield(buffer, typeInfo, offsetInfo)
    const currentValue = currentResult.value
    
    // Calculate new value
    let newValue = currentValue + increment

    // Handle overflow
    switch (overflow.toUpperCase()) {
      case 'WRAP':
        // Wrap around on overflow
        while (newValue > maxValue) {
          newValue -= (maxValue - minValue + 1)
        }
        while (newValue < minValue) {
          newValue += (maxValue - minValue + 1)
        }
        break

      case 'SAT':
        // Saturate at limits
        newValue = Math.max(minValue, Math.min(maxValue, newValue))
        break

      case 'FAIL':
        // Fail on overflow
        if (newValue > maxValue || newValue < minValue) {
          return { value: null }
        }
        break

      default:
        return { error: 'ERR Invalid overflow type' }
    }

    // Set the new value
    const setResult = this.setBitfield(buffer, typeInfo, offsetInfo, newValue)
    if (setResult.error) {
      return setResult
    }

    return {
      value: newValue,
      buffer: setResult.buffer
    }
  }

  /**
   * Parse BITFIELD command arguments into operations
   * @param {Array} args - Command arguments
   * @returns {Array} Array of operation objects
   */
  parseOperations(args) {
    const operations = []
    let i = 0

    while (i < args.length) {
      const command = args[i].toUpperCase()
      
      if (command === 'OVERFLOW') {
        if (i + 1 >= args.length) {
          throw new Error('OVERFLOW requires an overflow type')
        }
        
        const overflowType = args[i + 1].toUpperCase()
        if (!['WRAP', 'SAT', 'FAIL'].includes(overflowType)) {
          throw new Error('Invalid overflow type')
        }
        
        // Apply overflow to subsequent operations
        for (let j = operations.length - 1; j >= 0; j--) {
          if (!operations[j].overflow) {
            operations[j].overflow = overflowType
            break
          }
        }
        
        i += 2
        continue
      }

      if (['GET', 'SET', 'INCRBY'].includes(command)) {
        if (i + 2 >= args.length) {
          throw new Error(`${command} requires type and offset`)
        }

        const operation = {
          command,
          type: args[i + 1],
          offset: args[i + 2]
        }

        if (command === 'SET') {
          if (i + 3 >= args.length) {
            throw new Error('SET requires a value')
          }
          operation.value = parseInt(args[i + 3], 10)
          i += 4
        } else if (command === 'INCRBY') {
          if (i + 3 >= args.length) {
            throw new Error('INCRBY requires an increment')
          }
          operation.increment = parseInt(args[i + 3], 10)
          i += 4
        } else {
          i += 3
        }

        operations.push(operation)
      } else {
        throw new Error(`Unknown bitfield command: ${command}`)
      }
    }

    return operations
  }

  /**
   * Helper method to validate if a value is a valid bitfield (string)
   * @param {*} value - Value to validate
   * @returns {boolean} True if valid bitfield
   */
  isValidBitfield(value) {
    return typeof value === 'string'
  }

  /**
   * Get bitfield statistics for debugging
   * @param {string} key - Bitfield key
   * @returns {Object} Bitfield statistics
   */
  getBitfieldStats(key) {
    const bitfieldResult = this.ensureBitfield(key)
    if (!bitfieldResult.success || !bitfieldResult.exists) {
      return {
        exists: false,
        byteLength: 0,
        bitLength: 0
      }
    }

    const buffer = bitfieldResult.value

    return {
      exists: true,
      byteLength: buffer.length,
      bitLength: buffer.length * 8
    }
  }
}

module.exports = BitfieldOps
