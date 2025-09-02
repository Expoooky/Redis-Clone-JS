/**
 * Master.js - Redis master server implementation for replication
 * 
 * This module handles master-specific functionality in the replication system,
 * including slave management, command broadcasting, and synchronization.
 */

const { EventEmitter } = require('events')
const logger = require('../utils/Logger')

/**
 * Master server for replication system
 */
class Master extends EventEmitter {
  constructor(server, replicationManager) {
    super()
    
    this.server = server
    this.replicationManager = replicationManager
    this.slaves = new Map() // Enhanced slave tracking
    this.replicationQueue = [] // Queue for reliable command delivery
    this.replicationStats = {
      commandsSent: 0,
      bytesSent: 0,
      slavesConnected: 0,
      slavesDisconnected: 0
    }
    
    logger.info('Master server initialized', {
      component: 'Master'
    })
  }

  /**
   * Register a new slave connection
   */
  async registerSlave(client) {
    const slaveId = `slave_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    const slaveInfo = {
      id: slaveId,
      client,
      socket: client.socket,
      connected: true,
      registeredAt: Date.now(),
      lastPingTime: Date.now(),
      lastAckTime: Date.now(),
      offset: 0,
      capabilities: [],
      commandsSent: 0,
      bytesSent: 0,
      address: client.address || client.socket.remoteAddress + ':' + client.socket.remotePort
    }
    
    this.slaves.set(slaveId, slaveInfo)
    this.replicationStats.slavesConnected++
    
    // Setup slave connection handlers
    this.setupSlaveHandlers(slaveInfo)
    
    logger.info('Slave registered', {
      component: 'Master',
      slaveId,
      address: slaveInfo.address,
      totalSlaves: this.slaves.size
    })
    
    // Perform full synchronization for new slave
    await this.performFullSync(slaveInfo)
    
    this.emit('slaveRegistered', slaveInfo)
    
    return slaveId
  }

  /**
   * Setup event handlers for slave connection
   */
  setupSlaveHandlers(slaveInfo) {
    slaveInfo.socket.on('close', () => {
      this.handleSlaveDisconnection(slaveInfo.id)
    })
    
    slaveInfo.socket.on('error', (error) => {
      logger.error('Slave connection error', error, {
        component: 'Master',
        slaveId: slaveInfo.id
      })
      this.handleSlaveDisconnection(slaveInfo.id)
    })
  }

  /**
   * Perform full synchronization with slave
   */
  async performFullSync(slaveInfo) {
    logger.info('Starting full sync with slave', {
      component: 'Master',
      slaveId: slaveInfo.id
    })
    
    try {
      // Generate RDB snapshot
      const rdbData = await this.generateRDBForSlave()
      
      // Send FULLRESYNC response
      const replId = this.replicationManager.replicationId
      const offset = this.replicationManager.replicationOffset
      
      const fullresyncResponse = `+FULLRESYNC ${replId} ${offset}\r\n`
      await this.sendToSlave(slaveInfo, fullresyncResponse, false)
      
      // Send RDB data as bulk string
      const rdbHeader = `$${rdbData.length}\r\n`
      await this.sendToSlave(slaveInfo, rdbHeader, false)
      await this.sendToSlave(slaveInfo, rdbData, false)
      
      // Update slave offset
      slaveInfo.offset = offset
      
      logger.info('Full sync completed', {
        component: 'Master',
        slaveId: slaveInfo.id,
        rdbSize: rdbData.length,
        offset
      })
      
      this.emit('fullSyncCompleted', slaveInfo)
      
    } catch (error) {
      logger.error('Full sync failed', error, {
        component: 'Master',
        slaveId: slaveInfo.id
      })
      
      // Disconnect problematic slave
      this.disconnectSlave(slaveInfo.id)
      throw error
    }
  }

  /**
   * Generate RDB snapshot for slave synchronization
   */
  async generateRDBForSlave() {
    const databases = []
    
    // Collect data from all databases
    for (let dbIndex = 0; dbIndex < 16; dbIndex++) {
      this.server.dataStore.select(dbIndex)
      const keysResult = this.server.dataStore.keys('*')
      const keys = keysResult.success ? keysResult.value : []
      
      if (keys.length > 0) {
        const dbData = {
          index: dbIndex,
          keys: {}
        }
        
        for (const key of keys) {
          const getResult = this.server.dataStore.get(key)
          if (getResult.success) {
            const ttlResult = this.server.keyExpiration.ttl(key)
            const ttl = ttlResult.success ? ttlResult.value : -1
            
            dbData.keys[key] = {
              value: getResult.value,
              type: getResult.type || 'string',
              ttl: ttl > 0 ? ttl : null,
              encoding: 'raw'
            }
          }
        }
        
        databases.push(dbData)
      }
    }
    
    // Create RDB format (simplified JSON for now)
    const rdbContent = {
      magic: 'REDIS',
      version: '0009',
      created: Date.now(),
      databases,
      checksum: 'PLACEHOLDER'
    }
    
    // Serialize to buffer
    const jsonData = JSON.stringify(rdbContent)
    return Buffer.from(jsonData, 'utf8')
  }

  /**
   * Broadcast command to all slaves
   */
  async broadcastCommand(command, args, dbIndex = 0) {
    if (this.slaves.size === 0) {
      logger.debug('No slaves to replicate command to', {
        component: 'Master',
        command
      })
      return // No slaves to replicate to
    }
    
    logger.info('Broadcasting command to slaves', {
      component: 'Master',
      command,
      args,
      slaveCount: this.slaves.size
    })
    
    // Create RESP command
    const parts = [command, ...args]
    const respCommand = this.createRESPCommand(parts)
    
    logger.debug('RESP command created', {
      component: 'Master',
      respCommand: respCommand.substring(0, 100) + (respCommand.length > 100 ? '...' : '')
    })
    
    // Add to replication queue for reliability
    const queueItem = {
      id: Date.now() + Math.random(),
      command: respCommand,
      dbIndex,
      timestamp: Date.now(),
      attempts: 0,
      maxAttempts: 3
    }
    
    this.replicationQueue.push(queueItem)
    
    // Send to all connected slaves
    const broadcastPromises = []
    
    for (const [slaveId, slaveInfo] of this.slaves) {
      if (slaveInfo.connected) {
        broadcastPromises.push(
          this.sendCommandToSlave(slaveInfo, respCommand, dbIndex)
            .catch(error => {
              logger.error('Failed to send command to slave', error, {
                component: 'Master',
                slaveId,
                command
              })
              return { slaveId, error }
            })
        )
      }
    }
    
    try {
      const results = await Promise.allSettled(broadcastPromises)
      
      // Update stats
      this.replicationStats.commandsSent++
      this.replicationStats.bytesSent += respCommand.length
      
      // Check for failed sends
      const failures = results.filter(result => 
        result.status === 'rejected' || 
        (result.value && result.value.error)
      )
      
      if (failures.length > 0) {
        logger.warn('Some slaves failed to receive command', {
          component: 'Master',
          failures: failures.length,
          totalSlaves: this.slaves.size
        })
      }
      
    } catch (error) {
      logger.error('Command broadcast failed', error, {
        component: 'Master',
        command
      })
    }
  }

  /**
   * Send command to specific slave
   */
  async sendCommandToSlave(slaveInfo, command, dbIndex) {
    try {
      // Ensure correct database is selected on slave
      if (slaveInfo.currentDb !== dbIndex) {
        const selectCommand = this.createRESPCommand(['SELECT', dbIndex.toString()])
        await this.sendToSlave(slaveInfo, selectCommand)
        slaveInfo.currentDb = dbIndex
      }
      
      // Send the actual command
      await this.sendToSlave(slaveInfo, command)
      
      // Update stats
      slaveInfo.commandsSent++
      slaveInfo.bytesSent += command.length
      slaveInfo.lastPingTime = Date.now()
      
    } catch (error) {
      logger.error('Failed to send command to slave', error, {
        component: 'Master',
        slaveId: slaveInfo.id
      })
      
      // Mark slave as problematic
      slaveInfo.connected = false
      throw error
    }
  }

  /**
   * Send raw data to slave
   */
  async sendToSlave(slaveInfo, data, updateOffset = true) {
    if (!slaveInfo.connected || !slaveInfo.socket) {
      throw new Error('Slave not connected')
    }
    
    return new Promise((resolve, reject) => {
      slaveInfo.socket.write(data, (error) => {
        if (error) {
          reject(error)
        } else {
          if (updateOffset) {
            slaveInfo.offset += data.length
          }
          resolve()
        }
      })
    })
  }

  /**
   * Create RESP protocol command
   */
  createRESPCommand(parts) {
    return `*${parts.length}\r\n` + 
           parts.map(part => `$${part.toString().length}\r\n${part}\r\n`).join('')
  }

  /**
   * Handle slave disconnection
   */
  handleSlaveDisconnection(slaveId) {
    const slaveInfo = this.slaves.get(slaveId)
    
    if (slaveInfo) {
      slaveInfo.connected = false
      this.slaves.delete(slaveId)
      this.replicationStats.slavesDisconnected++
      
      logger.info('Slave disconnected', {
        component: 'Master',
        slaveId,
        duration: Date.now() - slaveInfo.registeredAt,
        commandsSent: slaveInfo.commandsSent,
        totalSlaves: this.slaves.size
      })
      
      this.emit('slaveDisconnected', slaveInfo)
    }
  }

  /**
   * Manually disconnect a slave
   */
  disconnectSlave(slaveId) {
    const slaveInfo = this.slaves.get(slaveId)
    
    if (slaveInfo && slaveInfo.connected) {
      logger.info('Disconnecting slave', {
        component: 'Master',
        slaveId
      })
      
      try {
        slaveInfo.socket.end()
      } catch (error) {
        logger.error('Error disconnecting slave', error, {
          component: 'Master',
          slaveId
        })
      }
      
      this.handleSlaveDisconnection(slaveId)
    }
  }

  /**
   * Get master statistics
   */
  getStats() {
    return {
      role: 'master',
      connectedSlaves: Array.from(this.slaves.values()).filter(s => s.connected).length,
      totalSlaves: this.slaves.size,
      replication: this.replicationStats,
      slaves: Array.from(this.slaves.values()).map(slave => ({
        id: slave.id,
        address: slave.address,
        connected: slave.connected,
        offset: slave.offset,
        lag: Date.now() - slave.lastPingTime,
        commandsSent: slave.commandsSent,
        bytesSent: slave.bytesSent
      }))
    }
  }

  /**
   * Ping all connected slaves
   */
  async pingSlaves() {
    if (this.slaves.size === 0) {
      return
    }
    
    const pingCommand = this.createRESPCommand(['PING'])
    const pingPromises = []
    
    for (const [slaveId, slaveInfo] of this.slaves) {
      if (slaveInfo.connected) {
        pingPromises.push(
          this.sendToSlave(slaveInfo, pingCommand)
            .catch(error => {
              logger.warn('Ping failed for slave', {
                component: 'Master',
                slaveId,
                error: error.message
              })
              return { slaveId, error }
            })
        )
      }
    }
    
    try {
      await Promise.allSettled(pingPromises)
    } catch (error) {
      logger.error('Slave ping operation failed', error, {
        component: 'Master'
      })
    }
  }

  /**
   * Process replication queue for reliable delivery
   */
  async processReplicationQueue() {
    if (this.replicationQueue.length === 0) {
      return
    }
    
    const now = Date.now()
    const retryItems = this.replicationQueue.filter(item => 
      item.attempts < item.maxAttempts && 
      (now - item.timestamp) > 1000 // Retry after 1 second
    )
    
    for (const item of retryItems) {
      item.attempts++
      
      try {
        await this.broadcastCommand(item.command, [], item.dbIndex)
        
        // Remove from queue on success
        const index = this.replicationQueue.indexOf(item)
        if (index > -1) {
          this.replicationQueue.splice(index, 1)
        }
        
      } catch (error) {
        logger.error('Replication queue item failed', error, {
          component: 'Master',
          itemId: item.id,
          attempts: item.attempts
        })
        
        // Remove if max attempts reached
        if (item.attempts >= item.maxAttempts) {
          const index = this.replicationQueue.indexOf(item)
          if (index > -1) {
            this.replicationQueue.splice(index, 1)
          }
        }
      }
    }
  }

  /**
   * Clean up master resources
   */
  cleanup() {
    // Disconnect all slaves
    for (const [slaveId, slaveInfo] of this.slaves) {
      try {
        if (slaveInfo.connected && slaveInfo.socket) {
          slaveInfo.socket.end()
        }
      } catch (error) {
        logger.error('Error cleaning up slave connection', error, {
          component: 'Master',
          slaveId
        })
      }
    }
    
    this.slaves.clear()
    this.replicationQueue = []
    
    logger.info('Master cleaned up', {
      component: 'Master'
    })
  }
}

module.exports = { Master }
