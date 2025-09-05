/**
 * PerformanceMonitor - Comprehensive performance tracking and monitoring
 * 
 * Features:
 * - CPU usage monitoring
 * - Memory usage tracking
 * - Command execution statistics
 * - Network I/O monitoring
 * - Performance alerts and thresholds
 * - Real-time metrics collection
 */

const os = require('os');
const { EventEmitter } = require('events');
const logger = require('../utils/Logger');

class PerformanceMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      monitoringInterval: options.monitoringInterval || 1000, // 1 second
      memoryThreshold: options.memoryThreshold || 0.8, // 80%
      cpuThreshold: options.cpuThreshold || 0.7, // 70%
      commandTimeThreshold: options.commandTimeThreshold || 100, // 100ms
      enabled: options.enabled !== false,
      historySize: options.historySize || 3600, // 1 hour of data
      ...options
    };
    
    this.metrics = {
      // System metrics
      memory: {
        used: 0,
        total: 0,
        percentage: 0,
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        rss: 0
      },
      cpu: {
        usage: 0,
        loadAverage: [0, 0, 0],
        cores: os.cpus().length
      },
      // Redis-specific metrics
      commands: {
        total: 0,
        perSecond: 0,
        slowCommands: 0,
        errors: 0,
        averageLatency: 0,
        breakdown: new Map() // command -> count
      },
      network: {
        bytesReceived: 0,
        bytesSent: 0,
        connections: 0,
        connectionsTotal: 0
      },
      datastore: {
        keys: 0,
        databases: 0,
        memoryUsage: 0,
        hitRate: 0,
        evictions: 0
      }
    };
    
    this.history = {
      memory: [],
      cpu: [],
      commands: [],
      network: []
    };
    
    this.commandStats = new Map();
    this.slowQueries = [];
    this.alerts = [];
    
    this.startTime = Date.now();
    this.lastCpuMeasure = null;
    this.monitoringTimer = null;
    
    if (this.options.enabled) {
      this.start();
    }
  }

  /**
   * Start performance monitoring
   */
  start() {
    if (this.monitoringTimer) return;
    
    logger.info('Starting performance monitoring', { 
      interval: this.options.monitoringInterval,
      component: 'PerformanceMonitor'
    });
    
    this.monitoringTimer = setInterval(() => {
      this.collectMetrics();
    }, this.options.monitoringInterval);
    
    // Initial collection
    this.collectMetrics();
  }

  /**
   * Stop performance monitoring
   */
  stop() {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
      
      logger.info('Performance monitoring stopped', { component: 'PerformanceMonitor' });
    }
  }

  /**
   * Collect all performance metrics
   */
  collectMetrics() {
    this.collectMemoryMetrics();
    this.collectCpuMetrics();
    this.collectNetworkMetrics();
    this.updateCommandMetrics();
    this.checkThresholds();
    this.updateHistory();
    
    this.emit('metrics', this.getMetrics());
  }

  /**
   * Collect memory metrics
   */
  collectMemoryMetrics() {
    const memInfo = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    this.metrics.memory = {
      used: usedMem,
      total: totalMem,
      percentage: (usedMem / totalMem) * 100,
      heapUsed: memInfo.heapUsed,
      heapTotal: memInfo.heapTotal,
      external: memInfo.external,
      rss: memInfo.rss
    };
  }

  /**
   * Collect CPU metrics
   */
  collectCpuMetrics() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    
    // Calculate CPU usage
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });
    
    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - ~~(100 * idle / total);
    
    this.metrics.cpu = {
      usage,
      loadAverage: loadAvg,
      cores: cpus.length
    };
  }

  /**
   * Collect network metrics
   */
  collectNetworkMetrics() {
    // Network metrics would be updated by the server
    // This maintains the current values
  }

  /**
   * Update command performance metrics
   */
  updateCommandMetrics() {
    const currentTime = Date.now();
    const timeWindow = 1000; // 1 second window
    
    let commandsInWindow = 0;
    let totalLatency = 0;
    let slowCommands = 0;
    
    // Count commands in the last second
    for (const [timestamp, stats] of this.commandStats.entries()) {
      if (currentTime - timestamp <= timeWindow) {
        commandsInWindow++;
        totalLatency += stats.latency;
        if (stats.latency > this.options.commandTimeThreshold) {
          slowCommands++;
        }
      } else {
        // Remove old entries
        this.commandStats.delete(timestamp);
      }
    }
    
    this.metrics.commands.perSecond = commandsInWindow;
    
    // Calculate average latency from all recorded commands, not just window
    const allLatencies = Array.from(this.commandStats.values()).map(s => s.latency);
    this.metrics.commands.averageLatency = allLatencies.length > 0 
      ? allLatencies.reduce((sum, lat) => sum + lat, 0) / allLatencies.length 
      : 0;
      
    this.metrics.commands.slowCommands = slowCommands;
  }

  /**
   * Record command execution
   */
  recordCommand(command, latency, error = false) {
    const timestamp = Date.now();
    
    this.commandStats.set(timestamp, {
      command,
      latency,
      error,
      timestamp
    });
    
    this.metrics.commands.total++;
    if (error) {
      this.metrics.commands.errors++;
    }
    
    // Update command breakdown
    const currentCount = this.metrics.commands.breakdown.get(command) || 0;
    this.metrics.commands.breakdown.set(command, currentCount + 1);
    
    // Track slow queries
    if (latency > this.options.commandTimeThreshold) {
      this.slowQueries.push({
        command,
        latency,
        timestamp
      });
      
      // Limit slow query history
      if (this.slowQueries.length > 1000) {
        this.slowQueries = this.slowQueries.slice(-500);
      }
    }
  }

  /**
   * Update network statistics
   */
  updateNetworkStats(bytesReceived = 0, bytesSent = 0, connections = 0) {
    this.metrics.network.bytesReceived += bytesReceived;
    this.metrics.network.bytesSent += bytesSent;
    this.metrics.network.connections = connections;
    this.metrics.network.connectionsTotal++;
  }

  /**
   * Update datastore statistics
   */
  updateDatastoreStats(keys = 0, databases = 0, memoryUsage = 0, hitRate = 0, evictions = 0) {
    this.metrics.datastore = {
      keys,
      databases,
      memoryUsage,
      hitRate,
      evictions
    };
  }

  /**
   * Check performance thresholds and emit alerts
   */
  checkThresholds() {
    const alerts = [];
    
    // Memory threshold
    if (this.metrics.memory.percentage > this.options.memoryThreshold * 100) {
      alerts.push({
        type: 'memory',
        severity: 'high',
        message: `Memory usage is ${this.metrics.memory.percentage.toFixed(1)}% (threshold: ${this.options.memoryThreshold * 100}%)`,
        value: this.metrics.memory.percentage,
        threshold: this.options.memoryThreshold * 100
      });
    }
    
    // CPU threshold
    if (this.metrics.cpu.usage > this.options.cpuThreshold * 100) {
      alerts.push({
        type: 'cpu',
        severity: 'high',
        message: `CPU usage is ${this.metrics.cpu.usage.toFixed(1)}% (threshold: ${this.options.cpuThreshold * 100}%)`,
        value: this.metrics.cpu.usage,
        threshold: this.options.cpuThreshold * 100
      });
    }
    
    // Command latency threshold
    if (this.metrics.commands.averageLatency > this.options.commandTimeThreshold) {
      alerts.push({
        type: 'latency',
        severity: 'medium',
        message: `Average command latency is ${this.metrics.commands.averageLatency.toFixed(1)}ms (threshold: ${this.options.commandTimeThreshold}ms)`,
        value: this.metrics.commands.averageLatency,
        threshold: this.options.commandTimeThreshold
      });
    }
    
    // Emit alerts
    for (const alert of alerts) {
      this.emit('alert', alert);
      logger.warn('Performance alert', { alert, component: 'PerformanceMonitor' });
    }
    
    this.alerts = alerts;
  }

  /**
   * Update metrics history
   */
  updateHistory() {
    const timestamp = Date.now();
    
    // Add to history
    this.history.memory.push({
      timestamp,
      ...this.metrics.memory
    });
    
    this.history.cpu.push({
      timestamp,
      ...this.metrics.cpu
    });
    
    this.history.commands.push({
      timestamp,
      ...this.metrics.commands
    });
    
    this.history.network.push({
      timestamp,
      ...this.metrics.network
    });
    
    // Limit history size
    Object.keys(this.history).forEach(key => {
      if (this.history[key].length > this.options.historySize) {
        this.history[key] = this.history[key].slice(-this.options.historySize);
      }
    });
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return {
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      ...this.metrics,
      alerts: this.alerts
    };
  }

  /**
   * Get performance statistics
   */
  getStats() {
    const uptime = Date.now() - this.startTime;
    
    return {
      uptime,
      metrics: this.metrics,
      history: {
        memory: this.history.memory.slice(-60), // Last minute
        cpu: this.history.cpu.slice(-60),
        commands: this.history.commands.slice(-60),
        network: this.history.network.slice(-60)
      },
      slowQueries: this.slowQueries.slice(-50), // Last 50 slow queries
      alerts: this.alerts,
      commandBreakdown: Object.fromEntries(this.metrics.commands.breakdown),
      averages: this.calculateAverages()
    };
  }

  /**
   * Calculate average metrics
   */
  calculateAverages() {
    const windowSize = Math.min(60, this.history.memory.length); // Last minute
    
    if (windowSize === 0) return {};
    
    const recentMemory = this.history.memory.slice(-windowSize);
    const recentCpu = this.history.cpu.slice(-windowSize);
    const recentCommands = this.history.commands.slice(-windowSize);
    
    return {
      memory: recentMemory.reduce((sum, m) => sum + m.percentage, 0) / windowSize,
      cpu: recentCpu.reduce((sum, c) => sum + c.usage, 0) / windowSize,
      commandsPerSecond: recentCommands.reduce((sum, c) => sum + c.perSecond, 0) / windowSize,
      averageLatency: recentCommands.reduce((sum, c) => sum + c.averageLatency, 0) / windowSize
    };
  }

  /**
   * Get performance summary
   */
  getSummary() {
    const averages = this.calculateAverages();
    
    return {
      status: this.alerts.length > 0 ? 'warning' : 'healthy',
      uptime: Date.now() - this.startTime,
      memory: {
        current: this.metrics.memory.percentage.toFixed(1) + '%',
        average: averages.memory ? averages.memory.toFixed(1) + '%' : '0%'
      },
      cpu: {
        current: this.metrics.cpu.usage.toFixed(1) + '%',
        average: averages.cpu ? averages.cpu.toFixed(1) + '%' : '0%'
      },
      commands: {
        total: this.metrics.commands.total,
        perSecond: this.metrics.commands.perSecond,
        averageLatency: this.metrics.commands.averageLatency.toFixed(1) + 'ms',
        slowCommands: this.metrics.commands.slowCommands
      },
      alerts: this.alerts.length
    };
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics.commands.total = 0;
    this.metrics.commands.errors = 0;
    this.metrics.commands.breakdown.clear();
    this.metrics.network.bytesReceived = 0;
    this.metrics.network.bytesSent = 0;
    this.metrics.network.connectionsTotal = 0;
    
    this.commandStats.clear();
    this.slowQueries = [];
    this.alerts = [];
    this.history = {
      memory: [],
      cpu: [],
      commands: [],
      network: []
    };
    
    this.startTime = Date.now();
    
    logger.info('Performance metrics reset', { component: 'PerformanceMonitor' });
  }
}

module.exports = PerformanceMonitor;
