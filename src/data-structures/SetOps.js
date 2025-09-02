/**
 * Set Operations Module
 * Implements all set-related Redis commands
 * Sets are implemented as JavaScript Set objects for O(1) operations
 */

const logger = require('../utils/Logger')

class SetOps {
  constructor(dataStore) {
    this.dataStore = dataStore
    logger.info('SetOps module initialized')
  }

  /**
   * Ensure key holds a set, create if needed
   * @param {string} key - Key to check/create
   * @returns {Object} Result with set or error
   */
  ensureSet(key) {
    const result = this.dataStore.get(key)
    
    if (!result.success) {
      return result
    }

    if (result.value === null) {
      // Key doesn't exist, will be created on first operation
      return { success: true, value: new Set(), exists: false }
    }

    if (!(result.value instanceof Set)) {
      return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
    }

    return { success: true, value: result.value, exists: true }
  }

  /**
   * SADD command - Add members to set
   * @param {string} key - Set key
   * @param {Array} members - Members to add
   * @returns {Object} Result with number of added members
   */
  sadd(key, members) {
    if (!Array.isArray(members) || members.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments for \'sadd\' command' }
    }

    const setResult = this.ensureSet(key)
    if (!setResult.success) {
      return setResult
    }

    const set = new Set(setResult.value)
    let addedCount = 0

    for (const member of members) {
      const memberStr = member.toString()
      if (!set.has(memberStr)) {
        set.add(memberStr)
        addedCount++
      }
    }

    const saveResult = this.dataStore.set(key, set)
    if (!saveResult.success) {
      return saveResult
    }

    logger.debug('SADD executed', {
      key,
      membersProvided: members.length,
      addedCount,
      setSize: set.size
    })

    return { success: true, value: addedCount }
  }

  /**
   * SREM command - Remove members from set
   * @param {string} key - Set key
   * @param {Array} members - Members to remove
   * @returns {Object} Result with number of removed members
   */
  srem(key, members) {
    if (!Array.isArray(members) || members.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments for \'srem\' command' }
    }

    const setResult = this.ensureSet(key)
    if (!setResult.success) {
      return setResult
    }

    if (!setResult.exists) {
      return { success: true, value: 0 }
    }

    const set = new Set(setResult.value)
    let removedCount = 0

    for (const member of members) {
      const memberStr = member.toString()
      if (set.has(memberStr)) {
        set.delete(memberStr)
        removedCount++
      }
    }

    // Update or delete the key
    if (set.size === 0) {
      this.dataStore.del(key)
    } else {
      this.dataStore.set(key, set)
    }

    logger.debug('SREM executed', {
      key,
      membersProvided: members.length,
      removedCount,
      remainingSize: set.size
    })

    return { success: true, value: removedCount }
  }

  /**
   * SISMEMBER command - Check if member exists in set
   * @param {string} key - Set key
   * @param {string} member - Member to check
   * @returns {Object} Result with 1 if exists, 0 if not
   */
  sismember(key, member) {
    const setResult = this.ensureSet(key)
    if (!setResult.success) {
      return setResult
    }

    if (!setResult.exists) {
      return { success: true, value: 0 }
    }

    const memberStr = member.toString()
    const exists = setResult.value.has(memberStr) ? 1 : 0

    logger.debug('SISMEMBER executed', { key, member: memberStr, exists })

    return { success: true, value: exists }
  }

  /**
   * SMEMBERS command - Get all members of set
   * @param {string} key - Set key
   * @returns {Object} Result with array of members
   */
  smembers(key) {
    const setResult = this.ensureSet(key)
    if (!setResult.success) {
      return setResult
    }

    if (!setResult.exists) {
      return { success: true, value: [] }
    }

    const members = Array.from(setResult.value)

    logger.debug('SMEMBERS executed', { key, memberCount: members.length })

    return { success: true, value: members }
  }

  /**
   * SCARD command - Get cardinality (size) of set
   * @param {string} key - Set key
   * @returns {Object} Result with set size
   */
  scard(key) {
    const setResult = this.ensureSet(key)
    if (!setResult.success) {
      return setResult
    }

    const size = setResult.exists ? setResult.value.size : 0

    logger.debug('SCARD executed', { key, size })

    return { success: true, value: size }
  }

  /**
   * SRANDMEMBER command - Get random member(s) from set
   * @param {string} key - Set key
   * @param {number} count - Number of members to return (optional)
   * @returns {Object} Result with random member(s)
   */
  srandmember(key, count = 1) {
    const setResult = this.ensureSet(key)
    if (!setResult.success) {
      return setResult
    }

    if (!setResult.exists || setResult.value.size === 0) {
      return { success: true, value: count === 1 ? null : [] }
    }

    const members = Array.from(setResult.value)
    const results = []

    if (count === 1) {
      // Return single random member
      const randomIndex = Math.floor(Math.random() * members.length)
      return { success: true, value: members[randomIndex] }
    }

    const absCount = Math.abs(count)
    const allowRepeats = count < 0

    if (allowRepeats) {
      // Allow repetitions
      for (let i = 0; i < absCount; i++) {
        const randomIndex = Math.floor(Math.random() * members.length)
        results.push(members[randomIndex])
      }
    } else {
      // No repetitions
      const shuffled = [...members]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      results.push(...shuffled.slice(0, Math.min(absCount, shuffled.length)))
    }

    logger.debug('SRANDMEMBER executed', {
      key,
      count,
      returnedCount: results.length,
      allowRepeats
    })

    return { success: true, value: results }
  }

  /**
   * SINTER command - Get intersection of multiple sets
   * @param {Array} keys - Array of set keys
   * @returns {Object} Result with intersection
   */
  sinter(keys) {
    if (!Array.isArray(keys) || keys.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments for \'sinter\' command' }
    }

    // Get all sets
    const sets = []
    for (const key of keys) {
      const setResult = this.ensureSet(key)
      if (!setResult.success) {
        return setResult
      }
      
      if (!setResult.exists) {
        // If any set doesn't exist, intersection is empty
        return { success: true, value: [] }
      }
      
      sets.push(setResult.value)
    }

    // Find intersection
    let intersection = new Set(sets[0])
    for (let i = 1; i < sets.length; i++) {
      const currentSet = sets[i]
      intersection = new Set([...intersection].filter(member => currentSet.has(member)))
    }

    const result = Array.from(intersection)

    logger.debug('SINTER executed', {
      keys,
      setCount: sets.length,
      intersectionSize: result.length
    })

    return { success: true, value: result }
  }

  /**
   * SUNION command - Get union of multiple sets
   * @param {Array} keys - Array of set keys
   * @returns {Object} Result with union
   */
  sunion(keys) {
    if (!Array.isArray(keys) || keys.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments for \'sunion\' command' }
    }

    const union = new Set()

    for (const key of keys) {
      const setResult = this.ensureSet(key)
      if (!setResult.success) {
        return setResult
      }
      
      if (setResult.exists) {
        for (const member of setResult.value) {
          union.add(member)
        }
      }
    }

    const result = Array.from(union)

    logger.debug('SUNION executed', {
      keys,
      setCount: keys.length,
      unionSize: result.length
    })

    return { success: true, value: result }
  }

  /**
   * SDIFF command - Get difference of multiple sets (first set minus others)
   * @param {Array} keys - Array of set keys
   * @returns {Object} Result with difference
   */
  sdiff(keys) {
    if (!Array.isArray(keys) || keys.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments for \'sdiff\' command' }
    }

    // Get first set
    const firstSetResult = this.ensureSet(keys[0])
    if (!firstSetResult.success) {
      return firstSetResult
    }

    if (!firstSetResult.exists) {
      return { success: true, value: [] }
    }

    let difference = new Set(firstSetResult.value)

    // Subtract all other sets
    for (let i = 1; i < keys.length; i++) {
      const setResult = this.ensureSet(keys[i])
      if (!setResult.success) {
        return setResult
      }
      
      if (setResult.exists) {
        for (const member of setResult.value) {
          difference.delete(member)
        }
      }
    }

    const result = Array.from(difference)

    logger.debug('SDIFF executed', {
      keys,
      setCount: keys.length,
      differenceSize: result.length
    })

    return { success: true, value: result }
  }

  /**
   * SINTERSTORE command - Store intersection in destination key
   * @param {string} destination - Destination key
   * @param {Array} keys - Array of set keys
   * @returns {Object} Result with size of intersection
   */
  sinterstore(destination, keys) {
    const intersectionResult = this.sinter(keys)
    if (!intersectionResult.success) {
      return intersectionResult
    }

    const intersectionSet = new Set(intersectionResult.value)
    
    if (intersectionSet.size === 0) {
      this.dataStore.del(destination)
    } else {
      const setResult = this.dataStore.set(destination, intersectionSet)
      if (!setResult.success) {
        return setResult
      }
    }

    logger.debug('SINTERSTORE executed', {
      destination,
      keys,
      resultSize: intersectionSet.size
    })

    return { success: true, value: intersectionSet.size }
  }

  /**
   * SUNIONSTORE command - Store union in destination key
   * @param {string} destination - Destination key
   * @param {Array} keys - Array of set keys
   * @returns {Object} Result with size of union
   */
  sunionstore(destination, keys) {
    const unionResult = this.sunion(keys)
    if (!unionResult.success) {
      return unionResult
    }

    const unionSet = new Set(unionResult.value)
    
    if (unionSet.size === 0) {
      this.dataStore.del(destination)
    } else {
      const setResult = this.dataStore.set(destination, unionSet)
      if (!setResult.success) {
        return setResult
      }
    }

    logger.debug('SUNIONSTORE executed', {
      destination,
      keys,
      resultSize: unionSet.size
    })

    return { success: true, value: unionSet.size }
  }

  /**
   * SDIFFSTORE command - Store difference in destination key
   * @param {string} destination - Destination key
   * @param {Array} keys - Array of set keys
   * @returns {Object} Result with size of difference
   */
  sdiffstore(destination, keys) {
    const diffResult = this.sdiff(keys)
    if (!diffResult.success) {
      return diffResult
    }

    const diffSet = new Set(diffResult.value)
    
    if (diffSet.size === 0) {
      this.dataStore.del(destination)
    } else {
      const setResult = this.dataStore.set(destination, diffSet)
      if (!setResult.success) {
        return setResult
      }
    }

    logger.debug('SDIFFSTORE executed', {
      destination,
      keys,
      resultSize: diffSet.size
    })

    return { success: true, value: diffSet.size }
  }

  /**
   * Helper method to validate if a value is a valid set
   * @param {*} value - Value to validate
   * @returns {boolean} True if valid set
   */
  isValidSet(value) {
    return value instanceof Set
  }

  /**
   * Helper method to convert array to set with string values
   * @param {Array} array - Array to convert
   * @returns {Set} Set with string values
   */
  arrayToStringSet(array) {
    return new Set(array.map(item => item.toString()))
  }
}

module.exports = SetOps
