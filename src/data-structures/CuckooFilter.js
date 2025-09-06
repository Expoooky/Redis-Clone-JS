/**
 * Cuckoo Filter Implementation
 * Advanced probabilistic data structure with deletion support
 * More space-efficient than Bloom filters and supports deletion
 */

const crypto = require('crypto')
const logger = require('../utils/Logger')

/**
 * Fingerprint generation and validation
 */
class Fingerprint {
  static generate(item, bits = 8) {
    const hash = crypto.createHash('sha256').update(item.toString()).digest()
    const fingerprint = hash[0] & ((1 << bits) - 1)
    return fingerprint === 0 ? 1 : fingerprint // Avoid zero fingerprint
  }

  static isValid(fingerprint, bits = 8) {
    return fingerprint > 0 && fingerprint < (1 << bits)
  }
}

/**
 * Cuckoo Filter Bucket
 */
class Bucket {
  constructor(capacity = 4) {
    this.capacity = capacity
    this.fingerprints = new Array(capacity).fill(0)
    this.size = 0
  }

  isFull() {
    return this.size >= this.capacity
  }

  isEmpty() {
    return this.size === 0
  }

  insert(fingerprint) {
    if (this.isFull()) return false
    
    for (let i = 0; i < this.capacity; i++) {
      if (this.fingerprints[i] === 0) {
        this.fingerprints[i] = fingerprint
        this.size++
        return true
      }
    }
    return false
  }

  remove(fingerprint) {
    for (let i = 0; i < this.capacity; i++) {
      if (this.fingerprints[i] === fingerprint) {
        this.fingerprints[i] = 0
        this.size--
        return true
      }
    }
    return false
  }

  contains(fingerprint) {
    return this.fingerprints.includes(fingerprint)
  }

  getRandomFingerprint() {
    if (this.isEmpty()) return 0
    
    const validIndices = []
    for (let i = 0; i < this.capacity; i++) {
      if (this.fingerprints[i] !== 0) {
        validIndices.push(i)
      }
    }
    
    if (validIndices.length === 0) return 0
    
    const randomIndex = validIndices[Math.floor(Math.random() * validIndices.length)]
    return this.fingerprints[randomIndex]
  }

  replaceFingerprint(oldFingerprint, newFingerprint) {
    for (let i = 0; i < this.capacity; i++) {
      if (this.fingerprints[i] === oldFingerprint) {
        this.fingerprints[i] = newFingerprint
        return oldFingerprint
      }
    }
    return 0
  }
}

/**
 * Cuckoo Filter implementation
 */
class CuckooFilterSketch {
  constructor(capacity = 1000000, bucketCapacity = 4, fingerprintBits = 8) {
    this.capacity = capacity
    this.bucketCapacity = bucketCapacity
    this.fingerprintBits = fingerprintBits
    this.maxKicks = 500 // Maximum number of cuckoo kicks before giving up
    
    // Calculate number of buckets
    this.numBuckets = Math.ceil(capacity / bucketCapacity)
    
    // Initialize buckets
    this.buckets = []
    for (let i = 0; i < this.numBuckets; i++) {
      this.buckets.push(new Bucket(bucketCapacity))
    }
    
    this.itemCount = 0
    this.loadFactor = 0.0
    
    logger.debug('Cuckoo filter created', {
      capacity,
      bucketCapacity,
      fingerprintBits,
      numBuckets: this.numBuckets,
      maxKicks: this.maxKicks
    })
  }

  /**
   * Hash function for bucket calculation
   */
  hash(item) {
    const hash = crypto.createHash('sha256').update(item.toString()).digest()
    let hashValue = 0
    for (let i = 0; i < 4; i++) {
      hashValue = (hashValue << 8) | hash[i]
    }
    return Math.abs(hashValue) % this.numBuckets
  }

  /**
   * Alternative bucket calculation using fingerprint
   */
  alternativeBucket(bucket, fingerprint) {
    // Use fingerprint to calculate alternative bucket
    const fp32 = fingerprint
    const hash = crypto.createHash('sha256').update(fp32.toString()).digest()
    let hashValue = 0
    for (let i = 0; i < 4; i++) {
      hashValue = (hashValue << 8) | hash[i]
    }
    return (bucket ^ Math.abs(hashValue)) % this.numBuckets
  }

  /**
   * Add an item to the filter
   */
  add(item) {
    const fingerprint = Fingerprint.generate(item, this.fingerprintBits)
    const bucket1 = this.hash(item)
    const bucket2 = this.alternativeBucket(bucket1, fingerprint)

    // Try to insert in bucket1
    if (this.buckets[bucket1].insert(fingerprint)) {
      this.itemCount++
      this.updateLoadFactor()
      return true
    }

    // Try to insert in bucket2
    if (this.buckets[bucket2].insert(fingerprint)) {
      this.itemCount++
      this.updateLoadFactor()
      return true
    }

    // Perform cuckoo eviction
    return this.cuckooEvict(bucket1, fingerprint)
  }

  /**
   * Cuckoo eviction process
   */
  cuckooEvict(startBucket, fingerprint) {
    let currentBucket = startBucket
    let currentFingerprint = fingerprint

    for (let kick = 0; kick < this.maxKicks; kick++) {
      // Get a random fingerprint from current bucket
      const victimFingerprint = this.buckets[currentBucket].getRandomFingerprint()
      
      if (victimFingerprint === 0) {
        // Bucket is empty, can insert
        if (this.buckets[currentBucket].insert(currentFingerprint)) {
          this.itemCount++
          this.updateLoadFactor()
          return true
        }
        continue
      }

      // Replace victim with current fingerprint
      this.buckets[currentBucket].replaceFingerprint(victimFingerprint, currentFingerprint)

      // Calculate alternative bucket for victim
      const alternativeBucket = this.alternativeBucket(currentBucket, victimFingerprint)

      // Try to insert victim in alternative bucket
      if (this.buckets[alternativeBucket].insert(victimFingerprint)) {
        this.itemCount++
        this.updateLoadFactor()
        return true
      }

      // Continue eviction process
      currentBucket = alternativeBucket
      currentFingerprint = victimFingerprint
    }

    // Failed to insert after maximum kicks
    logger.warn('Cuckoo filter insertion failed after maximum kicks', {
      item: fingerprint,
      kicks: this.maxKicks,
      loadFactor: this.loadFactor
    })
    
    return false
  }

  /**
   * Check if an item might be in the filter
   */
  contains(item) {
    const fingerprint = Fingerprint.generate(item, this.fingerprintBits)
    const bucket1 = this.hash(item)
    const bucket2 = this.alternativeBucket(bucket1, fingerprint)

    return this.buckets[bucket1].contains(fingerprint) || 
           this.buckets[bucket2].contains(fingerprint)
  }

  /**
   * Remove an item from the filter
   */
  remove(item) {
    const fingerprint = Fingerprint.generate(item, this.fingerprintBits)
    const bucket1 = this.hash(item)
    const bucket2 = this.alternativeBucket(bucket1, fingerprint)

    if (this.buckets[bucket1].remove(fingerprint)) {
      this.itemCount--
      this.updateLoadFactor()
      return true
    }

    if (this.buckets[bucket2].remove(fingerprint)) {
      this.itemCount--
      this.updateLoadFactor()
      return true
    }

    return false
  }

  /**
   * Update load factor
   */
  updateLoadFactor() {
    this.loadFactor = this.itemCount / this.capacity
  }

  /**
   * Get filter statistics
   */
  getStats() {
    let usedBuckets = 0
    let totalFingerprints = 0

    for (const bucket of this.buckets) {
      if (!bucket.isEmpty()) {
        usedBuckets++
      }
      totalFingerprints += bucket.size
    }

    return {
      capacity: this.capacity,
      itemCount: this.itemCount,
      loadFactor: this.loadFactor,
      numBuckets: this.numBuckets,
      usedBuckets,
      totalFingerprints,
      bucketCapacity: this.bucketCapacity,
      fingerprintBits: this.fingerprintBits,
      maxKicks: this.maxKicks
    }
  }

  /**
   * Clear all items from the filter
   */
  clear() {
    for (const bucket of this.buckets) {
      bucket.fingerprints.fill(0)
      bucket.size = 0
    }
    this.itemCount = 0
    this.loadFactor = 0.0
  }

  /**
   * Export filter data for persistence
   */
  export() {
    return {
      capacity: this.capacity,
      bucketCapacity: this.bucketCapacity,
      fingerprintBits: this.fingerprintBits,
      numBuckets: this.numBuckets,
      itemCount: this.itemCount,
      loadFactor: this.loadFactor,
      maxKicks: this.maxKicks,
      buckets: this.buckets.map(bucket => ({
        fingerprints: bucket.fingerprints,
        size: bucket.size
      }))
    }
  }

  /**
   * Import filter data from persistence
   */
  static import(data) {
    const filter = new CuckooFilterSketch(
      data.capacity,
      data.bucketCapacity,
      data.fingerprintBits
    )
    
    filter.itemCount = data.itemCount
    filter.loadFactor = data.loadFactor
    filter.maxKicks = data.maxKicks

    for (let i = 0; i < data.buckets.length; i++) {
      filter.buckets[i].fingerprints = [...data.buckets[i].fingerprints]
      filter.buckets[i].size = data.buckets[i].size
    }

    return filter
  }
}

/**
 * Cuckoo Filter Operations for Redis integration
 */
class CuckooFilterOps {
  constructor(dataStore) {
    this.dataStore = dataStore
    this.filters = new Map() // Store cuckoo filters by key
    logger.info('CuckooFilterOps module initialized')
  }

  /**
   * Get or create a cuckoo filter for a key
   */
  getFilter(key, capacity = 1000000, bucketCapacity = 4, fingerprintBits = 8) {
    if (!this.filters.has(key)) {
      const filter = new CuckooFilterSketch(capacity, bucketCapacity, fingerprintBits)
      this.filters.set(key, filter)
    }
    return this.filters.get(key)
  }

  /**
   * CF.ADD - Add an item to a cuckoo filter
   */
  cfAdd(key, item, options = {}) {
    try {
      const filter = this.getFilter(
        key,
        options.capacity,
        options.bucketCapacity,
        options.fingerprintBits
      )
      
      const added = filter.add(item)
      
      logger.debug('Cuckoo filter add operation', {
        key,
        item,
        added,
        itemCount: filter.itemCount,
        loadFactor: filter.loadFactor
      })

      return {
        success: true,
        value: added ? 1 : 0
      }
    } catch (error) {
      logger.error('Cuckoo filter add error', { key, item, error: error.message })
      return {
        success: false,
        error: `ERR ${error.message}`
      }
    }
  }

  /**
   * CF.EXISTS - Check if an item exists in a cuckoo filter
   */
  cfExists(key, item) {
    try {
      if (!this.filters.has(key)) {
        return { success: true, value: 0 }
      }

      const filter = this.filters.get(key)
      const exists = filter.contains(item)

      logger.debug('Cuckoo filter exists check', {
        key,
        item,
        exists
      })

      return {
        success: true,
        value: exists ? 1 : 0
      }
    } catch (error) {
      logger.error('Cuckoo filter exists error', { key, item, error: error.message })
      return {
        success: false,
        error: `ERR ${error.message}`
      }
    }
  }

  /**
   * CF.DEL - Delete an item from a cuckoo filter
   */
  cfDel(key, item) {
    try {
      if (!this.filters.has(key)) {
        return { success: true, value: 0 }
      }

      const filter = this.filters.get(key)
      const deleted = filter.remove(item)

      logger.debug('Cuckoo filter delete operation', {
        key,
        item,
        deleted,
        itemCount: filter.itemCount,
        loadFactor: filter.loadFactor
      })

      return {
        success: true,
        value: deleted ? 1 : 0
      }
    } catch (error) {
      logger.error('Cuckoo filter delete error', { key, item, error: error.message })
      return {
        success: false,
        error: `ERR ${error.message}`
      }
    }
  }

  /**
   * CF.COUNT - Get approximate count of items in filter
   */
  cfCount(key) {
    try {
      if (!this.filters.has(key)) {
        return { success: true, value: 0 }
      }

      const filter = this.filters.get(key)
      
      return {
        success: true,
        value: filter.itemCount
      }
    } catch (error) {
      logger.error('Cuckoo filter count error', { key, error: error.message })
      return {
        success: false,
        error: `ERR ${error.message}`
      }
    }
  }

  /**
   * CF.INFO - Get information about a cuckoo filter
   */
  cfInfo(key) {
    try {
      if (!this.filters.has(key)) {
        return {
          success: false,
          error: 'ERR no such key'
        }
      }

      const filter = this.filters.get(key)
      const stats = filter.getStats()

      return {
        success: true,
        value: [
          'Capacity', stats.capacity,
          'Size', stats.itemCount,
          'Number of buckets', stats.numBuckets,
          'Number of filters', 1,
          'Bucket size', stats.bucketCapacity,
          'Expansion rate', 2,
          'Max iterations', stats.maxKicks,
          'Load factor', stats.loadFactor.toFixed(4)
        ]
      }
    } catch (error) {
      logger.error('Cuckoo filter info error', { key, error: error.message })
      return {
        success: false,
        error: `ERR ${error.message}`
      }
    }
  }

  /**
   * CF.RESERVE - Reserve a cuckoo filter with specific parameters
   */
  cfReserve(key, capacity, bucketCapacity = 4, maxIterations = 500) {
    try {
      if (this.filters.has(key)) {
        return {
          success: false,
          error: 'ERR item exists'
        }
      }

      const filter = new CuckooFilterSketch(capacity, bucketCapacity, 8)
      filter.maxKicks = maxIterations
      this.filters.set(key, filter)

      logger.debug('Cuckoo filter reserved', {
        key,
        capacity,
        bucketCapacity,
        maxIterations
      })

      return { success: true, value: 'OK' }
    } catch (error) {
      logger.error('Cuckoo filter reserve error', { key, error: error.message })
      return {
        success: false,
        error: `ERR ${error.message}`
      }
    }
  }

  /**
   * Delete a cuckoo filter
   */
  delete(key) {
    const deleted = this.filters.delete(key)
    logger.debug('Cuckoo filter deleted', { key, deleted })
    return deleted
  }

  /**
   * Get all filter keys
   */
  keys() {
    return Array.from(this.filters.keys())
  }

  /**
   * Clear all filters
   */
  clear() {
    this.filters.clear()
    logger.debug('All cuckoo filters cleared')
  }
}

module.exports = {
  CuckooFilterSketch,
  CuckooFilterOps,
  Bucket,
  Fingerprint
}
