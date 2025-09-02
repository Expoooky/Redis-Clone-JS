/**
 * List Operations Module
 * Implements all list-related Redis commands
 * Lists are implemented as JavaScript arrays for simplicity
 */

const logger = require('../utils/Logger')

class ListOps {
  constructor(dataStore) {
    this.dataStore = dataStore
    logger.info('ListOps module initialized')
  }

  /**
   * Ensure key holds a list, create if needed
   * @param {string} key - Key to check/create
   * @returns {Object} Result with list or error
   */
  ensureList(key) {
    const result = this.dataStore.get(key)
    
    if (!result.success) {
      return result
    }

    if (result.value === null) {
      // Key doesn't exist, will be created on first operation
      return { success: true, value: [], exists: false }
    }

    if (!Array.isArray(result.value)) {
      return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
    }

    return { success: true, value: result.value, exists: true }
  }

  /**
   * LPUSH command - Insert elements at the head of the list
   * @param {string} key - List key
   * @param {Array} elements - Elements to insert
   * @returns {Object} Result with new list length
   */
  lpush(key, elements) {
    if (!Array.isArray(elements) || elements.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments for \'lpush\' command' }
    }

    const listResult = this.ensureList(key)
    if (!listResult.success) {
      return listResult
    }

    const list = [...listResult.value]
    
    // Insert elements at the beginning (left) in forward order
    // Redis LPUSH semantics: each element is inserted at the head
    for (let i = 0; i < elements.length; i++) {
      list.unshift(elements[i].toString())
    }

    const setResult = this.dataStore.set(key, list)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('LPUSH executed', {
      key,
      elementsAdded: elements.length,
      newLength: list.length
    })

    return { success: true, value: list.length }
  }

  /**
   * RPUSH command - Insert elements at the tail of the list
   * @param {string} key - List key
   * @param {Array} elements - Elements to insert
   * @returns {Object} Result with new list length
   */
  rpush(key, elements) {
    if (!Array.isArray(elements) || elements.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments for \'rpush\' command' }
    }

    const listResult = this.ensureList(key)
    if (!listResult.success) {
      return listResult
    }

    const list = [...listResult.value]
    
    // Insert elements at the end (right)
    for (const element of elements) {
      list.push(element.toString())
    }

    const setResult = this.dataStore.set(key, list)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('RPUSH executed', {
      key,
      elementsAdded: elements.length,
      newLength: list.length
    })

    return { success: true, value: list.length }
  }

  /**
   * LPOP command - Remove and return element from the head of the list
   * @param {string} key - List key
   * @param {number} count - Number of elements to pop (default 1)
   * @returns {Object} Result with popped element(s)
   */
  lpop(key, count = 1) {
    const listResult = this.ensureList(key)
    if (!listResult.success) {
      return listResult
    }

    if (!listResult.exists || listResult.value.length === 0) {
      return { success: true, value: null }
    }

    const list = [...listResult.value]
    const poppedElements = []

    const actualCount = Math.min(count, list.length)
    for (let i = 0; i < actualCount; i++) {
      const element = list.shift()
      if (element !== undefined) {
        poppedElements.push(element)
      }
    }

    // Update or delete the key
    if (list.length === 0) {
      this.dataStore.del(key)
    } else {
      this.dataStore.set(key, list)
    }

    logger.debug('LPOP executed', {
      key,
      poppedCount: poppedElements.length,
      remainingLength: list.length
    })

    // Return single element if count was 1, array if count > 1
    return {
      success: true,
      value: count === 1 ? (poppedElements[0] || null) : poppedElements
    }
  }

  /**
   * RPOP command - Remove and return element from the tail of the list
   * @param {string} key - List key
   * @param {number} count - Number of elements to pop (default 1)
   * @returns {Object} Result with popped element(s)
   */
  rpop(key, count = 1) {
    const listResult = this.ensureList(key)
    if (!listResult.success) {
      return listResult
    }

    if (!listResult.exists || listResult.value.length === 0) {
      return { success: true, value: null }
    }

    const list = [...listResult.value]
    const poppedElements = []

    const actualCount = Math.min(count, list.length)
    for (let i = 0; i < actualCount; i++) {
      const element = list.pop()
      if (element !== undefined) {
        poppedElements.push(element)
      }
    }

    // Update or delete the key
    if (list.length === 0) {
      this.dataStore.del(key)
    } else {
      this.dataStore.set(key, list)
    }

    logger.debug('RPOP executed', {
      key,
      poppedCount: poppedElements.length,
      remainingLength: list.length
    })

    // Return single element if count was 1, array if count > 1
    return {
      success: true,
      value: count === 1 ? (poppedElements[0] || null) : poppedElements
    }
  }

  /**
   * LLEN command - Get the length of a list
   * @param {string} key - List key
   * @returns {Object} Result with list length
   */
  llen(key) {
    const listResult = this.ensureList(key)
    if (!listResult.success) {
      return listResult
    }

    return { success: true, value: listResult.exists ? listResult.value.length : 0 }
  }

  /**
   * LINDEX command - Get element at index
   * @param {string} key - List key
   * @param {number} index - Index (supports negative indices)
   * @returns {Object} Result with element or null
   */
  lindex(key, index) {
    const listResult = this.ensureList(key)
    if (!listResult.success) {
      return listResult
    }

    if (!listResult.exists || listResult.value.length === 0) {
      return { success: true, value: null }
    }

    const list = listResult.value
    const normalizedIndex = index < 0 ? list.length + index : index

    if (normalizedIndex < 0 || normalizedIndex >= list.length) {
      return { success: true, value: null }
    }

    return { success: true, value: list[normalizedIndex] }
  }

  /**
   * LSET command - Set element at index
   * @param {string} key - List key
   * @param {number} index - Index to set
   * @param {string} element - New element value
   * @returns {Object} Result
   */
  lset(key, index, element) {
    const listResult = this.ensureList(key)
    if (!listResult.success) {
      return listResult
    }

    if (!listResult.exists) {
      return { success: false, error: 'ERR no such key' }
    }

    const list = [...listResult.value]
    const normalizedIndex = index < 0 ? list.length + index : index

    if (normalizedIndex < 0 || normalizedIndex >= list.length) {
      return { success: false, error: 'ERR index out of range' }
    }

    list[normalizedIndex] = element.toString()

    const setResult = this.dataStore.set(key, list)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('LSET executed', { key, index, normalizedIndex })

    return { success: true, value: 'OK' }
  }

  /**
   * LRANGE command - Get range of elements
   * @param {string} key - List key
   * @param {number} start - Start index (inclusive)
   * @param {number} stop - Stop index (inclusive)
   * @returns {Object} Result with array of elements
   */
  lrange(key, start, stop) {
    const listResult = this.ensureList(key)
    if (!listResult.success) {
      return listResult
    }

    if (!listResult.exists || listResult.value.length === 0) {
      return { success: true, value: [] }
    }

    const list = listResult.value
    const len = list.length

    // Normalize negative indices
    let normalizedStart = start < 0 ? Math.max(0, len + start) : start
    let normalizedStop = stop < 0 ? Math.max(-1, len + stop) : stop

    // Clamp to list bounds
    normalizedStart = Math.max(0, Math.min(normalizedStart, len - 1))
    normalizedStop = Math.max(-1, Math.min(normalizedStop, len - 1))

    // Handle edge cases
    if (normalizedStart > normalizedStop || len === 0) {
      return { success: true, value: [] }
    }

    const result = list.slice(normalizedStart, normalizedStop + 1)

    logger.debug('LRANGE executed', {
      key,
      start,
      stop,
      normalizedStart,
      normalizedStop,
      resultLength: result.length
    })

    return { success: true, value: result }
  }

  /**
   * LTRIM command - Trim list to specified range
   * @param {string} key - List key
   * @param {number} start - Start index (inclusive)
   * @param {number} stop - Stop index (inclusive)
   * @returns {Object} Result
   */
  ltrim(key, start, stop) {
    const listResult = this.ensureList(key)
    if (!listResult.success) {
      return listResult
    }

    if (!listResult.exists) {
      return { success: true, value: 'OK' }
    }

    const list = listResult.value
    const len = list.length

    // Normalize negative indices
    let normalizedStart = start < 0 ? Math.max(0, len + start) : start
    let normalizedStop = stop < 0 ? Math.max(-1, len + stop) : stop

    // Clamp to list bounds
    normalizedStart = Math.max(0, Math.min(normalizedStart, len - 1))
    normalizedStop = Math.max(-1, Math.min(normalizedStop, len - 1))

    let trimmedList
    if (normalizedStart > normalizedStop || len === 0) {
      trimmedList = []
    } else {
      trimmedList = list.slice(normalizedStart, normalizedStop + 1)
    }

    // Update or delete the key
    if (trimmedList.length === 0) {
      this.dataStore.del(key)
    } else {
      this.dataStore.set(key, trimmedList)
    }

    logger.debug('LTRIM executed', {
      key,
      originalLength: len,
      newLength: trimmedList.length,
      start,
      stop
    })

    return { success: true, value: 'OK' }
  }

  /**
   * LINSERT command - Insert element before or after pivot
   * @param {string} key - List key
   * @param {string} where - 'BEFORE' or 'AFTER'
   * @param {string} pivot - Pivot element to insert relative to
   * @param {string} element - Element to insert
   * @returns {Object} Result with new list length or -1 if pivot not found
   */
  linsert(key, where, pivot, element) {
    const direction = where.toUpperCase()
    if (direction !== 'BEFORE' && direction !== 'AFTER') {
      return { success: false, error: 'ERR syntax error' }
    }

    const listResult = this.ensureList(key)
    if (!listResult.success) {
      return listResult
    }

    if (!listResult.exists || listResult.value.length === 0) {
      return { success: true, value: 0 }
    }

    const list = [...listResult.value]
    const pivotIndex = list.indexOf(pivot.toString())

    if (pivotIndex === -1) {
      return { success: true, value: -1 }
    }

    const insertIndex = direction === 'BEFORE' ? pivotIndex : pivotIndex + 1
    list.splice(insertIndex, 0, element.toString())

    const setResult = this.dataStore.set(key, list)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('LINSERT executed', {
      key,
      direction,
      pivot,
      element,
      pivotIndex,
      insertIndex,
      newLength: list.length
    })

    return { success: true, value: list.length }
  }

  /**
   * LREM command - Remove elements equal to element
   * @param {string} key - List key
   * @param {number} count - Number of elements to remove
   * @param {string} element - Element to remove
   * @returns {Object} Result with number of removed elements
   */
  lrem(key, count, element) {
    const listResult = this.ensureList(key)
    if (!listResult.success) {
      return listResult
    }

    if (!listResult.exists || listResult.value.length === 0) {
      return { success: true, value: 0 }
    }

    const list = [...listResult.value]
    const targetElement = element.toString()
    let removedCount = 0

    if (count > 0) {
      // Remove from head to tail
      for (let i = 0; i < list.length && removedCount < count; i++) {
        if (list[i] === targetElement) {
          list.splice(i, 1)
          removedCount++
          i-- // Adjust index after removal
        }
      }
    } else if (count < 0) {
      // Remove from tail to head
      const absCount = Math.abs(count)
      for (let i = list.length - 1; i >= 0 && removedCount < absCount; i--) {
        if (list[i] === targetElement) {
          list.splice(i, 1)
          removedCount++
        }
      }
    } else {
      // Remove all occurrences
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i] === targetElement) {
          list.splice(i, 1)
          removedCount++
        }
      }
    }

    // Update or delete the key
    if (list.length === 0) {
      this.dataStore.del(key)
    } else {
      this.dataStore.set(key, list)
    }

    logger.debug('LREM executed', {
      key,
      count,
      element: targetElement,
      removedCount,
      remainingLength: list.length
    })

    return { success: true, value: removedCount }
  }

  /**
   * Helper method to validate if a value is a valid list
   * @param {*} value - Value to validate
   * @returns {boolean} True if valid list
   */
  isValidList(value) {
    return Array.isArray(value)
  }

  /**
   * Helper method to convert elements to string array
   * @param {Array} elements - Elements to convert
   * @returns {Array} String array
   */
  toStringArray(elements) {
    return elements.map(el => el.toString())
  }
}

module.exports = ListOps
