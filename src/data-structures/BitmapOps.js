/**
 * Bitmap Operations Module
 * Implements Redis bitmap commands for bit-level operations on strings
 * Provides efficient bit manipulation and counting operations
 */

const logger = require('../utils/Logger')

class BitmapOps {
  constructor(dataStore) {
    this.dataStore = dataStore
    logger.info('BitmapOps module initialized')
  }

  /**
   * Ensure key holds a string value for bitmap operations
   * @param {string} key - Key to check/create
   * @returns {Object} Result with string buffer or error
   */
  ensureBitmap(key) {
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
   * SETBIT command - Set bit at offset
   * @param {string} key - Bitmap key
   * @param {number} offset - Bit offset (0-based)
   * @param {number} value - Bit value (0 or 1)
   * @returns {Object} Result with original bit value
   */
  setbit(key, offset, value) {
    // Validate inputs
    if (!Number.isInteger(offset) || offset < 0) {
      return { success: false, error: 'ERR bit offset is not an integer or out of range' }
    }

    if (value !== 0 && value !== 1) {
      return { success: false, error: 'ERR bit is not an integer or out of range' }
    }

    // Redis has a maximum offset limit (512MB * 8 bits)
    const maxOffset = 512 * 1024 * 1024 * 8
    if (offset >= maxOffset) {
      return { success: false, error: 'ERR bit offset is out of range' }
    }

    const bitmapResult = this.ensureBitmap(key)
    if (!bitmapResult.success) {
      return bitmapResult
    }

    let buffer = bitmapResult.value
    const byteIndex = Math.floor(offset / 8)
    const bitIndex = 7 - (offset % 8) // Redis uses big-endian bit ordering

    // Extend buffer if necessary
    if (byteIndex >= buffer.length) {
      const newBuffer = Buffer.alloc(byteIndex + 1)
      buffer.copy(newBuffer)
      buffer = newBuffer
    }

    // Get original bit value
    const originalBit = (buffer[byteIndex] >> bitIndex) & 1

    // Set the new bit value
    if (value === 1) {
      buffer[byteIndex] |= (1 << bitIndex)
    } else {
      buffer[byteIndex] &= ~(1 << bitIndex)
    }

    // Store back as string
    const stringValue = buffer.toString('binary')
    const setResult = this.dataStore.set(key, stringValue)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('SETBIT executed', {
      key,
      offset,
      value,
      originalBit,
      bufferLength: buffer.length
    })

    return { success: true, value: originalBit }
  }

  /**
   * GETBIT command - Get bit at offset
   * @param {string} key - Bitmap key
   * @param {number} offset - Bit offset (0-based)
   * @returns {Object} Result with bit value
   */
  getbit(key, offset) {
    // Validate inputs
    if (!Number.isInteger(offset) || offset < 0) {
      return { success: false, error: 'ERR bit offset is not an integer or out of range' }
    }

    const bitmapResult = this.ensureBitmap(key)
    if (!bitmapResult.success) {
      return bitmapResult
    }

    if (!bitmapResult.exists) {
      return { success: true, value: 0 }
    }

    const buffer = bitmapResult.value
    const byteIndex = Math.floor(offset / 8)
    const bitIndex = 7 - (offset % 8) // Redis uses big-endian bit ordering

    // If offset is beyond the string, return 0
    if (byteIndex >= buffer.length) {
      return { success: true, value: 0 }
    }

    const bitValue = (buffer[byteIndex] >> bitIndex) & 1

    logger.debug('GETBIT executed', {
      key,
      offset,
      bitValue,
      bufferLength: buffer.length
    })

    return { success: true, value: bitValue }
  }

  /**
   * BITCOUNT command - Count set bits
   * @param {string} key - Bitmap key
   * @param {number} start - Start byte (optional)
   * @param {number} end - End byte (optional)
   * @returns {Object} Result with bit count
   */
  bitcount(key, start = null, end = null) {
    const bitmapResult = this.ensureBitmap(key)
    if (!bitmapResult.success) {
      return bitmapResult
    }

    if (!bitmapResult.exists) {
      return { success: true, value: 0 }
    }

    const buffer = bitmapResult.value
    const bufferLength = buffer.length

    // Determine byte range
    let startByte = 0
    let endByte = bufferLength - 1

    if (start !== null) {
      startByte = start < 0 ? Math.max(0, bufferLength + start) : start
      startByte = Math.max(0, Math.min(startByte, bufferLength - 1))
    }

    if (end !== null) {
      endByte = end < 0 ? Math.max(-1, bufferLength + end) : end
      endByte = Math.max(-1, Math.min(endByte, bufferLength - 1))
    }

    if (startByte > endByte || bufferLength === 0) {
      return { success: true, value: 0 }
    }

    // Count bits in the specified byte range
    let count = 0
    for (let i = startByte; i <= endByte; i++) {
      count += this.popcount(buffer[i])
    }

    logger.debug('BITCOUNT executed', {
      key,
      start,
      end,
      startByte,
      endByte,
      count,
      bufferLength
    })

    return { success: true, value: count }
  }

  /**
   * BITPOS command - Find position of first bit with given value
   * @param {string} key - Bitmap key
   * @param {number} bit - Bit value to find (0 or 1)
   * @param {number} start - Start byte (optional)
   * @param {number} end - End byte (optional)
   * @returns {Object} Result with bit position
   */
  bitpos(key, bit, start = null, end = null) {
    // Validate bit value
    if (bit !== 0 && bit !== 1) {
      return { success: false, error: 'ERR bit is not an integer or out of range' }
    }

    const bitmapResult = this.ensureBitmap(key)
    if (!bitmapResult.success) {
      return bitmapResult
    }

    if (!bitmapResult.exists) {
      // Empty string
      return { success: true, value: bit === 1 ? -1 : 0 }
    }

    const buffer = bitmapResult.value
    const bufferLength = buffer.length

    // Determine byte range
    let startByte = 0
    let endByte = bufferLength - 1

    if (start !== null) {
      startByte = start < 0 ? Math.max(0, bufferLength + start) : start
      startByte = Math.max(0, Math.min(startByte, bufferLength - 1))
    }

    if (end !== null) {
      endByte = end < 0 ? Math.max(-1, bufferLength + end) : end
      endByte = Math.max(-1, Math.min(endByte, bufferLength - 1))
    }

    if (startByte > endByte) {
      return { success: true, value: -1 }
    }

    // Search for the bit
    for (let byteIndex = startByte; byteIndex <= endByte; byteIndex++) {
      const byte = buffer[byteIndex]
      
      for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
        const currentBit = (byte >> (7 - bitIndex)) & 1
        
        if (currentBit === bit) {
          const position = byteIndex * 8 + bitIndex
          
          logger.debug('BITPOS executed', {
            key,
            bit,
            start,
            end,
            position
          })
          
          return { success: true, value: position }
        }
      }
    }

    // Not found
    return { success: true, value: -1 }
  }

  /**
   * BITOP command - Perform bitwise operations
   * @param {string} operation - Operation (AND, OR, XOR, NOT)
   * @param {string} destkey - Destination key
   * @param {Array} keys - Source keys
   * @returns {Object} Result with destination string length
   */
  bitop(operation, destkey, keys) {
    const op = operation.toUpperCase()
    
    // Validate operation
    if (!['AND', 'OR', 'XOR', 'NOT'].includes(op)) {
      return { success: false, error: 'ERR syntax error' }
    }

    // NOT operation requires exactly one source key
    if (op === 'NOT' && keys.length !== 1) {
      return { success: false, error: 'ERR BITOP NOT must be called with a single source key' }
    }

    // Get all source bitmaps
    const sourceBuffers = []
    let maxLength = 0

    for (const key of keys) {
      const bitmapResult = this.ensureBitmap(key)
      if (!bitmapResult.success) {
        return bitmapResult
      }
      
      const buffer = bitmapResult.exists ? bitmapResult.value : Buffer.alloc(0)
      sourceBuffers.push(buffer)
      maxLength = Math.max(maxLength, buffer.length)
    }

    // Create result buffer
    const resultBuffer = Buffer.alloc(maxLength)

    // Perform bitwise operation
    for (let i = 0; i < maxLength; i++) {
      let result = 0

      switch (op) {
        case 'AND':
          result = 0xFF // Start with all bits set for AND
          for (const buffer of sourceBuffers) {
            const byte = i < buffer.length ? buffer[i] : 0
            result &= byte
          }
          break

        case 'OR':
          result = 0 // Start with no bits set for OR
          for (const buffer of sourceBuffers) {
            const byte = i < buffer.length ? buffer[i] : 0
            result |= byte
          }
          break

        case 'XOR':
          result = 0 // Start with no bits set for XOR
          for (const buffer of sourceBuffers) {
            const byte = i < buffer.length ? buffer[i] : 0
            result ^= byte
          }
          break

        case 'NOT':
          const byte = i < sourceBuffers[0].length ? sourceBuffers[0][i] : 0
          result = ~byte & 0xFF
          break
      }

      resultBuffer[i] = result
    }

    // Store result
    const resultString = resultBuffer.toString('binary')
    const setResult = this.dataStore.set(destkey, resultString)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('BITOP executed', {
      operation: op,
      destkey,
      sourceKeys: keys,
      sourceCount: keys.length,
      resultLength: maxLength
    })

    return { success: true, value: maxLength }
  }

  /**
   * Count set bits in a byte (population count)
   * @param {number} byte - Byte value (0-255)
   * @returns {number} Number of set bits
   */
  popcount(byte) {
    // Brian Kernighan's algorithm
    let count = 0
    while (byte) {
      count++
      byte &= byte - 1 // Clear the lowest set bit
    }
    return count
  }

  /**
   * Helper method to validate if a value is a valid bitmap (string)
   * @param {*} value - Value to validate
   * @returns {boolean} True if valid bitmap
   */
  isValidBitmap(value) {
    return typeof value === 'string'
  }

  /**
   * Convert buffer to binary string representation
   * @param {Buffer} buffer - Buffer to convert
   * @returns {string} Binary string
   */
  bufferToBinaryString(buffer) {
    return buffer.toString('binary')
  }

  /**
   * Get bitmap statistics for debugging
   * @param {string} key - Bitmap key
   * @returns {Object} Bitmap statistics
   */
  getBitmapStats(key) {
    const bitmapResult = this.ensureBitmap(key)
    if (!bitmapResult.success || !bitmapResult.exists) {
      return {
        exists: false,
        byteLength: 0,
        bitLength: 0,
        setBits: 0
      }
    }

    const buffer = bitmapResult.value
    let setBits = 0
    
    for (let i = 0; i < buffer.length; i++) {
      setBits += this.popcount(buffer[i])
    }

    return {
      exists: true,
      byteLength: buffer.length,
      bitLength: buffer.length * 8,
      setBits,
      density: buffer.length > 0 ? (setBits / (buffer.length * 8)) * 100 : 0
    }
  }
}

module.exports = BitmapOps
