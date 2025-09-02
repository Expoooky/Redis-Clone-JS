/**
 * Time Series Data Structure
 * Implements Redis-like time series functionality for storing and querying timestamped data
 * Supports retention policies, aggregation, and downsampling
 */

const logger = require('../utils/Logger')

/**
 * Time Series Sample (data point)
 */
class Sample {
  constructor(timestamp, value) {
    this.timestamp = Number(timestamp)
    this.value = Number(value)
  }

  toString() {
    return `${this.timestamp}:${this.value}`
  }
}

/**
 * Time Series Bucket for aggregation
 */
class Bucket {
  constructor(startTime, bucketSize, aggregation = 'avg') {
    this.startTime = startTime
    this.endTime = startTime + bucketSize
    this.aggregation = aggregation
    this.samples = []
    this.count = 0
    this.sum = 0
    this.min = Infinity
    this.max = -Infinity
  }

  addSample(sample) {
    if (sample.timestamp >= this.startTime && sample.timestamp < this.endTime) {
      this.samples.push(sample)
      this.count++
      this.sum += sample.value
      this.min = Math.min(this.min, sample.value)
      this.max = Math.max(this.max, sample.value)
      return true
    }
    return false
  }

  getValue() {
    if (this.count === 0) return null

    switch (this.aggregation) {
      case 'sum':
        return this.sum
      case 'avg':
        return this.sum / this.count
      case 'min':
        return this.min
      case 'max':
        return this.max
      case 'count':
        return this.count
      case 'first':
        return this.samples[0]?.value || null
      case 'last':
        return this.samples[this.samples.length - 1]?.value || null
      default:
        return this.sum / this.count // Default to average
    }
  }
}

/**
 * Time Series class
 */
class TimeSeries {
  constructor(options = {}) {
    this.samples = [] // Sorted array of samples by timestamp
    this.labels = new Map(Object.entries(options.labels || {})) // Metadata labels
    this.retentionMs = options.retentionMs || 0 // 0 = infinite retention
    this.duplicatePolicy = options.duplicatePolicy || 'last' // last, first, sum, min, max
    this.chunkSize = options.chunkSize || 4096 // Samples per chunk for efficiency
    
    // Aggregation settings
    this.bucketSize = options.bucketSize || 0 // 0 = no bucketing
    this.aggregation = options.aggregation || 'avg'
    
    logger.debug('TimeSeries created', {
      retentionMs: this.retentionMs,
      duplicatePolicy: this.duplicatePolicy,
      labels: Object.fromEntries(this.labels)
    })
  }

  /**
   * Add a sample to the time series
   * @param {number} timestamp - Unix timestamp in milliseconds
   * @param {number} value - Numeric value
   * @returns {Object} Result with success status
   */
  add(timestamp, value) {
    const sample = new Sample(timestamp, value)
    
    // Validate timestamp and value
    if (!Number.isFinite(sample.timestamp) || !Number.isFinite(sample.value)) {
      return { success: false, error: 'ERR invalid timestamp or value' }
    }

    // Handle duplicate timestamps
    const existingIndex = this.findSampleIndex(sample.timestamp)
    if (existingIndex !== -1) {
      const existingSample = this.samples[existingIndex]
      
      switch (this.duplicatePolicy) {
        case 'first':
          // Keep existing, ignore new
          return { success: true, timestamp: sample.timestamp }
        case 'last':
          // Replace with new value
          existingSample.value = sample.value
          break
        case 'sum':
          existingSample.value += sample.value
          break
        case 'min':
          existingSample.value = Math.min(existingSample.value, sample.value)
          break
        case 'max':
          existingSample.value = Math.max(existingSample.value, sample.value)
          break
        default:
          existingSample.value = sample.value
      }
      
      return { success: true, timestamp: sample.timestamp }
    }

    // Insert sample in sorted order
    const insertIndex = this.findInsertIndex(sample.timestamp)
    this.samples.splice(insertIndex, 0, sample)

    // Apply retention policy
    this.applyRetention()

    logger.debug('Sample added to time series', {
      timestamp: sample.timestamp,
      value: sample.value,
      totalSamples: this.samples.length
    })

    return { success: true, timestamp: sample.timestamp }
  }

  /**
   * Get samples in a time range
   * @param {number} fromTimestamp - Start timestamp (inclusive)
   * @param {number} toTimestamp - End timestamp (inclusive)
   * @param {Object} options - Query options
   * @returns {Array} Array of samples in range
   */
  range(fromTimestamp, toTimestamp, options = {}) {
    const startIndex = this.findFirstIndexAfter(fromTimestamp)
    const endIndex = this.findLastIndexBefore(toTimestamp)
    
    if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
      return []
    }

    let samples = this.samples.slice(startIndex, endIndex + 1)
    
    // Apply aggregation if specified
    if (options.aggregation && options.bucketSize) {
      samples = this.aggregateSamples(samples, options.bucketSize, options.aggregation)
    }

    // Apply count limit
    if (options.count && options.count > 0) {
      samples = samples.slice(0, options.count)
    }

    return samples
  }

  /**
   * Get the latest sample
   * @returns {Sample|null} Latest sample or null if empty
   */
  get() {
    if (this.samples.length === 0) {
      return null
    }
    
    return this.samples[this.samples.length - 1]
  }

  /**
   * Get information about the time series
   * @returns {Object} Time series information
   */
  info() {
    const firstSample = this.samples[0]
    const lastSample = this.samples[this.samples.length - 1]
    
    return {
      totalSamples: this.samples.length,
      memoryUsage: this.estimateMemoryUsage(),
      firstTimestamp: firstSample?.timestamp || null,
      lastTimestamp: lastSample?.timestamp || null,
      retentionMs: this.retentionMs,
      duplicatePolicy: this.duplicatePolicy,
      labels: Object.fromEntries(this.labels)
    }
  }

  /**
   * Delete samples in a time range
   * @param {number} fromTimestamp - Start timestamp (inclusive)
   * @param {number} toTimestamp - End timestamp (inclusive)
   * @returns {number} Number of deleted samples
   */
  delete(fromTimestamp, toTimestamp) {
    const startIndex = this.findFirstIndexAfter(fromTimestamp)
    const endIndex = this.findLastIndexBefore(toTimestamp)
    
    if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
      return 0
    }

    const deletedCount = endIndex - startIndex + 1
    this.samples.splice(startIndex, deletedCount)
    
    logger.debug('Samples deleted from time series', {
      fromTimestamp,
      toTimestamp,
      deletedCount,
      remainingSamples: this.samples.length
    })

    return deletedCount
  }

  /**
   * Find index of sample with exact timestamp
   * @param {number} timestamp - Timestamp to find
   * @returns {number} Index or -1 if not found
   */
  findSampleIndex(timestamp) {
    for (let i = 0; i < this.samples.length; i++) {
      if (this.samples[i].timestamp === timestamp) {
        return i
      }
      if (this.samples[i].timestamp > timestamp) {
        break
      }
    }
    return -1
  }

  /**
   * Find insertion index for timestamp (binary search)
   * @param {number} timestamp - Timestamp to insert
   * @returns {number} Insertion index
   */
  findInsertIndex(timestamp) {
    let left = 0
    let right = this.samples.length

    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      if (this.samples[mid].timestamp < timestamp) {
        left = mid + 1
      } else {
        right = mid
      }
    }

    return left
  }

  /**
   * Find first index with timestamp >= given timestamp
   * @param {number} timestamp - Target timestamp
   * @returns {number} Index or -1 if not found
   */
  findFirstIndexAfter(timestamp) {
    for (let i = 0; i < this.samples.length; i++) {
      if (this.samples[i].timestamp >= timestamp) {
        return i
      }
    }
    return -1
  }

  /**
   * Find last index with timestamp <= given timestamp
   * @param {number} timestamp - Target timestamp
   * @returns {number} Index or -1 if not found
   */
  findLastIndexBefore(timestamp) {
    for (let i = this.samples.length - 1; i >= 0; i--) {
      if (this.samples[i].timestamp <= timestamp) {
        return i
      }
    }
    return -1
  }

  /**
   * Aggregate samples into buckets
   * @param {Array} samples - Samples to aggregate
   * @param {number} bucketSize - Bucket size in milliseconds
   * @param {string} aggregation - Aggregation function
   * @returns {Array} Aggregated samples
   */
  aggregateSamples(samples, bucketSize, aggregation) {
    if (samples.length === 0) return []

    const buckets = []
    const startTime = Math.floor(samples[0].timestamp / bucketSize) * bucketSize
    const endTime = samples[samples.length - 1].timestamp

    // Create buckets
    for (let time = startTime; time <= endTime; time += bucketSize) {
      buckets.push(new Bucket(time, bucketSize, aggregation))
    }

    // Assign samples to buckets
    for (const sample of samples) {
      const bucketIndex = Math.floor((sample.timestamp - startTime) / bucketSize)
      if (bucketIndex >= 0 && bucketIndex < buckets.length) {
        buckets[bucketIndex].addSample(sample)
      }
    }

    // Convert buckets to samples
    const aggregatedSamples = []
    for (const bucket of buckets) {
      const value = bucket.getValue()
      if (value !== null) {
        aggregatedSamples.push(new Sample(bucket.startTime, value))
      }
    }

    return aggregatedSamples
  }

  /**
   * Apply retention policy
   */
  applyRetention() {
    if (this.retentionMs <= 0) return

    const cutoffTime = Date.now() - this.retentionMs
    let removeCount = 0

    for (let i = 0; i < this.samples.length; i++) {
      if (this.samples[i].timestamp >= cutoffTime) {
        break
      }
      removeCount++
    }

    if (removeCount > 0) {
      this.samples.splice(0, removeCount)
      logger.debug('Applied retention policy', {
        removedSamples: removeCount,
        remainingSamples: this.samples.length,
        cutoffTime
      })
    }
  }

  /**
   * Estimate memory usage
   * @returns {number} Estimated memory usage in bytes
   */
  estimateMemoryUsage() {
    const sampleSize = 16 // 8 bytes for timestamp + 8 bytes for value
    const labelSize = Array.from(this.labels.entries()).reduce((size, [key, value]) => {
      return size + key.length * 2 + value.length * 2 // UTF-16 encoding
    }, 0)
    
    return this.samples.length * sampleSize + labelSize + 128 // Base overhead
  }
}

/**
 * Time Series Operations
 */
class TimeSeriesOps {
  constructor(dataStore) {
    this.dataStore = dataStore
    this.defaultRetentionMs = 24 * 60 * 60 * 1000 // 24 hours default
    logger.info('TimeSeriesOps module initialized')
  }

  /**
   * Ensure key holds a time series
   * @param {string} key - Key to check/create
   * @param {Object} options - Creation options
   * @returns {Object} Result with time series or error
   */
  ensureTimeSeries(key, options = {}) {
    const result = this.dataStore.get(key)
    
    if (!result.success) {
      return result
    }

    if (result.value === null) {
      // Key doesn't exist, will be created on first operation
      return { 
        success: true, 
        value: new TimeSeries(options), 
        exists: false 
      }
    }

    if (!(result.value instanceof TimeSeries)) {
      return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
    }

    return { success: true, value: result.value, exists: true }
  }

  /**
   * TS.CREATE command - Create a time series
   * @param {string} key - Time series key
   * @param {Object} options - Creation options
   * @returns {Object} Result with success status
   */
  tsCreate(key, options = {}) {
    const tsResult = this.ensureTimeSeries(key, options)
    if (!tsResult.success) {
      return tsResult
    }

    if (tsResult.exists) {
      return { success: false, error: 'ERR key already exists' }
    }

    const setResult = this.dataStore.set(key, tsResult.value)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('TS.CREATE executed', { key, options })
    return { success: true, value: 'OK' }
  }

  /**
   * TS.ADD command - Add a sample to time series
   * @param {string} key - Time series key
   * @param {number} timestamp - Unix timestamp in milliseconds
   * @param {number} value - Numeric value
   * @param {Object} options - Add options
   * @returns {Object} Result with timestamp
   */
  tsAdd(key, timestamp, value, options = {}) {
    // Use current time if timestamp is '*'
    if (timestamp === '*') {
      timestamp = Date.now()
    } else {
      timestamp = Number(timestamp)
    }

    const tsResult = this.ensureTimeSeries(key, options)
    if (!tsResult.success) {
      return tsResult
    }

    const timeSeries = tsResult.value
    const addResult = timeSeries.add(timestamp, value)
    
    if (!addResult.success) {
      return addResult
    }

    // Save the time series
    const setResult = this.dataStore.set(key, timeSeries)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('TS.ADD executed', { key, timestamp, value })
    return { success: true, value: addResult.timestamp }
  }

  /**
   * TS.RANGE command - Get samples in time range
   * @param {string} key - Time series key
   * @param {number|string} fromTimestamp - Start timestamp or '-'
   * @param {number|string} toTimestamp - End timestamp or '+'
   * @param {Object} options - Query options
   * @returns {Object} Result with samples array
   */
  tsRange(key, fromTimestamp, toTimestamp, options = {}) {
    const tsResult = this.ensureTimeSeries(key)
    if (!tsResult.success) {
      return tsResult
    }

    if (!tsResult.exists) {
      return { success: true, value: [] }
    }

    // Handle special timestamp values
    const timeSeries = tsResult.value
    const samples = timeSeries.samples
    
    let from = fromTimestamp === '-' ? (samples[0]?.timestamp || 0) : Number(fromTimestamp)
    let to = toTimestamp === '+' ? (samples[samples.length - 1]?.timestamp || Date.now()) : Number(toTimestamp)

    const result = timeSeries.range(from, to, options)
    
    // Format as [timestamp, value] pairs
    const formattedResult = result.map(sample => [sample.timestamp, sample.value])

    logger.debug('TS.RANGE executed', { 
      key, 
      from, 
      to, 
      resultCount: formattedResult.length 
    })

    return { success: true, value: formattedResult }
  }

  /**
   * TS.GET command - Get latest sample
   * @param {string} key - Time series key
   * @returns {Object} Result with latest sample
   */
  tsGet(key) {
    const tsResult = this.ensureTimeSeries(key)
    if (!tsResult.success) {
      return tsResult
    }

    if (!tsResult.exists) {
      return { success: false, error: 'ERR key does not exist' }
    }

    const latestSample = tsResult.value.get()
    const result = latestSample ? [latestSample.timestamp, latestSample.value] : null

    logger.debug('TS.GET executed', { key, result })
    return { success: true, value: result }
  }

  /**
   * TS.MGET command - Get latest samples from multiple time series
   * @param {Array} keys - Array of time series keys
   * @param {Object} options - Query options (filters)
   * @returns {Object} Result with array of latest samples
   */
  tsMGet(keys, options = {}) {
    if (!Array.isArray(keys) || keys.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments' }
    }

    const results = []

    for (const key of keys) {
      const getResult = this.tsGet(key)
      if (getResult.success) {
        results.push([key, getResult.value])
      } else {
        results.push([key, null])
      }
    }

    logger.debug('TS.MGET executed', { keyCount: keys.length })
    return { success: true, value: results }
  }

  /**
   * TS.MRANGE command - Get ranges from multiple time series
   * @param {number|string} fromTimestamp - Start timestamp
   * @param {number|string} toTimestamp - End timestamp
   * @param {Array} keys - Array of time series keys
   * @param {Object} options - Query options
   * @returns {Object} Result with array of time series ranges
   */
  tsMRange(fromTimestamp, toTimestamp, keys, options = {}) {
    if (!Array.isArray(keys) || keys.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments' }
    }

    const results = []

    for (const key of keys) {
      const rangeResult = this.tsRange(key, fromTimestamp, toTimestamp, options)
      if (rangeResult.success) {
        results.push([key, rangeResult.value])
      } else {
        results.push([key, []])
      }
    }

    logger.debug('TS.MRANGE executed', { 
      from: fromTimestamp, 
      to: toTimestamp, 
      keyCount: keys.length 
    })

    return { success: true, value: results }
  }

  /**
   * TS.INFO command - Get time series information
   * @param {string} key - Time series key
   * @returns {Object} Result with time series information
   */
  tsInfo(key) {
    const tsResult = this.ensureTimeSeries(key)
    if (!tsResult.success) {
      return tsResult
    }

    if (!tsResult.exists) {
      return { success: false, error: 'ERR key does not exist' }
    }

    const info = tsResult.value.info()
    
    // Format as array for Redis compatibility
    const result = [
      'totalSamples', info.totalSamples,
      'memoryUsage', info.memoryUsage,
      'firstTimestamp', info.firstTimestamp,
      'lastTimestamp', info.lastTimestamp,
      'retentionTime', info.retentionMs,
      'duplicatePolicy', info.duplicatePolicy,
      'labels', Object.entries(info.labels).flat()
    ]

    logger.debug('TS.INFO executed', { key })
    return { success: true, value: result }
  }

  /**
   * TS.DEL command - Delete samples in time range
   * @param {string} key - Time series key
   * @param {number} fromTimestamp - Start timestamp
   * @param {number} toTimestamp - End timestamp
   * @returns {Object} Result with number of deleted samples
   */
  tsDel(key, fromTimestamp, toTimestamp) {
    const tsResult = this.ensureTimeSeries(key)
    if (!tsResult.success) {
      return tsResult
    }

    if (!tsResult.exists) {
      return { success: true, value: 0 }
    }

    const timeSeries = tsResult.value
    const deletedCount = timeSeries.delete(fromTimestamp, toTimestamp)

    // Save the modified time series
    const setResult = this.dataStore.set(key, timeSeries)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('TS.DEL executed', { key, fromTimestamp, toTimestamp, deletedCount })
    return { success: true, value: deletedCount }
  }

  /**
   * Helper method to validate if a value is a valid time series
   * @param {*} value - Value to validate
   * @returns {boolean} True if valid time series
   */
  isValidTimeSeries(value) {
    return value instanceof TimeSeries
  }
}

module.exports = { TimeSeriesOps, TimeSeries, Sample }
