/**
 * Persistence Manager
 * Coordinates RDB snapshots and AOF logging for comprehensive data persistence
 */

const { RDBSnapshot } = require('./RDBSnapshot')
const { AOFLogger } = require('./AOFLogger')
const { logger } = require('../utils/Logger')

class PersistenceManager {
  constructor(dataStore, options = {}) {
    this.dataStore = dataStore
    this.options = {
      // RDB options
      rdbEnabled: options.rdbEnabled !== false, // Default true
      rdbFilename: options.rdbFilename || 'dump.rdb',
      rdbDirectory: options.rdbDirectory || './data',
      
      // AOF options
      aofEnabled: options.aofEnabled || false, // Default false
      aofFilename: options.aofFilename || 'appendonly.aof',
      aofDirectory: options.aofDirectory || './data',
      aofFsync: options.aofFsync || 'everysec',
      
      // Auto-save options
      autoSaveEnabled: options.autoSaveEnabled !== false, // Default true
      autoSaveInterval: options.autoSaveInterval || 900, // 15 minutes
      autoSaveChanges: options.autoSaveChanges || 1, // Minimum changes
      
      // Hybrid persistence
      hybridEnabled: options.hybridEnabled || false,
      
      ...options
    }
    
    this.rdbSnapshot = null
    this.aofLogger = null
    this.autoSaveTimer = null
    this.lastSaveTime = 0
    this.changesSinceLastSave = 0
    this.initialized = false
  }

  /**
   * Initialize persistence systems
   */
  async initialize() {
    if (this.initialized) return

    logger.info('Initializing persistence manager', {
      component: 'PersistenceManager',
      rdbEnabled: this.options.rdbEnabled,
      aofEnabled: this.options.aofEnabled,
      hybridEnabled: this.options.hybridEnabled
    })

    try {
      // Initialize RDB if enabled
      if (this.options.rdbEnabled) {
        this.rdbSnapshot = new RDBSnapshot(this.dataStore, {
          filename: this.options.rdbFilename,
          directory: this.options.rdbDirectory
        })
      }

      // Initialize AOF if enabled
      if (this.options.aofEnabled) {
        this.aofLogger = new AOFLogger(this.dataStore, {
          filename: this.options.aofFilename,
          directory: this.options.aofDirectory,
          fsync: this.options.aofFsync,
          enabled: true
        })
        
        await this.aofLogger.initialize()
      }

      // Load existing data
      await this.loadData()

      // Setup auto-save if enabled
      if (this.options.autoSaveEnabled) {
        this.setupAutoSave()
      }

      this.initialized = true
      
      logger.info('Persistence manager initialized successfully', {
        component: 'PersistenceManager'
      })

    } catch (error) {
      logger.error('Failed to initialize persistence manager', error, {
        component: 'PersistenceManager'
      })
      throw error
    }
  }

  /**
   * Load data from persistent storage
   */
  async loadData() {
    const loadOrder = this.determineLoadOrder()
    
    for (const source of loadOrder) {
      try {
        if (source === 'rdb' && this.rdbSnapshot) {
          logger.info('Loading data from RDB snapshot', {
            component: 'PersistenceManager'
          })
          
          const result = await this.rdbSnapshot.load()
          if (result.keys > 0) {
            this.lastSaveTime = this.rdbSnapshot.getLastSaveTime()
            logger.info('RDB data loaded', {
              component: 'PersistenceManager',
              keys: result.keys
            })
          }
        }
        
        if (source === 'aof' && this.aofLogger) {
          logger.info('Replaying AOF log', {
            component: 'PersistenceManager'
          })
          
          const result = await this.aofLogger.loadAndReplay()
          if (result.commands > 0) {
            logger.info('AOF data replayed', {
              component: 'PersistenceManager',
              commands: result.commands
            })
          }
        }
        
      } catch (error) {
        logger.error(`Failed to load from ${source}`, error, {
          component: 'PersistenceManager'
        })
        
        // In hybrid mode, continue with next source
        if (!this.options.hybridEnabled) {
          throw error
        }
      }
    }
  }

  /**
   * Determine load order based on configuration
   */
  determineLoadOrder() {
    if (this.options.hybridEnabled) {
      // In hybrid mode, load RDB first, then AOF
      return ['rdb', 'aof']
    } else if (this.options.aofEnabled) {
      // AOF only
      return ['aof']
    } else if (this.options.rdbEnabled) {
      // RDB only
      return ['rdb']
    }
    
    return []
  }

  /**
   * Log a command for persistence
   */
  async logCommand(command, args, database = 0) {
    if (!this.initialized) return

    // Increment change counter
    this.changesSinceLastSave++

    // Log to AOF if enabled
    if (this.aofLogger && this.aofLogger.isEnabled()) {
      await this.aofLogger.logCommand(command, args, database)
    }

    // Mark RDB as dirty if enabled
    if (this.rdbSnapshot) {
      this.rdbSnapshot.markDirty()
    }
  }

  /**
   * Perform synchronous save (SAVE command)
   */
  async save() {
    if (!this.initialized) {
      throw new Error('Persistence manager not initialized')
    }

    if (!this.rdbSnapshot) {
      throw new Error('RDB snapshots not enabled')
    }

    logger.info('Starting synchronous save', {
      component: 'PersistenceManager'
    })

    const startTime = Date.now()
    
    try {
      const result = await this.rdbSnapshot.save(false)
      
      this.lastSaveTime = result.lastSave
      this.changesSinceLastSave = 0
      
      const duration = Date.now() - startTime
      
      logger.info('Synchronous save completed', {
        component: 'PersistenceManager',
        duration: `${duration}ms`,
        size: result.size,
        keys: result.keys
      })

      return result

    } catch (error) {
      logger.error('Synchronous save failed', error, {
        component: 'PersistenceManager'
      })
      throw error
    }
  }

  /**
   * Perform background save (BGSAVE command)
   */
  async backgroundSave() {
    if (!this.initialized) {
      throw new Error('Persistence manager not initialized')
    }

    if (!this.rdbSnapshot) {
      throw new Error('RDB snapshots not enabled')
    }

    if (this.rdbSnapshot.isSavingInProgress()) {
      throw new Error('Background save already in progress')
    }

    logger.info('Starting background save', {
      component: 'PersistenceManager'
    })

    // Start background save without waiting
    this.rdbSnapshot.save(true).then(result => {
      this.lastSaveTime = result.lastSave
      this.changesSinceLastSave = 0
      
      logger.info('Background save completed', {
        component: 'PersistenceManager',
        duration: result.duration,
        size: result.size,
        keys: result.keys
      })
    }).catch(error => {
      logger.error('Background save failed', error, {
        component: 'PersistenceManager'
      })
    })

    return {
      success: true,
      message: 'Background saving started'
    }
  }

  /**
   * Get last save time
   */
  getLastSaveTime() {
    return this.lastSaveTime
  }

  /**
   * Setup automatic saving
   */
  setupAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer)
    }

    this.autoSaveTimer = setInterval(() => {
      this.checkAutoSave()
    }, this.options.autoSaveInterval * 1000)

    logger.info('Auto-save configured', {
      component: 'PersistenceManager',
      interval: `${this.options.autoSaveInterval}s`,
      minChanges: this.options.autoSaveChanges
    })
  }

  /**
   * Check if auto-save should be triggered
   */
  async checkAutoSave() {
    if (!this.rdbSnapshot || this.rdbSnapshot.isSavingInProgress()) {
      return
    }

    if (this.changesSinceLastSave >= this.options.autoSaveChanges) {
      logger.info('Triggering auto-save', {
        component: 'PersistenceManager',
        changes: this.changesSinceLastSave,
        timeSinceLastSave: Date.now() - this.lastSaveTime * 1000
      })

      try {
        await this.backgroundSave()
      } catch (error) {
        logger.error('Auto-save failed', error, {
          component: 'PersistenceManager'
        })
      }
    }
  }

  /**
   * Rewrite AOF file
   */
  async rewriteAOF() {
    if (!this.aofLogger) {
      throw new Error('AOF logging not enabled')
    }

    return await this.aofLogger.rewriteAOF()
  }

  /**
   * Enable/disable AOF logging
   */
  async setAOFEnabled(enabled) {
    if (!this.aofLogger) {
      if (enabled) {
        // Initialize AOF if it wasn't enabled before
        this.aofLogger = new AOFLogger(this.dataStore, {
          filename: this.options.aofFilename,
          directory: this.options.aofDirectory,
          fsync: this.options.aofFsync,
          enabled: true
        })
        
        await this.aofLogger.initialize()
        this.options.aofEnabled = true
        
        logger.info('AOF logging enabled', {
          component: 'PersistenceManager'
        })
      }
    } else {
      if (enabled) {
        this.aofLogger.enable()
      } else {
        this.aofLogger.disable()
      }
      
      this.options.aofEnabled = enabled
      
      logger.info(`AOF logging ${enabled ? 'enabled' : 'disabled'}`, {
        component: 'PersistenceManager'
      })
    }
  }

  /**
   * Get comprehensive persistence statistics
   */
  getStats() {
    const stats = {
      initialized: this.initialized,
      lastSaveTime: this.lastSaveTime,
      changesSinceLastSave: this.changesSinceLastSave,
      autoSaveEnabled: this.options.autoSaveEnabled,
      autoSaveInterval: this.options.autoSaveInterval,
      rdb: null,
      aof: null
    }

    if (this.rdbSnapshot) {
      stats.rdb = this.rdbSnapshot.getStats()
    }

    if (this.aofLogger) {
      stats.aof = this.aofLogger.getStats()
    }

    return stats
  }

  /**
   * Get configuration info for INFO command
   */
  getConfigInfo() {
    return {
      'rdb-enabled': this.options.rdbEnabled ? 'yes' : 'no',
      'rdb-filename': this.options.rdbFilename,
      'rdb-last-save-time': this.lastSaveTime,
      'rdb-changes-since-last-save': this.changesSinceLastSave,
      'aof-enabled': this.options.aofEnabled ? 'yes' : 'no',
      'aof-filename': this.options.aofFilename,
      'aof-fsync': this.options.aofFsync,
      'auto-save-enabled': this.options.autoSaveEnabled ? 'yes' : 'no',
      'auto-save-interval': this.options.autoSaveInterval,
      'hybrid-enabled': this.options.hybridEnabled ? 'yes' : 'no'
    }
  }

  /**
   * Shutdown persistence systems
   */
  async shutdown() {
    logger.info('Shutting down persistence manager', {
      component: 'PersistenceManager'
    })

    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer)
      this.autoSaveTimer = null
    }

    // Perform final save if RDB is enabled and dirty
    if (this.rdbSnapshot && this.rdbSnapshot.isDirty() && !this.rdbSnapshot.isSavingInProgress()) {
      try {
        logger.info('Performing final save before shutdown', {
          component: 'PersistenceManager'
        })
        
        await this.rdbSnapshot.save(false)
        
      } catch (error) {
        logger.error('Final save failed during shutdown', error, {
          component: 'PersistenceManager'
        })
      }
    }

    // Close AOF logger
    if (this.aofLogger) {
      await this.aofLogger.close()
    }

    this.initialized = false
    
    logger.info('Persistence manager shutdown complete', {
      component: 'PersistenceManager'
    })
  }
}

module.exports = { PersistenceManager }
