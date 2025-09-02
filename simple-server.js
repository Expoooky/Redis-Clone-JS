#!/usr/bin/env node

/**
 * Simple Redis-Clone-JS Server (without CLI complexity)
 */

const RedisServer = require('./src/server/Server')
const logger = require('./src/utils/Logger')

// Set log level
logger.setLevel('debug')

console.log('🚀 Starting Redis-Clone-JS Server...')

// Get configuration from environment
const port = parseInt(process.env.REDIS_PORT, 10) || 6379
const host = process.env.REDIS_HOST || '127.0.0.1'
const role = process.env.REDIS_ROLE || 'master'
const masterHost = process.env.REDIS_MASTER_HOST
const masterPort = parseInt(process.env.REDIS_MASTER_PORT, 10) || 6379

// Set replication configuration
if (role === 'slave' && masterHost) {
  const config = require('./src/utils/Config')
  config.set('replication.role', 'slave')
  config.set('replication.masterHost', masterHost)
  config.set('replication.masterPort', masterPort)
} else {
  const config = require('./src/utils/Config')
  config.set('replication.role', 'master')
}

// Create server instance
const server = new RedisServer({
  port,
  host
})

// Setup graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⏹️  Shutting down gracefully...')
  await server.stop()
  process.exit(0)
})

// Start server
async function start() {
  try {
    await server.start()
    console.log('✅ Redis-Clone-JS server is ready!')
    console.log(`📍 Server listening on ${host}:${port} (role: ${role})`)
    console.log('🔄 Press Ctrl+C to stop')
  } catch (error) {
    console.error('❌ Failed to start server:', error)
    process.exit(1)
  }
}

start()
