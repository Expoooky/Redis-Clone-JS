/**
 * Configuration management for Redis-Clone-JS
 * Handles server settings, data store options, and feature toggles
 */

const fs = require('fs')
const path = require('path')

class Config {
  constructor() {
    this.config = this.loadDefaultConfig()
    this.loadConfigFile()
    this.loadEnvironmentVariables()
  }

  /**
   * Load default configuration values
   * @returns {Object} Default configuration object
   */
  loadDefaultConfig() {
    return {
      // Server settings
      server: {
        port: 6379,
        host: '127.0.0.1',
        maxClients: 10000,
        timeout: 0, // 0 = no timeout
        tcpBacklog: 511,
        tcpKeepAlive: 300, // seconds
        bindAddress: ['127.0.0.1']
      },

      // Data store settings
      datastore: {
        maxMemory: '1gb', // Maximum memory usage
        maxMemoryPolicy: 'noeviction', // noeviction, allkeys-lru, volatile-lru, etc.
        databases: 16, // Number of databases (0-15)
        keyExpirationCheckInterval: 100, // milliseconds
        keyExpirationSampleSize: 20 // number of keys to check per interval
      },

      // Persistence settings
      persistence: {
        aof: {
          enabled: false,
          filename: 'appendonly.aof',
          fsync: 'everysec', // always, everysec, no
          autoRewritePercentage: 100,
          autoRewriteMinSize: '64mb'
        },
        rdb: {
          enabled: true,
          filename: 'dump.rdb',
          save: ['900 1', '300 10', '60 10000'], // seconds changes
          compression: true,
          checksum: true
        }
      },

      // Logging settings
      logging: {
        level: 'info', // error, warn, info, debug
        file: true,
        syslog: false,
        verbosity: 'normal' // quiet, normal, verbose
      },

      // Security settings
      security: {
        requireAuth: false,
        password: null,
        acl: {
          enabled: false,
          file: 'users.acl'
        },
        tls: {
          enabled: false,
          port: 6380,
          cert: null,
          key: null,
          ca: null
        }
      },

      // Replication settings
      replication: {
        role: 'master', // master, slave
        masterHost: null,
        masterPort: 6379,
        masterAuth: null,
        slaveReadOnly: true,
        slavePriority: 100
      },

      // Pub/Sub settings
      pubsub: {
        maxChannels: 1000000,
        maxPatterns: 1000000,
        notifyKeyspaceEvents: '' // Event types to notify about
      },

      // Performance settings
      performance: {
        slowlogLogSlowerThan: 10000, // microseconds
        slowlogMaxLen: 128,
        maxmemorySamples: 5,
        hashMaxZiplistEntries: 512,
        hashMaxZiplistValue: 64,
        listMaxZiplistSize: -2,
        setMaxIntsetEntries: 512,
        zsetMaxZiplistEntries: 128,
        zsetMaxZiplistValue: 64
      },

      // Feature flags
      features: {
        vectorDatabase: true,
        documentDatabase: true,
        timeSeries: true,
        geospatial: true,
        hyperloglog: true,
        bloomFilter: true,
        luaScripting: false, // Disabled by default (complex feature)
        clustering: false // Disabled by default (complex feature)
      },

      // Development settings
      development: {
        enableDebugCommands: false,
        enableMetrics: true,
        profileMemory: false
      }
    }
  }

  /**
   * Load configuration from file if it exists
   */
  loadConfigFile() {
    const configPaths = [
      'redis-clone.conf',
      'config/redis-clone.conf',
      path.join(process.env.HOME || process.env.USERPROFILE || '', '.redis-clone.conf')
    ]

    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        try {
          const configFile = fs.readFileSync(configPath, 'utf8')
          this.parseConfigFile(configFile)
          break
        } catch (error) {
          console.warn(`Warning: Could not load config file ${configPath}: ${error.message}`)
        }
      }
    }
  }

  /**
   * Parse configuration file content
   * @param {string} content - Configuration file content
   */
  parseConfigFile(content) {
    const lines = content.split('\n')
    
    for (const line of lines) {
      const trimmedLine = line.trim()
      
      // Skip comments and empty lines
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue
      }

      // Parse key-value pairs
      const spaceIndex = trimmedLine.indexOf(' ')
      if (spaceIndex === -1) continue

      const key = trimmedLine.substring(0, spaceIndex).toLowerCase()
      const value = trimmedLine.substring(spaceIndex + 1).trim()

      this.setConfigValue(key, value)
    }
  }

  /**
   * Set configuration value from string
   * @param {string} key - Configuration key
   * @param {string} value - Configuration value as string
   */
  setConfigValue(key, value) {
    // Convert Redis-style config keys to our nested structure
    const keyMappings = {
      port: 'server.port',
      bind: 'server.host',
      timeout: 'server.timeout',
      'tcp-backlog': 'server.tcpBacklog',
      'tcp-keepalive': 'server.tcpKeepAlive',
      maxclients: 'server.maxClients',
      maxmemory: 'datastore.maxMemory',
      'maxmemory-policy': 'datastore.maxMemoryPolicy',
      databases: 'datastore.databases',
      appendonly: 'persistence.aof.enabled',
      appendfilename: 'persistence.aof.filename',
      appendfsync: 'persistence.aof.fsync',
      save: 'persistence.rdb.save',
      dbfilename: 'persistence.rdb.filename',
      requirepass: 'security.password',
      loglevel: 'logging.level'
    }

    const configPath = keyMappings[key] || key
    this.setNestedValue(this.config, configPath, this.parseValue(value))
  }

  /**
   * Parse string value to appropriate type
   * @param {string} value - String value to parse
   * @returns {*} Parsed value
   */
  parseValue(value) {
    // Handle quoted strings
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1)
    }

    // Handle boolean values
    if (value.toLowerCase() === 'yes' || value.toLowerCase() === 'true') return true
    if (value.toLowerCase() === 'no' || value.toLowerCase() === 'false') return false

    // Handle numbers
    if (/^\d+$/.test(value)) return parseInt(value, 10)
    if (/^\d+\.\d+$/.test(value)) return parseFloat(value)

    // Handle memory sizes
    const memoryMatch = value.match(/^(\d+)(b|kb|mb|gb)$/i)
    if (memoryMatch) {
      const size = parseInt(memoryMatch[1], 10)
      const unit = memoryMatch[2].toLowerCase()
      const multipliers = { b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 }
      return size * multipliers[unit]
    }

    return value
  }

  /**
   * Set nested object value using dot notation
   * @param {Object} obj - Target object
   * @param {string} path - Dot-separated path
   * @param {*} value - Value to set
   */
  setNestedValue(obj, path, value) {
    const keys = path.split('.')
    let current = obj

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {}
      }
      current = current[key]
    }

    current[keys[keys.length - 1]] = value
  }

  /**
   * Load configuration from environment variables
   */
  loadEnvironmentVariables() {
    const envMappings = {
      REDIS_PORT: 'server.port',
      REDIS_HOST: 'server.host',
      REDIS_PASSWORD: 'security.password',
      REDIS_DATABASES: 'datastore.databases',
      REDIS_MAX_MEMORY: 'datastore.maxMemory',
      REDIS_LOG_LEVEL: 'logging.level',
      REDIS_AOF_ENABLED: 'persistence.aof.enabled',
      REDIS_RDB_ENABLED: 'persistence.rdb.enabled'
    }

    for (const [envVar, configPath] of Object.entries(envMappings)) {
      if (process.env[envVar]) {
        this.setNestedValue(this.config, configPath, this.parseValue(process.env[envVar]))
      }
    }
  }

  /**
   * Get configuration value using dot notation
   * @param {string} path - Dot-separated path to config value
   * @param {*} defaultValue - Default value if path doesn't exist
   * @returns {*} Configuration value
   */
  get(path, defaultValue = undefined) {
    const keys = path.split('.')
    let current = this.config

    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key]
      } else {
        return defaultValue
      }
    }

    return current
  }

  /**
   * Set configuration value using dot notation
   * @param {string} path - Dot-separated path to config value
   * @param {*} value - Value to set
   */
  set(path, value) {
    this.setNestedValue(this.config, path, value)
  }

  /**
   * Get all configuration
   * @returns {Object} Complete configuration object
   */
  getAll() {
    return { ...this.config }
  }

  /**
   * Validate configuration
   * @returns {Array} Array of validation errors
   */
  validate() {
    const errors = []

    // Validate port range
    const port = this.get('server.port')
    if (port < 1 || port > 65535) {
      errors.push(`Invalid port number: ${port}. Must be between 1 and 65535.`)
    }

    // Validate databases count
    const databases = this.get('datastore.databases')
    if (databases < 1 || databases > 16) {
      errors.push(`Invalid databases count: ${databases}. Must be between 1 and 16.`)
    }

    // Validate memory settings
    const maxMemory = this.get('datastore.maxMemory')
    if (typeof maxMemory === 'string' && !maxMemory.match(/^\d+(b|kb|mb|gb)$/i)) {
      errors.push(`Invalid maxMemory format: ${maxMemory}. Use format like '1gb', '512mb', etc.`)
    }

    return errors
  }
}

// Create singleton instance
const config = new Config()

module.exports = config
