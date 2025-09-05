/**
 * SlowLog.js - Slow query logging and analysis module
 * 
 * This module tracks and logs slow queries for performance analysis,
 * similar to Redis SLOWLOG functionality.
 */

const logger = require('../utils/Logger')

/**
 * Slow query logger and analyzer
 */
class SlowLog {
  constructor(options = {}) {
    this.enabled = options.enabled !== false
    this.slowlogMaxLen = options.slowlogMaxLen || 128
    this.slowlogLogSlowerThan = options.slowlogLogSlowerThan || 10000 // microseconds (10ms)
    
    // Slow log entries storage
    this.entries = []
    this.entryId = 0
    
    // Performance tracking
    this.totalQueries = 0
    this.slowQueries = 0
    
    logger.info('SlowLog initialized', {
      enabled: this.enabled,
      maxLen: this.slowlogMaxLen,
      threshold: this.slowlogLogSlowerThan,
      component: 'SlowLog'
    })
  }

  /**
   * Log a command if it's slower than threshold
   */
  logCommand(command, args, executionTimeMicros, timestamp = null, clientInfo = null) {
    if (!this.enabled) {
      return
    }

    this.totalQueries++

    // Check if command is slow enough to log
    if (executionTimeMicros >= this.slowlogLogSlowerThan) {
      this.slowQueries++
      
      const entry = {
        id: ++this.entryId,
        timestamp: timestamp || Math.floor(Date.now() / 1000),
        executionTime: executionTimeMicros,
        command: command.toUpperCase(),
        args: this.sanitizeArgs(args),
        clientAddress: clientInfo ? `${clientInfo.host}:${clientInfo.port}` : '127.0.0.1:0',
        clientName: clientInfo ? clientInfo.name : ''
      }

      // Add to entries (newest first)
      this.entries.unshift(entry)
      
      // Maintain max length
      if (this.entries.length > this.slowlogMaxLen) {
        this.entries = this.entries.slice(0, this.slowlogMaxLen)
      }
      
      logger.warn('Slow query detected', {
        command: entry.command,
        executionTime: `${(executionTimeMicros / 1000).toFixed(2)}ms`,
        args: entry.args.slice(0, 3), // Log first 3 args only
        client: entry.clientAddress,
        component: 'SlowLog'
      })
    }
  }

  /**
   * Sanitize command arguments for logging
   */
  sanitizeArgs(args) {
    if (!Array.isArray(args)) {
      return []
    }

    return args.map(arg => {
      if (typeof arg !== 'string') {
        arg = String(arg)
      }
      
      // Truncate very long arguments
      if (arg.length > 128) {
        return arg.substring(0, 125) + '...'
      }
      
      // Sanitize potentially sensitive data
      if (this.isSensitiveCommand(args[0])) {
        return '[SANITIZED]'
      }
      
      return arg
    })
  }

  /**
   * Check if command might contain sensitive data
   */
  isSensitiveCommand(command) {
    const sensitiveCommands = new Set([
      'AUTH', 'ACL', 'CONFIG', 'EVAL', 'EVALSHA'
    ])
    
    return sensitiveCommands.has(String(command).toUpperCase())
  }

  /**
   * Get slow log entries
   */
  getEntries(count = null) {
    if (count === null) {
      return [...this.entries] // Return copy
    }
    
    const numEntries = Math.min(count, this.entries.length)
    return this.entries.slice(0, numEntries)
  }

  /**
   * Get slow log entry by ID
   */
  getEntry(id) {
    return this.entries.find(entry => entry.id === id) || null
  }

  /**
   * Get slow log length
   */
  getLength() {
    return this.entries.length
  }

  /**
   * Reset/clear slow log
   */
  reset() {
    const clearedEntries = this.entries.length
    this.entries = []
    this.entryId = 0
    
    logger.info('SlowLog reset', {
      clearedEntries,
      component: 'SlowLog'
    })
    
    return clearedEntries
  }

  /**
   * Get slow log statistics
   */
  getStats() {
    const stats = {
      enabled: this.enabled,
      maxLen: this.slowlogMaxLen,
      threshold: this.slowlogLogSlowerThan,
      currentLength: this.entries.length,
      totalQueries: this.totalQueries,
      slowQueries: this.slowQueries,
      slowQueryPercentage: this.totalQueries > 0 
        ? ((this.slowQueries / this.totalQueries) * 100).toFixed(2)
        : 0
    }

    // Add timing statistics if we have entries
    if (this.entries.length > 0) {
      const executionTimes = this.entries.map(entry => entry.executionTime)
      
      stats.slowestQuery = Math.max(...executionTimes)
      stats.averageSlowTime = Math.round(executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length)
      stats.medianSlowTime = this.calculateMedian(executionTimes)
    }

    return stats
  }

  /**
   * Calculate median execution time
   */
  calculateMedian(times) {
    const sorted = [...times].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    
    return sorted.length % 2 !== 0 
      ? sorted[mid] 
      : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
  }

  /**
   * Get slow query analysis
   */
  getAnalysis() {
    if (this.entries.length === 0) {
      return {
        totalEntries: 0,
        analysis: 'No slow queries recorded'
      }
    }

    // Analyze by command type
    const commandStats = {}
    const clientStats = {}
    const timeRanges = {
      'under_100ms': 0,
      '100ms_to_1s': 0,
      '1s_to_10s': 0,
      'over_10s': 0
    }

    for (const entry of this.entries) {
      // Command statistics
      commandStats[entry.command] = (commandStats[entry.command] || 0) + 1
      
      // Client statistics
      clientStats[entry.clientAddress] = (clientStats[entry.clientAddress] || 0) + 1
      
      // Time range analysis
      const timeMs = entry.executionTime / 1000
      if (timeMs < 100) {
        timeRanges.under_100ms++
      } else if (timeMs < 1000) {
        timeRanges['100ms_to_1s']++
      } else if (timeMs < 10000) {
        timeRanges['1s_to_10s']++
      } else {
        timeRanges.over_10s++
      }
    }

    // Find top slow commands
    const topSlowCommands = Object.entries(commandStats)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([cmd, count]) => ({ command: cmd, count }))

    // Find top slow clients
    const topSlowClients = Object.entries(clientStats)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([client, count]) => ({ client, count }))

    return {
      totalEntries: this.entries.length,
      timeRange: {
        earliest: new Date(this.entries[this.entries.length - 1].timestamp * 1000).toISOString(),
        latest: new Date(this.entries[0].timestamp * 1000).toISOString()
      },
      topSlowCommands,
      topSlowClients,
      executionTimeDistribution: timeRanges,
      recommendations: this.generateRecommendations(commandStats, timeRanges)
    }
  }

  /**
   * Generate performance recommendations based on slow query analysis
   */
  generateRecommendations(commandStats, timeRanges) {
    const recommendations = []

    // Check for frequently slow commands
    const totalSlowQueries = Object.values(commandStats).reduce((a, b) => a + b, 0)
    
    for (const [command, count] of Object.entries(commandStats)) {
      const percentage = (count / totalSlowQueries) * 100
      
      if (percentage > 20) {
        recommendations.push({
          type: 'command_optimization',
          message: `Command '${command}' appears in ${percentage.toFixed(1)}% of slow queries. Consider optimizing ${command} operations.`
        })
      }
    }

    // Check for very slow queries
    if (timeRanges.over_10s > 0) {
      recommendations.push({
        type: 'performance_critical',
        message: `${timeRanges.over_10s} queries took over 10 seconds. These need immediate attention.`
      })
    }

    // Check for memory-intensive operations
    if (commandStats['KEYS'] || commandStats['SMEMBERS'] || commandStats['HGETALL']) {
      recommendations.push({
        type: 'memory_optimization',
        message: 'Memory-intensive commands detected. Consider using SCAN variants instead of blocking operations.'
      })
    }

    // Check for script-related slowness
    if (commandStats['EVAL'] || commandStats['EVALSHA']) {
      recommendations.push({
        type: 'script_optimization',
        message: 'Slow Lua scripts detected. Review script complexity and consider optimization.'
      })
    }

    if (recommendations.length === 0) {
      recommendations.push({
        type: 'general',
        message: 'No specific patterns detected. Monitor query patterns and consider indexing strategies.'
      })
    }

    return recommendations
  }

  /**
   * Update configuration
   */
  updateConfig(options = {}) {
    if (typeof options.enabled === 'boolean') {
      this.enabled = options.enabled
    }
    
    if (typeof options.slowlogMaxLen === 'number' && options.slowlogMaxLen > 0) {
      this.slowlogMaxLen = options.slowlogMaxLen
      // Trim entries if new max is smaller
      if (this.entries.length > this.slowlogMaxLen) {
        this.entries = this.entries.slice(0, this.slowlogMaxLen)
      }
    }
    
    if (typeof options.slowlogLogSlowerThan === 'number' && options.slowlogLogSlowerThan >= 0) {
      this.slowlogLogSlowerThan = options.slowlogLogSlowerThan
    }

    logger.info('SlowLog configuration updated', {
      enabled: this.enabled,
      maxLen: this.slowlogMaxLen,
      threshold: this.slowlogLogSlowerThan,
      component: 'SlowLog'
    })
  }

  /**
   * Export slow log data for external analysis
   */
  exportData(format = 'json') {
    const data = {
      config: {
        enabled: this.enabled,
        maxLen: this.slowlogMaxLen,
        threshold: this.slowlogLogSlowerThan
      },
      stats: this.getStats(),
      entries: this.entries,
      analysis: this.getAnalysis()
    }

    if (format === 'csv') {
      return this.convertToCSV(this.entries)
    }
    
    return data
  }

  /**
   * Convert entries to CSV format
   */
  convertToCSV(entries) {
    if (entries.length === 0) {
      return 'id,timestamp,execution_time_us,command,args,client_address\n'
    }

    const header = 'id,timestamp,execution_time_us,command,args,client_address\n'
    const rows = entries.map(entry => {
      const argsStr = entry.args.join(' ').replace(/"/g, '""')
      return `${entry.id},"${new Date(entry.timestamp * 1000).toISOString()}",${entry.executionTime},"${entry.command}","${argsStr}","${entry.clientAddress}"`
    }).join('\n')

    return header + rows
  }

  /**
   * Import slow log data (for testing or migration)
   */
  importData(data) {
    if (data.entries && Array.isArray(data.entries)) {
      this.entries = data.entries
      this.entryId = Math.max(...this.entries.map(e => e.id), 0)
      
      logger.info('SlowLog data imported', {
        entriesImported: this.entries.length,
        component: 'SlowLog'
      })
    }
  }

  /**
   * Get recent slow queries (last N minutes)
   */
  getRecentEntries(minutes = 60) {
    const cutoffTime = Math.floor(Date.now() / 1000) - (minutes * 60)
    return this.entries.filter(entry => entry.timestamp >= cutoffTime)
  }
}

module.exports = SlowLog
