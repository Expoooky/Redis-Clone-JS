/**
 * Sorted Set Operations Module
 * Implements all sorted set (ZSET) related Redis commands
 * Sorted sets store unique elements with scores for efficient ordered operations
 */

const logger = require('../utils/Logger')

/**
 * SortedSet data structure implementation
 * Uses a Map for element->score lookup and maintains a sorted array for range operations
 */
class SortedSet {
  constructor() {
    this.elementToScore = new Map() // element -> score mapping
    this.sortedElements = [] // [{element, score}] sorted by score then lexicographically
  }

  /**
   * Add element with score
   * @param {string} element - Element to add
   * @param {number} score - Score for the element
   * @returns {boolean} True if new element, false if updated existing
   */
  add(element, score) {
    const elementStr = element.toString()
    const isNewElement = !this.elementToScore.has(elementStr)
    
    if (!isNewElement) {
      // Remove from sorted array
      this.removeFromSorted(elementStr)
    }
    
    // Update score mapping
    this.elementToScore.set(elementStr, score)
    
    // Insert into sorted position
    this.insertSorted(elementStr, score)
    
    return isNewElement
  }

  /**
   * Remove element
   * @param {string} element - Element to remove
   * @returns {boolean} True if element existed and was removed
   */
  remove(element) {
    const elementStr = element.toString()
    
    if (!this.elementToScore.has(elementStr)) {
      return false
    }
    
    this.elementToScore.delete(elementStr)
    this.removeFromSorted(elementStr)
    
    return true
  }

  /**
   * Get score of element
   * @param {string} element - Element to get score for
   * @returns {number|null} Score or null if element doesn't exist
   */
  getScore(element) {
    const elementStr = element.toString()
    return this.elementToScore.get(elementStr) || null
  }

  /**
   * Get rank (0-based index) of element
   * @param {string} element - Element to get rank for
   * @param {boolean} reverse - If true, get reverse rank (highest score = rank 0)
   * @returns {number|null} Rank or null if element doesn't exist
   */
  getRank(element, reverse = false) {
    const elementStr = element.toString()
    
    if (!this.elementToScore.has(elementStr)) {
      return null
    }
    
    const index = this.sortedElements.findIndex(item => item.element === elementStr)
    
    if (reverse) {
      return this.sortedElements.length - 1 - index
    }
    
    return index
  }

  /**
   * Get elements by rank range
   * @param {number} start - Start rank (inclusive)
   * @param {number} stop - Stop rank (inclusive)
   * @param {boolean} reverse - If true, return in reverse order
   * @param {boolean} withScores - If true, include scores in result
   * @returns {Array} Array of elements or [element, score] pairs
   */
  getByRank(start, stop, reverse = false, withScores = false) {
    let elements = [...this.sortedElements]
    
    if (reverse) {
      elements.reverse()
    }
    
    const len = elements.length
    
    // Normalize negative indices
    let normalizedStart = start < 0 ? Math.max(0, len + start) : start
    let normalizedStop = stop < 0 ? Math.max(-1, len + stop) : stop
    
    // Clamp to valid range
    normalizedStart = Math.max(0, Math.min(normalizedStart, len - 1))
    normalizedStop = Math.max(-1, Math.min(normalizedStop, len - 1))
    
    if (normalizedStart > normalizedStop || len === 0) {
      return []
    }
    
    const result = elements.slice(normalizedStart, normalizedStop + 1)
    
    if (withScores) {
      return result.flatMap(item => [item.element, item.score.toString()])
    }
    
    return result.map(item => item.element)
  }

  /**
   * Get elements by score range
   * @param {number} min - Minimum score (inclusive)
   * @param {number} max - Maximum score (inclusive)
   * @param {boolean} withScores - If true, include scores in result
   * @param {number} offset - Number of elements to skip
   * @param {number} count - Maximum number of elements to return
   * @returns {Array} Array of elements or [element, score] pairs
   */
  getByScore(min, max, withScores = false, offset = 0, count = -1) {
    const result = []
    let skipped = 0
    let returned = 0
    
    for (const item of this.sortedElements) {
      if (item.score >= min && item.score <= max) {
        if (skipped < offset) {
          skipped++
          continue
        }
        
        if (count > 0 && returned >= count) {
          break
        }
        
        if (withScores) {
          result.push(item.element, item.score.toString())
        } else {
          result.push(item.element)
        }
        
        returned++
      }
    }
    
    return result
  }

  /**
   * Get cardinality (number of elements)
   * @returns {number} Number of elements
   */
  card() {
    return this.elementToScore.size
  }

  /**
   * Count elements in score range
   * @param {number} min - Minimum score
   * @param {number} max - Maximum score
   * @returns {number} Count of elements in range
   */
  count(min, max) {
    let count = 0
    
    for (const item of this.sortedElements) {
      if (item.score >= min && item.score <= max) {
        count++
      } else if (item.score > max) {
        break // Since sorted, no more matches
      }
    }
    
    return count
  }

  /**
   * Increment score of element
   * @param {string} element - Element to increment
   * @param {number} increment - Amount to increment by
   * @returns {number} New score
   */
  incrementBy(element, increment) {
    const elementStr = element.toString()
    const currentScore = this.elementToScore.get(elementStr) || 0
    const newScore = currentScore + increment
    
    this.add(elementStr, newScore)
    
    return newScore
  }

  /**
   * Remove elements by rank range
   * @param {number} start - Start rank (inclusive)
   * @param {number} stop - Stop rank (inclusive)
   * @returns {number} Number of removed elements
   */
  removeByRank(start, stop) {
    const elementsToRemove = this.getByRank(start, stop)
    
    for (const element of elementsToRemove) {
      this.remove(element)
    }
    
    return elementsToRemove.length
  }

  /**
   * Remove elements by score range
   * @param {number} min - Minimum score
   * @param {number} max - Maximum score
   * @returns {number} Number of removed elements
   */
  removeByScore(min, max) {
    const elementsToRemove = this.getByScore(min, max)
    
    for (const element of elementsToRemove) {
      this.remove(element)
    }
    
    return elementsToRemove.length
  }

  /**
   * Insert element in sorted position
   * @param {string} element - Element to insert
   * @param {number} score - Score of element
   */
  insertSorted(element, score) {
    const newItem = { element, score }
    
    // Binary search for insertion point
    let left = 0
    let right = this.sortedElements.length
    
    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      const midItem = this.sortedElements[mid]
      
      // Compare by score first, then lexicographically by element
      if (score < midItem.score || (score === midItem.score && element < midItem.element)) {
        right = mid
      } else {
        left = mid + 1
      }
    }
    
    this.sortedElements.splice(left, 0, newItem)
  }

  /**
   * Remove element from sorted array
   * @param {string} element - Element to remove
   */
  removeFromSorted(element) {
    const index = this.sortedElements.findIndex(item => item.element === element)
    if (index !== -1) {
      this.sortedElements.splice(index, 1)
    }
  }

  /**
   * Get all elements with scores for debugging
   * @returns {Array} Array of {element, score} objects
   */
  getAll() {
    return [...this.sortedElements]
  }
}

class SortedSetOps {
  constructor(dataStore) {
    this.dataStore = dataStore
    logger.info('SortedSetOps module initialized')
  }

  /**
   * Ensure key holds a sorted set, create if needed
   * @param {string} key - Key to check/create
   * @returns {Object} Result with sorted set or error
   */
  ensureSortedSet(key) {
    const result = this.dataStore.get(key)
    
    if (!result.success) {
      return result
    }

    if (result.value === null) {
      // Key doesn't exist, will be created on first operation
      return { success: true, value: new SortedSet(), exists: false }
    }

    if (!(result.value instanceof SortedSet)) {
      return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
    }

    return { success: true, value: result.value, exists: true }
  }

  /**
   * ZADD command - Add elements with scores to sorted set
   * @param {string} key - Sorted set key
   * @param {Array} scoreElementPairs - Array of [score, element] pairs
   * @param {Object} options - Options (NX, XX, CH, INCR)
   * @returns {Object} Result with number of added elements
   */
  zadd(key, scoreElementPairs, options = {}) {
    if (!Array.isArray(scoreElementPairs) || scoreElementPairs.length === 0 || scoreElementPairs.length % 2 !== 0) {
      return { success: false, error: 'ERR wrong number of arguments for \'zadd\' command' }
    }

    const zsetResult = this.ensureSortedSet(key)
    if (!zsetResult.success) {
      return zsetResult
    }

    const zset = zsetResult.exists ? zsetResult.value : new SortedSet()
    let addedCount = 0
    let updatedCount = 0

    // Process score-element pairs
    for (let i = 0; i < scoreElementPairs.length; i += 2) {
      const score = parseFloat(scoreElementPairs[i])
      const element = scoreElementPairs[i + 1].toString()
      
      if (isNaN(score)) {
        return { success: false, error: 'ERR value is not a valid float' }
      }

      // Handle NX and XX options
      const elementExists = zset.getScore(element) !== null
      
      if (options.nx && elementExists) {
        continue // Skip if element exists and NX is set
      }
      
      if (options.xx && !elementExists) {
        continue // Skip if element doesn't exist and XX is set
      }

      // Handle INCR option
      if (options.incr) {
        if (scoreElementPairs.length !== 2) {
          return { success: false, error: 'ERR INCR option supports a single increment-element pair' }
        }
        
        const newScore = zset.incrementBy(element, score)
        
        const setResult = this.dataStore.set(key, zset)
        if (!setResult.success) {
          return setResult
        }
        
        return { success: true, value: newScore.toString() }
      }

      // Add element
      const isNew = zset.add(element, score)
      
      if (isNew) {
        addedCount++
      } else {
        updatedCount++
      }
    }

    const setResult = this.dataStore.set(key, zset)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('ZADD executed', {
      key,
      pairsProvided: scoreElementPairs.length / 2,
      addedCount,
      updatedCount,
      totalElements: zset.card()
    })

    // Return changed count if CH option is set, otherwise return added count
    return { success: true, value: options.ch ? (addedCount + updatedCount) : addedCount }
  }

  /**
   * ZREM command - Remove elements from sorted set
   * @param {string} key - Sorted set key
   * @param {Array} elements - Elements to remove
   * @returns {Object} Result with number of removed elements
   */
  zrem(key, elements) {
    if (!Array.isArray(elements) || elements.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments for \'zrem\' command' }
    }

    const zsetResult = this.ensureSortedSet(key)
    if (!zsetResult.success) {
      return zsetResult
    }

    if (!zsetResult.exists) {
      return { success: true, value: 0 }
    }

    const zset = zsetResult.value
    let removedCount = 0

    for (const element of elements) {
      if (zset.remove(element)) {
        removedCount++
      }
    }

    // Update or delete the key
    if (zset.card() === 0) {
      this.dataStore.del(key)
    } else {
      this.dataStore.set(key, zset)
    }

    logger.debug('ZREM executed', {
      key,
      elementsProvided: elements.length,
      removedCount,
      remainingElements: zset.card()
    })

    return { success: true, value: removedCount }
  }

  /**
   * ZRANGE command - Get elements by rank range
   * @param {string} key - Sorted set key
   * @param {number} start - Start rank
   * @param {number} stop - Stop rank
   * @param {Object} options - Options (REV, WITHSCORES)
   * @returns {Object} Result with array of elements
   */
  zrange(key, start, stop, options = {}) {
    const zsetResult = this.ensureSortedSet(key)
    if (!zsetResult.success) {
      return zsetResult
    }

    if (!zsetResult.exists) {
      return { success: true, value: [] }
    }

    const elements = zsetResult.value.getByRank(start, stop, options.rev, options.withscores)

    logger.debug('ZRANGE executed', {
      key,
      start,
      stop,
      reverse: options.rev,
      withScores: options.withscores,
      resultCount: options.withscores ? elements.length / 2 : elements.length
    })

    return { success: true, value: elements }
  }

  /**
   * ZRANGEBYSCORE command - Get elements by score range
   * @param {string} key - Sorted set key
   * @param {number} min - Minimum score
   * @param {number} max - Maximum score
   * @param {Object} options - Options (WITHSCORES, LIMIT)
   * @returns {Object} Result with array of elements
   */
  zrangebyscore(key, min, max, options = {}) {
    const zsetResult = this.ensureSortedSet(key)
    if (!zsetResult.success) {
      return zsetResult
    }

    if (!zsetResult.exists) {
      return { success: true, value: [] }
    }

    const offset = options.limit ? options.limit.offset : 0
    const count = options.limit ? options.limit.count : -1

    const elements = zsetResult.value.getByScore(min, max, options.withscores, offset, count)

    logger.debug('ZRANGEBYSCORE executed', {
      key,
      min,
      max,
      withScores: options.withscores,
      offset,
      count,
      resultCount: options.withscores ? elements.length / 2 : elements.length
    })

    return { success: true, value: elements }
  }

  /**
   * ZRANK command - Get rank of element
   * @param {string} key - Sorted set key
   * @param {string} element - Element to get rank for
   * @returns {Object} Result with rank or null
   */
  zrank(key, element) {
    const zsetResult = this.ensureSortedSet(key)
    if (!zsetResult.success) {
      return zsetResult
    }

    if (!zsetResult.exists) {
      return { success: true, value: null }
    }

    const rank = zsetResult.value.getRank(element)

    logger.debug('ZRANK executed', { key, element, rank })

    return { success: true, value: rank }
  }

  /**
   * ZREVRANK command - Get reverse rank of element
   * @param {string} key - Sorted set key
   * @param {string} element - Element to get reverse rank for
   * @returns {Object} Result with reverse rank or null
   */
  zrevrank(key, element) {
    const zsetResult = this.ensureSortedSet(key)
    if (!zsetResult.success) {
      return zsetResult
    }

    if (!zsetResult.exists) {
      return { success: true, value: null }
    }

    const rank = zsetResult.value.getRank(element, true)

    logger.debug('ZREVRANK executed', { key, element, rank })

    return { success: true, value: rank }
  }

  /**
   * ZSCORE command - Get score of element
   * @param {string} key - Sorted set key
   * @param {string} element - Element to get score for
   * @returns {Object} Result with score or null
   */
  zscore(key, element) {
    const zsetResult = this.ensureSortedSet(key)
    if (!zsetResult.success) {
      return zsetResult
    }

    if (!zsetResult.exists) {
      return { success: true, value: null }
    }

    const score = zsetResult.value.getScore(element)

    logger.debug('ZSCORE executed', { key, element, score })

    return { success: true, value: score !== null ? score.toString() : null }
  }

  /**
   * ZCARD command - Get cardinality of sorted set
   * @param {string} key - Sorted set key
   * @returns {Object} Result with cardinality
   */
  zcard(key) {
    const zsetResult = this.ensureSortedSet(key)
    if (!zsetResult.success) {
      return zsetResult
    }

    const cardinality = zsetResult.exists ? zsetResult.value.card() : 0

    logger.debug('ZCARD executed', { key, cardinality })

    return { success: true, value: cardinality }
  }

  /**
   * ZINCRBY command - Increment score of element
   * @param {string} key - Sorted set key
   * @param {number} increment - Amount to increment by
   * @param {string} element - Element to increment
   * @returns {Object} Result with new score
   */
  zincrby(key, increment, element) {
    if (typeof increment !== 'number' || isNaN(increment)) {
      return { success: false, error: 'ERR value is not a valid float' }
    }

    const zsetResult = this.ensureSortedSet(key)
    if (!zsetResult.success) {
      return zsetResult
    }

    const zset = zsetResult.exists ? zsetResult.value : new SortedSet()
    const newScore = zset.incrementBy(element, increment)

    const setResult = this.dataStore.set(key, zset)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('ZINCRBY executed', {
      key,
      element,
      increment,
      newScore
    })

    return { success: true, value: newScore.toString() }
  }

  /**
   * ZREMRANGEBYRANK command - Remove elements by rank range
   * @param {string} key - Sorted set key
   * @param {number} start - Start rank
   * @param {number} stop - Stop rank
   * @returns {Object} Result with number of removed elements
   */
  zremrangebyrank(key, start, stop) {
    const zsetResult = this.ensureSortedSet(key)
    if (!zsetResult.success) {
      return zsetResult
    }

    if (!zsetResult.exists) {
      return { success: true, value: 0 }
    }

    const zset = zsetResult.value
    const removedCount = zset.removeByRank(start, stop)

    // Update or delete the key
    if (zset.card() === 0) {
      this.dataStore.del(key)
    } else {
      this.dataStore.set(key, zset)
    }

    logger.debug('ZREMRANGEBYRANK executed', {
      key,
      start,
      stop,
      removedCount,
      remainingElements: zset.card()
    })

    return { success: true, value: removedCount }
  }

  /**
   * ZREMRANGEBYSCORE command - Remove elements by score range
   * @param {string} key - Sorted set key
   * @param {number} min - Minimum score
   * @param {number} max - Maximum score
   * @returns {Object} Result with number of removed elements
   */
  zremrangebyscore(key, min, max) {
    const zsetResult = this.ensureSortedSet(key)
    if (!zsetResult.success) {
      return zsetResult
    }

    if (!zsetResult.exists) {
      return { success: true, value: 0 }
    }

    const zset = zsetResult.value
    const removedCount = zset.removeByScore(min, max)

    // Update or delete the key
    if (zset.card() === 0) {
      this.dataStore.del(key)
    } else {
      this.dataStore.set(key, zset)
    }

    logger.debug('ZREMRANGEBYSCORE executed', {
      key,
      min,
      max,
      removedCount,
      remainingElements: zset.card()
    })

    return { success: true, value: removedCount }
  }

  /**
   * Helper method to validate if a value is a valid sorted set
   * @param {*} value - Value to validate
   * @returns {boolean} True if valid sorted set
   */
  isValidSortedSet(value) {
    return value instanceof SortedSet
  }
}

module.exports = SortedSetOps
