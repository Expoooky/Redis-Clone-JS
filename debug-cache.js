/**
 * Debug cache operations
 */

const { spawn } = require('child_process')
const net = require('net')

// Simple Redis client
class SimpleRedisClient {
  constructor() {
    this.socket = null
    this.connected = false
  }

  async connect(port = 6379, host = '127.0.0.1') {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket()
      
      this.socket.connect(port, host, () => {
        this.connected = true
        resolve()
      })
      
      this.socket.on('error', reject)
    })
  }

  async sendCommand(command) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('Client is not connected'))
        return
      }

      const args = command.split(' ')
      const resp = this.buildRESP(args)
      
      let response = ''
      const onData = (data) => {
        response += data.toString()
        
        if (response.includes('\r\n')) {
          this.socket.removeListener('data', onData)
          try {
            const result = this.parseResponse(response)
            resolve(result)
          } catch (error) {
            reject(error)
          }
        }
      }
      
      this.socket.on('data', onData)
      this.socket.write(resp)
      
      setTimeout(() => {
        this.socket.removeListener('data', onData)
        reject(new Error('Command timeout'))
      }, 5000)
    })
  }

  buildRESP(args) {
    let resp = `*${args.length}\r\n`
    for (const arg of args) {
      const argStr = String(arg)
      resp += `$${argStr.length}\r\n${argStr}\r\n`
    }
    return resp
  }

  parseResponse(response) {
    const lines = response.split('\r\n')
    const firstLine = lines[0]
    
    if (firstLine.startsWith('+')) {
      return firstLine.substring(1)
    } else if (firstLine.startsWith('-')) {
      throw new Error(firstLine.substring(1))
    } else if (firstLine.startsWith(':')) {
      return parseInt(firstLine.substring(1))
    } else if (firstLine.startsWith('$')) {
      const length = parseInt(firstLine.substring(1))
      if (length === -1) return null
      
      const lengthLineEnd = response.indexOf('\r\n')
      const dataStart = lengthLineEnd + 2
      const data = response.substring(dataStart, dataStart + length)
      return data
    } else if (firstLine.startsWith('*')) {
      const count = parseInt(firstLine.substring(1))
      if (count === -1) return null
      
      const result = []
      let lineIndex = 1
      
      for (let i = 0; i < count; i++) {
        if (lines[lineIndex] && lines[lineIndex].startsWith('$')) {
          const length = parseInt(lines[lineIndex].substring(1))
          result.push(length === -1 ? null : lines[lineIndex + 1])
          lineIndex += 2
        } else if (lines[lineIndex] && lines[lineIndex].startsWith(':')) {
          result.push(parseInt(lines[lineIndex].substring(1)))
          lineIndex += 1
        } else if (lines[lineIndex]) {
          result.push(lines[lineIndex].substring(1))
          lineIndex += 1
        }
      }
      
      return result
    }
    
    return response.trim()
  }

  async disconnect() {
    if (this.socket) {
      this.socket.end()
      this.connected = false
    }
  }
}

const { CacheAside } = require('./src/patterns/CachingPatterns')

async function debugCache() {
  console.log('🔍 Debugging Cache Operations...')

  // Start Redis server
  console.log('🚀 Starting Redis server...')
  const serverProcess = spawn('node', ['simple-server.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false
  })

  await new Promise(resolve => setTimeout(resolve, 3000))

  const client = new SimpleRedisClient()
  await client.connect()
  console.log('✅ Connected to Redis server')

  try {
    console.log('\n🧪 Direct Redis operations:')
    
    // Test 1: Basic SET/GET
    console.log('\n1. Basic SET/GET:')
    const value = JSON.stringify({ name: 'test', age: 30 })
    const encodedValue = Buffer.from(value).toString('base64')
    console.log('  Original value:', value)
    console.log('  Encoded value:', encodedValue)
    
    const setResult = await client.sendCommand(`SET debug_key ${encodedValue}`)
    console.log('  SET result:', setResult, 'Type:', typeof setResult)
    
    const getResult = await client.sendCommand('GET debug_key')
    console.log('  GET result:', getResult, 'Type:', typeof getResult)
    
    if (typeof getResult === 'string') {
      const decoded = Buffer.from(getResult, 'base64').toString('utf8')
      console.log('  Decoded result:', decoded)
    }

    console.log('\n2. Cache-Aside pattern:')
    
    // Mock data source
    const dataSource = {
      data: { user_1: { name: 'John', age: 30 } },
      get: async function(key) { 
        console.log('  DataSource.get called for key:', key)
        return this.data[key] || null 
      }
    }

    const cacheAside = new CacheAside(client, dataSource, {
      keyPrefix: 'debug_cache:',
      defaultTTL: 60
    })

    // First get (cache miss)
    console.log('\n  First get (cache miss):')
    const result1 = await cacheAside.get('user_1', async (key) => dataSource.get(key))
    console.log('  Result 1:', result1)

    // Check what's actually in Redis
    const redisValue = await client.sendCommand('GET debug_cache:user_1')
    console.log('  Redis value:', redisValue, 'Type:', typeof redisValue)

    // Second get (should be cache hit)
    console.log('\n  Second get (should be cache hit):')
    const result2 = await cacheAside.get('user_1', async (key) => dataSource.get(key))
    console.log('  Result 2:', result2)

  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  }

  await client.disconnect()
  serverProcess.kill()
  console.log('\n✅ Debug complete')
  process.exit(0)
}

if (require.main === module) {
  debugCache().catch(console.error)
}
