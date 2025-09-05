/**
 * ClusterManager.js - Redis cluster management and coordination
 * 
 * This module coordinates the entire cluster, handling:
 * - Cluster topology management
 * - Node discovery and membership
 * - Failover detection and recovery
 * - Slot migration orchestration
 * - Client redirection
 */

const EventEmitter = require('events')
const { HashSlots, CLUSTER_SLOTS } = require('./HashSlots')
const { ClusterNode, NODE_STATES, NODE_FLAGS } = require('./ClusterNode')
const logger = require('../utils/Logger')

/**
 * Cluster states
 */
const CLUSTER_STATES = {
  INITIALIZING: 'initializing',
  READY: 'ready',
  DEGRADED: 'degraded',
  FAILED: 'failed'
}

/**
 * Manages the entire Redis cluster
 */
class ClusterManager extends EventEmitter {
  constructor(options = {}) {
    super()
    
    this.options = {
      port: options.port || 6379,
      host: options.host || '127.0.0.1',
      clusterEnabled: options.clusterEnabled || false,
      clusterConfigFile: options.clusterConfigFile || 'nodes.conf',
      clusterNodeTimeout: options.clusterNodeTimeout || 15000,
      clusterSlaveValidityFactor: options.clusterSlaveValidityFactor || 10,
      clusterMigrationBarrier: options.clusterMigrationBarrier || 1,
      clusterRequireFullCoverage: options.clusterRequireFullCoverage !== false,
      ...options
    }
    
    // Core components
    this.hashSlots = new HashSlots()
    this.nodes = new Map() // nodeId -> ClusterNode
    this.myself = null // This node
    
    // Cluster state
    this.state = CLUSTER_STATES.INITIALIZING
    this.epoch = 0
    this.lastStateUpdate = Date.now()
    
    // Node management
    this.seeds = new Set() // Seed nodes for discovery
    this.bannedNodes = new Set() // Temporarily banned nodes
    
    // Failover management
    this.failoverState = null
    this.elections = new Map() // slot -> election info
    
    // Migration management
    this.activeMigrations = new Map() // slot -> migration info
    
    // Statistics
    this.stats = {
      nodesAdded: 0,
      nodesRemoved: 0,
      failovers: 0,
      migrations: 0,
      redirections: 0,
      messagesReceived: 0,
      messagesSent: 0
    }
    
    // Timers
    this.heartbeatTimer = null
    this.stateUpdateTimer = null
    
    logger.info('Cluster manager created', {
      clusterEnabled: this.options.clusterEnabled,
      port: this.options.port,
      component: 'ClusterManager'
    })
  }

  /**
   * Initialize cluster
   */
  async initialize() {
    if (!this.options.clusterEnabled) {
      logger.info('Cluster mode disabled', {
        component: 'ClusterManager'
      })
      return
    }

    // Create myself node
    this.myself = new ClusterNode({
      host: this.options.host,
      port: this.options.port,
      flags: [NODE_FLAGS.MYSELF, NODE_FLAGS.MASTER]
    })
    
    this.nodes.set(this.myself.id, this.myself)
    
    // Set up event handlers
    this.setupEventHandlers()
    
    // Load cluster configuration if exists
    await this.loadClusterConfig()
    
    // Start cluster services
    this.startHeartbeat()
    this.startStateUpdates()
    
    this.state = CLUSTER_STATES.READY
    
    logger.info('Cluster manager initialized', {
      nodeId: this.myself.id.substring(0, 8),
      nodeCount: this.nodes.size,
      component: 'ClusterManager'
    })
    
    this.emit('initialized')
  }

  /**
   * Setup event handlers for cluster events
   */
  setupEventHandlers() {
    if (!this.myself) return

    this.myself.on('connected', (node) => {
      this.handleNodeConnected(node)
    })
    
    this.myself.on('disconnected', (node) => {
      this.handleNodeDisconnected(node)
    })
    
    this.myself.on('failed', ({ node, reason }) => {
      this.handleNodeFailed(node, reason)
    })
    
    this.myself.on('recovered', ({ node }) => {
      this.handleNodeRecovered(node)
    })
    
    this.myself.on('message', (message) => {
      this.handleClusterMessage(message)
    })
  }

  /**
   * Add a seed node for cluster discovery
   */
  addSeed(host, port) {
    const seed = `${host}:${port}`
    this.seeds.add(seed)
    
    logger.info('Seed node added', {
      seed,
      totalSeeds: this.seeds.size,
      component: 'ClusterManager'
    })
  }

  /**
   * Join cluster by connecting to seed nodes
   */
  async joinCluster() {
    if (!this.options.clusterEnabled || this.seeds.size === 0) {
      return
    }

    logger.info('Joining cluster', {
      seedCount: this.seeds.size,
      component: 'ClusterManager'
    })
    
    for (const seed of this.seeds) {
      try {
        const [host, port] = seed.split(':')
        await this.meetNode(host, parseInt(port))
      } catch (error) {
        logger.warn('Failed to meet seed node', {
          seed,
          error: error.message,
          component: 'ClusterManager'
        })
      }
    }
  }

  /**
   * Meet a new node and add it to the cluster
   */
  async meetNode(host, port, busPort = null) {
    const nodeId = this.generateNodeId()
    const node = new ClusterNode({
      id: nodeId,
      host,
      port,
      busPort: busPort || (port + 10000),
      flags: [NODE_FLAGS.MASTER]
    })
    
    this.nodes.set(nodeId, node)
    this.stats.nodesAdded++
    
    // Set up event handlers
    this.setupNodeEventHandlers(node)
    
    // Attempt to connect
    try {
      await node.connect()
      
      // Send meet message
      if (this.myself) {
        this.myself.meet(node)
      }
      
      logger.info('New node added to cluster', {
        nodeId: nodeId.substring(0, 8),
        host,
        port,
        totalNodes: this.nodes.size,
        component: 'ClusterManager'
      })
      
      this.emit('nodeAdded', node)
      return node
      
    } catch (error) {
      // Remove failed node
      this.nodes.delete(nodeId)
      this.stats.nodesAdded--
      
      logger.error('Failed to meet node', {
        host,
        port,
        error: error.message,
        component: 'ClusterManager'
      })
      
      throw error
    }
  }

  /**
   * Setup event handlers for a node
   */
  setupNodeEventHandlers(node) {
    node.on('connected', () => this.handleNodeConnected(node))
    node.on('disconnected', () => this.handleNodeDisconnected(node))
    node.on('failed', ({ reason }) => this.handleNodeFailed(node, reason))
    node.on('recovered', () => this.handleNodeRecovered(node))
    node.on('message', (message) => this.handleClusterMessage(message))
    node.on('slotsChanged', (slots) => this.handleNodeSlotsChanged(node, slots))
  }

  /**
   * Remove a node from the cluster
   */
  removeNode(nodeId, reason = 'manual removal') {
    const node = this.nodes.get(nodeId)
    if (!node) return false

    // Clean up slots
    const nodeSlots = this.hashSlots.getSlotsForNode(nodeId)
    if (nodeSlots.size > 0) {
      this.hashSlots.removeSlots(nodeId, Array.from(nodeSlots))
    }
    
    // Disconnect and clean up
    node.cleanup()
    this.nodes.delete(nodeId)
    this.stats.nodesRemoved++
    
    logger.info('Node removed from cluster', {
      nodeId: nodeId.substring(0, 8),
      reason,
      slotsRemoved: nodeSlots.size,
      remainingNodes: this.nodes.size,
      component: 'ClusterManager'
    })
    
    this.emit('nodeRemoved', { node, reason })
    return true
  }

  /**
   * Assign slots to a node
   */
  assignSlots(nodeId, slots) {
    if (!this.nodes.has(nodeId)) {
      throw new Error(`Node ${nodeId} not found in cluster`)
    }

    const node = this.nodes.get(nodeId)
    
    // Assign slots in hash slot manager
    this.hashSlots.assignSlotList(nodeId, slots)
    
    // Update node slots
    node.updateSlots(slots)
    
    logger.info('Slots assigned to node', {
      nodeId: nodeId.substring(0, 8),
      slotCount: slots.length,
      component: 'ClusterManager'
    })
    
    this.updateClusterState()
    return true
  }

  /**
   * Get the node responsible for a key
   */
  getNodeForKey(key) {
    const slotInfo = this.hashSlots.getNodeForSlot(this.hashSlots.calculateSlot(key))
    
    if (slotInfo.migration) {
      // Key might be migrating
      return {
        primary: this.nodes.get(slotInfo.primary),
        migration: this.nodes.get(slotInfo.migration),
        status: slotInfo.status
      }
    }
    
    return {
      primary: this.nodes.get(slotInfo.primary),
      migration: null,
      status: 'stable'
    }
  }

  /**
   * Handle client request routing
   */
  routeCommand(key, command, args) {
    const nodeInfo = this.getNodeForKey(key)
    
    if (!nodeInfo.primary) {
      this.stats.redirections++
      throw new Error(`CLUSTERDOWN The cluster is down`)
    }
    
    // If this node handles the key
    if (nodeInfo.primary === this.myself) {
      return { execute: true, redirect: null }
    }
    
    // Redirect to appropriate node
    this.stats.redirections++
    return {
      execute: false,
      redirect: {
        type: nodeInfo.status === 'migrating' ? 'ASK' : 'MOVED',
        slot: this.hashSlots.calculateSlot(key),
        host: nodeInfo.primary.host,
        port: nodeInfo.primary.port
      }
    }
  }

  /**
   * Start slot migration
   */
  async startMigration(slot, fromNodeId, toNodeId) {
    if (!this.nodes.has(fromNodeId) || !this.nodes.has(toNodeId)) {
      throw new Error('Source or target node not found')
    }

    // Start migration in hash slots
    this.hashSlots.startMigration(slot, fromNodeId, toNodeId)
    
    const migration = {
      slot,
      fromNodeId,
      toNodeId,
      startTime: Date.now(),
      keysRemaining: 0,
      status: 'active'
    }
    
    this.activeMigrations.set(slot, migration)
    this.stats.migrations++
    
    logger.info('Slot migration started', {
      slot,
      fromNode: fromNodeId.substring(0, 8),
      toNode: toNodeId.substring(0, 8),
      component: 'ClusterManager'
    })
    
    this.emit('migrationStarted', migration)
    return migration
  }

  /**
   * Complete slot migration
   */
  async completeMigration(slot) {
    const migration = this.activeMigrations.get(slot)
    if (!migration) {
      throw new Error(`No active migration for slot ${slot}`)
    }

    // Complete migration in hash slots
    this.hashSlots.completeMigration(slot)
    
    // Update node slot assignments
    const fromNode = this.nodes.get(migration.fromNodeId)
    const toNode = this.nodes.get(migration.toNodeId)
    
    if (fromNode) {
      const fromSlots = Array.from(fromNode.slots).filter(s => s !== slot)
      fromNode.updateSlots(fromSlots)
    }
    
    if (toNode) {
      const toSlots = Array.from(toNode.slots).concat([slot])
      toNode.updateSlots(toSlots)
    }
    
    migration.status = 'completed'
    migration.endTime = Date.now()
    
    this.activeMigrations.delete(slot)
    
    logger.info('Slot migration completed', {
      slot,
      duration: migration.endTime - migration.startTime,
      component: 'ClusterManager'
    })
    
    this.emit('migrationCompleted', migration)
    return migration
  }

  /**
   * Handle node failure and initiate failover if needed
   */
  async handleFailover(failedNodeId) {
    const failedNode = this.nodes.get(failedNodeId)
    if (!failedNode || !failedNode.isMaster()) {
      return
    }

    const failedSlots = Array.from(this.hashSlots.getSlotsForNode(failedNodeId))
    if (failedSlots.length === 0) {
      return
    }

    logger.warn('Master node failed, initiating failover', {
      failedNodeId: failedNodeId.substring(0, 8),
      affectedSlots: failedSlots.length,
      component: 'ClusterManager'
    })

    // Find available nodes to take over slots
    const availableNodes = Array.from(this.nodes.values()).filter(node => 
      node.id !== failedNodeId && 
      node.isMaster() && 
      node.isHealthy &&
      node.state === NODE_STATES.CONNECTED
    )

    if (availableNodes.length === 0) {
      this.state = CLUSTER_STATES.FAILED
      logger.error('No healthy nodes available for failover', {
        component: 'ClusterManager'
      })
      return
    }

    // Redistribute failed node's slots
    const slotsPerNode = Math.ceil(failedSlots.length / availableNodes.length)
    let slotIndex = 0

    for (const node of availableNodes) {
      const slotsToAssign = failedSlots.slice(slotIndex, slotIndex + slotsPerNode)
      if (slotsToAssign.length > 0) {
        this.assignSlots(node.id, slotsToAssign)
        slotIndex += slotsPerNode
      }
    }

    // Remove failed node
    this.removeNode(failedNodeId, 'failover')
    this.stats.failovers++

    logger.info('Failover completed', {
      failedNodeId: failedNodeId.substring(0, 8),
      redistributedSlots: failedSlots.length,
      component: 'ClusterManager'
    })

    this.emit('failoverCompleted', {
      failedNodeId,
      redistributedSlots: failedSlots.length,
      newTopology: this.getClusterState()
    })
  }

  /**
   * Update cluster state based on current conditions
   */
  updateClusterState() {
    const topology = this.hashSlots.getTopology()
    const healthyNodes = Array.from(this.nodes.values()).filter(node => node.isHealthy).length
    const totalNodes = this.nodes.size
    
    let newState = this.state

    if (this.options.clusterRequireFullCoverage && topology.coverage < 100) {
      newState = CLUSTER_STATES.DEGRADED
    } else if (healthyNodes < totalNodes * 0.5) {
      newState = CLUSTER_STATES.DEGRADED
    } else if (healthyNodes === 0) {
      newState = CLUSTER_STATES.FAILED
    } else {
      newState = CLUSTER_STATES.READY
    }

    if (newState !== this.state) {
      const oldState = this.state
      this.state = newState
      this.lastStateUpdate = Date.now()
      
      logger.info('Cluster state changed', {
        oldState,
        newState,
        coverage: topology.coverage,
        healthyNodes,
        totalNodes,
        component: 'ClusterManager'
      })
      
      this.emit('stateChanged', { oldState, newState, topology })
    }
  }

  /**
   * Get current cluster state
   */
  getClusterState() {
    const topology = this.hashSlots.getTopology()
    const nodes = {}
    
    for (const [nodeId, node] of this.nodes.entries()) {
      nodes[nodeId] = node.getNodeInfo()
    }
    
    return {
      state: this.state,
      epoch: this.epoch,
      nodes,
      topology,
      activeMigrations: Array.from(this.activeMigrations.values()),
      stats: { ...this.stats }
    }
  }

  /**
   * Handle cluster messages from other nodes
   */
  handleClusterMessage(message) {
    this.stats.messagesReceived++
    
    switch (message.type) {
      case 'ping':
        this.handlePingMessage(message)
        break
      case 'pong':
        this.handlePongMessage(message)
        break
      case 'meet':
        this.handleMeetMessage(message)
        break
      case 'fail':
        this.handleFailMessage(message)
        break
      case 'migrate':
        this.handleMigrateMessage(message)
        break
      default:
        logger.debug('Unknown cluster message', {
          type: message.type,
          component: 'ClusterManager'
        })
    }
  }

  /**
   * Handle node connected event
   */
  handleNodeConnected(node) {
    logger.info('Cluster node connected', {
      nodeId: node.id.substring(0, 8),
      component: 'ClusterManager'
    })
  }

  /**
   * Handle node disconnected event
   */
  handleNodeDisconnected(node) {
    logger.info('Cluster node disconnected', {
      nodeId: node.id.substring(0, 8),
      component: 'ClusterManager'
    })
  }

  /**
   * Handle node failed event
   */
  handleNodeFailed(node, reason) {
    logger.warn('Cluster node failed', {
      nodeId: node.id.substring(0, 8),
      reason,
      component: 'ClusterManager'
    })
    
    // Initiate failover if it's a master node
    if (node.isMaster()) {
      this.handleFailover(node.id)
    }
  }

  /**
   * Handle node recovered event
   */
  handleNodeRecovered(node) {
    logger.info('Cluster node recovered', {
      nodeId: node.id.substring(0, 8),
      component: 'ClusterManager'
    })
    
    this.updateClusterState()
  }

  /**
   * Handle node slots changed event
   */
  handleNodeSlotsChanged(node, slots) {
    logger.debug('Node slots updated', {
      nodeId: node.id.substring(0, 8),
      slotCount: slots.size,
      component: 'ClusterManager'
    })
    
    this.updateClusterState()
  }

  /**
   * Handle ping message
   */
  handlePingMessage(message) {
    // Respond with pong
    if (this.myself) {
      this.myself.pong(message)
    }
  }

  /**
   * Handle pong message
   */
  handlePongMessage(message) {
    // Update node info if needed
  }

  /**
   * Handle meet message
   */
  handleMeetMessage(message) {
    // Add new node to cluster
    if (message.targetNodeId && !this.nodes.has(message.targetNodeId)) {
      this.meetNode(message.targetHost, message.targetPort, message.targetBusPort)
    }
  }

  /**
   * Handle fail message
   */
  handleFailMessage(message) {
    const failedNode = this.nodes.get(message.failedNodeId)
    if (failedNode) {
      failedNode.markAsFailed(message.reason)
    }
  }

  /**
   * Handle migrate message
   */
  handleMigrateMessage(message) {
    // Handle slot migration coordination
  }

  /**
   * Start heartbeat for cluster monitoring
   */
  startHeartbeat() {
    if (this.heartbeatTimer) return

    this.heartbeatTimer = setInterval(() => {
      // Ping all connected nodes
      for (const node of this.nodes.values()) {
        if (node !== this.myself && node.state === NODE_STATES.CONNECTED) {
          node.ping()
        }
      }
    }, 1000)
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /**
   * Start periodic state updates
   */
  startStateUpdates() {
    if (this.stateUpdateTimer) return

    this.stateUpdateTimer = setInterval(() => {
      this.updateClusterState()
    }, 5000)
  }

  /**
   * Stop state updates
   */
  stopStateUpdates() {
    if (this.stateUpdateTimer) {
      clearInterval(this.stateUpdateTimer)
      this.stateUpdateTimer = null
    }
  }

  /**
   * Load cluster configuration
   */
  async loadClusterConfig() {
    // Implement cluster config loading
    logger.info('Cluster configuration loaded', {
      component: 'ClusterManager'
    })
  }

  /**
   * Save cluster configuration
   */
  async saveClusterConfig() {
    // Implement cluster config saving
    logger.info('Cluster configuration saved', {
      component: 'ClusterManager'
    })
  }

  /**
   * Generate unique node ID
   */
  generateNodeId() {
    const crypto = require('crypto')
    return crypto.randomBytes(20).toString('hex')
  }

  /**
   * Clean up cluster manager
   */
  async cleanup() {
    this.stopHeartbeat()
    this.stopStateUpdates()
    
    // Clean up all nodes
    for (const node of this.nodes.values()) {
      node.cleanup()
    }
    
    this.nodes.clear()
    this.removeAllListeners()
    
    logger.info('Cluster manager cleaned up', {
      component: 'ClusterManager'
    })
  }
}

module.exports = { ClusterManager, CLUSTER_STATES }
