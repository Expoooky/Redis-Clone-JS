#!/usr/bin/env node

/**
 * Redis-Clone-JS Server Entry Point
 * Main application entry point for the Redis-like in-memory data store
 */

const { Command } = require('commander')
const RedisServer = require('./src/server/Server')
const logger = require('./src/utils/Logger')
const config = require('./src/utils/Config')

const program = new Command()

// CLI setup
program
  .name('redis-clone-js')
  .description('Redis-like in-memory data store implementation in JavaScript')
  .version('1.0.0')
  .option('-p, --port <port>', 'server port', (value) => parseInt(value, 10))
  .option('-h, --host <host>', 'server host')
  .option('--max-clients <count>', 'maximum number of clients', (value) => parseInt(value, 10))
  .option('--timeout <seconds>', 'client timeout in seconds', (value) => parseInt(value, 10))
  .option('--log-level <level>', 'log level (error, warn, info, debug)', 'info')
  .option('--dev', 'enable development mode')
  .option('--config <file>', 'configuration file path')
  .parse()

const options = program.opts()

// Configure logging level
if (options.logLevel) {
  logger.setLevel(options.logLevel)
}

// Override config with CLI options
if (options.port) config.set('server.port', options.port)
if (options.host) config.set('server.host', options.host)
if (options.maxClients) config.set('server.maxClients', options.maxClients)
if (options.timeout) config.set('server.timeout', options.timeout)

// Development mode settings
if (options.dev) {
  logger.setLevel('debug')
  config.set('development.enableDebugCommands', true)
  config.set('development.enableMetrics', true)
  logger.info('Development mode enabled')
}

// Validate configuration
const configErrors = config.validate()
if (configErrors.length > 0) {
  logger.error('Configuration validation failed')
  configErrors.forEach(error => logger.error(error))
  process.exit(1)
}

// Create server instance
const server = new RedisServer({
  port: config.get('server.port'),
  host: config.get('server.host'),
  maxClients: config.get('server.maxClients'),
  timeout: config.get('server.timeout')
})

// Setup signal handlers for graceful shutdown
let isShuttingDown = false

const gracefulShutdown = async (signal) => {
  if (isShuttingDown) {
    logger.warn('Force shutdown requested')
    process.exit(1)
  }
  
  isShuttingDown = true
  logger.info(`Received ${signal}, starting graceful shutdown...`)
  
  try {
    await server.stop()
    logger.info('Server stopped gracefully')
    process.exit(0)
  } catch (error) {
    logger.error('Error during shutdown', error)
    process.exit(1)
  }
}

// Handle different shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error)
  if (!isShuttingDown) {
    gracefulShutdown('uncaughtException')
  }
})

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { reason, promise })
  if (!isShuttingDown) {
    gracefulShutdown('unhandledRejection')
  }
})

// Setup server event handlers
server.on('ready', () => {
  const stats = server.getStats()
  logger.info('Redis-Clone-JS server is ready to accept connections', {
    host: stats.config.host,
    port: stats.config.port,
    maxClients: stats.config.maxClients,
    databases: stats.memory.databases,
    maxMemory: formatBytes(stats.memory.max)
  })
  
  if (options.dev) {
    logger.info('Server statistics', stats)
  }
})

server.on('clientConnected', (client) => {
  logger.debug('New client connected', {
    clientId: client.id,
    address: client.address,
    totalClients: server.getStats().connectedClients
  })
})

server.on('clientDisconnected', (client) => {
  logger.debug('Client disconnected', {
    clientId: client.id,
    address: client.address,
    totalClients: server.getStats().connectedClients
  })
})

// Start the server
async function startServer() {
  try {
    logger.info('Starting Redis-Clone-JS server...', {
      version: '1.0.0',
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    })
    
    // Log configuration summary
    logger.info('Configuration summary', {
      server: {
        host: config.get('server.host'),
        port: config.get('server.port'),
        maxClients: config.get('server.maxClients'),
        timeout: config.get('server.timeout')
      },
      datastore: {
        databases: config.get('datastore.databases'),
        maxMemory: config.get('datastore.maxMemory'),
        maxMemoryPolicy: config.get('datastore.maxMemoryPolicy')
      },
      features: config.get('features'),
      development: options.dev
    })
    
    await server.start()
    
    // In development mode, log periodic statistics
    if (options.dev) {
      setInterval(() => {
        const stats = server.getStats()
        logger.debug('Server statistics', {
          clients: stats.connectedClients,
          memoryUsed: formatBytes(stats.memory.used),
          memoryPercentage: stats.memory.percentage.toFixed(2) + '%',
          keysWithExpiration: stats.expiration.keysWithExpiration
        })
      }, 30000) // Every 30 seconds
    }
    
  } catch (error) {
    logger.error('Failed to start server', error)
    process.exit(1)
  }
}

// Utility functions
function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// Display startup banner
function displayBanner() {
  const banner = `
╔══════════════════════════════════════════════════════════════════════╗
║                 Redis-Clone-JS In-Memory Data Store                  ║
║                                                                      ║
║        A Redis-compatible implementation built in JavaScript         ║
║        Supports strings, expiration, and core Redis commands         ║
╚══════════════════════════════════════════════════════════════════════╝

Server Configuration:
  Host: ${config.get('server.host')}
  Port: ${config.get('server.port')}
  Max Clients: ${config.get('server.maxClients')}
  Databases: ${config.get('datastore.databases')}
  Max Memory: ${config.get('datastore.maxMemory')}
  
Log Level: ${logger.getLevel()}

Starting server...
`
  
  console.log(banner)
}

// Display banner and start server
displayBanner()
startServer()

// Export server instance for testing
module.exports = server
