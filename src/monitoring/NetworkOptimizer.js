/**
 * NetworkOptimizer - Advanced network optimization and monitoring
 * 
 * Features:
 * - Connection pooling optimization
 * - Bandwidth usage monitoring
 * - Command batching and pipelining
 * - Network buffer optimization
 * - Connection multiplexing
 * - Latency optimization
 */

const { EventEmitter } = require('events');
const logger = require('../utils/Logger');

class NetworkOptimizer extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      maxConnections: options.maxConnections || 10000,
      connectionTimeout: options.connectionTimeout || 300000, // 5 minutes
      bufferSize: options.bufferSize || 64 * 1024, // 64KB
      batchingEnabled: options.batchingEnabled !== false,
      batchTimeout: options.batchTimeout || 10, // 10ms
      maxBatchSize: options.maxBatchSize || 100,
      compressionEnabled: options.compressionEnabled || false,
      compressionThreshold: options.compressionThreshold || 1024, // 1KB
      keepAliveEnabled: options.keepAliveEnabled !== false,
      tcpNoDelay: options.tcpNoDelay !== false,
      ...options
    };
    
    this.stats = {
      connections: {
        active: 0,
        total: 0,
        rejected: 0,
        timedOut: 0,
        errors: 0
      },
      bandwidth: {
        bytesReceived: 0,
        bytesSent: 0,
        packetsReceived: 0,
        packetsSent: 0,
        compressionSavings: 0
      },
      batching: {
        batchesCreated: 0,
        commandsBatched: 0,
        batchingRatio: 0,
        averageBatchSize: 0
      },
      latency: {
        min: Infinity,
        max: 0,
        average: 0,
        p95: 0,
        p99: 0,
        samples: []
      },
      buffers: {
        totalAllocated: 0,
        totalFreed: 0,
        peakUsage: 0,
        currentUsage: 0
      }
    };
    
    this.connections = new Map();
    this.pendingBatches = new Map();
    this.latencySamples = [];
    this.bufferPool = [];
    this.compressionCache = new Map();
    
    this.batchingTimer = null;
    this.cleanupTimer = null;
    
    this.startCleanupTimer();
  }

  /**
   * Start network optimization
   */
  start() {
    logger.info('Network optimizer started', {
      maxConnections: this.options.maxConnections,
      batchingEnabled: this.options.batchingEnabled,
      component: 'NetworkOptimizer'
    });
    
    if (this.options.batchingEnabled) {
      this.startBatching();
    }
  }

  /**
   * Stop network optimization
   */
  stop() {
    if (this.batchingTimer) {
      clearInterval(this.batchingTimer);
      this.batchingTimer = null;
    }
    
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    logger.info('Network optimizer stopped', { component: 'NetworkOptimizer' });
  }

  /**
   * Register new connection
   */
  registerConnection(clientId, socket) {
    if (this.connections.size >= this.options.maxConnections) {
      this.stats.connections.rejected++;
      this.emit('connectionRejected', { clientId, reason: 'maxConnections' });
      return false;
    }
    
    const connection = {
      clientId,
      socket,
      startTime: Date.now(),
      lastActivity: Date.now(),
      bytesReceived: 0,
      bytesSent: 0,
      packetsReceived: 0,
      packetsSent: 0,
      commandsExecuted: 0,
      errors: 0
    };
    
    this.connections.set(clientId, connection);
    this.stats.connections.active++;
    this.stats.connections.total++;
    
    // Optimize socket settings
    this.optimizeSocket(socket);
    
    // Set up connection monitoring
    this.setupConnectionMonitoring(connection);
    
    logger.debug('Connection registered', {
      clientId,
      activeConnections: this.stats.connections.active,
      component: 'NetworkOptimizer'
    });
    
    this.emit('connectionRegistered', connection);
    return true;
  }

  /**
   * Unregister connection
   */
  unregisterConnection(clientId) {
    const connection = this.connections.get(clientId);
    if (connection) {
      this.connections.delete(clientId);
      this.stats.connections.active--;
      
      // Clean up any pending batches
      this.pendingBatches.delete(clientId);
      
      logger.debug('Connection unregistered', {
        clientId,
        activeConnections: this.stats.connections.active,
        duration: Date.now() - connection.startTime,
        component: 'NetworkOptimizer'
      });
      
      this.emit('connectionUnregistered', connection);
    }
  }

  /**
   * Optimize socket settings
   */
  optimizeSocket(socket) {
    try {
      if (socket && typeof socket.setNoDelay === 'function' && this.options.tcpNoDelay) {
        socket.setNoDelay(true);
      }
      
      if (socket && typeof socket.setKeepAlive === 'function' && this.options.keepAliveEnabled) {
        socket.setKeepAlive(true, 60000); // 60 seconds
      }
      
      // Set buffer sizes if available
      if (socket && typeof socket.setRecvBufferSize === 'function') {
        socket.setRecvBufferSize(this.options.bufferSize);
      }
      
      if (socket && typeof socket.setSendBufferSize === 'function') {
        socket.setSendBufferSize(this.options.bufferSize);
      }
      
    } catch (error) {
      logger.warn('Failed to optimize socket', { 
        error: error.message, 
        component: 'NetworkOptimizer' 
      });
    }
  }

  /**
   * Setup connection monitoring
   */
  setupConnectionMonitoring(connection) {
    const { socket, clientId } = connection;
    
    // Check if socket has event handling capabilities
    if (socket && typeof socket.on === 'function') {
      socket.on('data', (data) => {
        connection.bytesReceived += data.length;
        connection.packetsReceived++;
        connection.lastActivity = Date.now();
        
        this.stats.bandwidth.bytesReceived += data.length;
        this.stats.bandwidth.packetsReceived++;
        
        this.emit('dataReceived', { clientId, size: data.length });
      });
      
      socket.on('error', (error) => {
        connection.errors++;
        this.stats.connections.errors++;
        
        logger.debug('Connection error', {
          clientId,
          error: error.message,
          component: 'NetworkOptimizer'
        });
      });
    }
    
    // Monitor for timeouts
    this.checkConnectionTimeout(connection);
  }

  /**
   * Check for connection timeouts
   */
  checkConnectionTimeout(connection) {
    const checkTimeout = () => {
      const now = Date.now();
      const idleTime = now - connection.lastActivity;
      
      if (idleTime > this.options.connectionTimeout) {
        this.stats.connections.timedOut++;
        connection.socket.end();
        
        logger.debug('Connection timed out', {
          clientId: connection.clientId,
          idleTime,
          component: 'NetworkOptimizer'
        });
        
        this.emit('connectionTimeout', connection);
      }
    };
    
    // Check timeout periodically
    setTimeout(checkTimeout, this.options.connectionTimeout / 4);
  }

  /**
   * Record data sent
   */
  recordDataSent(clientId, size) {
    const connection = this.connections.get(clientId);
    if (connection) {
      connection.bytesSent += size;
      connection.packetsSent++;
      connection.lastActivity = Date.now();
    }
    
    this.stats.bandwidth.bytesSent += size;
    this.stats.bandwidth.packetsSent++;
    
    this.emit('dataSent', { clientId, size });
  }

  /**
   * Record command execution
   */
  recordCommand(clientId, command, latency) {
    const connection = this.connections.get(clientId);
    if (connection) {
      connection.commandsExecuted++;
    }
    
    // Record latency
    this.recordLatency(latency);
    
    // Try to batch the command if enabled
    if (this.options.batchingEnabled && this.canBatchCommand(command)) {
      this.addToBatch(clientId, command);
    }
  }

  /**
   * Record latency measurement
   */
  recordLatency(latency) {
    this.latencySamples.push(latency);
    
    // Keep only recent samples (last 1000)
    if (this.latencySamples.length > 1000) {
      this.latencySamples = this.latencySamples.slice(-1000);
    }
    
    // Update statistics
    this.updateLatencyStats();
  }

  /**
   * Update latency statistics
   */
  updateLatencyStats() {
    if (this.latencySamples.length === 0) return;
    
    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    
    this.stats.latency.min = Math.min(this.stats.latency.min, sorted[0]);
    this.stats.latency.max = Math.max(this.stats.latency.max, sorted[sorted.length - 1]);
    this.stats.latency.average = sorted.reduce((sum, val) => sum + val, 0) / sorted.length;
    
    // Calculate percentiles
    this.stats.latency.p95 = sorted[Math.floor(sorted.length * 0.95)];
    this.stats.latency.p99 = sorted[Math.floor(sorted.length * 0.99)];
  }

  /**
   * Start command batching
   */
  startBatching() {
    this.batchingTimer = setInterval(() => {
      this.processBatches();
    }, this.options.batchTimeout);
  }

  /**
   * Check if command can be batched
   */
  canBatchCommand(command) {
    // Most read commands can be batched safely
    const batchableCommands = [
      'GET', 'MGET', 'HGET', 'HGETALL', 'LRANGE', 'SMEMBERS',
      'SISMEMBER', 'ZRANGE', 'ZCARD', 'EXISTS', 'TTL', 'TYPE'
    ];
    
    return batchableCommands.includes(command.toUpperCase());
  }

  /**
   * Add command to batch
   */
  addToBatch(clientId, command) {
    if (!this.pendingBatches.has(clientId)) {
      this.pendingBatches.set(clientId, {
        commands: [],
        startTime: Date.now()
      });
    }
    
    const batch = this.pendingBatches.get(clientId);
    batch.commands.push(command);
    
    // Process batch if it reaches max size
    if (batch.commands.length >= this.options.maxBatchSize) {
      this.processBatch(clientId, batch);
      this.pendingBatches.delete(clientId);
    }
  }

  /**
   * Process all pending batches
   */
  processBatches() {
    for (const [clientId, batch] of this.pendingBatches.entries()) {
      this.processBatch(clientId, batch);
    }
    this.pendingBatches.clear();
  }

  /**
   * Process individual batch
   */
  processBatch(clientId, batch) {
    if (batch.commands.length === 0) return;
    
    this.stats.batching.batchesCreated++;
    this.stats.batching.commandsBatched += batch.commands.length;
    
    // Calculate batching efficiency
    this.stats.batching.averageBatchSize = 
      this.stats.batching.commandsBatched / this.stats.batching.batchesCreated;
    
    this.stats.batching.batchingRatio = 
      this.stats.batching.commandsBatched / this.stats.connections.total;
    
    logger.debug('Batch processed', {
      clientId,
      commands: batch.commands.length,
      duration: Date.now() - batch.startTime,
      component: 'NetworkOptimizer'
    });
    
    this.emit('batchProcessed', { clientId, batch });
  }

  /**
   * Compress data if enabled and beneficial
   */
  compressData(data) {
    if (!this.options.compressionEnabled || data.length < this.options.compressionThreshold) {
      return { data, compressed: false, savings: 0 };
    }
    
    try {
      // Simple compression simulation (in real implementation, use zlib)
      const compressed = Buffer.from(JSON.stringify({ compressed: data }));
      
      if (compressed.length < data.length) {
        const savings = data.length - compressed.length;
        this.stats.bandwidth.compressionSavings += savings;
        
        return { data: compressed, compressed: true, savings };
      }
    } catch (error) {
      logger.warn('Compression failed', { 
        error: error.message, 
        component: 'NetworkOptimizer' 
      });
    }
    
    return { data, compressed: false, savings: 0 };
  }

  /**
   * Get optimal buffer from pool
   */
  getBuffer(size = this.options.bufferSize) {
    let buffer = this.bufferPool.find(buf => buf.length >= size && !buf.inUse);
    
    if (!buffer) {
      buffer = Buffer.allocUnsafe(size);
      this.bufferPool.push(buffer);
      this.stats.buffers.totalAllocated++;
    }
    
    buffer.inUse = true;
    this.stats.buffers.currentUsage += buffer.length;
    this.stats.buffers.peakUsage = Math.max(
      this.stats.buffers.peakUsage, 
      this.stats.buffers.currentUsage
    );
    
    return buffer;
  }

  /**
   * Return buffer to pool
   */
  returnBuffer(buffer) {
    if (buffer && buffer.inUse) {
      buffer.inUse = false;
      this.stats.buffers.currentUsage -= buffer.length;
      this.stats.buffers.totalFreed++;
    }
  }

  /**
   * Start cleanup timer
   */
  startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 60000); // Every minute
  }

  /**
   * Cleanup unused resources
   */
  cleanup() {
    // Clean up unused buffers
    const unusedBuffers = this.bufferPool.filter(buf => !buf.inUse);
    if (unusedBuffers.length > 10) {
      this.bufferPool = this.bufferPool.filter(buf => buf.inUse);
    }
    
    // Clean up compression cache
    if (this.compressionCache.size > 1000) {
      this.compressionCache.clear();
    }
    
    // Clean up old latency samples
    if (this.latencySamples.length > 1000) {
      this.latencySamples = this.latencySamples.slice(-500);
    }
    
    logger.debug('Network optimizer cleanup completed', { component: 'NetworkOptimizer' });
  }

  /**
   * Get network statistics
   */
  getStats() {
    return {
      ...this.stats,
      connections: {
        ...this.stats.connections,
        efficiency: this.stats.connections.total > 0 
          ? (this.stats.connections.active / this.stats.connections.total) * 100 
          : 0
      },
      bandwidth: {
        ...this.stats.bandwidth,
        compressionRatio: this.stats.bandwidth.bytesSent > 0
          ? (this.stats.bandwidth.compressionSavings / this.stats.bandwidth.bytesSent) * 100
          : 0
      },
      buffers: {
        ...this.stats.buffers,
        poolSize: this.bufferPool.length,
        utilizationRate: this.bufferPool.length > 0
          ? (this.bufferPool.filter(buf => buf.inUse).length / this.bufferPool.length) * 100
          : 0
      }
    };
  }

  /**
   * Get connection details
   */
  getConnectionDetails() {
    const connections = [];
    
    for (const connection of this.connections.values()) {
      connections.push({
        clientId: connection.clientId,
        uptime: Date.now() - connection.startTime,
        bytesReceived: connection.bytesReceived,
        bytesSent: connection.bytesSent,
        packetsReceived: connection.packetsReceived,
        packetsSent: connection.packetsSent,
        commandsExecuted: connection.commandsExecuted,
        errors: connection.errors,
        idleTime: Date.now() - connection.lastActivity
      });
    }
    
    return connections;
  }

  /**
   * Get network summary
   */
  getSummary() {
    return {
      connections: {
        active: this.stats.connections.active,
        total: this.stats.connections.total,
        rejected: this.stats.connections.rejected
      },
      bandwidth: {
        received: this.formatBytes(this.stats.bandwidth.bytesReceived),
        sent: this.formatBytes(this.stats.bandwidth.bytesSent),
        compressionSavings: this.formatBytes(this.stats.bandwidth.compressionSavings)
      },
      latency: {
        average: `${this.stats.latency.average.toFixed(2)}ms`,
        p95: `${this.stats.latency.p95.toFixed(2)}ms`,
        p99: `${this.stats.latency.p99.toFixed(2)}ms`
      },
      batching: {
        enabled: this.options.batchingEnabled,
        averageSize: this.stats.batching.averageBatchSize.toFixed(1),
        ratio: `${(this.stats.batching.batchingRatio * 100).toFixed(1)}%`
      }
    };
  }

  /**
   * Format bytes to human readable
   */
  formatBytes(bytes) {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  }
}

module.exports = NetworkOptimizer;
