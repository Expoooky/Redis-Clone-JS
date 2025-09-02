/**
 * Bloom Filter Implementation
 * Probabilistic data structure for efficient membership testing
 * Provides space-efficient set membership queries with configurable false positive rate
 */

const crypto = require('crypto')
const logger = require('../utils/Logger')

/**
 * Bloom Filter implementation with multiple hash functions
 */
class BloomFilterSketch {
  constructor(expectedElements = 10000, falsePositiveRate = 0.01) {
    // Validate parameters
    if (expectedElements <= 0) {
      throw new Error('Expected elements must be positive')
    }
    if (falsePositiveRate <= 0 || falsePositiveRate >= 1) {
      throw new Error('False positive rate must be between 0 and 1')
    }

    this.expectedElements = expectedElements
    this.falsePositiveRate = falsePositiveRate
    
    // Calculate optimal bit array size and number of hash functions
    this.bitSize = this.calculateOptimalBitSize(expectedElements, falsePositiveRate)
    this.hashFunctions = this.calculateOptimalHashFunctions(this.bitSize, expectedElements)
    
    // Initialize bit array (using Buffer for efficiency)
    this.byteSize = Math.ceil(this.bitSize / 8)
    this.bits = Buffer.alloc(this.byteSize, 0)
    
    // Track number of added elements
    this.addedElements = 0
    
    logger.debug('Bloom filter created', {
      expectedElements,
      falsePositiveRate,
      bitSize: this.bitSize,
      hashFunctions: this.hashFunctions,
      byteSize: this.byteSize
    })
  }

  /**
   * Calculate optimal bit array size
   * @param {number} n - Expected number of elements
   * @param {number} p - Desired false positive rate
   * @returns {number} Optimal bit array size
   */
  calculateOptimalBitSize(n, p) {
    return Math.ceil(-(n * Math.log(p)) / (Math.log(2) * Math.log(2)))
  }

  /**
   * Calculate optimal number of hash functions
   * @param {number} m - Bit array size
   * @param {number} n - Expected number of elements
   * @returns {number} Optimal number of hash functions
   */
  calculateOptimalHashFunctions(m, n) {
    return Math.max(1, Math.round((m / n) * Math.log(2)))
  }

  /**
   * Generate multiple hash values for an element
   * @param {string} element - Element to hash
   * @returns {Array} Array of hash values
   */
  hash(element) {
    const elementStr = element.toString()
    const hashes = []
    
    // Use SHA-256 and derive multiple hash values
    const baseHash = crypto.createHash('sha256').update(elementStr).digest()
    
    // Extract multiple 32-bit hash values from the 256-bit hash
    for (let i = 0; i < this.hashFunctions; i++) {
      let hashValue = 0
      
      // Use different parts of the hash for each function
      const offset = (i * 4) % (baseHash.length - 4)
      hashValue = baseHash.readUInt32BE(offset)
      
      // Apply additional mixing if we need more hash functions than bytes available
      if (i >= Math.floor(baseHash.length / 4)) {
        const seed = i * 0x9e3779b9 // Golden ratio
        hashValue ^= seed
        hashValue = ((hashValue >>> 16) ^ hashValue) * 0x45d9f3b
        hashValue = ((hashValue >>> 16) ^ hashValue) * 0x45d9f3b
        hashValue = (hashValue >>> 16) ^ hashValue
      }
      
      // Ensure positive and within bit range
      hashes.push(Math.abs(hashValue) % this.bitSize)
    }
    
    return hashes
  }

  /**
   * Add an element to the Bloom filter
   * @param {string} element - Element to add
   */
  add(element) {
    const hashValues = this.hash(element)
    
    for (const hashValue of hashValues) {
      this.setBit(hashValue)
    }
    
    this.addedElements++
  }

  /**
   * Test if an element might be in the set
   * @param {string} element - Element to test
   * @returns {boolean} True if element might be in set, false if definitely not
   */
  contains(element) {
    const hashValues = this.hash(element)
    
    for (const hashValue of hashValues) {
      if (!this.getBit(hashValue)) {
        return false // Definitely not in set
      }
    }
    
    return true // Might be in set
  }

  /**
   * Set a bit in the bit array
   * @param {number} bitIndex - Index of bit to set
   */
  setBit(bitIndex) {
    const byteIndex = Math.floor(bitIndex / 8)
    const bitOffset = bitIndex % 8
    
    this.bits[byteIndex] |= (1 << (7 - bitOffset))
  }

  /**
   * Get a bit from the bit array
   * @param {number} bitIndex - Index of bit to get
   * @returns {boolean} Bit value
   */
  getBit(bitIndex) {
    const byteIndex = Math.floor(bitIndex / 8)
    const bitOffset = bitIndex % 8
    
    return (this.bits[byteIndex] & (1 << (7 - bitOffset))) !== 0
  }

  /**
   * Get current false positive probability
   * @returns {number} Current false positive probability
   */
  getCurrentFalsePositiveRate() {
    if (this.addedElements === 0) {
      return 0
    }
    
    // Calculate actual false positive rate based on current state
    const ratio = this.addedElements / this.expectedElements
    return Math.pow(1 - Math.exp(-this.hashFunctions * ratio), this.hashFunctions)
  }

  /**
   * Get number of set bits
   * @returns {number} Number of set bits
   */
  getSetBits() {
    let count = 0
    
    for (let i = 0; i < this.byteSize; i++) {
      count += this.popcount(this.bits[i])
    }
    
    return count
  }

  /**
   * Count set bits in a byte
   * @param {number} byte - Byte value
   * @returns {number} Number of set bits
   */
  popcount(byte) {
    let count = 0
    while (byte) {
      count++
      byte &= byte - 1
    }
    return count
  }

  /**
   * Clear all bits in the filter
   */
  clear() {
    this.bits.fill(0)
    this.addedElements = 0
  }

  /**
   * Merge another Bloom filter into this one (OR operation)
   * @param {BloomFilterSketch} other - Other Bloom filter
   * @returns {boolean} True if merge was successful
   */
  merge(other) {
    // Can only merge filters with same parameters
    if (this.bitSize !== other.bitSize || this.hashFunctions !== other.hashFunctions) {
      return false
    }
    
    for (let i = 0; i < this.byteSize; i++) {
      this.bits[i] |= other.bits[i]
    }
    
    // Update element count (approximation)
    this.addedElements = Math.max(this.addedElements, other.addedElements)
    
    return true
  }

  /**
   * Create a copy of this Bloom filter
   * @returns {BloomFilterSketch} Copy of this filter
   */
  clone() {
    const copy = new BloomFilterSketch(this.expectedElements, this.falsePositiveRate)
    copy.bits = Buffer.from(this.bits)
    copy.addedElements = this.addedElements
    return copy
  }

  /**
   * Serialize Bloom filter to buffer
   * @returns {Buffer} Serialized representation
   */
  serialize() {
    const headerSize = 20 // 4 bytes each for: expected, rate(as int), bitSize, hashFunctions, addedElements
    const buffer = Buffer.alloc(headerSize + this.byteSize)
    
    let offset = 0
    buffer.writeUInt32BE(this.expectedElements, offset); offset += 4
    buffer.writeUInt32BE(Math.round(this.falsePositiveRate * 1000000), offset); offset += 4 // Store as millionths
    buffer.writeUInt32BE(this.bitSize, offset); offset += 4
    buffer.writeUInt32BE(this.hashFunctions, offset); offset += 4
    buffer.writeUInt32BE(this.addedElements, offset); offset += 4
    
    this.bits.copy(buffer, offset)
    
    return buffer
  }

  /**
   * Deserialize Bloom filter from buffer
   * @param {Buffer} buffer - Serialized data
   * @returns {BloomFilterSketch} Deserialized Bloom filter
   */
  static deserialize(buffer) {
    if (buffer.length < 20) {
      throw new Error('Invalid Bloom filter data')
    }
    
    let offset = 0
    const expectedElements = buffer.readUInt32BE(offset); offset += 4
    const falsePositiveRate = buffer.readUInt32BE(offset) / 1000000; offset += 4
    const bitSize = buffer.readUInt32BE(offset); offset += 4
    const hashFunctions = buffer.readUInt32BE(offset); offset += 4
    const addedElements = buffer.readUInt32BE(offset); offset += 4
    
    const expectedByteSize = Math.ceil(bitSize / 8)
    if (buffer.length !== 20 + expectedByteSize) {
      throw new Error('Invalid Bloom filter data length')
    }
    
    const bloomFilter = new BloomFilterSketch(expectedElements, falsePositiveRate)
    
    // Verify the calculated parameters match
    if (bloomFilter.bitSize !== bitSize || bloomFilter.hashFunctions !== hashFunctions) {
      throw new Error('Bloom filter parameter mismatch')
    }
    
    buffer.copy(bloomFilter.bits, 0, offset)
    bloomFilter.addedElements = addedElements
    
    return bloomFilter
  }

  /**
   * Get statistics about this Bloom filter
   * @returns {Object} Statistics
   */
  getStats() {
    const setBits = this.getSetBits()
    const fillRatio = setBits / this.bitSize
    
    return {
      expectedElements: this.expectedElements,
      addedElements: this.addedElements,
      targetFalsePositiveRate: this.falsePositiveRate,
      currentFalsePositiveRate: this.getCurrentFalsePositiveRate(),
      bitSize: this.bitSize,
      byteSize: this.byteSize,
      hashFunctions: this.hashFunctions,
      setBits,
      fillRatio,
      capacity: this.addedElements / this.expectedElements
    }
  }
}

/**
 * Bloom Filter Operations for custom Redis commands
 */
class BloomFilterOps {
  constructor(dataStore) {
    this.dataStore = dataStore
    logger.info('BloomFilterOps module initialized')
  }

  /**
   * Ensure key holds a Bloom filter, create if needed
   * @param {string} key - Key to check/create
   * @param {number} expectedElements - Expected number of elements (for creation)
   * @param {number} falsePositiveRate - False positive rate (for creation)
   * @returns {Object} Result with Bloom filter or error
   */
  ensureBloomFilter(key, expectedElements = 10000, falsePositiveRate = 0.01) {
    const result = this.dataStore.get(key)
    
    if (!result.success) {
      return result
    }

    if (result.value === null) {
      // Key doesn't exist, will be created on first operation
      return { 
        success: true, 
        value: new BloomFilterSketch(expectedElements, falsePositiveRate), 
        exists: false 
      }
    }

    if (!(result.value instanceof BloomFilterSketch)) {
      return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
    }

    return { success: true, value: result.value, exists: true }
  }

  /**
   * BF.ADD command - Add element to Bloom filter
   * @param {string} key - Bloom filter key
   * @param {string} element - Element to add
   * @param {Object} options - Creation options (expectedElements, falsePositiveRate)
   * @returns {Object} Result with 1 if likely new, 0 if likely existed
   */
  bfAdd(key, element, options = {}) {
    const expectedElements = options.expectedElements || 10000
    const falsePositiveRate = options.falsePositiveRate || 0.01
    
    const bfResult = this.ensureBloomFilter(key, expectedElements, falsePositiveRate)
    if (!bfResult.success) {
      return bfResult
    }

    const bloomFilter = bfResult.value
    
    // Check if element was already likely in the set
    const wasPresent = bloomFilter.contains(element.toString())
    
    // Add the element
    bloomFilter.add(element.toString())

    // Save the Bloom filter
    const setResult = this.dataStore.set(key, bloomFilter)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('BF.ADD executed', {
      key,
      element,
      wasPresent,
      addedElements: bloomFilter.addedElements
    })

    return { success: true, value: wasPresent ? 0 : 1 }
  }

  /**
   * BF.EXISTS command - Test if element exists in Bloom filter
   * @param {string} key - Bloom filter key
   * @param {string} element - Element to test
   * @returns {Object} Result with 1 if might exist, 0 if definitely doesn't exist
   */
  bfExists(key, element) {
    const bfResult = this.ensureBloomFilter(key)
    if (!bfResult.success) {
      return bfResult
    }

    if (!bfResult.exists) {
      return { success: true, value: 0 }
    }

    const exists = bfResult.value.contains(element.toString()) ? 1 : 0

    logger.debug('BF.EXISTS executed', {
      key,
      element,
      exists
    })

    return { success: true, value: exists }
  }

  /**
   * BF.MADD command - Add multiple elements to Bloom filter
   * @param {string} key - Bloom filter key
   * @param {Array} elements - Elements to add
   * @param {Object} options - Creation options
   * @returns {Object} Result with array of results for each element
   */
  bfMAdd(key, elements, options = {}) {
    if (!Array.isArray(elements) || elements.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments' }
    }

    const expectedElements = options.expectedElements || 10000
    const falsePositiveRate = options.falsePositiveRate || 0.01
    
    const bfResult = this.ensureBloomFilter(key, expectedElements, falsePositiveRate)
    if (!bfResult.success) {
      return bfResult
    }

    const bloomFilter = bfResult.value
    const results = []

    for (const element of elements) {
      const wasPresent = bloomFilter.contains(element.toString())
      bloomFilter.add(element.toString())
      results.push(wasPresent ? 0 : 1)
    }

    // Save the Bloom filter
    const setResult = this.dataStore.set(key, bloomFilter)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('BF.MADD executed', {
      key,
      elementCount: elements.length,
      addedElements: bloomFilter.addedElements
    })

    return { success: true, value: results }
  }

  /**
   * BF.MEXISTS command - Test multiple elements for existence
   * @param {string} key - Bloom filter key
   * @param {Array} elements - Elements to test
   * @returns {Object} Result with array of results for each element
   */
  bfMExists(key, elements) {
    if (!Array.isArray(elements) || elements.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments' }
    }

    const bfResult = this.ensureBloomFilter(key)
    if (!bfResult.success) {
      return bfResult
    }

    if (!bfResult.exists) {
      return { success: true, value: elements.map(() => 0) }
    }

    const results = elements.map(element => 
      bfResult.value.contains(element.toString()) ? 1 : 0
    )

    logger.debug('BF.MEXISTS executed', {
      key,
      elementCount: elements.length
    })

    return { success: true, value: results }
  }

  /**
   * BF.INFO command - Get Bloom filter information
   * @param {string} key - Bloom filter key
   * @returns {Object} Result with filter statistics
   */
  bfInfo(key) {
    const bfResult = this.ensureBloomFilter(key)
    if (!bfResult.success) {
      return bfResult
    }

    if (!bfResult.exists) {
      return { success: true, value: null }
    }

    const stats = bfResult.value.getStats()

    logger.debug('BF.INFO executed', { key })

    return { success: true, value: stats }
  }

  /**
   * Helper method to validate if a value is a valid Bloom filter
   * @param {*} value - Value to validate
   * @returns {boolean} True if valid Bloom filter
   */
  isValidBloomFilter(value) {
    return value instanceof BloomFilterSketch
  }
}

module.exports = { BloomFilterOps, BloomFilterSketch }
