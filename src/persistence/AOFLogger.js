/**
 * AOF (Append-Only File) Logger Implementation
 * Provides Redis-compatible append-only file logging for durability and recovery
 */

const fs = require('fs').promises
const path = require('path')
const { createWriteStream, createReadStream } = require('fs')
const { createReadline } = require('readline')
const readline = require('readline')
const { logger } = require('../utils/Logger')

/**
 * AOF synchronization policies
 */
const AOF_FSYNC_NO = 'no'        // Never fsync, let OS handle it
const AOF_FSYNC_ALWAYS = 'always' // Fsync after every write
const AOF_FSYNC_EVERYSEC = 'everysec' // Fsync every second

/**
 * AOF rewrite policies
 */
const DEFAULT_AUTO_AOF_REWRITE_PERCENTAGE = 100
const DEFAULT_AUTO_AOF_REWRITE_MIN_SIZE = 67108864 // 64MB

class AOFLogger {
  constructor(dataStore, options = {}) {
    this.dataStore = dataStore
    this.options = {
      filename: options.filename || 'appendonly.aof',
      directory: options.directory || './data',
      fsync: options.fsync || AOF_FSYNC_EVERYSEC,
      autoRewritePercentage: options.autoRewritePercentage || DEFAULT_AUTO_AOF_REWRITE_PERCENTAGE,
      autoRewriteMinSize: options.autoRewriteMinSize || DEFAULT_AUTO_AOF_REWRITE_MIN_SIZE,
      enabled: options.enabled !== false, // Default true
      ...options
    }
    
    this.writeStream = null
    this.commandBuffer = []
    this.lastFsync = 0
    this.fsyncInterval = null
    this.rewriteInProgress = false
    this.currentSize = 0
    this.baseSize = 0
    this.lastRewriteTime = 0
    this.totalCommands = 0
    this.enabled = this.options.enabled
  }

  /**
   * Initialize AOF logging
   */
  async initialize() {
    if (!this.enabled) {
      logger.info('AOF logging disabled', { component: 'AOFLogger' })
      return
    }

    try {
      // Ensure directory exists
      await fs.mkdir(this.options.directory, { recursive: true })
      
      const filePath = this.getAOFPath()
      
      // Check if AOF file exists and get current size
      try {
        const stats = await fs.stat(filePath)
        this.currentSize = stats.size
        this.baseSize = stats.size
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        this.currentSize = 0
        this.baseSize = 0
      }
      
      // Create write stream for appending
      this.writeStream = createWriteStream(filePath, { flags: 'a' })
      
      // Set up periodic fsync if needed
      if (this.options.fsync === AOF_FSYNC_EVERYSEC) {
        this.setupPeriodicFsync()
      }
      
      logger.info('AOF logger initialized', {
        component: 'AOFLogger',
        filename: this.options.filename,
        fsync: this.options.fsync,
        currentSize: this.currentSize
      })

    } catch (error) {
      logger.error('Failed to initialize AOF logger', error, {
        component: 'AOFLogger'
      })
      throw error
    }
  }

  /**
   * Log a command to AOF
   */
  async logCommand(command, args, database = 0) {
    if (!this.enabled || !this.writeStream) return

    // Skip read-only commands
    if (this.isReadOnlyCommand(command)) return

    const startTime = Date.now()
    
    try {
      // Format command in RESP protocol
      const respCommand = this.formatRESPCommand(command, args, database)
      
      // Write to stream
      const written = this.writeStream.write(respCommand)
      this.currentSize += respCommand.length
      this.totalCommands++
      
      // Handle fsync based on policy
      await this.handleFsync(written)
      
      // Check if rewrite is needed
      this.checkAutoRewrite()
      
      logger.debug('AOF command logged', {
        component: 'AOFLogger',
        command,
        args: args.slice(0, 3), // Limit args for logging
        database,
        size: respCommand.length,
        duration: Date.now() - startTime
      })

    } catch (error) {
      logger.error('Failed to log command to AOF', error, {
        component: 'AOFLogger',
        command,
        args
      })
      throw error
    }
  }

  /**
   * Load and replay AOF file
   */
  async loadAndReplay() {
    if (!this.enabled) return { commands: 0 }

    const filePath = this.getAOFPath()
    
    try {
      // Check if file exists
      await fs.access(filePath)
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info('No AOF file found, starting fresh', {
          component: 'AOFLogger'
        })
        return { commands: 0 }
      }
      throw error
    }

    const startTime = Date.now()
    let commandCount = 0
    let currentDb = 0
    
    logger.info('Loading AOF file', {
      component: 'AOFLogger',
      filename: this.options.filename
    })

    try {
      const fileStream = createReadStream(filePath)
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      })

      const commandBuffer = []
      
      for await (const line of rl) {
        const trimmedLine = line.trim()
        if (!trimmedLine) continue
        
        if (trimmedLine.startsWith('*')) {
          // Start of new command
          if (commandBuffer.length > 0) {
            await this.replayCommand(commandBuffer, currentDb)
            commandCount++
          }
          commandBuffer.length = 0
          const argCount = parseInt(trimmedLine.slice(1))
          if (isNaN(argCount)) continue
        } else if (trimmedLine.startsWith('$')) {
          // Length prefix - skip
          continue
        } else {
          // Command argument
          commandBuffer.push(trimmedLine)
          
          // Handle database selection
          if (commandBuffer.length === 1 && trimmedLine.toUpperCase() === 'SELECT') {
            // Next argument will be database number
          } else if (commandBuffer.length === 2 && commandBuffer[0].toUpperCase() === 'SELECT') {
            currentDb = parseInt(trimmedLine) || 0
          }
        }
      }
      
      // Process last command if any
      if (commandBuffer.length > 0) {
        await this.replayCommand(commandBuffer, currentDb)
        commandCount++
      }
      
      const duration = Date.now() - startTime
      logger.info('AOF file loaded successfully', {
        component: 'AOFLogger',
        commands: commandCount,
        duration: `${duration}ms`
      })

      return { commands: commandCount, duration }

    } catch (error) {
      logger.error('Failed to load AOF file', error, {
        component: 'AOFLogger'
      })
      throw error
    }
  }

  /**
   * Rewrite AOF file to compact it
   */
  async rewriteAOF() {
    if (this.rewriteInProgress) {
      throw new Error('AOF rewrite already in progress')
    }

    const startTime = Date.now()
    this.rewriteInProgress = true
    
    try {
      logger.info('Starting AOF rewrite', {
        component: 'AOFLogger',
        currentSize: this.currentSize
      })

      const tempPath = this.getAOFPath() + '.rewrite'
      const writeStream = createWriteStream(tempPath)
      
      let commandCount = 0
      
      // Serialize current state of all databases
      for (let dbIndex = 0; dbIndex < this.dataStore.databases.length; dbIndex++) {
        const db = this.dataStore.databases[dbIndex]
        if (!db || Object.keys(db).length === 0) continue
        
        // Write SELECT command if not database 0
        if (dbIndex !== 0) {
          const selectCmd = this.formatRESPCommand('SELECT', [dbIndex.toString()], 0)
          writeStream.write(selectCmd)
          commandCount++
        }
        
        // Write all key-value pairs
        for (const [key, value] of Object.entries(db)) {
          const commands = this.generateCommandsForKeyValue(key, value, dbIndex)
          for (const cmd of commands) {
            writeStream.write(cmd)
            commandCount++
          }
          
          // Add expiration if exists
          const expireTime = this.dataStore.expirations.get(dbIndex)?.get(key)
          if (expireTime && expireTime > Date.now()) {
            const expireCmd = this.formatRESPCommand('PEXPIREAT', [key, expireTime.toString()], dbIndex)
            writeStream.write(expireCmd)
            commandCount++
          }
        }
      }
      
      // Close temp file
      await new Promise((resolve, reject) => {
        writeStream.end((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
      
      // Atomic replacement
      const originalPath = this.getAOFPath()
      await fs.rename(tempPath, originalPath)
      
      // Update size tracking
      const stats = await fs.stat(originalPath)
      this.currentSize = stats.size
      this.baseSize = stats.size
      this.lastRewriteTime = Date.now()
      
      // Restart write stream
      if (this.writeStream) {
        this.writeStream.end()
      }
      this.writeStream = createWriteStream(originalPath, { flags: 'a' })
      
      const duration = Date.now() - startTime
      const compressionRatio = this.baseSize > 0 ? (1 - stats.size / this.baseSize) * 100 : 0
      
      logger.info('AOF rewrite completed', {
        component: 'AOFLogger',
        oldSize: this.baseSize,
        newSize: stats.size,
        compressionRatio: `${compressionRatio.toFixed(1)}%`,
        commands: commandCount,
        duration: `${duration}ms`
      })

      return {
        success: true,
        oldSize: this.baseSize,
        newSize: stats.size,
        commands: commandCount,
        duration
      }

    } catch (error) {
      logger.error('AOF rewrite failed', error, {
        component: 'AOFLogger'
      })
      throw error
    } finally {
      this.rewriteInProgress = false
    }
  }

  formatRESPCommand(command, args, database = 0) {
    const parts = [command, ...args]
    let result = `*${parts.length}\r\n`
    
    for (const part of parts) {
      const str = part.toString()
      result += `$${Buffer.byteLength(str)}\r\n${str}\r\n`
    }
    
    return result
  }

  async replayCommand(commandBuffer, database) {
    if (commandBuffer.length === 0) return
    
    const command = commandBuffer[0].toUpperCase()
    const args = commandBuffer.slice(1)
    
    // Skip certain commands during replay
    if (this.shouldSkipCommand(command)) return
    
    try {
      // Set correct database
      const oldDb = this.dataStore.currentDb
      this.dataStore.select(database)
      
      // Execute command through data store
      await this.executeReplayCommand(command, args)
      
      // Restore original database
      this.dataStore.select(oldDb)
      
    } catch (error) {
      logger.warn('Failed to replay AOF command', {
        component: 'AOFLogger',
        command,
        args: args.slice(0, 3),
        error: error.message
      })
      // Continue with other commands
    }
  }

  async executeReplayCommand(command, args) {
    // This is a simplified replay - in a full implementation,
    // you'd route through the proper command handlers
    switch (command) {
      case 'SET':
        if (args.length >= 2) {
          this.dataStore.set(args[0], args[1])
        }
        break
      case 'DEL':
        for (const key of args) {
          this.dataStore.del(key)
        }
        break
      case 'EXPIRE':
        if (args.length >= 2) {
          const seconds = parseInt(args[1])
          this.dataStore.setExpiration(args[0], Date.now() + seconds * 1000)
        }
        break
      case 'PEXPIREAT':
        if (args.length >= 2) {
          this.dataStore.setExpiration(args[0], parseInt(args[1]))
        }
        break
      // Add more commands as needed
      default:
        logger.debug('Unhandled AOF command during replay', {
          component: 'AOFLogger',
          command,
          args: args.slice(0, 3)
        })
    }
  }

  generateCommandsForKeyValue(key, value, database) {
    const commands = []
    
    if (typeof value === 'string' || typeof value === 'number') {
      commands.push(this.formatRESPCommand('SET', [key, value.toString()], database))
    } else if (Array.isArray(value)) {
      if (value.length > 0) {
        commands.push(this.formatRESPCommand('RPUSH', [key, ...value], database))
      }
    } else if (value instanceof Set) {
      if (value.size > 0) {
        commands.push(this.formatRESPCommand('SADD', [key, ...Array.from(value)], database))
      }
    } else if (value instanceof Map) {
      const pairs = []
      for (const [field, val] of value) {
        pairs.push(field, val)
      }
      if (pairs.length > 0) {
        commands.push(this.formatRESPCommand('HSET', [key, ...pairs], database))
      }
    } else if (value && typeof value === 'object') {
      // Handle complex objects as JSON
      commands.push(this.formatRESPCommand('SET', [key, JSON.stringify(value)], database))
    }
    
    return commands
  }

  isReadOnlyCommand(command) {
    const readOnlyCommands = new Set([
      'GET', 'MGET', 'EXISTS', 'TYPE', 'TTL', 'PTTL',
      'LLEN', 'LINDEX', 'LRANGE',
      'SCARD', 'SISMEMBER', 'SMEMBERS', 'SRANDMEMBER',
      'HGET', 'HMGET', 'HLEN', 'HKEYS', 'HVALS', 'HGETALL', 'HEXISTS',
      'ZCARD', 'ZSCORE', 'ZRANK', 'ZREVRANK', 'ZRANGE', 'ZRANGEBYSCORE',
      'PING', 'ECHO', 'INFO', 'DBSIZE', 'LASTSAVE',
      'KEYS', 'SCAN', 'RANDOMKEY'
    ])
    
    return readOnlyCommands.has(command.toUpperCase())
  }

  shouldSkipCommand(command) {
    const skipCommands = new Set([
      'PING', 'ECHO', 'INFO', 'LASTSAVE', 'SAVE', 'BGSAVE'
    ])
    
    return skipCommands.has(command.toUpperCase())
  }

  async handleFsync(written) {
    if (this.options.fsync === AOF_FSYNC_ALWAYS) {
      if (this.writeStream.fd) {
        await new Promise((resolve, reject) => {
          require('fs').fsync(this.writeStream.fd, (error) => {
            if (error) reject(error)
            else resolve()
          })
        })
      }
      this.lastFsync = Date.now()
    }
    // For 'everysec', handled by periodic fsync
    // For 'no', OS handles it
  }

  setupPeriodicFsync() {
    this.fsyncInterval = setInterval(async () => {
      if (this.writeStream && this.writeStream.fd && Date.now() - this.lastFsync >= 1000) {
        try {
          await new Promise((resolve, reject) => {
            require('fs').fsync(this.writeStream.fd, (error) => {
              if (error) reject(error)
              else resolve()
            })
          })
          this.lastFsync = Date.now()
        } catch (error) {
          logger.error('Periodic fsync failed', error, {
            component: 'AOFLogger'
          })
        }
      }
    }, 1000)
  }

  checkAutoRewrite() {
    if (this.rewriteInProgress) return
    if (this.baseSize === 0) return
    
    const growthPercentage = ((this.currentSize - this.baseSize) / this.baseSize) * 100
    
    if (this.currentSize >= this.options.autoRewriteMinSize &&
        growthPercentage >= this.options.autoRewritePercentage) {
      
      logger.info('Triggering automatic AOF rewrite', {
        component: 'AOFLogger',
        currentSize: this.currentSize,
        baseSize: this.baseSize,
        growthPercentage: `${growthPercentage.toFixed(1)}%`
      })
      
      // Trigger rewrite asynchronously
      this.rewriteAOF().catch(error => {
        logger.error('Automatic AOF rewrite failed', error, {
          component: 'AOFLogger'
        })
      })
    }
  }

  getAOFPath() {
    return path.join(this.options.directory, this.options.filename)
  }

  async close() {
    if (this.fsyncInterval) {
      clearInterval(this.fsyncInterval)
      this.fsyncInterval = null
    }
    
    if (this.writeStream) {
      await new Promise((resolve) => {
        this.writeStream.end(resolve)
      })
      this.writeStream = null
    }
    
    logger.info('AOF logger closed', {
      component: 'AOFLogger'
    })
  }

  enable() {
    this.enabled = true
    logger.info('AOF logging enabled', { component: 'AOFLogger' })
  }

  disable() {
    this.enabled = false
    logger.info('AOF logging disabled', { component: 'AOFLogger' })
  }

  isEnabled() {
    return this.enabled
  }

  getStats() {
    return {
      enabled: this.enabled,
      filename: this.options.filename,
      currentSize: this.currentSize,
      baseSize: this.baseSize,
      totalCommands: this.totalCommands,
      lastRewriteTime: this.lastRewriteTime,
      rewriteInProgress: this.rewriteInProgress,
      fsyncPolicy: this.options.fsync,
      autoRewritePercentage: this.options.autoRewritePercentage,
      autoRewriteMinSize: this.options.autoRewriteMinSize
    }
  }
}

module.exports = { 
  AOFLogger, 
  AOF_FSYNC_NO, 
  AOF_FSYNC_ALWAYS, 
  AOF_FSYNC_EVERYSEC 
}
