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
      return { success: false, error: 'wrong type Operation against a key holding the wrong kind of value' }
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
        return { success: false, error: 'wrong type Operation against a key holding the wrong kind of value' }
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
      return { success: false, error: 'wrong type Operation against a key holding the wrong kind of value' }
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
        return { success: false, error: 'wrong type Operation against a key holding the wrong kind of value' }
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
        return { success: false, error: 'wrong type Operation against a key holding the wrong kind of value' }
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
        return { success: false, error: 'wrong type Operation against a key holding the wrong kind of value' }
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
   * SETNX command - Set key to hold string value if key does not exist
   * @param {string} key - Key to set
   * @param {string} value - Value to set
   * @returns {Object} Result object (1 if key was set, 0 if key already exists)
   */
  setnx(key, value) {
    const existsResult = this.dataStore.exists(key)
    if (!existsResult.success) {
      return existsResult
    }

    if (existsResult.value === 1) {
      // Key exists, return 0
      return { success: true, value: 0 }
    }

    // Key doesn't exist, set it
    const setResult = this.dataStore.set(key, value.toString())
    if (!setResult.success) {
      return setResult
    }

    logger.debug('Key set with NX', { key })
    return { success: true, value: 1 }
  }

  /**
   * SETEX command - Set key to hold string value and set key to timeout after given seconds
   * @param {string} key - Key to set
   * @param {number} seconds - Expiration time in seconds
   * @param {string} value - Value to set
   * @returns {Object} Result object
   */
  setex(key, seconds, value) {
    if (!Number.isInteger(seconds) || seconds <= 0) {
      return { success: false, error: 'ERR invalid expire time in setex' }
    }

    const options = { ex: seconds }
    return this.set(key, value, options)
  }

  /**
   * PSETEX command - Set key to hold string value and set key to timeout after given milliseconds
   * @param {string} key - Key to set
   * @param {number} milliseconds - Expiration time in milliseconds
   * @param {string} value - Value to set
   * @returns {Object} Result object
   */
  psetex(key, milliseconds, value) {
    if (!Number.isInteger(milliseconds) || milliseconds <= 0) {
      return { success: false, error: 'ERR invalid expire time in psetex' }
    }

    const options = { px: milliseconds }
    return this.set(key, value, options)
  }

  /**
   * GETSET command - Set key to value and return the old value stored at key
   * @param {string} key - Key to set
   * @param {string} value - Value to set
   * @returns {Object} Result object with old value
   */
  getset(key, value) {
    // Get the old value first
    const oldResult = this.get(key)
    if (!oldResult.success && oldResult.error !== 'Key not found') {
      return oldResult
    }

    const oldValue = oldResult.success ? oldResult.value : null

    // Set the new value
    const setResult = this.set(key, value)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('Key set with old value returned', { key, hadOldValue: oldValue !== null })
    return { success: true, value: oldValue }
  }

  /**
   * GETDEL command - Get the value of key and delete the key (Redis 6.2+)
   * @param {string} key - Key to get and delete
   * @returns {Object} Result object with value
   */
  getdel(key) {
    // Get the value first
    const getResult = this.get(key)
    if (!getResult.success && getResult.error !== 'Key not found') {
      return getResult
    }

    const value = getResult.success ? getResult.value : null

    // Delete the key if it exists
    if (value !== null) {
      const delResult = this.dataStore.del(key)
      if (!delResult.success) {
        return delResult
      }
    }

    logger.debug('Key retrieved and deleted', { key, hadValue: value !== null })
    return { success: true, value: value }
  }

  /**
   * GETEX command - Get the value of key and optionally set its expiration (Redis 6.2+)
   * @param {string} key - Key to get
   * @param {Object} options - Expiration options (EX, PX, EXAT, PXAT, PERSIST)
   * @returns {Object} Result object with value
   */
  getex(key, options = {}) {
    // Get the value first
    const getResult = this.get(key)
    if (!getResult.success) {
      return getResult
    }

    const value = getResult.value

    // If value is null, no need to set expiration
    if (value === null) {
      return { success: true, value: null }
    }

    // Set expiration if options provided
    if (Object.keys(options).length > 0) {
      if (options.persist) {
        // Remove expiration
        const persistResult = this.dataStore.persist(key)
        if (!persistResult.success) {
          logger.warn('Failed to persist key in GETEX', { key, error: persistResult.error })
        }
      } else {
        // Set new expiration
        const setResult = this.dataStore.set(key, value, options)
        if (!setResult.success) {
          logger.warn('Failed to set expiration in GETEX', { key, error: setResult.error })
        }
      }
    }

    logger.debug('Key retrieved with expiration update', { key, hasOptions: Object.keys(options).length > 0 })
    return { success: true, value: value }
  }

  /**
   * SUBSTR command - Alias for GETRANGE (deprecated but still supported)
   * @param {string} key - Key to get substring from
   * @param {number} start - Start index (inclusive)
   * @param {number} end - End index (inclusive)
   * @returns {Object} Result object with substring
   */
  substr(key, start, end) {
    return this.getrange(key, start, end)
  }

  /**
   * GETBIT command - Returns the bit value at offset in the string value stored at key
   * @param {string} key - Key to check
   * @param {number} offset - Bit offset
   * @returns {Object} Result object with bit value (0 or 1)
   */
  getbit(key, offset) {
    if (!Number.isInteger(offset) || offset < 0) {
      return { success: false, error: 'ERR bit offset is not an integer or out of range' }
    }

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

    const str = result.value
    const byteIndex = Math.floor(offset / 8)
    const bitIndex = offset % 8

    // If offset is beyond string length, return 0
    if (byteIndex >= str.length) {
      return { success: true, value: 0 }
    }

    const byte = str.charCodeAt(byteIndex)
    const bit = (byte >> (7 - bitIndex)) & 1

    logger.debug('Bit retrieved', { key, offset, byteIndex, bitIndex, bit })
    return { success: true, value: bit }
  }

  /**
   * SETBIT command - Sets or clears the bit at offset in the string value stored at key
   * @param {string} key - Key to modify
   * @param {number} offset - Bit offset
   * @param {number} value - Bit value (0 or 1)
   * @returns {Object} Result object with old bit value
   */
  setbit(key, offset, value) {
    if (!Number.isInteger(offset) || offset < 0) {
      return { success: false, error: 'ERR bit offset is not an integer or out of range' }
    }

    if (value !== 0 && value !== 1) {
      return { success: false, error: 'ERR bit is not an integer or out of range' }
    }

    // Redis has a limit on bit offset (2^32-1 bits = 512MB)
    if (offset >= 2**32) {
      return { success: false, error: 'ERR bit offset is not an integer or out of range' }
    }

    const result = this.dataStore.get(key)
    
    if (!result.success) {
      return result
    }

    let str = ''
    if (result.value !== null) {
      // Check if existing value is a string
      if (typeof result.value !== 'string') {
        return { success: false, error: 'wrong type Operation against a key holding the wrong kind of value' }
      }
      str = result.value
    }

    const byteIndex = Math.floor(offset / 8)
    const bitIndex = offset % 8

    // Extend string with null bytes if needed
    while (str.length <= byteIndex) {
      str += '\x00'
    }

    // Get current bit value
    const oldByte = str.charCodeAt(byteIndex)
    const oldBit = (oldByte >> (7 - bitIndex)) & 1

    // Set new bit value
    let newByte
    if (value === 1) {
      newByte = oldByte | (1 << (7 - bitIndex))
    } else {
      newByte = oldByte & ~(1 << (7 - bitIndex))
    }

    // Replace byte in string
    const newStr = str.substring(0, byteIndex) + String.fromCharCode(newByte) + str.substring(byteIndex + 1)

    // Save updated string
    const setResult = this.dataStore.set(key, newStr)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('Bit set', { key, offset, oldBit, newBit: value })
    return { success: true, value: oldBit }
  }

  /**
   * BITCOUNT command - Count the number of set bits in a string
   * @param {string} key - Key to check
   * @param {number} start - Start byte index (optional)
   * @param {number} end - End byte index (optional)
   * @param {string} unit - Unit type: BYTE (default) or BIT
   * @returns {Object} Result object with bit count
   */
  bitcount(key, start = null, end = null, unit = 'BYTE') {
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

    let str = result.value
    const len = str.length

    // Handle range parameters
    let startByte = 0
    let endByte = len - 1

    if (start !== null || end !== null) {
      if (unit.toUpperCase() === 'BIT') {
        // BIT unit - Redis 7.0+ feature
        if (start !== null) {
          if (start < 0) startByte = Math.max(0, Math.floor((len * 8 + start) / 8))
          else startByte = Math.floor(start / 8)
        }
        if (end !== null) {
          if (end < 0) endByte = Math.max(-1, Math.floor((len * 8 + end) / 8))
          else endByte = Math.floor(end / 8)
        }
      } else {
        // BYTE unit (default)
        if (start !== null) {
          startByte = start < 0 ? Math.max(0, len + start) : start
        }
        if (end !== null) {
          endByte = end < 0 ? Math.max(-1, len + end) : end
        }
      }

      // Clamp to string bounds
      startByte = Math.max(0, Math.min(startByte, len - 1))
      endByte = Math.max(-1, Math.min(endByte, len - 1))

      if (startByte > endByte) {
        return { success: true, value: 0 }
      }

      str = str.substring(startByte, endByte + 1)
    }

    // Count set bits
    let bitCount = 0
    for (let i = 0; i < str.length; i++) {
      const byte = str.charCodeAt(i)
      // Count bits using Brian Kernighan's algorithm
      let n = byte
      while (n) {
        bitCount++
        n = n & (n - 1) // Remove the lowest set bit
      }
    }

    logger.debug('Bits counted', { key, start, end, unit, bitCount })
    return { success: true, value: bitCount }
  }

  /**
   * BITPOS command - Return the position of the first bit set to 1 or 0
   * @param {string} key - Key to check
   * @param {number} bit - Bit value to find (0 or 1)
   * @param {number} start - Start byte index (optional)
   * @param {number} end - End byte index (optional)
   * @param {string} unit - Unit type: BYTE (default) or BIT
   * @returns {Object} Result object with bit position
   */
  bitpos(key, bit, start = null, end = null, unit = 'BYTE') {
    if (bit !== 0 && bit !== 1) {
      return { success: false, error: 'ERR The bit argument must be 1 or 0.' }
    }

    const result = this.dataStore.get(key)
    
    if (!result.success) {
      return result
    }

    if (result.value === null) {
      return { success: true, value: bit === 1 ? -1 : 0 }
    }

    // Check if the value is a string
    if (typeof result.value !== 'string') {
      return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
    }

    const str = result.value
    const len = str.length

    // Handle range parameters
    let startByte = 0
    let endByte = len - 1
    let searchStr = str

    if (start !== null || end !== null) {
      if (unit.toUpperCase() === 'BIT') {
        // BIT unit - Redis 7.0+ feature
        if (start !== null) {
          if (start < 0) startByte = Math.max(0, Math.floor((len * 8 + start) / 8))
          else startByte = Math.floor(start / 8)
        }
        if (end !== null) {
          if (end < 0) endByte = Math.max(-1, Math.floor((len * 8 + end) / 8))
          else endByte = Math.floor(end / 8)
        }
      } else {
        // BYTE unit (default)
        if (start !== null) {
          startByte = start < 0 ? Math.max(0, len + start) : start
        }
        if (end !== null) {
          endByte = end < 0 ? Math.max(-1, len + end) : end
        }
      }

      // Clamp to string bounds
      startByte = Math.max(0, Math.min(startByte, len - 1))
      endByte = Math.max(-1, Math.min(endByte, len - 1))

      if (startByte > endByte) {
        return { success: true, value: -1 }
      }

      searchStr = str.substring(startByte, endByte + 1)
    }

    // Find first occurrence of bit
    for (let i = 0; i < searchStr.length; i++) {
      const byte = searchStr.charCodeAt(i)
      for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
        const currentBit = (byte >> (7 - bitIndex)) & 1
        if (currentBit === bit) {
          const absolutePosition = (startByte + i) * 8 + bitIndex
          logger.debug('Bit position found', { key, bit, position: absolutePosition })
          return { success: true, value: absolutePosition }
        }
      }
    }

    // Bit not found
    logger.debug('Bit position not found', { key, bit })
    return { success: true, value: -1 }
  }

  /**
   * BITOP command - Perform bitwise operations between strings
   * @param {string} operation - AND, OR, XOR, NOT
   * @param {string} destKey - Destination key
   * @param {Array<string>} keys - Source keys
   * @returns {Object} Result object with result string length
   */
  bitop(operation, destKey, keys) {
    const op = operation.toUpperCase()
    if (!['AND', 'OR', 'XOR', 'NOT'].includes(op)) {
      return { success: false, error: 'ERR syntax error' }
    }

    if (!Array.isArray(keys) || keys.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments' }
    }

    if (op === 'NOT' && keys.length !== 1) {
      return { success: false, error: 'ERR BITOP NOT must be called with a single source key.' }
    }

    // Get all source strings
    const strings = []
    let maxLength = 0

    for (const key of keys) {
      const result = this.dataStore.get(key)
      if (!result.success) {
        return result
      }

      let str = ''
      if (result.value !== null) {
        if (typeof result.value !== 'string') {
          return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
        }
        str = result.value
      }
      
      strings.push(str)
      maxLength = Math.max(maxLength, str.length)
    }

    // Perform bitwise operation
    let resultBytes = new Array(maxLength).fill(0)

    if (op === 'NOT') {
      const str = strings[0]
      for (let i = 0; i < maxLength; i++) {
        const byte = i < str.length ? str.charCodeAt(i) : 0
        resultBytes[i] = (~byte) & 0xFF
      }
    } else {
      // Initialize with first string for AND/OR/XOR
      const firstStr = strings[0]
      for (let i = 0; i < maxLength; i++) {
        resultBytes[i] = i < firstStr.length ? firstStr.charCodeAt(i) : 0
      }

      // Apply operation with remaining strings
      for (let strIndex = 1; strIndex < strings.length; strIndex++) {
        const str = strings[strIndex]
        for (let i = 0; i < maxLength; i++) {
          const byte = i < str.length ? str.charCodeAt(i) : 0
          
          if (op === 'AND') {
            resultBytes[i] &= byte
          } else if (op === 'OR') {
            resultBytes[i] |= byte
          } else if (op === 'XOR') {
            resultBytes[i] ^= byte
          }
        }
      }
    }

    // Convert back to string
    const resultString = String.fromCharCode(...resultBytes)

    // Set destination key
    const setResult = this.dataStore.set(destKey, resultString)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('Bitwise operation completed', { operation: op, destKey, sourceKeys: keys, resultLength: maxLength })
    return { success: true, value: maxLength }
  }

  /**
   * BITFIELD command - Perform arbitrary bitfield integer operations on strings
   * @param {string} key - Key to operate on
   * @param {Array} operations - Array of operations [type, offset, value]
   * @returns {Object} Result object with array of results
   */
  bitfield(key, operations) {
    if (!Array.isArray(operations) || operations.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments' }
    }

    const result = this.dataStore.get(key)
    if (!result.success) {
      return result
    }

    let str = ''
    if (result.value !== null) {
      if (typeof result.value !== 'string') {
        return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
      }
      str = result.value
    }

    const results = []
    let modified = false

    for (const operation of operations) {
      const [command, ...args] = operation
      const cmd = command.toUpperCase()

      if (cmd === 'GET') {
        const [type, offset] = args
        const getResult = this._bitfieldGet(str, type, offset)
        if (!getResult.success) {
          return getResult
        }
        results.push(getResult.value)
      } else if (cmd === 'SET') {
        const [type, offset, value] = args
        const setResult = this._bitfieldSet(str, type, offset, value)
        if (!setResult.success) {
          return setResult
        }
        results.push(setResult.oldValue)
        str = setResult.newString
        modified = true
      } else if (cmd === 'INCRBY') {
        const [type, offset, increment] = args
        const incrResult = this._bitfieldIncrBy(str, type, offset, increment)
        if (!incrResult.success) {
          return incrResult
        }
        results.push(incrResult.value)
        str = incrResult.newString
        modified = true
      } else {
        return { success: false, error: `ERR unknown subcommand '${command}'` }
      }
    }

    // Save modified string back to key
    if (modified) {
      const setResult = this.dataStore.set(key, str)
      if (!setResult.success) {
        return setResult
      }
    }

    logger.debug('Bitfield operations completed', { key, operationCount: operations.length, modified })
    return { success: true, value: results }
  }

  /**
   * BITFIELD_RO command - Read-only version of BITFIELD (Redis 6.0+)
   * @param {string} key - Key to operate on  
   * @param {Array} operations - Array of GET operations
   * @returns {Object} Result object with array of results
   */
  bitfield_ro(key, operations) {
    // Validate that all operations are GET operations
    for (const operation of operations) {
      const [command] = operation
      if (command.toUpperCase() !== 'GET') {
        return { success: false, error: 'ERR BITFIELD_RO only supports GET operations' }
      }
    }

    return this.bitfield(key, operations)
  }

  /**
   * STRALGO command - Run algorithms (like LCS) on strings (Redis 7.0+)
   * @param {string} algorithm - Algorithm name (LCS)
   * @param {Array} args - Algorithm arguments
   * @returns {Object} Result object with algorithm result
   */
  stralgo(algorithm, args) {
    const algo = algorithm.toUpperCase()
    
    if (algo === 'LCS') {
      return this._lcsAlgorithm(args)
    }

    return { success: false, error: `ERR unknown algorithm '${algorithm}'` }
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

  /**
   * Helper method for BITFIELD GET operation
   * @private
   */
  _bitfieldGet(str, type, offset) {
    const typeInfo = this._parseBitfieldType(type)
    if (!typeInfo.success) {
      return typeInfo
    }

    const { signed, bits } = typeInfo
    const offsetInfo = this._parseBitfieldOffset(offset, str.length)
    if (!offsetInfo.success) {
      return offsetInfo
    }

    const bitOffset = offsetInfo.bitOffset
    const value = this._extractBits(str, bitOffset, bits, signed)
    
    return { success: true, value }
  }

  /**
   * Helper method for BITFIELD SET operation
   * @private
   */
  _bitfieldSet(str, type, offset, value) {
    const typeInfo = this._parseBitfieldType(type)
    if (!typeInfo.success) {
      return typeInfo
    }

    const { signed, bits } = typeInfo
    const offsetInfo = this._parseBitfieldOffset(offset, str.length)
    if (!offsetInfo.success) {
      return offsetInfo
    }

    // Validate value range
    const maxVal = signed ? (2**(bits-1)) - 1 : (2**bits) - 1
    const minVal = signed ? -(2**(bits-1)) : 0
    
    if (value < minVal || value > maxVal) {
      return { success: false, error: 'ERR value is out of range' }
    }

    const bitOffset = offsetInfo.bitOffset
    const oldValue = this._extractBits(str, bitOffset, bits, signed)
    const newString = this._setBits(str, bitOffset, bits, value)
    
    return { success: true, oldValue, newString }
  }

  /**
   * Helper method for BITFIELD INCRBY operation
   * @private
   */
  _bitfieldIncrBy(str, type, offset, increment) {
    const typeInfo = this._parseBitfieldType(type)
    if (!typeInfo.success) {
      return typeInfo
    }

    const { signed, bits } = typeInfo
    const offsetInfo = this._parseBitfieldOffset(offset, str.length)
    if (!offsetInfo.success) {
      return offsetInfo
    }

    const bitOffset = offsetInfo.bitOffset
    const currentValue = this._extractBits(str, bitOffset, bits, signed)
    const newValue = currentValue + increment

    // Handle overflow/underflow
    const maxVal = signed ? (2**(bits-1)) - 1 : (2**bits) - 1
    const minVal = signed ? -(2**(bits-1)) : 0
    
    let finalValue = newValue
    if (signed) {
      // Wrap around for signed integers
      while (finalValue > maxVal) finalValue -= (2**bits)
      while (finalValue < minVal) finalValue += (2**bits)
    } else {
      // Wrap around for unsigned integers
      finalValue = ((finalValue % (2**bits)) + (2**bits)) % (2**bits)
    }

    const newString = this._setBits(str, bitOffset, bits, finalValue)
    
    return { success: true, value: finalValue, newString }
  }

  /**
   * Helper method to parse bitfield type (i8, u16, etc.)
   * @private
   */
  _parseBitfieldType(type) {
    const match = type.match(/^([iu])(\d+)$/)
    if (!match) {
      return { success: false, error: 'ERR Invalid bitfield type' }
    }

    const signed = match[1] === 'i'
    const bits = parseInt(match[2], 10)

    if (bits < 1 || bits > 64) {
      return { success: false, error: 'ERR Invalid bitfield type' }
    }

    return { success: true, signed, bits }
  }

  /**
   * Helper method to parse bitfield offset
   * @private
   */
  _parseBitfieldOffset(offset, stringLength) {
    if (typeof offset === 'string' && offset.startsWith('#')) {
      // Multiply by type width - not implemented for simplicity
      return { success: false, error: 'ERR type-based offset not supported' }
    }

    const bitOffset = parseInt(offset, 10)
    if (isNaN(bitOffset) || bitOffset < 0) {
      return { success: false, error: 'ERR Invalid offset' }
    }

    return { success: true, bitOffset }
  }

  /**
   * Helper method to extract bits from string
   * @private
   */
  _extractBits(str, bitOffset, bits, signed) {
    let value = 0
    
    for (let i = 0; i < bits; i++) {
      const currentBitOffset = bitOffset + i
      const byteIndex = Math.floor(currentBitOffset / 8)
      const bitIndex = currentBitOffset % 8
      
      if (byteIndex >= str.length) {
        // Beyond string, bit is 0
        continue
      }
      
      const byte = str.charCodeAt(byteIndex)
      const bit = (byte >> (7 - bitIndex)) & 1
      
      value = (value << 1) | bit
    }
    
    // Handle signed conversion
    if (signed && bits > 0) {
      const signBit = 1 << (bits - 1)
      if (value & signBit) {
        value -= (1 << bits)
      }
    }
    
    return value
  }

  /**
   * Helper method to set bits in string
   * @private
   */
  _setBits(str, bitOffset, bits, value) {
    // Ensure string is long enough
    const maxByteIndex = Math.floor((bitOffset + bits - 1) / 8)
    while (str.length <= maxByteIndex) {
      str += '\x00'
    }
    
    let bytes = []
    for (let i = 0; i < str.length; i++) {
      bytes.push(str.charCodeAt(i))
    }
    
    // Convert value to unsigned for bit operations
    let unsignedValue = value
    if (value < 0) {
      unsignedValue = (1 << bits) + value
    }
    
    // Set each bit
    for (let i = bits - 1; i >= 0; i--) {
      const currentBitOffset = bitOffset + (bits - 1 - i)
      const byteIndex = Math.floor(currentBitOffset / 8)
      const bitIndex = currentBitOffset % 8
      
      const bit = (unsignedValue >> i) & 1
      
      if (bit === 1) {
        bytes[byteIndex] |= (1 << (7 - bitIndex))
      } else {
        bytes[byteIndex] &= ~(1 << (7 - bitIndex))
      }
    }
    
    return String.fromCharCode(...bytes)
  }

  /**
   * Helper method to implement LCS algorithm
   * @private
   */
  _lcsAlgorithm(args) {
    // Parse arguments: KEYS key1 key2 [LEN] [IDX] [MINMATCHLEN len] [WITHMATCHLEN]
    let keys = []
    let options = { len: false, idx: false, minMatchLen: 0, withMatchLen: false }
    
    let i = 0
    while (i < args.length) {
      const arg = args[i].toUpperCase()
      
      if (arg === 'KEYS') {
        if (i + 2 >= args.length) {
          return { success: false, error: 'ERR wrong number of arguments' }
        }
        keys = [args[i + 1], args[i + 2]]
        i += 3
      } else if (arg === 'LEN') {
        options.len = true
        i++
      } else if (arg === 'IDX') {
        options.idx = true
        i++
      } else if (arg === 'MINMATCHLEN') {
        if (i + 1 >= args.length) {
          return { success: false, error: 'ERR wrong number of arguments' }
        }
        options.minMatchLen = parseInt(args[i + 1], 10)
        i += 2
      } else if (arg === 'WITHMATCHLEN') {
        options.withMatchLen = true
        i++
      } else {
        return { success: false, error: `ERR unknown option '${arg}'` }
      }
    }

    if (keys.length !== 2) {
      return { success: false, error: 'ERR wrong number of arguments' }
    }

    // Get the strings
    const results = []
    for (const key of keys) {
      const result = this.get(key)
      if (!result.success) {
        return result
      }
      results.push(result.value || '')
    }

    const [str1, str2] = results
    const lcs = this._computeLCS(str1, str2, options.minMatchLen)

    if (options.len) {
      return { success: true, value: lcs.length }
    }
    
    if (options.idx) {
      const matches = this._findLCSMatches(str1, str2, lcs, options.withMatchLen)
      return { success: true, value: { matches, len: lcs.length } }
    }

    return { success: true, value: lcs }
  }

  /**
   * Helper method to compute LCS using dynamic programming
   * @private
   */
  _computeLCS(str1, str2, minMatchLen = 0) {
    const m = str1.length
    const n = str2.length
    
    // Create DP table
    const dp = Array(m + 1).fill().map(() => Array(n + 1).fill(0))
    
    // Fill DP table
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
        }
      }
    }
    
    // Backtrack to find LCS
    let lcs = ''
    let i = m, j = n
    
    while (i > 0 && j > 0) {
      if (str1[i - 1] === str2[j - 1]) {
        lcs = str1[i - 1] + lcs
        i--
        j--
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--
      } else {
        j--
      }
    }
    
    return lcs
  }

  /**
   * Helper method to find LCS matches with positions
   * @private
   */
  _findLCSMatches(str1, str2, lcs, withMatchLen) {
    // Simplified implementation - would need more complex logic for full Redis compatibility
    const matches = []
    // This is a basic implementation - full Redis LCS match finding is more complex
    return matches
  }
}

module.exports = StringOps
