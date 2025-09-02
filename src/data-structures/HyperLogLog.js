/**
 * HyperLogLog Implementation
 * Probabilistic data structure for cardinality estimation
 * Provides highly memory-efficient counting of unique elements with configurable precision
 */

const crypto = require('crypto')
const logger = require('../utils/Logger')

/**
 * HyperLogLog implementation using standard algorithm
 */
class HyperLogLogSketch {
  constructor(precision = 14) {
    // Validate precision (Redis uses 14 bits = 16384 buckets)
    if (precision < 4 || precision > 16) {
      throw new Error('Precision must be between 4 and 16')
    }

    this.precision = precision
    this.bucketCount = Math.pow(2, precision) // Number of buckets (m)
    this.buckets = new Uint8Array(this.bucketCount) // Initialize to all zeros
    
    // Alpha constant for bias correction
    if (this.bucketCount >= 128) {
      this.alpha = 0.7213 / (1 + 1.079 / this.bucketCount)
    } else if (this.bucketCount >= 64) {
      this.alpha = 0.709
    } else if (this.bucketCount >= 32) {
      this.alpha = 0.697
    } else {
      this.alpha = 0.5
    }
  }

  /**
   * Hash a value using SHA-1 (Redis compatibility)
   * @param {string} value - Value to hash
   * @returns {string} 64-bit hash as binary string
   */
  hash(value) {
    const hash = crypto.createHash('sha1').update(value.toString()).digest()
    
    // Use first 8 bytes (64 bits) of SHA-1 hash
    let result = ''
    for (let i = 0; i < 8; i++) {
      result += hash[i].toString(2).padStart(8, '0')
    }
    
    return result
  }

  /**
   * Count leading zeros in binary string
   * @param {string} binaryString - Binary string
   * @returns {number} Number of leading zeros
   */
  countLeadingZeros(binaryString) {
    let count = 0
    for (let i = 0; i < binaryString.length; i++) {
      if (binaryString[i] === '0') {
        count++
      } else {
        break
      }
    }
    return count + 1 // Add 1 for HyperLogLog algorithm
  }

  /**
   * Add an element to the HyperLogLog
   * @param {string} element - Element to add
   * @returns {boolean} True if bucket was updated
   */
  add(element) {
    const hashBinary = this.hash(element)
    
    // Use first 'precision' bits to determine bucket
    const bucketIndex = parseInt(hashBinary.substring(0, this.precision), 2)
    
    // Use remaining bits to count leading zeros
    const remainingBits = hashBinary.substring(this.precision)
    const leadingZeros = this.countLeadingZeros(remainingBits)
    
    // Update bucket with maximum leading zero count
    const oldValue = this.buckets[bucketIndex]
    if (leadingZeros > oldValue) {
      this.buckets[bucketIndex] = Math.min(leadingZeros, 255) // Cap at 255 for Uint8Array
      return true
    }
    
    return false
  }

  /**
   * Estimate cardinality of the set
   * @returns {number} Estimated cardinality
   */
  cardinality() {
    // Standard HyperLogLog cardinality estimation
    let harmonicMean = 0
    let zeroCount = 0
    
    for (let i = 0; i < this.bucketCount; i++) {
      const bucketValue = this.buckets[i]
      harmonicMean += Math.pow(2, -bucketValue)
      
      if (bucketValue === 0) {
        zeroCount++
      }
    }
    
    harmonicMean = this.bucketCount / harmonicMean
    let estimate = this.alpha * this.bucketCount * harmonicMean
    
    // Apply small range correction
    if (estimate <= 2.5 * this.bucketCount) {
      if (zeroCount > 0) {
        estimate = this.bucketCount * Math.log(this.bucketCount / zeroCount)
      }
    }
    // Apply large range correction for 32-bit hash
    else if (estimate <= (1 / 30) * Math.pow(2, 32)) {
      estimate = -Math.pow(2, 32) * Math.log(1 - estimate / Math.pow(2, 32))
    }
    
    return Math.round(estimate)
  }

  /**
   * Merge another HyperLogLog into this one
   * @param {HyperLogLogSketch} other - Other HyperLogLog to merge
   * @returns {boolean} True if any buckets were updated
   */
  merge(other) {
    if (this.precision !== other.precision) {
      throw new Error('Cannot merge HyperLogLogs with different precisions')
    }
    
    let updated = false
    
    for (let i = 0; i < this.bucketCount; i++) {
      if (other.buckets[i] > this.buckets[i]) {
        this.buckets[i] = other.buckets[i]
        updated = true
      }
    }
    
    return updated
  }

  /**
   * Create a copy of this HyperLogLog
   * @returns {HyperLogLogSketch} Copy of this HyperLogLog
   */
  clone() {
    const copy = new HyperLogLogSketch(this.precision)
    copy.buckets.set(this.buckets)
    return copy
  }

  /**
   * Serialize HyperLogLog to buffer
   * @returns {Buffer} Serialized representation
   */
  serialize() {
    const buffer = Buffer.alloc(1 + this.buckets.length)
    buffer.writeUInt8(this.precision, 0)
    
    for (let i = 0; i < this.buckets.length; i++) {
      buffer.writeUInt8(this.buckets[i], i + 1)
    }
    
    return buffer
  }

  /**
   * Deserialize HyperLogLog from buffer
   * @param {Buffer} buffer - Serialized data
   * @returns {HyperLogLogSketch} Deserialized HyperLogLog
   */
  static deserialize(buffer) {
    if (buffer.length < 1) {
      throw new Error('Invalid HyperLogLog data')
    }
    
    const precision = buffer.readUInt8(0)
    const expectedLength = Math.pow(2, precision)
    
    if (buffer.length !== expectedLength + 1) {
      throw new Error('Invalid HyperLogLog data length')
    }
    
    const hll = new HyperLogLogSketch(precision)
    
    for (let i = 0; i < expectedLength; i++) {
      hll.buckets[i] = buffer.readUInt8(i + 1)
    }
    
    return hll
  }

  /**
   * Get statistics about this HyperLogLog
   * @returns {Object} Statistics
   */
  getStats() {
    let minBucket = 255
    let maxBucket = 0
    let nonZeroBuckets = 0
    
    for (let i = 0; i < this.buckets.length; i++) {
      const value = this.buckets[i]
      minBucket = Math.min(minBucket, value)
      maxBucket = Math.max(maxBucket, value)
      
      if (value > 0) {
        nonZeroBuckets++
      }
    }
    
    return {
      precision: this.precision,
      bucketCount: this.bucketCount,
      nonZeroBuckets,
      minBucket,
      maxBucket,
      density: (nonZeroBuckets / this.bucketCount) * 100,
      cardinality: this.cardinality()
    }
  }
}

/**
 * HyperLogLog Operations for Redis commands
 */
class HyperLogLogOps {
  constructor(dataStore) {
    this.dataStore = dataStore
    this.defaultPrecision = 14 // Redis default
    logger.info('HyperLogLogOps module initialized')
  }

  /**
   * Ensure key holds a HyperLogLog, create if needed
   * @param {string} key - Key to check/create
   * @returns {Object} Result with HyperLogLog or error
   */
  ensureHyperLogLog(key) {
    const result = this.dataStore.get(key)
    
    if (!result.success) {
      return result
    }

    if (result.value === null) {
      // Key doesn't exist, will be created on first operation
      return { 
        success: true, 
        value: new HyperLogLogSketch(this.defaultPrecision), 
        exists: false 
      }
    }

    if (!(result.value instanceof HyperLogLogSketch)) {
      return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
    }

    return { success: true, value: result.value, exists: true }
  }

  /**
   * PFADD command - Add elements to HyperLogLog
   * @param {string} key - HyperLogLog key
   * @param {Array} elements - Elements to add
   * @returns {Object} Result with 1 if updated, 0 if not
   */
  pfadd(key, elements) {
    if (!Array.isArray(elements) || elements.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments for \'pfadd\' command' }
    }

    const hllResult = this.ensureHyperLogLog(key)
    if (!hllResult.success) {
      return hllResult
    }

    const hll = hllResult.value
    let updated = false

    // Add each element
    for (const element of elements) {
      if (hll.add(element.toString())) {
        updated = true
      }
    }

    // Save the HyperLogLog
    const setResult = this.dataStore.set(key, hll)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('PFADD executed', {
      key,
      elementCount: elements.length,
      updated,
      estimatedCardinality: hll.cardinality()
    })

    return { success: true, value: updated ? 1 : 0 }
  }

  /**
   * PFCOUNT command - Count estimated cardinality
   * @param {Array} keys - HyperLogLog keys to count
   * @returns {Object} Result with estimated cardinality
   */
  pfcount(keys) {
    if (!Array.isArray(keys) || keys.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments for \'pfcount\' command' }
    }

    if (keys.length === 1) {
      // Single key
      const hllResult = this.ensureHyperLogLog(keys[0])
      if (!hllResult.success) {
        return hllResult
      }

      if (!hllResult.exists) {
        return { success: true, value: 0 }
      }

      const cardinality = hllResult.value.cardinality()

      logger.debug('PFCOUNT executed (single key)', {
        key: keys[0],
        cardinality
      })

      return { success: true, value: cardinality }
    } else {
      // Multiple keys - merge them temporarily
      let mergedHLL = null

      for (const key of keys) {
        const hllResult = this.ensureHyperLogLog(key)
        if (!hllResult.success) {
          return hllResult
        }

        if (hllResult.exists) {
          if (mergedHLL === null) {
            mergedHLL = hllResult.value.clone()
          } else {
            mergedHLL.merge(hllResult.value)
          }
        }
      }

      const cardinality = mergedHLL ? mergedHLL.cardinality() : 0

      logger.debug('PFCOUNT executed (multiple keys)', {
        keys,
        keyCount: keys.length,
        cardinality
      })

      return { success: true, value: cardinality }
    }
  }

  /**
   * PFMERGE command - Merge HyperLogLogs
   * @param {string} destkey - Destination key
   * @param {Array} sourcekeys - Source keys to merge
   * @returns {Object} Result
   */
  pfmerge(destkey, sourcekeys) {
    if (!Array.isArray(sourcekeys)) {
      sourcekeys = [sourcekeys]
    }

    // Get or create destination HyperLogLog
    const destResult = this.ensureHyperLogLog(destkey)
    if (!destResult.success) {
      return destResult
    }

    let mergedHLL = destResult.exists ? destResult.value.clone() : new HyperLogLogSketch(this.defaultPrecision)

    // Merge all source HyperLogLogs
    for (const sourcekey of sourcekeys) {
      if (sourcekey === destkey) {
        continue // Skip self-merge
      }

      const sourceResult = this.ensureHyperLogLog(sourcekey)
      if (!sourceResult.success) {
        return sourceResult
      }

      if (sourceResult.exists) {
        mergedHLL.merge(sourceResult.value)
      }
    }

    // Save merged result
    const setResult = this.dataStore.set(destkey, mergedHLL)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('PFMERGE executed', {
      destkey,
      sourcekeys,
      sourceCount: sourcekeys.length,
      resultCardinality: mergedHLL.cardinality()
    })

    return { success: true, value: 'OK' }
  }

  /**
   * Get HyperLogLog statistics for debugging
   * @param {string} key - HyperLogLog key
   * @returns {Object} Statistics or null
   */
  getHyperLogLogStats(key) {
    const hllResult = this.ensureHyperLogLog(key)
    if (!hllResult.success || !hllResult.exists) {
      return null
    }

    return hllResult.value.getStats()
  }

  /**
   * Helper method to validate if a value is a valid HyperLogLog
   * @param {*} value - Value to validate
   * @returns {boolean} True if valid HyperLogLog
   */
  isValidHyperLogLog(value) {
    return value instanceof HyperLogLogSketch
  }

  /**
   * Create a new HyperLogLog with custom precision
   * @param {number} precision - Precision (4-16)
   * @returns {HyperLogLogSketch} New HyperLogLog
   */
  createHyperLogLog(precision = this.defaultPrecision) {
    return new HyperLogLogSketch(precision)
  }
}

module.exports = { HyperLogLogOps, HyperLogLogSketch }
