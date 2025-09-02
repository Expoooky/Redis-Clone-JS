/**
 * ReplicationManager.js - Coordinates Redis replication between master and slaves
 * 
 * This module manages the replication system, handling master-slave relationships,
 * data synchronization, and command forwarding.
 */

const { EventEmitter } = require('events')
const net = require('net')
const logger = require('../utils/Logger')
const config = require('../utils/Config')

/**
 * Manages replication for the Redis server
 */
class ReplicationManager extends EventEmitter {
  constructor(server) {
    super()
    
    this.server = server
    this.role = config.get('replication.role', 'master')
    this.slaves = new Map() // slaveId -> slave connection info
    this.master = null // master connection info if this is a slave
    this.replicationId = this.generateReplicationId()
    this.replicationOffset = 0
    this.replicationBuffer = [] // Buffer for partial sync
    this.maxReplicationBuffer = 1024 * 1024 // 1MB buffer
    
    logger.info('ReplicationManager initialized', {
      component: 'ReplicationManager',
      role: this.role,
      replicationId: this.replicationId
    })
  }

  /**
   * Initialize replication system
   */
  async initialize() {
    if (this.role === 'slave') {
      await this.initializeSlave()
    } else {
      await this.initializeMaster()
    }
  }

  /**
   * Initialize as master server
   */
  async initializeMaster() {
    this.role = 'master'
    
    logger.info('Initializing as master server', {
      component: 'ReplicationManager'
    })
    
    // Master is ready to accept slave connections
    this.emit('masterReady')
  }

  /**
   * Initialize as slave server
   */
  async initializeSlave() {
    const masterHost = config.get('replication.masterHost')
    const masterPort = config.get('replication.masterPort', 6379)
    const masterAuth = config.get('replication.masterAuth')
    
    if (!masterHost) {
      logger.info('No master host configured for slave server', {
        component: 'ReplicationManager'
      })
      return // Just be a standalone server
    }
    
    logger.info('Initializing as slave server', {
      component: 'ReplicationManager',
      masterHost,
      masterPort
    })
    
    // Connect to master in background (don't block initialization)
    this.connectToMasterWithRetry(masterHost, masterPort, masterAuth)
  }

  /**
   * Connect to master with retry logic (non-blocking)
   */
  async connectToMasterWithRetry(masterHost, masterPort, masterAuth) {
    let attempts = 0
    const maxAttempts = 5
    
    while (attempts < maxAttempts) {
      try {
        await this.connectToMaster(masterHost, masterPort, masterAuth)
        logger.info('Successfully connected to master', {
          component: 'ReplicationManager'
        })
        
        // Request initial sync
        await this.requestInitialSync()
        return // Success
      } catch (error) {
        attempts++
        logger.warn(`Failed to connect to master (attempt ${attempts}/${maxAttempts})`, {
          component: 'ReplicationManager',
          error: error.message
        })
        
        if (attempts >= maxAttempts) {
          logger.error('Failed to connect to master after multiple attempts', error, {
            component: 'ReplicationManager'
          })
          return
        }
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.min(1000 * attempts, 5000)))
      }
    }
  }

  /**
   * Connect to master server (for slave)
   */
  async connectToMaster(host, port, auth = null) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(port, host)
      let connected = false
      let buffer = ''
      
      socket.on('connect', async () => {
        logger.info('Connected to master server', {
          component: 'ReplicationManager',
          masterHost: host,
          masterPort: port
        })
        
        this.master = {
          socket,
          host,
          port,
          connected: true,
          lastPingTime: Date.now()
        }
        
        connected = true
        
        try {
          // Send PSYNC command to initiate replication
          const psyncCommand = '*3\r\n$5\r\nPSYNC\r\n$1\r\n?\r\n$2\r\n-1\r\n'
          socket.write(psyncCommand)
          
          logger.info('Sent PSYNC command to master', {
            component: 'ReplicationManager'
          })
          
          resolve()
        } catch (error) {
          reject(error)
        }
      })
      
      socket.on('data', (data) => {
        buffer += data.toString()
        this.processMasterData(buffer)
        buffer = '' // Clear buffer after processing
      })
      
      socket.on('error', (error) => {
        logger.error('Master connection error', error, {
          component: 'ReplicationManager'
        })
        this.master = null
        this.emit('masterDisconnected', error)
        if (!connected) {
          reject(error)
        }
      })
      
      socket.on('close', () => {
        logger.warn('Master connection closed', {
          component: 'ReplicationManager'
        })
        this.master = null
        this.emit('masterDisconnected')
      })
      
      // Connection timeout
      setTimeout(() => {
        if (!connected) {
          socket.destroy()
          reject(new Error('Master connection timeout'))
        }
      }, 3000)
    })
  }

  /**
   * Process data received from master
   */
  processMasterData(buffer) {
    // Parse RESP data from master
    // This would contain replicated commands and sync data
    
    logger.info('Received data from master', {
      component: 'ReplicationManager',
      dataLength: buffer.length,
      preview: buffer.substring(0, 100) + (buffer.length > 100 ? '...' : '')
    })
    
    try {
      // Handle FULLRESYNC response
      if (buffer.includes('FULLRESYNC')) {
        logger.info('Received FULLRESYNC response from master', {
          component: 'ReplicationManager'
        })
        
        // Extract replication ID and offset
        const lines = buffer.split('\r\n')
        for (const line of lines) {
          if (line.startsWith('+FULLRESYNC')) {
            const parts = line.split(' ')
            if (parts.length >= 3) {
              this.replicationId = parts[1]
              this.replicationOffset = parseInt(parts[2], 10) || 0
              logger.info('Master replication info received', {
                component: 'ReplicationManager',
                replId: this.replicationId,
                offset: this.replicationOffset
              })
            }
          }
        }
      }
      
      // Handle RDB data (bulk string format)
      if (buffer.includes('$') && buffer.includes('REDIS')) {
        logger.info('Received RDB data from master', {
          component: 'ReplicationManager',
          size: buffer.length
        })
        // In a real implementation, we would parse and load the RDB data
        // For now, just acknowledge receipt
      }
      
      // Handle replicated commands (RESP arrays)
      if (buffer.includes('*') && buffer.includes('$') && !buffer.includes('FULLRESYNC')) {
        logger.info('Received replicated command from master', {
          component: 'ReplicationManager'
        })
        
        // Forward to server for execution
        if (this.server && this.server.handleMasterReplicationData) {
          this.server.handleMasterReplicationData(buffer)
        }
      }
      
      // Handle PING commands
      if (buffer.includes('PING')) {
        logger.debug('Received PING from master', {
          component: 'ReplicationManager'
        })
      }
      
    } catch (error) {
      logger.error('Error processing master data', error, {
        component: 'ReplicationManager'
      })
    }
  }

  /**
   * Send command to master
   */
  async sendToMaster(command, ...args) {
    if (!this.master || !this.master.connected) {
      throw new Error('Not connected to master')
    }
    
    const parts = [command, ...args]
    const respCommand = `*${parts.length}\r\n` + 
      parts.map(part => `$${part.length}\r\n${part}\r\n`).join('')
    
    this.master.socket.write(respCommand)
  }

  /**
   * Request initial synchronization from master  
   */
  async requestInitialSync() {
    if (!this.master || !this.master.connected) {
      throw new Error('Not connected to master')
    }
    
    logger.info('Requesting initial sync from master', {
      component: 'ReplicationManager'
    })
    
    try {
      // Send a simple command to trigger master to send us data
      // In a real Redis implementation, this would be PSYNC
      // For our implementation, we'll use a simple approach
      await this.sendToMaster('PING')
      
      // The master should send us current data when it sees we're a slave
      logger.info('Initial sync request sent', {
        component: 'ReplicationManager'
      })
    } catch (error) {
      logger.error('Failed to request initial sync', error, {
        component: 'ReplicationManager'
      })
      throw error
    }
  }

  /**
   * Request full synchronization from master
   */
  async requestFullSync() {
    logger.info('Requesting full sync from master', {
      component: 'ReplicationManager'
    })
    
    // Send PSYNC command for full sync
    await this.sendToMaster('PSYNC', '?', '-1')
  }

  /**
   * Handle new slave connection (for master)
   */
  async handleSlaveConnection(client) {
    if (this.role !== 'master') {
      throw new Error('Only master can accept slave connections')
    }
    
    const slaveId = `slave_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    const slaveInfo = {
      id: slaveId,
      client,
      connected: true,
      offset: 0,
      lastAckTime: Date.now(),
      capabilities: []
    }
    
    this.slaves.set(slaveId, slaveInfo)
    
    logger.info('New slave connected', {
      component: 'ReplicationManager',
      slaveId,
      totalSlaves: this.slaves.size
    })
    
    // Send full sync to new slave
    await this.sendFullSyncToSlave(slaveInfo)
    
    this.emit('slaveConnected', slaveInfo)
    
    return slaveId
  }

  /**
   * Send full database sync to slave
   */
  async sendFullSyncToSlave(slaveInfo) {
    logger.info('Sending full sync to slave', {
      component: 'ReplicationManager',
      slaveId: slaveInfo.id
    })
    
    try {
      // Generate RDB snapshot for full sync
      const rdbData = await this.generateRDBSnapshot()
      
      // Send FULLRESYNC response
      const response = `+FULLRESYNC ${this.replicationId} ${this.replicationOffset}\r\n`
      slaveInfo.client.socket.write(response)
      
      // Send RDB data
      const rdbHeader = `$${rdbData.length}\r\n`
      slaveInfo.client.socket.write(rdbHeader)
      slaveInfo.client.socket.write(rdbData)
      
      // Update slave offset
      slaveInfo.offset = this.replicationOffset
      
      logger.info('Full sync sent to slave', {
        component: 'ReplicationManager',
        slaveId: slaveInfo.id,
        rdbSize: rdbData.length
      })
      
    } catch (error) {
      logger.error('Failed to send full sync to slave', error, {
        component: 'ReplicationManager',
        slaveId: slaveInfo.id
      })
      throw error
    }
  }

  /**
   * Generate RDB snapshot for replication
   */
  async generateRDBSnapshot() {
    // Get all data from the data store
    const databases = []
    
    // For each database, get all keys and their values
    for (let dbIndex = 0; dbIndex < 16; dbIndex++) {
      this.server.dataStore.select(dbIndex)
      const keysResult = this.server.dataStore.keys('*')
      const keys = keysResult.success ? keysResult.value : []
      
      if (keys.length > 0) {
        const dbData = { index: dbIndex, keys: {} }
        
        for (const key of keys) {
          const result = this.server.dataStore.get(key)
          if (result.success) {
            dbData.keys[key] = {
              value: result.value,
              type: result.type,
              ttl: (() => {
                const ttlResult = this.server.keyExpiration.ttl(key)
                return ttlResult.success ? ttlResult.value : -1
              })()
            }
          }
        }
        
        databases.push(dbData)
      }
    }
    
    // Create simple RDB format (JSON for now, could be binary)
    const rdbData = JSON.stringify({
      version: '1.0',
      created: Date.now(),
      databases
    })
    
    return Buffer.from(rdbData, 'utf8')
  }

  /**
   * Replicate command to all slaves (for master)
   */
  async replicateCommand(command, args, dbIndex = 0) {
    if (this.role !== 'master' || this.slaves.size === 0) {
      return
    }
    
    // Create RESP command
    const parts = [command, ...args]
    const respCommand = `*${parts.length}\r\n` + 
      parts.map(part => `$${part.length}\r\n${part}\r\n`).join('')
    
    // Add to replication buffer
    this.replicationBuffer.push({
      offset: this.replicationOffset,
      command: respCommand,
      dbIndex,
      timestamp: Date.now()
    })
    
    // Trim buffer if too large
    if (this.replicationBuffer.length > this.maxReplicationBuffer) {
      this.replicationBuffer = this.replicationBuffer.slice(-this.maxReplicationBuffer / 2)
    }
    
    // Send to all connected slaves
    const slavePromises = []
    
    for (const [slaveId, slaveInfo] of this.slaves) {
      if (slaveInfo.connected) {
        slavePromises.push(this.sendCommandToSlave(slaveInfo, respCommand, dbIndex))
      }
    }
    
    // Update replication offset
    this.replicationOffset += respCommand.length
    
    try {
      await Promise.allSettled(slavePromises)
    } catch (error) {
      logger.error('Error replicating command to slaves', error, {
        component: 'ReplicationManager',
        command
      })
    }
  }

  /**
   * Send command to specific slave
   */
  async sendCommandToSlave(slaveInfo, command, dbIndex) {
    try {
      // Send SELECT command if database changed
      if (slaveInfo.currentDb !== dbIndex) {
        const selectCommand = `*2\r\n$6\r\nSELECT\r\n$${dbIndex.toString().length}\r\n${dbIndex}\r\n`
        slaveInfo.client.socket.write(selectCommand)
        slaveInfo.currentDb = dbIndex
      }
      
      // Send the actual command
      slaveInfo.client.socket.write(command)
      
      logger.debug('Command sent to slave', {
        component: 'ReplicationManager',
        slaveId: slaveInfo.id,
        commandLength: command.length
      })
      
    } catch (error) {
      logger.error('Failed to send command to slave', error, {
        component: 'ReplicationManager',
        slaveId: slaveInfo.id
      })
      
      // Mark slave as disconnected
      slaveInfo.connected = false
      this.emit('slaveError', slaveInfo, error)
    }
  }

  /**
   * Handle slave disconnection
   */
  handleSlaveDisconnection(slaveId) {
    const slaveInfo = this.slaves.get(slaveId)
    if (slaveInfo) {
      slaveInfo.connected = false
      this.slaves.delete(slaveId)
      
      logger.info('Slave disconnected', {
        component: 'ReplicationManager',
        slaveId,
        totalSlaves: this.slaves.size
      })
      
      this.emit('slaveDisconnected', slaveInfo)
    }
  }

  /**
   * Change replication role
   */
  async changeRole(newRole, masterHost = null, masterPort = 6379) {
    if (newRole === this.role) {
      return
    }
    
    logger.info('Changing replication role', {
      component: 'ReplicationManager',
      fromRole: this.role,
      toRole: newRole
    })
    
    // Cleanup current role
    if (this.role === 'slave' && this.master) {
      this.master.socket.end()
      this.master = null
    } else if (this.role === 'master') {
      // Disconnect all slaves
      for (const [slaveId, slaveInfo] of this.slaves) {
        slaveInfo.client.socket.end()
      }
      this.slaves.clear()
    }
    
    this.role = newRole
    
    // Initialize new role
    if (newRole === 'master') {
      await this.initializeMaster()
    } else if (newRole === 'slave' && masterHost) {
      config.set('replication.masterHost', masterHost)
      config.set('replication.masterPort', masterPort)
      await this.initializeSlave()
    }
    
    this.emit('roleChanged', { oldRole: this.role, newRole, masterHost, masterPort })
  }

  /**
   * Get replication info for INFO command
   */
  getReplicationInfo() {
    const info = []
    
    if (this.role === 'master') {
      info.push(`role:master`)
      info.push(`connected_slaves:${this.slaves.size}`)
      info.push(`master_replid:${this.replicationId}`)
      info.push(`master_replid2:${'0'.repeat(40)}`)
      info.push(`master_repl_offset:${this.replicationOffset}`)
      
      // Add slave info
      let slaveIndex = 0
      for (const [slaveId, slaveInfo] of this.slaves) {
        if (slaveInfo.connected) {
          info.push(`slave${slaveIndex}:ip=${slaveInfo.client.address.split(':')[0]},port=${slaveInfo.client.address.split(':')[1]},state=online,offset=${slaveInfo.offset},lag=${Date.now() - slaveInfo.lastAckTime}`)
          slaveIndex++
        }
      }
    } else {
      info.push(`role:slave`)
      const masterHost = this.master?.host || config.get('replication.masterHost', '127.0.0.1')
      const masterPort = this.master?.port || config.get('replication.masterPort', 6379)
      
      info.push(`master_host:${masterHost}`)
      info.push(`master_port:${masterPort}`)
      
      if (this.master) {
        info.push(`master_link_status:${this.master.connected ? 'up' : 'down'}`)
        info.push(`master_last_io_seconds_ago:${Math.floor((Date.now() - this.master.lastPingTime) / 1000)}`)
      } else {
        info.push(`master_link_status:down`)
        info.push(`master_last_io_seconds_ago:-1`)
      }
      
      info.push(`master_sync_in_progress:0`)
      info.push(`slave_repl_offset:${this.replicationOffset}`)
      info.push(`slave_priority:${config.get('replication.slavePriority', 100)}`)
      info.push(`slave_read_only:${config.get('replication.slaveReadOnly', true) ? 1 : 0}`)
    }
    
    return info.join('\r\n')
  }

  /**
   * Generate unique replication ID
   */
  generateReplicationId() {
    return Math.random().toString(36).substr(2, 40).padEnd(40, '0')
  }

  /**
   * Check if this server is read-only (slave)
   */
  isReadOnly() {
    return this.role === 'slave' && config.get('replication.slaveReadOnly', true)
  }

  /**
   * Get connected slaves count
   */
  getSlaveCount() {
    return this.slaves.size
  }

  /**
   * Clean up resources
   */
  cleanup() {
    if (this.master && this.master.socket) {
      this.master.socket.end()
    }
    
    for (const [slaveId, slaveInfo] of this.slaves) {
      if (slaveInfo.client && slaveInfo.client.socket) {
        slaveInfo.client.socket.end()
      }
    }
    
    this.slaves.clear()
    this.replicationBuffer = []
    
    logger.info('ReplicationManager cleaned up', {
      component: 'ReplicationManager'
    })
  }
}

module.exports = { ReplicationManager }
