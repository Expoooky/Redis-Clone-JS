/**
 * Hash Operations Module
 * Implements all hash-related Redis commands
 * Hashes are implemented as JavaScript Map objects for efficient field-value operations
 */

const logger = require('../utils/Logger')

class HashOps {
  constructor(dataStore) {
    this.dataStore = dataStore
    logger.info('HashOps module initialized')
  }

  /**
   * Ensure key holds a hash, create if needed
   * @param {string} key - Key to check/create
   * @returns {Object} Result with hash or error
   */
  ensureHash(key) {
    const result = this.dataStore.get(key)
    
    if (!result.success) {
      return result
    }

    if (result.value === null) {
      // Key doesn't exist, will be created on first operation
      return { success: true, value: new Map(), exists: false }
    }

    if (!(result.value instanceof Map)) {
      return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
    }

    return { success: true, value: result.value, exists: true }
  }

  /**
   * HSET command - Set field in hash
   * @param {string} key - Hash key
   * @param {Array} fieldValuePairs - Array of field-value pairs
   * @returns {Object} Result with number of fields added (not updated)
   */
  hset(key, fieldValuePairs) {
    if (!Array.isArray(fieldValuePairs) || fieldValuePairs.length === 0 || fieldValuePairs.length % 2 !== 0) {
      return { success: false, error: 'ERR wrong number of arguments for \'hset\' command' }
    }

    const hashResult = this.ensureHash(key)
    if (!hashResult.success) {
      return hashResult
    }

    const hash = new Map(hashResult.value)
    let addedCount = 0

    // Process field-value pairs
    for (let i = 0; i < fieldValuePairs.length; i += 2) {
      const field = fieldValuePairs[i].toString()
      const value = fieldValuePairs[i + 1].toString()
      
      const isNewField = !hash.has(field)
      hash.set(field, value)
      
      if (isNewField) {
        addedCount++
      }
    }

    const setResult = this.dataStore.set(key, hash)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('HSET executed', {
      key,
      pairsProvided: fieldValuePairs.length / 2,
      addedCount,
      totalFields: hash.size
    })

    return { success: true, value: addedCount }
  }

  /**
   * HGET command - Get field value from hash
   * @param {string} key - Hash key
   * @param {string} field - Field name
   * @returns {Object} Result with field value or null
   */
  hget(key, field) {
    const hashResult = this.ensureHash(key)
    if (!hashResult.success) {
      return hashResult
    }

    if (!hashResult.exists) {
      return { success: true, value: null }
    }

    const fieldStr = field.toString()
    const value = hashResult.value.get(fieldStr)

    logger.debug('HGET executed', { key, field: fieldStr, found: value !== undefined })

    return { success: true, value: value !== undefined ? value : null }
  }

  /**
   * HMSET command - Set multiple fields in hash (deprecated, use HSET)
   * @param {string} key - Hash key
   * @param {Array} fieldValuePairs - Array of field-value pairs
   * @returns {Object} Result
   */
  hmset(key, fieldValuePairs) {
    const result = this.hset(key, fieldValuePairs)
    if (result.success) {
      return { success: true, value: 'OK' }
    }
    return result
  }

  /**
   * HGETALL command - Get all fields and values from hash
   * @param {string} key - Hash key
   * @returns {Object} Result with array of field-value pairs
   */
  hgetall(key) {
    const hashResult = this.ensureHash(key)
    if (!hashResult.success) {
      return hashResult
    }

    if (!hashResult.exists) {
      return { success: true, value: [] }
    }

    const result = []
    for (const [field, value] of hashResult.value) {
      result.push(field, value)
    }

    logger.debug('HGETALL executed', {
      key,
      fieldCount: hashResult.value.size,
      resultLength: result.length
    })

    return { success: true, value: result }
  }

  /**
   * HDEL command - Delete fields from hash
   * @param {string} key - Hash key
   * @param {Array} fields - Fields to delete
   * @returns {Object} Result with number of deleted fields
   */
  hdel(key, fields) {
    if (!Array.isArray(fields) || fields.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments for \'hdel\' command' }
    }

    const hashResult = this.ensureHash(key)
    if (!hashResult.success) {
      return hashResult
    }

    if (!hashResult.exists) {
      return { success: true, value: 0 }
    }

    const hash = new Map(hashResult.value)
    let deletedCount = 0

    for (const field of fields) {
      const fieldStr = field.toString()
      if (hash.has(fieldStr)) {
        hash.delete(fieldStr)
        deletedCount++
      }
    }

    // Update or delete the key
    if (hash.size === 0) {
      this.dataStore.del(key)
    } else {
      this.dataStore.set(key, hash)
    }

    logger.debug('HDEL executed', {
      key,
      fieldsProvided: fields.length,
      deletedCount,
      remainingFields: hash.size
    })

    return { success: true, value: deletedCount }
  }

  /**
   * HEXISTS command - Check if field exists in hash
   * @param {string} key - Hash key
   * @param {string} field - Field name
   * @returns {Object} Result with 1 if exists, 0 if not
   */
  hexists(key, field) {
    const hashResult = this.ensureHash(key)
    if (!hashResult.success) {
      return hashResult
    }

    if (!hashResult.exists) {
      return { success: true, value: 0 }
    }

    const fieldStr = field.toString()
    const exists = hashResult.value.has(fieldStr) ? 1 : 0

    logger.debug('HEXISTS executed', { key, field: fieldStr, exists })

    return { success: true, value: exists }
  }

  /**
   * HKEYS command - Get all field names from hash
   * @param {string} key - Hash key
   * @returns {Object} Result with array of field names
   */
  hkeys(key) {
    const hashResult = this.ensureHash(key)
    if (!hashResult.success) {
      return hashResult
    }

    if (!hashResult.exists) {
      return { success: true, value: [] }
    }

    const keys = Array.from(hashResult.value.keys())

    logger.debug('HKEYS executed', { key, keyCount: keys.length })

    return { success: true, value: keys }
  }

  /**
   * HVALS command - Get all values from hash
   * @param {string} key - Hash key
   * @returns {Object} Result with array of values
   */
  hvals(key) {
    const hashResult = this.ensureHash(key)
    if (!hashResult.success) {
      return hashResult
    }

    if (!hashResult.exists) {
      return { success: true, value: [] }
    }

    const values = Array.from(hashResult.value.values())

    logger.debug('HVALS executed', { key, valueCount: values.length })

    return { success: true, value: values }
  }

  /**
   * HLEN command - Get number of fields in hash
   * @param {string} key - Hash key
   * @returns {Object} Result with field count
   */
  hlen(key) {
    const hashResult = this.ensureHash(key)
    if (!hashResult.success) {
      return hashResult
    }

    const length = hashResult.exists ? hashResult.value.size : 0

    logger.debug('HLEN executed', { key, length })

    return { success: true, value: length }
  }

  /**
   * HINCRBY command - Increment field value by integer
   * @param {string} key - Hash key
   * @param {string} field - Field name
   * @param {number} increment - Increment value
   * @returns {Object} Result with new value
   */
  hincrby(key, field, increment) {
    if (!Number.isInteger(increment)) {
      return { success: false, error: 'ERR value is not an integer or out of range' }
    }

    const hashResult = this.ensureHash(key)
    if (!hashResult.success) {
      return hashResult
    }

    const hash = new Map(hashResult.value)
    const fieldStr = field.toString()
    
    let currentValue = 0
    if (hash.has(fieldStr)) {
      const existingValue = hash.get(fieldStr)
      const parsed = parseInt(existingValue, 10)
      if (isNaN(parsed) || existingValue !== parsed.toString()) {
        return { success: false, error: 'ERR hash value is not an integer' }
      }
      currentValue = parsed
    }

    const newValue = currentValue + increment
    
    // Check for integer overflow
    if (!Number.isSafeInteger(newValue)) {
      return { success: false, error: 'ERR increment or decrement would overflow' }
    }

    hash.set(fieldStr, newValue.toString())

    const setResult = this.dataStore.set(key, hash)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('HINCRBY executed', {
      key,
      field: fieldStr,
      increment,
      oldValue: currentValue,
      newValue
    })

    return { success: true, value: newValue }
  }

  /**
   * HINCRBYFLOAT command - Increment field value by float
   * @param {string} key - Hash key
   * @param {string} field - Field name
   * @param {number} increment - Increment value (float)
   * @returns {Object} Result with new value
   */
  hincrbyfloat(key, field, increment) {
    if (typeof increment !== 'number' || isNaN(increment)) {
      return { success: false, error: 'ERR value is not a valid float' }
    }

    const hashResult = this.ensureHash(key)
    if (!hashResult.success) {
      return hashResult
    }

    const hash = new Map(hashResult.value)
    const fieldStr = field.toString()
    
    let currentValue = 0.0
    if (hash.has(fieldStr)) {
      const existingValue = hash.get(fieldStr)
      const parsed = parseFloat(existingValue)
      if (isNaN(parsed)) {
        return { success: false, error: 'ERR hash value is not a float' }
      }
      currentValue = parsed
    }

    const newValue = currentValue + increment
    
    // Check for infinity
    if (!isFinite(newValue)) {
      return { success: false, error: 'ERR increment would produce NaN or Infinity' }
    }

    // Format the result
    const formattedValue = newValue % 1 === 0 ? newValue.toString() : newValue.toString()
    hash.set(fieldStr, formattedValue)

    const setResult = this.dataStore.set(key, hash)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('HINCRBYFLOAT executed', {
      key,
      field: fieldStr,
      increment,
      oldValue: currentValue,
      newValue
    })

    return { success: true, value: formattedValue }
  }

  /**
   * HMGET command - Get values of multiple fields
   * @param {string} key - Hash key
   * @param {Array} fields - Fields to get
   * @returns {Object} Result with array of values (null for non-existent fields)
   */
  hmget(key, fields) {
    if (!Array.isArray(fields) || fields.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments for \'hmget\' command' }
    }

    const hashResult = this.ensureHash(key)
    if (!hashResult.success) {
      return hashResult
    }

    const values = []
    
    if (!hashResult.exists) {
      // Return null for all fields if hash doesn't exist
      for (let i = 0; i < fields.length; i++) {
        values.push(null)
      }
    } else {
      for (const field of fields) {
        const fieldStr = field.toString()
        const value = hashResult.value.get(fieldStr)
        values.push(value !== undefined ? value : null)
      }
    }

    logger.debug('HMGET executed', {
      key,
      fieldCount: fields.length,
      nullCount: values.filter(v => v === null).length
    })

    return { success: true, value: values }
  }

  /**
   * HSETNX command - Set field only if it doesn't exist
   * @param {string} key - Hash key
   * @param {string} field - Field name
   * @param {string} value - Field value
   * @returns {Object} Result with 1 if set, 0 if not set
   */
  hsetnx(key, field, value) {
    const hashResult = this.ensureHash(key)
    if (!hashResult.success) {
      return hashResult
    }

    const hash = new Map(hashResult.value)
    const fieldStr = field.toString()
    
    if (hash.has(fieldStr)) {
      return { success: true, value: 0 } // Field already exists
    }

    hash.set(fieldStr, value.toString())

    const setResult = this.dataStore.set(key, hash)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('HSETNX executed', {
      key,
      field: fieldStr,
      value: value.toString(),
      wasSet: true
    })

    return { success: true, value: 1 }
  }

  /**
   * Helper method to validate if a value is a valid hash
   * @param {*} value - Value to validate
   * @returns {boolean} True if valid hash
   */
  isValidHash(value) {
    return value instanceof Map
  }

  /**
   * Helper method to convert object to Map with string keys and values
   * @param {Object} obj - Object to convert
   * @returns {Map} Map with string keys and values
   */
  objectToStringMap(obj) {
    const map = new Map()
    for (const [key, value] of Object.entries(obj)) {
      map.set(key.toString(), value.toString())
    }
    return map
  }
}

module.exports = HashOps
