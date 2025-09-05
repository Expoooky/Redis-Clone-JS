/**
 * ClusterNode.js - Individual cluster node management
 * 
 * This module represents a single node in a Redis cluster, handling:
 * - Node identity and configuration
 * - Inter-node communication
 * - Health monitoring and failover detection
 * - Slot migration coordination
 */

const net = require('net')
const crypto = require('crypto')
const EventEmitter = require('events')
const logger = require('../utils/Logger')

/**
 * Node states in cluster
 */
const NODE_STATES = {
  UNKNOWN: 'unknown',
  CONNECTING: 'connecting',
  HANDSHAKE: 'handshake',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  FAILED: 'failed'
}

/**
 * Node flags
 */
const NODE_FLAGS = {
  MASTER: 'master',
  SLAVE: 'slave',
  FAIL: 'fail',
  HANDSHAKE: 'handshake',
  NOADDR: 'noaddr',
  MYSELF: 'myself'
}

/**
 * Represents a single node in the cluster
 */
class ClusterNode extends EventEmitter {
  constructor(options = {}) {
    super()
    
    this.id = options.id || this.generateNodeId()
    this.host = options.host || '127.0.0.1'
    this.port = options.port || 6379
    this.busPort = options.busPort || (this.port + 10000) // Cluster bus port
    this.flags = new Set(options.flags || [NODE_FLAGS.MASTER])
    
    // Node state
    this.state = NODE_STATES.UNKNOWN
    this.lastSeen = Date.now()
    this.pingTime = 0
    this.pongTime = 0
    this.epoch = 0
    this.slots = new Set() // Slots served by this node
    
    // Connection management
    this.socket = null
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 10
    this.reconnectDelay = 1000
    this.heartbeatInterval = 1000
    this.heartbeatTimer = null
    
    // Health monitoring
    this.isHealthy = true
    this.lastHealthCheck = Date.now()
    this.failureCount = 0
    this.maxFailures = 3
    
    // Statistics
    this.stats = {
      messagesReceived: 0,
      messagesSent: 0,
      bytesReceived: 0,
      bytesSent: 0,
      connectionAttempts: 0,
      lastConnect: null,
      lastDisconnect: null
    }
    
    // Message handlers
    this.messageHandlers = new Map()
    this.initializeMessageHandlers()
    
    logger.info('Cluster node created', {
      nodeId: this.id.substring(0, 8),
      host: this.host,
      port: this.port,
      busPort: this.busPort,
      flags: Array.from(this.flags),
      component: 'ClusterNode'
    })
  }

  /**
   * Generate unique node ID
   */
  generateNodeId() {
    return crypto.randomBytes(20).toString('hex')
  }

  /**
   * Initialize message handlers for cluster communication
   */
  initializeMessageHandlers() {
    this.messageHandlers.set('ping', this.handlePing.bind(this))
    this.messageHandlers.set('pong', this.handlePong.bind(this))
    this.messageHandlers.set('meet', this.handleMeet.bind(this))
    this.messageHandlers.set('nodes', this.handleNodes.bind(this))
    this.messageHandlers.set('fail', this.handleFail.bind(this))
    this.messageHandlers.set('migrate', this.handleMigrate.bind(this))
    this.messageHandlers.set('asking', this.handleAsking.bind(this))
  }

  /**
   * Connect to this node
   */
  async connect() {
    if (this.state === NODE_STATES.CONNECTED || this.state === NODE_STATES.CONNECTING) {
      return
    }

    this.state = NODE_STATES.CONNECTING
    this.stats.connectionAttempts++
    
    try {
      this.socket = net.createConnection(this.busPort, this.host)
      
      this.socket.on('connect', this.handleConnect.bind(this))
      this.socket.on('data', this.handleData.bind(this))
      this.socket.on('error', this.handleError.bind(this))
      this.socket.on('close', this.handleClose.bind(this))
      
      logger.debug('Connecting to cluster node', {
        nodeId: this.id.substring(0, 8),
        host: this.host,
        busPort: this.busPort,
        component: 'ClusterNode'
      })
      
    } catch (error) {
      this.handleConnectionError(error)
    }
  }

  /**
   * Disconnect from this node
   */
  disconnect() {
    if (this.socket) {
      this.socket.end()
      this.socket = null
    }
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    
    this.state = NODE_STATES.DISCONNECTED
    this.stats.lastDisconnect = Date.now()
    
    logger.info('Disconnected from cluster node', {
      nodeId: this.id.substring(0, 8),
      component: 'ClusterNode'
    })
  }

  /**
   * Send a message to this node
   */
  sendMessage(type, data = {}) {
    if (!this.socket || this.state !== NODE_STATES.CONNECTED) {
      logger.warn('Cannot send message to disconnected node', {
        nodeId: this.id.substring(0, 8),
        messageType: type,
        component: 'ClusterNode'
      })
      return false
    }

    const message = {
      type,
      nodeId: this.id,
      timestamp: Date.now(),
      ...data
    }

    const messageBuffer = Buffer.from(JSON.stringify(message) + '\n')
    
    try {
      this.socket.write(messageBuffer)
      this.stats.messagesSent++
      this.stats.bytesSent += messageBuffer.length
      
      logger.debug('Message sent to cluster node', {
        nodeId: this.id.substring(0, 8),
        messageType: type,
        size: messageBuffer.length,
        component: 'ClusterNode'
      })
      
      return true
    } catch (error) {
      logger.error('Failed to send message to node', {
        nodeId: this.id.substring(0, 8),
        messageType: type,
        error: error.message,
        component: 'ClusterNode'
      })
      return false
    }
  }

  /**
   * Send ping message
   */
  ping() {
    this.pingTime = Date.now()
    return this.sendMessage('ping', {
      epoch: this.epoch,
      slots: Array.from(this.slots)
    })
  }

  /**
   * Send pong message
   */
  pong(originalMessage = {}) {
    return this.sendMessage('pong', {
      epoch: this.epoch,
      pingTime: originalMessage.timestamp,
      slots: Array.from(this.slots)
    })
  }

  /**
   * Send meet message to introduce nodes
   */
  meet(targetNode) {
    return this.sendMessage('meet', {
      targetNodeId: targetNode.id,
      targetHost: targetNode.host,
      targetPort: targetNode.port,
      targetBusPort: targetNode.busPort
    })
  }

  /**
   * Update slot assignments for this node
   */
  updateSlots(slots) {
    this.slots = new Set(slots)
    
    logger.info('Node slots updated', {
      nodeId: this.id.substring(0, 8),
      slotCount: this.slots.size,
      component: 'ClusterNode'
    })
    
    this.emit('slotsChanged', this.slots)
  }

  /**
   * Mark node as failed
   */
  markAsFailed(reason = 'unknown') {
    this.flags.add(NODE_FLAGS.FAIL)
    this.state = NODE_STATES.FAILED
    this.isHealthy = false
    
    logger.warn('Cluster node marked as failed', {
      nodeId: this.id.substring(0, 8),
      reason,
      component: 'ClusterNode'
    })
    
    this.emit('failed', { node: this, reason })
  }

  /**
   * Mark node as healthy
   */
  markAsHealthy() {
    this.flags.delete(NODE_FLAGS.FAIL)
    this.isHealthy = true
    this.failureCount = 0
    this.lastHealthCheck = Date.now()
    
    logger.info('Cluster node marked as healthy', {
      nodeId: this.id.substring(0, 8),
      component: 'ClusterNode'
    })
    
    this.emit('recovered', { node: this })
  }

  /**
   * Check if node is a master
   */
  isMaster() {
    return this.flags.has(NODE_FLAGS.MASTER)
  }

  /**
   * Check if node is a slave
   */
  isSlave() {
    return this.flags.has(NODE_FLAGS.SLAVE)
  }

  /**
   * Get node information
   */
  getNodeInfo() {
    return {
      id: this.id,
      host: this.host,
      port: this.port,
      busPort: this.busPort,
      flags: Array.from(this.flags),
      state: this.state,
      slots: Array.from(this.slots),
      lastSeen: this.lastSeen,
      isHealthy: this.isHealthy,
      epoch: this.epoch,
      stats: { ...this.stats }
    }
  }

  /**
   * Handle successful connection
   */
  handleConnect() {
    this.state = NODE_STATES.CONNECTED
    this.stats.lastConnect = Date.now()
    this.lastSeen = Date.now()
    this.reconnectAttempts = 0
    
    // Start heartbeat
    this.heartbeatTimer = setInterval(() => {
      this.ping()
    }, this.heartbeatInterval)
    
    logger.info('Connected to cluster node', {
      nodeId: this.id.substring(0, 8),
      host: this.host,
      busPort: this.busPort,
      component: 'ClusterNode'
    })
    
    this.emit('connected', this)
  }

  /**
   * Handle incoming data
   */
  handleData(buffer) {
    this.stats.messagesReceived++
    this.stats.bytesReceived += buffer.length
    this.lastSeen = Date.now()
    
    const messages = buffer.toString().trim().split('\n')
    
    for (const messageStr of messages) {
      if (!messageStr) continue
      
      try {
        const message = JSON.parse(messageStr)
        this.processMessage(message)
      } catch (error) {
        logger.warn('Failed to parse cluster message', {
          nodeId: this.id.substring(0, 8),
          error: error.message,
          component: 'ClusterNode'
        })
      }
    }
  }

  /**
   * Process incoming message
   */
  processMessage(message) {
    const handler = this.messageHandlers.get(message.type)
    
    if (handler) {
      handler(message)
    } else {
      logger.warn('Unknown cluster message type', {
        nodeId: this.id.substring(0, 8),
        messageType: message.type,
        component: 'ClusterNode'
      })
    }
    
    this.emit('message', message)
  }

  /**
   * Handle ping message
   */
  handlePing(message) {
    this.pong(message)
    this.emit('ping', message)
  }

  /**
   * Handle pong message
   */
  handlePong(message) {
    this.pongTime = Date.now()
    const latency = this.pongTime - this.pingTime
    
    logger.debug('Received pong from cluster node', {
      nodeId: this.id.substring(0, 8),
      latency,
      component: 'ClusterNode'
    })
    
    this.emit('pong', { message, latency })
  }

  /**
   * Handle meet message
   */
  handleMeet(message) {
    logger.info('Received meet message', {
      nodeId: this.id.substring(0, 8),
      targetNode: message.targetNodeId?.substring(0, 8),
      component: 'ClusterNode'
    })
    
    this.emit('meet', message)
  }

  /**
   * Handle nodes message
   */
  handleNodes(message) {
    this.emit('nodes', message)
  }

  /**
   * Handle fail message
   */
  handleFail(message) {
    logger.warn('Received fail message for node', {
      failedNode: message.failedNodeId?.substring(0, 8),
      reason: message.reason,
      component: 'ClusterNode'
    })
    
    this.emit('fail', message)
  }

  /**
   * Handle migrate message
   */
  handleMigrate(message) {
    logger.info('Received migrate message', {
      nodeId: this.id.substring(0, 8),
      slot: message.slot,
      sourceNode: message.sourceNodeId?.substring(0, 8),
      component: 'ClusterNode'
    })
    
    this.emit('migrate', message)
  }

  /**
   * Handle asking message
   */
  handleAsking(message) {
    this.emit('asking', message)
  }

  /**
   * Handle connection error
   */
  handleError(error) {
    this.failureCount++
    
    logger.error('Cluster node connection error', {
      nodeId: this.id.substring(0, 8),
      error: error.message,
      failureCount: this.failureCount,
      component: 'ClusterNode'
    })
    
    if (this.failureCount >= this.maxFailures) {
      this.markAsFailed(`Connection failures: ${this.failureCount}`)
    }
    
    this.emit('error', error)
  }

  /**
   * Handle connection close
   */
  handleClose() {
    this.state = NODE_STATES.DISCONNECTED
    this.stats.lastDisconnect = Date.now()
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    
    // Attempt reconnection if not intentionally disconnected
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      setTimeout(() => {
        this.reconnectAttempts++
        this.connect()
      }, this.reconnectDelay * Math.pow(2, this.reconnectAttempts))
    }
    
    logger.info('Cluster node connection closed', {
      nodeId: this.id.substring(0, 8),
      reconnectAttempts: this.reconnectAttempts,
      component: 'ClusterNode'
    })
    
    this.emit('disconnected', this)
  }

  /**
   * Handle connection error during initial connect
   */
  handleConnectionError(error) {
    this.state = NODE_STATES.DISCONNECTED
    this.failureCount++
    
    logger.error('Failed to connect to cluster node', {
      nodeId: this.id.substring(0, 8),
      error: error.message,
      component: 'ClusterNode'
    })
    
    this.emit('connectionError', error)
  }

  /**
   * Start health monitoring
   */
  startHealthCheck(interval = 5000) {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
    }
    
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck()
    }, interval)
  }

  /**
   * Stop health monitoring
   */
  stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  /**
   * Perform health check
   */
  performHealthCheck() {
    const now = Date.now()
    const timeSinceLastSeen = now - this.lastSeen
    const healthTimeout = this.heartbeatInterval * 3 // 3 missed heartbeats
    
    if (timeSinceLastSeen > healthTimeout && this.state === NODE_STATES.CONNECTED) {
      this.failureCount++
      
      if (this.failureCount >= this.maxFailures) {
        this.markAsFailed(`Health check timeout: ${timeSinceLastSeen}ms`)
      }
    } else if (this.isHealthy === false && timeSinceLastSeen <= healthTimeout) {
      this.markAsHealthy()
    }
    
    this.lastHealthCheck = now
  }

  /**
   * Get current latency to this node
   */
  getLatency() {
    if (this.pingTime > 0 && this.pongTime > this.pingTime) {
      return this.pongTime - this.pingTime
    }
    return -1
  }

  /**
   * Export node information for cluster state
   */
  exportState() {
    return {
      id: this.id,
      host: this.host,
      port: this.port,
      busPort: this.busPort,
      flags: Array.from(this.flags),
      state: this.state,
      slots: Array.from(this.slots),
      epoch: this.epoch,
      lastSeen: this.lastSeen,
      isHealthy: this.isHealthy
    }
  }

  /**
   * Import node state
   */
  importState(state) {
    this.id = state.id
    this.host = state.host
    this.port = state.port
    this.busPort = state.busPort
    this.flags = new Set(state.flags || [])
    this.state = state.state || NODE_STATES.UNKNOWN
    this.slots = new Set(state.slots || [])
    this.epoch = state.epoch || 0
    this.lastSeen = state.lastSeen || Date.now()
    this.isHealthy = state.isHealthy !== false
  }

  /**
   * Clean up resources
   */
  cleanup() {
    this.disconnect()
    this.stopHealthCheck()
    this.removeAllListeners()
    
    logger.info('Cluster node cleaned up', {
      nodeId: this.id.substring(0, 8),
      component: 'ClusterNode'
    })
  }
}

module.exports = { ClusterNode, NODE_STATES, NODE_FLAGS }
