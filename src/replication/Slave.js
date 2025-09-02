/**
 * Slave.js - Redis slave server implementation for replication
 * 
 * This module handles slave-specific functionality in the replication system,
 * including connecting to master, receiving commands, and maintaining synchronization.
 */

const { EventEmitter } = require('events')
const net = require('net')
const logger = require('../utils/Logger')

/**
 * Slave server for replication system
 */
class Slave extends EventEmitter {
  constructor(server, replicationManager) {
    super()
    
    this.server = server
    this.replicationManager = replicationManager
    this.masterConnection = null
    this.replicationState = 'disconnected' // disconnected, connecting, connected, syncing, sync_complete
    this.masterInfo = {
      host: null,
      port: null,
      replId: null,
      offset: 0
    }
    this.syncStats = {
      fullSyncs: 0,
      partialSyncs: 0,
      commandsReceived: 0,
      bytesReceived: 0,
      lastSyncTime: null
    }
    this.receiveBuffer = ''
    this.isReadOnly = true
    
    logger.info('Slave server initialized', {
      component: 'Slave'
    })
  }

  /**
   * Connect to master server
   */
  async connectToMaster(host, port, auth = null) {
    if (this.replicationState === 'connecting' || this.replicationState === 'connected') {
      return // Already connecting or connected
    }
    
    this.replicationState = 'connecting'
    this.masterInfo.host = host
    this.masterInfo.port = port
    
    logger.info('Connecting to master', {
      component: 'Slave',
      masterHost: host,
      masterPort: port
    })
    
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(port, host)
      let connectionEstablished = false
      
      socket.on('connect', async () => {
        logger.info('Connected to master', {
          component: 'Slave',
          masterHost: host,
          masterPort: port
        })
        
        this.masterConnection = {
          socket,
          connected: true,
          lastPingTime: Date.now(),
          lastReceiveTime: Date.now()
        }
        
        this.replicationState = 'connected'
        connectionEstablished = true
        
        try {
          // Setup connection handlers
          this.setupMasterConnectionHandlers()
          
          // Perform authentication if required
          if (auth) {
            await this.authenticateWithMaster(auth)
          }
          
          // Send PING to verify connection
          await this.sendToMaster('PING')
          
          // Request synchronization
          await this.requestSync()
          
          resolve()
          
        } catch (error) {
          logger.error('Failed to establish replication with master', error, {
            component: 'Slave'
          })
          reject(error)
        }
      })
      
      socket.on('error', (error) => {
        logger.error('Master connection error', error, {
          component: 'Slave',
          state: this.replicationState
        })
        
        this.replicationState = 'disconnected'
        this.masterConnection = null
        
        if (!connectionEstablished) {
          reject(error)
        } else {
          this.emit('masterConnectionError', error)
        }
      })
      
      socket.on('close', () => {
        logger.warn('Master connection closed', {
          component: 'Slave',
          state: this.replicationState
        })
        
        this.replicationState = 'disconnected'
        this.masterConnection = null
        this.emit('masterDisconnected')
      })
      
      // Connection timeout
      setTimeout(() => {
        if (!connectionEstablished) {
          socket.destroy()
          reject(new Error('Connection to master timed out'))
        }
      }, 10000) // 10 second timeout
    })
  }

  /**
   * Setup event handlers for master connection
   */
  setupMasterConnectionHandlers() {
    if (!this.masterConnection || !this.masterConnection.socket) {
      return
    }
    
    this.masterConnection.socket.on('data', (data) => {
      this.handleMasterData(data)
    })
    
    this.masterConnection.socket.on('error', (error) => {
      logger.error('Master socket error', error, {
        component: 'Slave'
      })
      this.handleMasterDisconnection(error)
    })
    
    this.masterConnection.socket.on('close', () => {
      this.handleMasterDisconnection()
    })
  }

  /**
   * Handle data received from master
   */
  handleMasterData(data) {
    this.receiveBuffer += data.toString()
    this.masterConnection.lastReceiveTime = Date.now()
    this.syncStats.bytesReceived += data.length
    
    // Process complete RESP messages
    this.processReceiveBuffer()
  }

  /**
   * Process accumulated data buffer
   */
  processReceiveBuffer() {
    while (this.receiveBuffer.length > 0) {
      const message = this.parseRESPMessage()
      if (!message) {
        break // Incomplete message, wait for more data
      }
      
      this.handleMasterMessage(message)
    }
  }

  /**
   * Parse RESP message from buffer
   */
  parseRESPMessage() {
    if (this.receiveBuffer.length === 0) {
      return null
    }
    
    const lineEnd = this.receiveBuffer.indexOf('\r\n')
    if (lineEnd === -1) {
      return null // Incomplete line
    }
    
    const firstLine = this.receiveBuffer.substring(0, lineEnd)
    const type = firstLine[0]
    
    let messageData = null
    let consumedBytes = 0
    
    switch (type) {
      case '+': // Simple string
        messageData = { type: 'simple_string', data: firstLine.substring(1) }
        consumedBytes = lineEnd + 2
        break
        
      case '-': // Error
        messageData = { type: 'error', data: firstLine.substring(1) }
        consumedBytes = lineEnd + 2
        break
        
      case ':': // Integer
        messageData = { type: 'integer', data: parseInt(firstLine.substring(1), 10) }
        consumedBytes = lineEnd + 2
        break
        
      case '$': // Bulk string
        const length = parseInt(firstLine.substring(1), 10)
        if (length === -1) {
          messageData = { type: 'bulk_string', data: null }
          consumedBytes = lineEnd + 2
        } else {
          const totalLength = lineEnd + 2 + length + 2
          if (this.receiveBuffer.length < totalLength) {
            return null // Incomplete message
          }
          
          const bulkData = this.receiveBuffer.substring(lineEnd + 2, lineEnd + 2 + length)
          messageData = { type: 'bulk_string', data: bulkData }
          consumedBytes = totalLength
        }
        break
        
      case '*': // Array
        const arrayLength = parseInt(firstLine.substring(1), 10)
        if (arrayLength === -1) {
          messageData = { type: 'array', data: null }
          consumedBytes = lineEnd + 2
        } else {
          // For simplicity, we'll handle arrays as command arrays
          const elements = []
          let offset = lineEnd + 2
          
          for (let i = 0; i < arrayLength; i++) {
            const elementBuffer = this.receiveBuffer.substring(offset)
            const element = this.parseSingleRESPElement(elementBuffer)
            
            if (!element) {
              return null // Incomplete array
            }
            
            elements.push(element.data)
            offset += element.consumedBytes
          }
          
          messageData = { type: 'array', data: elements }
          consumedBytes = offset
        }
        break
        
      default:
        // Unknown type, skip this byte
        consumedBytes = 1
        break
    }
    
    if (messageData && consumedBytes > 0) {
      this.receiveBuffer = this.receiveBuffer.substring(consumedBytes)
      return messageData
    }
    
    return null
  }

  /**
   * Parse single RESP element (for arrays)
   */
  parseSingleRESPElement(buffer) {
    const lineEnd = buffer.indexOf('\r\n')
    if (lineEnd === -1) return null
    
    const firstLine = buffer.substring(0, lineEnd)
    const type = firstLine[0]
    
    switch (type) {
      case '$': // Bulk string
        const length = parseInt(firstLine.substring(1), 10)
        if (length === -1) {
          return { data: null, consumedBytes: lineEnd + 2 }
        }
        
        const totalLength = lineEnd + 2 + length + 2
        if (buffer.length < totalLength) return null
        
        const bulkData = buffer.substring(lineEnd + 2, lineEnd + 2 + length)
        return { data: bulkData, consumedBytes: totalLength }
        
      default:
        return { data: firstLine.substring(1), consumedBytes: lineEnd + 2 }
    }
  }

  /**
   * Handle message from master
   */
  async handleMasterMessage(message) {
    try {
      switch (message.type) {
        case 'simple_string':
          if (message.data === 'PONG') {
            // Handle ping response
            logger.debug('Received PONG from master', { component: 'Slave' })
          } else if (message.data.startsWith('FULLRESYNC')) {
            // Handle full sync response
            await this.handleFullSyncResponse(message.data)
          }
          break
          
        case 'bulk_string':
          if (this.replicationState === 'syncing') {
            // This is RDB data for full sync
            await this.handleRDBData(message.data)
          }
          break
          
        case 'array':
          if (message.data && Array.isArray(message.data)) {
            // This is a replicated command
            await this.handleReplicatedCommand(message.data)
          }
          break
          
        case 'error':
          logger.error('Error from master', {
            component: 'Slave',
            error: message.data
          })
          break
      }
    } catch (error) {
      logger.error('Failed to handle master message', error, {
        component: 'Slave',
        messageType: message.type
      })
    }
  }

  /**
   * Handle full sync response from master
   */
  async handleFullSyncResponse(response) {
    // Parse FULLRESYNC response: FULLRESYNC <replid> <offset>
    const parts = response.split(' ')
    if (parts.length === 3 && parts[0] === 'FULLRESYNC') {
      this.masterInfo.replId = parts[1]
      this.masterInfo.offset = parseInt(parts[2], 10)
      
      this.replicationState = 'syncing'
      
      logger.info('Starting full sync', {
        component: 'Slave',
        replId: this.masterInfo.replId,
        offset: this.masterInfo.offset
      })
      
      this.emit('syncStarted', { type: 'full', replId: this.masterInfo.replId })
    }
  }

  /**
   * Handle RDB data for full synchronization
   */
  async handleRDBData(rdbData) {
    try {
      logger.info('Received RDB data', {
        component: 'Slave',
        size: rdbData ? rdbData.length : 0
      })
      
      if (rdbData) {
        // Parse and apply RDB data
        await this.applyRDBData(rdbData)
      }
      
      this.replicationState = 'sync_complete'
      this.syncStats.fullSyncs++
      this.syncStats.lastSyncTime = Date.now()
      
      logger.info('Full sync completed', {
        component: 'Slave'
      })
      
      this.emit('syncCompleted', { type: 'full' })
      
    } catch (error) {
      logger.error('Failed to handle RDB data', error, {
        component: 'Slave'
      })
      
      this.replicationState = 'connected'
      this.emit('syncFailed', { type: 'full', error })
    }
  }

  /**
   * Apply RDB data to local data store
   */
  async applyRDBData(rdbData) {
    try {
      // Parse RDB data (JSON format for our implementation)
      const rdbContent = JSON.parse(rdbData)
      
      if (!rdbContent.databases) {
        logger.warn('No databases found in RDB data', { component: 'Slave' })
        return
      }
      
      // Clear existing data
      for (let dbIndex = 0; dbIndex < 16; dbIndex++) {
        this.server.dataStore.select(dbIndex)
        this.server.dataStore.flushDatabase()
      }
      
      // Apply data from RDB
      for (const dbData of rdbContent.databases) {
        this.server.dataStore.select(dbData.index)
        
        for (const [key, keyData] of Object.entries(dbData.keys)) {
          // Set the key value
          this.server.dataStore.set(key, keyData.value)
          
          // Set TTL if present
          if (keyData.ttl && keyData.ttl > 0) {
            this.server.keyExpiration.setExpire(key, keyData.ttl)
          }
        }
      }
      
      logger.info('RDB data applied successfully', {
        component: 'Slave',
        databases: rdbContent.databases.length
      })
      
    } catch (error) {
      logger.error('Failed to apply RDB data', error, {
        component: 'Slave'
      })
      throw error
    }
  }

  /**
   * Handle replicated command from master
   */
  async handleReplicatedCommand(commandArray) {
    if (!commandArray || commandArray.length === 0) {
      return
    }
    
    const command = commandArray[0].toUpperCase()
    const args = commandArray.slice(1)
    
    logger.debug('Received replicated command', {
      component: 'Slave',
      command,
      argsCount: args.length
    })
    
    try {
      // Execute the command locally
      await this.server.executeCommand(command, args)
      
      this.syncStats.commandsReceived++
      
      // Update replication offset
      this.masterInfo.offset += this.calculateCommandSize(commandArray)
      
    } catch (error) {
      logger.error('Failed to execute replicated command', error, {
        component: 'Slave',
        command
      })
    }
  }

  /**
   * Calculate command size for offset tracking
   */
  calculateCommandSize(commandArray) {
    // Calculate RESP command size
    let size = `*${commandArray.length}\r\n`.length
    for (const part of commandArray) {
      const partStr = part.toString()
      size += `$${partStr.length}\r\n${partStr}\r\n`.length
    }
    return size
  }

  /**
   * Send command to master
   */
  async sendToMaster(command, ...args) {
    if (!this.masterConnection || !this.masterConnection.connected) {
      throw new Error('Not connected to master')
    }
    
    const parts = [command, ...args]
    const respCommand = `*${parts.length}\r\n` + 
      parts.map(part => `$${part.toString().length}\r\n${part}\r\n`).join('')
    
    return new Promise((resolve, reject) => {
      this.masterConnection.socket.write(respCommand, (error) => {
        if (error) {
          reject(error)
        } else {
          this.masterConnection.lastPingTime = Date.now()
          resolve()
        }
      })
    })
  }

  /**
   * Authenticate with master
   */
  async authenticateWithMaster(password) {
    logger.info('Authenticating with master', { component: 'Slave' })
    
    try {
      await this.sendToMaster('AUTH', password)
      // Wait for authentication response
      // In a real implementation, we'd parse the response
      
    } catch (error) {
      logger.error('Master authentication failed', error, {
        component: 'Slave'
      })
      throw error
    }
  }

  /**
   * Request synchronization from master
   */
  async requestSync() {
    logger.info('Requesting sync from master', {
      component: 'Slave',
      currentOffset: this.masterInfo.offset
    })
    
    try {
      // Request partial sync if we have a replication ID, otherwise full sync
      const replId = this.masterInfo.replId || '?'
      const offset = this.masterInfo.offset || -1
      
      await this.sendToMaster('PSYNC', replId, offset.toString())
      
    } catch (error) {
      logger.error('Sync request failed', error, {
        component: 'Slave'
      })
      throw error
    }
  }

  /**
   * Handle master disconnection
   */
  handleMasterDisconnection(error = null) {
    this.replicationState = 'disconnected'
    this.masterConnection = null
    
    logger.warn('Master disconnected', {
      component: 'Slave',
      error: error ? error.message : 'Connection closed'
    })
    
    this.emit('masterDisconnected', error)
    
    // Attempt reconnection after delay
    setTimeout(() => {
      if (this.replicationState === 'disconnected' && this.masterInfo.host) {
        this.reconnectToMaster()
      }
    }, 5000)
  }

  /**
   * Attempt to reconnect to master
   */
  async reconnectToMaster() {
    try {
      logger.info('Attempting to reconnect to master', {
        component: 'Slave',
        masterHost: this.masterInfo.host,
        masterPort: this.masterInfo.port
      })
      
      await this.connectToMaster(this.masterInfo.host, this.masterInfo.port)
      
    } catch (error) {
      logger.error('Reconnection to master failed', error, {
        component: 'Slave'
      })
      
      // Try again later
      setTimeout(() => {
        if (this.replicationState === 'disconnected') {
          this.reconnectToMaster()
        }
      }, 10000)
    }
  }

  /**
   * Ping master to keep connection alive
   */
  async pingMaster() {
    if (this.masterConnection && this.masterConnection.connected) {
      try {
        await this.sendToMaster('PING')
      } catch (error) {
        logger.error('Failed to ping master', error, {
          component: 'Slave'
        })
        this.handleMasterDisconnection(error)
      }
    }
  }

  /**
   * Get slave statistics
   */
  getStats() {
    return {
      role: 'slave',
      state: this.replicationState,
      master: this.masterInfo,
      connection: this.masterConnection ? {
        connected: this.masterConnection.connected,
        lastPingTime: this.masterConnection.lastPingTime,
        lastReceiveTime: this.masterConnection.lastReceiveTime
      } : null,
      sync: this.syncStats,
      readOnly: this.isReadOnly
    }
  }

  /**
   * Check if server should reject write commands
   */
  shouldRejectWrites() {
    return this.isReadOnly
  }

  /**
   * Disconnect from master
   */
  async disconnect() {
    if (this.masterConnection && this.masterConnection.socket) {
      this.masterConnection.socket.end()
      this.masterConnection = null
    }
    
    this.replicationState = 'disconnected'
    
    logger.info('Disconnected from master', {
      component: 'Slave'
    })
  }

  /**
   * Clean up slave resources
   */
  cleanup() {
    if (this.masterConnection && this.masterConnection.socket) {
      this.masterConnection.socket.end()
    }
    
    this.masterConnection = null
    this.receiveBuffer = ''
    this.replicationState = 'disconnected'
    
    logger.info('Slave cleaned up', {
      component: 'Slave'
    })
  }
}

module.exports = { Slave }
