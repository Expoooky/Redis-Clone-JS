/**
 * String Operations Module
 * Implements all string-related Redis commands
 */

const logger = require('../utils/Logger')

class StringOps {
  constructor(dataStore) {
    this.dataStore = dataStore
    logger.info('StringOps module initialized')
  }

  /**
   * GET command - Get the value of a key
   * @param {string} key - Key to get
   * @returns {Object} Result object
   */
  get(key) {
    const result = this.dataStore.get(key)
    
    if (!result.success) {
      return result
    }

    // Ensure the value is a string or can be converted to string
    if (result.value === null) {
      return { success: true, value: null }
    }

    // Check if the value is actually a string
    if (typeof result.value !== 'string') {
      return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
    }

    return { success: true, value: result.value }
  }

  /**
   * SET command - Set key to hold the string value
   * @param {string} key - Key to set
   * @param {string} value - Value to set
   * @param {Object} options - SET command options (EX, PX, NX, XX)
   * @returns {Object} Result object
   */
  set(key, value, options = {}) {
    // Convert value to string
    const stringValue = value.toString()
    
    return this.dataStore.set(key, stringValue, options)
  }

  /**
   * APPEND command - Append a value to a key
   * @param {string} key - Key to append to
   * @param {string} value - Value to append
   * @returns {Object} Result object with new string length
   */
  append(key, value) {
    const existingResult = this.dataStore.get(key)
    
    if (!existingResult.success) {
      return existingResult
    }

    let currentValue = ''
    
    if (existingResult.value !== null) {
      // Check if existing value is a string
      if (typeof existingResult.value !== 'string') {
        return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
      }
      currentValue = existingResult.value
    }

    const newValue = currentValue + value.toString()
    const setResult = this.dataStore.set(key, newValue)
    
    if (!setResult.success) {
      return setResult
    }

    logger.debug('String appended', {
      key,
      originalLength: currentValue.length,
      appendedLength: value.toString().length,
      newLength: newValue.length
    })

    return { success: true, value: newValue.length }
  }

  /**
   * STRLEN command - Get the length of the value stored in a key
   * @param {string} key - Key to check
   * @returns {Object} Result object with string length
   */
  strlen(key) {
    const result = this.dataStore.get(key)
    
    if (!result.success) {
      return result
    }

    if (result.value === null) {
      return { success: true, value: 0 }
    }

    // Check if the value is a string
    if (typeof result.value !== 'string') {
      return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
    }

    return { success: true, value: result.value.length }
  }

  /**
   * INCR command - Increment the integer value of a key by one
   * @param {string} key - Key to increment
   * @returns {Object} Result object with new value
   */
  incr(key) {
    return this.incrby(key, 1)
  }

  /**
   * DECR command - Decrement the integer value of a key by one
   * @param {string} key - Key to decrement
   * @returns {Object} Result object with new value
   */
  decr(key) {
    return this.decrby(key, 1)
  }

  /**
   * INCRBY command - Increment the integer value of a key by the given amount
   * @param {string} key - Key to increment
   * @param {number} increment - Amount to increment by
   * @returns {Object} Result object with new value
   */
  incrby(key, increment) {
    const result = this.dataStore.get(key)
    
    if (!result.success) {
      return result
    }

    let currentValue = 0

    if (result.value !== null) {
      // Check if existing value is a string
      if (typeof result.value !== 'string') {
        return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
      }

      // Try to parse as integer
      const parsed = parseInt(result.value, 10)
      if (isNaN(parsed) || result.value !== parsed.toString()) {
        return { success: false, error: 'ERR value is not an integer or out of range' }
      }
      currentValue = parsed
    }

    // Validate increment
    if (!Number.isInteger(increment)) {
      return { success: false, error: 'ERR value is not an integer or out of range' }
    }

    const newValue = currentValue + increment
    
    // Check for integer overflow (JavaScript safe integer range)
    if (!Number.isSafeInteger(newValue)) {
      return { success: false, error: 'ERR increment or decrement would overflow' }
    }

    const setResult = this.dataStore.set(key, newValue.toString())
    
    if (!setResult.success) {
      return setResult
    }

    logger.debug('Integer incremented', {
      key,
      oldValue: currentValue,
      increment,
      newValue
    })

    return { success: true, value: newValue }
  }

  /**
   * DECRBY command - Decrement the integer value of a key by the given amount
   * @param {string} key - Key to decrement
   * @param {number} decrement - Amount to decrement by
   * @returns {Object} Result object with new value
   */
  decrby(key, decrement) {
    // Validate decrement
    if (!Number.isInteger(decrement)) {
      return { success: false, error: 'ERR value is not an integer or out of range' }
    }

    return this.incrby(key, -decrement)
  }

  /**
   * INCRBYFLOAT command - Increment the float value of a key by the given amount
   * @param {string} key - Key to increment
   * @param {number} increment - Amount to increment by (float)
   * @returns {Object} Result object with new value
   */
  incrbyfloat(key, increment) {
    const result = this.dataStore.get(key)
    
    if (!result.success) {
      return result
    }

    let currentValue = 0.0

    if (result.value !== null) {
      // Check if existing value is a string
      if (typeof result.value !== 'string') {
        return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
      }

      // Try to parse as float
      const parsed = parseFloat(result.value)
      if (isNaN(parsed)) {
        return { success: false, error: 'ERR value is not a valid float' }
      }
      currentValue = parsed
    }

    // Validate increment
    if (typeof increment !== 'number' || isNaN(increment)) {
      return { success: false, error: 'ERR value is not a valid float' }
    }

    const newValue = currentValue + increment
    
    // Check for infinity
    if (!isFinite(newValue)) {
      return { success: false, error: 'ERR increment would produce NaN or Infinity' }
    }

    // Format the result (remove unnecessary decimal places)
    const formattedValue = newValue % 1 === 0 ? newValue.toString() : newValue.toString()
    
    const setResult = this.dataStore.set(key, formattedValue)
    
    if (!setResult.success) {
      return setResult
    }

    logger.debug('Float incremented', {
      key,
      oldValue: currentValue,
      increment,
      newValue
    })

    return { success: true, value: formattedValue }
  }

  /**
   * GETRANGE command - Get a substring of the string stored at a key
   * @param {string} key - Key to get substring from
   * @param {number} start - Start index (inclusive)
   * @param {number} end - End index (inclusive)
   * @returns {Object} Result object with substring
   */
  getrange(key, start, end) {
    const result = this.dataStore.get(key)
    
    if (!result.success) {
      return result
    }

    if (result.value === null) {
      return { success: true, value: '' }
    }

    // Check if the value is a string
    if (typeof result.value !== 'string') {
      return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
    }

    const str = result.value
    const len = str.length

    // Normalize negative indices
    let normalizedStart = start < 0 ? Math.max(0, len + start) : start
    let normalizedEnd = end < 0 ? Math.max(-1, len + end) : end

    // Clamp to string bounds
    normalizedStart = Math.max(0, Math.min(normalizedStart, len - 1))
    normalizedEnd = Math.max(-1, Math.min(normalizedEnd, len - 1))

    // Handle edge cases
    if (normalizedStart > normalizedEnd || len === 0) {
      return { success: true, value: '' }
    }

    const substring = str.substring(normalizedStart, normalizedEnd + 1)

    logger.debug('String range retrieved', {
      key,
      start,
      end,
      normalizedStart,
      normalizedEnd,
      originalLength: len,
      substringLength: substring.length
    })

    return { success: true, value: substring }
  }

  /**
   * SETRANGE command - Overwrite part of a string at key starting at the specified offset
   * @param {string} key - Key to modify
   * @param {number} offset - Offset to start writing at
   * @param {string} value - Value to write
   * @returns {Object} Result object with new string length
   */
  setrange(key, offset, value) {
    if (offset < 0) {
      return { success: false, error: 'ERR offset is out of range' }
    }

    const result = this.dataStore.get(key)
    
    if (!result.success) {
      return result
    }

    let currentValue = ''
    
    if (result.value !== null) {
      // Check if existing value is a string
      if (typeof result.value !== 'string') {
        return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
      }
      currentValue = result.value
    }

    const valueStr = value.toString()
    const currentLen = currentValue.length
    
    // If offset is beyond current string, pad with null bytes (\x00)
    if (offset > currentLen) {
      currentValue += '\x00'.repeat(offset - currentLen)
    }

    // Build new string
    const beforePart = currentValue.substring(0, offset)
    const afterPart = currentValue.substring(offset + valueStr.length)
    const newValue = beforePart + valueStr + afterPart

    const setResult = this.dataStore.set(key, newValue)
    
    if (!setResult.success) {
      return setResult
    }

    logger.debug('String range set', {
      key,
      offset,
      valueLength: valueStr.length,
      originalLength: currentLen,
      newLength: newValue.length
    })

    return { success: true, value: newValue.length }
  }

  /**
   * MGET command - Get the values of all the given keys
   * @param {Array<string>} keys - Array of keys to get
   * @returns {Object} Result object with array of values
   */
  mget(keys) {
    if (!Array.isArray(keys) || keys.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments' }
    }

    const values = []
    
    for (const key of keys) {
      const result = this.get(key)
      if (result.success) {
        values.push(result.value)
      } else {
        // If there's an error with one key, still continue with others
        // but return null for that key (Redis behavior)
        values.push(null)
      }
    }

    logger.debug('Multiple keys retrieved', {
      keyCount: keys.length,
      nullCount: values.filter(v => v === null).length
    })

    return { success: true, value: values }
  }

  /**
   * MSET command - Set multiple keys to multiple values
   * @param {Array} keyValuePairs - Array of [key, value] pairs
   * @returns {Object} Result object
   */
  mset(keyValuePairs) {
    if (!Array.isArray(keyValuePairs) || keyValuePairs.length === 0 || keyValuePairs.length % 2 !== 0) {
      return { success: false, error: 'ERR wrong number of arguments' }
    }

    const operations = []
    
    // Prepare all operations
    for (let i = 0; i < keyValuePairs.length; i += 2) {
      const key = keyValuePairs[i]
      const value = keyValuePairs[i + 1]
      operations.push({ key, value: value.toString() })
    }

    // Execute all operations
    for (const op of operations) {
      const result = this.dataStore.set(op.key, op.value)
      if (!result.success) {
        // If any operation fails, it's still considered successful in Redis
        // but we log the error
        logger.warn('MSET operation failed for key', { key: op.key, error: result.error })
      }
    }

    logger.debug('Multiple keys set', { operationCount: operations.length })

    return { success: true, value: 'OK' }
  }

  /**
   * MSETNX command - Set multiple keys to multiple values, only if none of the keys exist
   * @param {Array} keyValuePairs - Array of [key, value] pairs
   * @returns {Object} Result object (1 if all keys were set, 0 otherwise)
   */
  msetnx(keyValuePairs) {
    if (!Array.isArray(keyValuePairs) || keyValuePairs.length === 0 || keyValuePairs.length % 2 !== 0) {
      return { success: false, error: 'ERR wrong number of arguments' }
    }

    const operations = []
    
    // Prepare all operations and check if any key exists
    for (let i = 0; i < keyValuePairs.length; i += 2) {
      const key = keyValuePairs[i]
      const value = keyValuePairs[i + 1]
      
      // Check if key exists
      const existsResult = this.dataStore.exists(key)
      if (!existsResult.success) {
        return existsResult
      }
      
      if (existsResult.value === 1) {
        // If any key exists, return 0 without setting anything
        logger.debug('MSETNX failed - key exists', { key })
        return { success: true, value: 0 }
      }
      
      operations.push({ key, value: value.toString() })
    }

    // All keys don't exist, set them all
    for (const op of operations) {
      const result = this.dataStore.set(op.key, op.value)
      if (!result.success) {
        // This shouldn't happen since we checked existence, but handle it
        logger.error('MSETNX set operation failed', { key: op.key, error: result.error })
        return { success: false, error: 'ERR failed to set key' }
      }
    }

    logger.debug('Multiple keys set with NX', { operationCount: operations.length })

    return { success: true, value: 1 }
  }

  /**
   * Helper method to validate if a value is a valid string for string operations
   * @param {*} value - Value to validate
   * @returns {boolean} True if valid string
   */
  isValidStringValue(value) {
    return typeof value === 'string'
  }

  /**
   * Helper method to convert value to string safely
   * @param {*} value - Value to convert
   * @returns {string} String representation
   */
  toStringValue(value) {
    if (value === null || value === undefined) {
      return ''
    }
    return value.toString()
  }
}

module.exports = StringOps
