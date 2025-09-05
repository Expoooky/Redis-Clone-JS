/**
 * Metrics.js - Real-time metrics collection and aggregation module
 * 
 * This module provides comprehensive metrics collection, aggregation,
 * and reporting capabilities for monitoring system performance.
 */

const EventEmitter = require('events')
const logger = require('../utils/Logger')

/**
 * Real-time metrics collector and aggregator
 */
class Metrics extends EventEmitter {
  constructor(options = {}) {
    super()
    
    this.enabled = options.enabled !== false
    this.collectionInterval = options.collectionInterval || 1000 // 1 second
    this.retentionPeriod = options.retentionPeriod || 3600000 // 1 hour in milliseconds
    this.maxDataPoints = options.maxDataPoints || 3600 // Max data points to store
    
    // Metrics storage
    this.metrics = {
      counters: new Map(),
      gauges: new Map(),
      histograms: new Map(),
      timers: new Map(),
      sets: new Map()
    }
    
    // Time-series data storage
    this.timeSeries = new Map()
    
    // Active collection timer
    this.collectionTimer = null
    
    // Performance tracking
    this.startTime = Date.now()
    
    logger.info('Metrics system initialized', {
      enabled: this.enabled,
      collectionInterval: this.collectionInterval,
      retentionPeriod: this.retentionPeriod,
      component: 'Metrics'
    })
    
    if (this.enabled) {
      this.start()
    }
  }

  /**
   * Start metrics collection
   */
  start() {
    if (this.collectionTimer) {
      return
    }
    
    this.collectionTimer = setInterval(() => {
      this.collect()
    }, this.collectionInterval)
    
    this.emit('started')
    logger.info('Metrics collection started', { component: 'Metrics' })
  }

  /**
   * Stop metrics collection
   */
  stop() {
    if (this.collectionTimer) {
      clearInterval(this.collectionTimer)
      this.collectionTimer = null
    }
    
    this.emit('stopped')
    logger.info('Metrics collection stopped', { component: 'Metrics' })
  }

  /**
   * Increment a counter
   */
  increment(name, value = 1, tags = {}) {
    if (!this.enabled) return
    
    const key = this.buildKey(name, tags)
    const current = this.metrics.counters.get(key) || 0
    this.metrics.counters.set(key, current + value)
    
    this.emit('counter', { name, value, tags, total: current + value })
  }

  /**
   * Decrement a counter
   */
  decrement(name, value = 1, tags = {}) {
    this.increment(name, -value, tags)
  }

  /**
   * Set a gauge value
   */
  gauge(name, value, tags = {}) {
    if (!this.enabled) return
    
    const key = this.buildKey(name, tags)
    this.metrics.gauges.set(key, {
      value,
      timestamp: Date.now()
    })
    
    this.emit('gauge', { name, value, tags })
  }

  /**
   * Record a timing measurement
   */
  timing(name, duration, tags = {}) {
    if (!this.enabled) return
    
    const key = this.buildKey(name, tags)
    
    if (!this.metrics.timers.has(key)) {
      this.metrics.timers.set(key, {
        count: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity,
        values: []
      })
    }
    
    const timer = this.metrics.timers.get(key)
    timer.count++
    timer.sum += duration
    timer.min = Math.min(timer.min, duration)
    timer.max = Math.max(timer.max, duration)
    timer.values.push(duration)
    
    // Keep only recent values for percentile calculation
    if (timer.values.length > 1000) {
      timer.values = timer.values.slice(-500)
    }
    
    this.emit('timing', { name, duration, tags })
  }

  /**
   * Record histogram data
   */
  histogram(name, value, tags = {}) {
    if (!this.enabled) return
    
    const key = this.buildKey(name, tags)
    
    if (!this.metrics.histograms.has(key)) {
      this.metrics.histograms.set(key, {
        count: 0,
        sum: 0,
        buckets: new Map()
      })
    }
    
    const hist = this.metrics.histograms.get(key)
    hist.count++
    hist.sum += value
    
    // Update buckets
    const buckets = [0.1, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
    
    for (const bucket of buckets) {
      if (value <= bucket) {
        const current = hist.buckets.get(bucket) || 0
        hist.buckets.set(bucket, current + 1)
      }
    }
    
    this.emit('histogram', { name, value, tags })
  }

  /**
   * Add value to a set (for counting unique values)
   */
  set(name, value, tags = {}) {
    if (!this.enabled) return
    
    const key = this.buildKey(name, tags)
    
    if (!this.metrics.sets.has(key)) {
      this.metrics.sets.set(key, new Set())
    }
    
    this.metrics.sets.get(key).add(value)
    
    this.emit('set', { name, value, tags })
  }

  /**
   * Create a timer function for measuring execution time
   */
  timer(name, tags = {}) {
    const start = process.hrtime.bigint()
    
    return () => {
      const end = process.hrtime.bigint()
      const duration = Number(end - start) / 1000000 // Convert to milliseconds
      this.timing(name, duration, tags)
      return duration
    }
  }

  /**
   * Measure function execution time
   */
  measure(name, fn, tags = {}) {
    const timer = this.timer(name, tags)
    
    try {
      const result = fn()
      
      // Handle promises
      if (result && typeof result.then === 'function') {
        return result.finally(() => timer())
      }
      
      timer()
      return result
    } catch (error) {
      timer()
      throw error
    }
  }

  /**
   * Collect current metrics snapshot
   */
  collect() {
    const timestamp = Date.now()
    const snapshot = {
      timestamp,
      counters: this.serializeCounters(),
      gauges: this.serializeGauges(),
      timers: this.serializeTimers(),
      histograms: this.serializeHistograms(),
      sets: this.serializeSets(),
      system: this.collectSystemMetrics()
    }
    
    // Store in time series
    this.storeTimeSeries('snapshot', snapshot)
    
    // Clean up old data
    this.cleanupOldData()
    
    this.emit('collected', snapshot)
    
    return snapshot
  }

  /**
   * Serialize counters for snapshot
   */
  serializeCounters() {
    const result = {}
    for (const [key, value] of this.metrics.counters.entries()) {
      result[key] = value
    }
    return result
  }

  /**
   * Serialize gauges for snapshot
   */
  serializeGauges() {
    const result = {}
    for (const [key, data] of this.metrics.gauges.entries()) {
      result[key] = data.value
    }
    return result
  }

  /**
   * Serialize timers for snapshot
   */
  serializeTimers() {
    const result = {}
    for (const [key, timer] of this.metrics.timers.entries()) {
      if (timer.count > 0) {
        const values = [...timer.values].sort((a, b) => a - b)
        result[key] = {
          count: timer.count,
          sum: timer.sum,
          mean: timer.sum / timer.count,
          min: timer.min,
          max: timer.max,
          p50: this.percentile(values, 0.5),
          p90: this.percentile(values, 0.9),
          p95: this.percentile(values, 0.95),
          p99: this.percentile(values, 0.99)
        }
      }
    }
    return result
  }

  /**
   * Serialize histograms for snapshot
   */
  serializeHistograms() {
    const result = {}
    for (const [key, hist] of this.metrics.histograms.entries()) {
      if (hist.count > 0) {
        const buckets = {}
        for (const [bucket, count] of hist.buckets.entries()) {
          buckets[bucket] = count
        }
        
        result[key] = {
          count: hist.count,
          sum: hist.sum,
          mean: hist.sum / hist.count,
          buckets
        }
      }
    }
    return result
  }

  /**
   * Serialize sets for snapshot
   */
  serializeSets() {
    const result = {}
    for (const [key, set] of this.metrics.sets.entries()) {
      result[key] = set.size
    }
    return result
  }

  /**
   * Collect system metrics
   */
  collectSystemMetrics() {
    const memUsage = process.memoryUsage()
    const cpuUsage = process.cpuUsage()
    
    return {
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
        arrayBuffers: memUsage.arrayBuffers
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      uptime: process.uptime(),
      loadavg: require('os').loadavg()
    }
  }

  /**
   * Calculate percentile
   */
  percentile(values, p) {
    if (values.length === 0) return 0
    
    const index = Math.ceil(values.length * p) - 1
    return values[Math.max(0, Math.min(index, values.length - 1))]
  }

  /**
   * Store time series data
   */
  storeTimeSeries(name, data) {
    if (!this.timeSeries.has(name)) {
      this.timeSeries.set(name, [])
    }
    
    const series = this.timeSeries.get(name)
    series.push(data)
    
    // Limit data points
    if (series.length > this.maxDataPoints) {
      series.splice(0, series.length - this.maxDataPoints)
    }
  }

  /**
   * Get time series data
   */
  getTimeSeries(name, limit = null) {
    const series = this.timeSeries.get(name) || []
    
    if (limit) {
      return series.slice(-limit)
    }
    
    return [...series]
  }

  /**
   * Clean up old data beyond retention period
   */
  cleanupOldData() {
    const cutoffTime = Date.now() - this.retentionPeriod
    
    for (const [name, series] of this.timeSeries.entries()) {
      const filtered = series.filter(data => data.timestamp >= cutoffTime)
      this.timeSeries.set(name, filtered)
    }
  }

  /**
   * Build metric key with tags
   */
  buildKey(name, tags = {}) {
    if (Object.keys(tags).length === 0) {
      return name
    }
    
    const tagString = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(',')
    
    return `${name}{${tagString}}`
  }

  /**
   * Get all metrics
   */
  getMetrics() {
    return {
      counters: this.serializeCounters(),
      gauges: this.serializeGauges(),
      timers: this.serializeTimers(),
      histograms: this.serializeHistograms(),
      sets: this.serializeSets()
    }
  }

  /**
   * Get metric by name and tags
   */
  getMetric(name, tags = {}) {
    const key = this.buildKey(name, tags)
    
    return {
      counter: this.metrics.counters.get(key),
      gauge: this.metrics.gauges.get(key)?.value,
      timer: this.metrics.timers.get(key),
      histogram: this.metrics.histograms.get(key),
      set: this.metrics.sets.get(key)?.size
    }
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics.counters.clear()
    this.metrics.gauges.clear()
    this.metrics.histograms.clear()
    this.metrics.timers.clear()
    this.metrics.sets.clear()
    this.timeSeries.clear()
    
    logger.info('Metrics reset', { component: 'Metrics' })
    this.emit('reset')
  }

  /**
   * Reset specific metric
   */
  resetMetric(name, tags = {}) {
    const key = this.buildKey(name, tags)
    
    this.metrics.counters.delete(key)
    this.metrics.gauges.delete(key)
    this.metrics.histograms.delete(key)
    this.metrics.timers.delete(key)
    this.metrics.sets.delete(key)
  }

  /**
   * Get metrics summary
   */
  getSummary() {
    const snapshot = this.collect()
    
    return {
      timestamp: snapshot.timestamp,
      totalMetrics: {
        counters: this.metrics.counters.size,
        gauges: this.metrics.gauges.size,
        timers: this.metrics.timers.size,
        histograms: this.metrics.histograms.size,
        sets: this.metrics.sets.size
      },
      system: snapshot.system,
      uptime: Math.floor((Date.now() - this.startTime) / 1000)
    }
  }

  /**
   * Export metrics data
   */
  export(format = 'json') {
    const data = {
      config: {
        enabled: this.enabled,
        collectionInterval: this.collectionInterval,
        retentionPeriod: this.retentionPeriod
      },
      metrics: this.getMetrics(),
      timeSeries: Object.fromEntries(this.timeSeries.entries()),
      summary: this.getSummary()
    }
    
    if (format === 'prometheus') {
      return this.exportPrometheus()
    }
    
    return data
  }

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheus() {
    const lines = []
    
    // Export counters
    for (const [key, value] of this.metrics.counters.entries()) {
      const { name, tags } = this.parseKey(key)
      const tagsStr = this.formatPrometheusTags(tags)
      lines.push(`# TYPE ${name} counter`)
      lines.push(`${name}${tagsStr} ${value}`)
    }
    
    // Export gauges
    for (const [key, data] of this.metrics.gauges.entries()) {
      const { name, tags } = this.parseKey(key)
      const tagsStr = this.formatPrometheusTags(tags)
      lines.push(`# TYPE ${name} gauge`)
      lines.push(`${name}${tagsStr} ${data.value}`)
    }
    
    return lines.join('\n')
  }

  /**
   * Parse metric key back to name and tags
   */
  parseKey(key) {
    const match = key.match(/^([^{]+)(?:\{(.+)\})?$/)
    if (!match) {
      return { name: key, tags: {} }
    }
    
    const name = match[1]
    const tagString = match[2]
    const tags = {}
    
    if (tagString) {
      tagString.split(',').forEach(tag => {
        const [k, v] = tag.split('=')
        tags[k] = v
      })
    }
    
    return { name, tags }
  }

  /**
   * Format tags for Prometheus
   */
  formatPrometheusTags(tags) {
    if (Object.keys(tags).length === 0) {
      return ''
    }
    
    const tagPairs = Object.entries(tags)
      .map(([key, value]) => `${key}="${value}"`)
      .join(',')
    
    return `{${tagPairs}}`
  }

  /**
   * Get health check status
   */
  getHealth() {
    const isHealthy = this.enabled && this.collectionTimer !== null
    
    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      enabled: this.enabled,
      collecting: this.collectionTimer !== null,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      metricsCount: {
        counters: this.metrics.counters.size,
        gauges: this.metrics.gauges.size,
        timers: this.metrics.timers.size,
        histograms: this.metrics.histograms.size,
        sets: this.metrics.sets.size
      }
    }
  }
}

module.exports = Metrics
