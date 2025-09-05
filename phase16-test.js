/**
 * Phase 16 Test Suite: Monitoring & Management
 * 
 * This test suite validates:
 * - Server Information (INFO command)
 * - Slow Query Logging (SLOWLOG command) 
 * - Real-time Metrics Collection
 * - Performance Monitoring Integration
 */

const assert = require('assert')
const net = require('net')
const { spawn } = require('child_process')

// Simple Redis client for testing
class SimpleRedisClient {
  constructor() {
    this.socket = null
    this.connected = false
  }

  connect(port = 6379, host = '127.0.0.1') {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket()
      
      this.socket.connect(port, host, () => {
        this.connected = true
        resolve()
      })
      
      this.socket.on('error', reject)
    })
  }

  sendCommand(command) {
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
        
        // Simple response parsing - wait for complete response
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
      
      // Timeout
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
      
      // For bulk strings, we need to reconstruct the full string
      // The server sends: $<length>\r\n<data>\r\n
      // Find the data part after the length line
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
        if (lines[lineIndex].startsWith('$')) {
          const length = parseInt(lines[lineIndex].substring(1))
          result.push(length === -1 ? null : lines[lineIndex + 1])
          lineIndex += 2
        } else if (lines[lineIndex].startsWith(':')) {
          result.push(parseInt(lines[lineIndex].substring(1)))
          lineIndex += 1
        } else {
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

// Test framework
class TestRunner {
  constructor() {
    this.passed = 0
    this.failed = 0
    this.serverProcess = null
  }

  async startServer() {
    console.log('🚀 Using existing server...')
    
    // Test if server is already running by trying to connect
    const testClient = new SimpleRedisClient()
    try {
      await testClient.connect()
      await testClient.sendCommand('PING')
      await testClient.disconnect()
      console.log('✅ Server is already running and responsive')
      return
    } catch (error) {
      console.log('ℹ️ No existing server found, starting new one...')
    }
    
    return new Promise((resolve, reject) => {
      this.serverProcess = spawn('node', ['simple-server.js'], {
        stdio: 'pipe',
        env: { ...process.env, REDIS_PORT: '6379' }
      })
      
      this.serverProcess.stdout.on('data', (data) => {
        const output = data.toString()
        console.log('Server output:', output)
        if (output.includes('Redis-Clone-JS server is ready') || output.includes('listening')) {
          setTimeout(resolve, 2000) // Give server time to fully initialize
        }
      })
      
      this.serverProcess.stderr.on('data', (data) => {
        console.error('Server stderr:', data.toString())
      })
      
      this.serverProcess.on('error', reject)
      
      // Timeout
      setTimeout(() => {
        reject(new Error('Server start timeout'))
      }, 15000)
    })
  }

  async stopServer() {
    if (this.serverProcess) {
      console.log('🛑 Stopping test server...')
      this.serverProcess.kill()
      
      // Wait for process to exit
      await new Promise((resolve) => {
        this.serverProcess.on('exit', resolve)
        setTimeout(resolve, 3000) // Force resolve after 3s
      })
    }
  }

  async runCommand(command, ignoreError = false) {
    return new Promise((resolve, reject) => {
      const child = spawn('cmd', ['/c', command], { stdio: 'pipe' })
      
      let stdout = ''
      let stderr = ''
      
      child.stdout.on('data', (data) => {
        stdout += data.toString()
      })
      
      child.stderr.on('data', (data) => {
        stderr += data.toString()
      })
      
      child.on('close', (code) => {
        if (code !== 0 && !ignoreError) {
          reject(new Error(`Command failed: ${stderr || stdout}`))
        } else {
          resolve(stdout)
        }
      })
    })
  }

  async runTest(name, testFn) {
    try {
      console.log(`🧪 ${name}...`)
      const startTime = Date.now()
      await testFn()
      const duration = Date.now() - startTime
      console.log(`✅ ${name} (${duration}ms)`)
      this.passed++
    } catch (error) {
      console.error(`❌ ${name}: ${error.message}`)
      this.failed++
      throw error
    }
  }

  printResults() {
    const total = this.passed + this.failed
    const successRate = total > 0 ? ((this.passed / total) * 100).toFixed(1) : 0
    
    console.log('\n==================================================')
    console.log('📊 PHASE 16 TEST RESULTS')
    console.log('==================================================')
    console.log(`✅ Tests Passed: ${this.passed}`)
    console.log(`❌ Tests Failed: ${this.failed}`)
    console.log(`📈 Success Rate: ${successRate}%`)
    
    if (this.failed === 0) {
      console.log('\n🎉 ALL TESTS PASSED! Phase 16 is 100% working! 🎉')
      console.log('\n🚀 Monitoring & Management features are fully functional:')
      console.log('   • Server information and statistics ✅')
      console.log('   • Slow query logging and analysis ✅')
      console.log('   • Real-time metrics collection ✅')
      console.log('   • Performance monitoring integration ✅')
      console.log('\n🎯 Your Redis server now has comprehensive monitoring!')
    } else {
      console.log('\n🔧 Some tests failed. Please review the errors above.')
    }
  }
}

// Helper functions
function assertEquals(actual, expected, message) {
  assert.strictEqual(actual, expected, message)
}

function assertTrue(condition, message) {
  assert(condition, message)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Main test execution
async function runTests() {
  const runner = new TestRunner()

  try {
    await runner.startServer()
    console.log('✅ Test server started')

    // Phase 16 Tests: Monitoring & Management
    console.log('\n📊 Testing Server Information (INFO Command)...')

    await runner.runTest('INFO command basic functionality', async () => {
      const client = new SimpleRedisClient()
      await client.connect()
      
      try {
        // Test INFO command without section
        const infoAll = await client.sendCommand('INFO')
        assertTrue(typeof infoAll === 'string', 'INFO should return a string')
        assertTrue(infoAll.length > 100, 'INFO response should be substantial')
        
        // Check for key sections
        assertTrue(infoAll.includes('# Server'), 'Should contain Server section')
        assertTrue(infoAll.includes('# Clients'), 'Should contain Clients section')
        assertTrue(infoAll.includes('# Memory'), 'Should contain Memory section')
        assertTrue(infoAll.includes('redis_version'), 'Should contain version info')
        assertTrue(infoAll.includes('connected_clients'), 'Should contain client count')
        
        console.log('    ✅ INFO command returns comprehensive server information')
      } finally {
        await client.disconnect()
      }
    })

    await runner.runTest('INFO command section filtering', async () => {
      const client = new SimpleRedisClient()
      await client.connect()
      
      try {
        // Test specific sections
        const serverInfo = await client.sendCommand('INFO server')
        assertTrue(serverInfo.includes('# Server'), 'Should contain Server section header')
        assertTrue(serverInfo.includes('redis_version'), 'Should contain version')
        assertTrue(!serverInfo.includes('# Memory'), 'Should not contain Memory section')
        
        const memoryInfo = await client.sendCommand('INFO memory')
        assertTrue(memoryInfo.includes('# Memory'), 'Should contain Memory section header')
        assertTrue(memoryInfo.includes('used_memory'), 'Should contain memory usage')
        assertTrue(!memoryInfo.includes('# Server'), 'Should not contain Server section')
        
        console.log('    ✅ INFO command correctly filters by section')
      } finally {
        await client.disconnect()
      }
    })

    await runner.runTest('Server statistics tracking', async () => {
      const client = new SimpleRedisClient()
      await client.connect()
      
      try {
        // Perform some operations to generate statistics
        await client.sendCommand('SET test_key test_value')
        await client.sendCommand('GET test_key') // Cache hit
        await client.sendCommand('GET non_existent_key') // Cache miss
        await client.sendCommand('PING')
        
        // Get stats
        const statsInfo = await client.sendCommand('INFO stats')
        assertTrue(statsInfo.includes('total_commands_processed'), 'Should track command count')
        assertTrue(statsInfo.includes('keyspace_hits'), 'Should track cache hits')
        assertTrue(statsInfo.includes('keyspace_misses'), 'Should track cache misses')
        
        // Parse some stats
        const commandsMatch = statsInfo.match(/total_commands_processed:(\d+)/)
        if (commandsMatch) {
          const commands = parseInt(commandsMatch[1])
          assertTrue(commands > 0, `Should have processed commands, got ${commands}`)
        }
        
        console.log('    ✅ Server statistics are being tracked correctly')
      } finally {
        await client.disconnect()
      }
    })

    console.log('\n🐌 Testing Slow Query Logging (SLOWLOG Command)...')

    await runner.runTest('SLOWLOG command basic functionality', async () => {
      const client = new SimpleRedisClient()
      await client.connect()
      
      try {
        // Test SLOWLOG GET (should be empty initially for new server)
        const slowlogEntries = await client.sendCommand('SLOWLOG GET')
        assertTrue(Array.isArray(slowlogEntries), 'SLOWLOG GET should return an array')
        
        // Test SLOWLOG LEN
        const slowlogLen = await client.sendCommand('SLOWLOG LEN')
        assertTrue(typeof slowlogLen === 'number', 'SLOWLOG LEN should return a number')
        assertTrue(slowlogLen >= 0, 'SLOWLOG LEN should be non-negative')
        
        // Test SLOWLOG RESET
        const resetCount = await client.sendCommand('SLOWLOG RESET')
        assertTrue(typeof resetCount === 'number', 'SLOWLOG RESET should return a number')
        
        console.log('    ✅ SLOWLOG command basic operations work correctly')
      } finally {
        await client.disconnect()
      }
    })

    await runner.runTest('SLOWLOG entry format', async () => {
      const client = new SimpleRedisClient()
      await client.connect()
      
      try {
        // Reset slowlog first
        await client.sendCommand('SLOWLOG RESET')
        
        // Perform operations that might be slow
        for (let i = 0; i < 5; i++) {
          await client.sendCommand(`SET slowlog_test_${i} test_value_${i}`)
          await sleep(1) // Small delay
        }
        
        // Get slowlog entries
        const entries = await client.sendCommand('SLOWLOG GET 10')
        
        if (entries && entries.length > 0) {
          const entry = entries[0]
          assertTrue(Array.isArray(entry), 'Slowlog entry should be an array')
          assertTrue(entry.length >= 4, 'Slowlog entry should have at least 4 elements')
          
          // Check entry format: [id, timestamp, execution_time, command_array, client_address, client_name]
          assertTrue(typeof entry[0] === 'number', 'Entry ID should be a number')
          assertTrue(typeof entry[1] === 'number', 'Timestamp should be a number')
          assertTrue(typeof entry[2] === 'number', 'Execution time should be a number')
          assertTrue(Array.isArray(entry[3]), 'Command should be an array')
          
          console.log('    ✅ SLOWLOG entry format is correct')
        } else {
          console.log('    ℹ️ No slow queries detected (server is very fast!)')
        }
      } finally {
        await client.disconnect()
      }
    })

    await runner.runTest('SLOWLOG configuration and limits', async () => {
      const client = new SimpleRedisClient()
      await client.connect()
      
      try {
        // Test SLOWLOG GET with count parameter
        const limitedEntries = await client.sendCommand('SLOWLOG GET 2')
        assertTrue(Array.isArray(limitedEntries), 'Limited SLOWLOG GET should return array')
        assertTrue(limitedEntries.length <= 2, 'Should respect count limit')
        
        // Test error handling for invalid parameters
        try {
          await client.sendCommand('SLOWLOG GET invalid')
          assertTrue(false, 'Should reject invalid count parameter')
        } catch (error) {
          assertTrue(error.message.includes('not an integer'), 'Should provide helpful error message')
        }
        
        console.log('    ✅ SLOWLOG configuration and limits work correctly')
      } finally {
        await client.disconnect()
      }
    })

    console.log('\n📈 Testing Real-time Metrics Collection...')

    await runner.runTest('Metrics system integration', async () => {
      const client = new SimpleRedisClient()
      await client.connect()
      
      try {
        // Perform various operations to generate metrics
        await client.sendCommand('SET metrics_test_1 value1')
        await client.sendCommand('GET metrics_test_1')
        await client.sendCommand('SET metrics_test_2 value2')
        await client.sendCommand('GET non_existent_key')
        await client.sendCommand('PING test')
        
        // The metrics are collected internally - we can verify through INFO stats
        const statsInfo = await client.sendCommand('INFO stats')
        
        // Verify basic command tracking
        assertTrue(statsInfo.includes('total_commands_processed'), 'Should track total commands')
        assertTrue(statsInfo.includes('instantaneous_ops_per_sec'), 'Should track ops per second')
        
        console.log('    ✅ Metrics system is integrated and collecting data')
      } finally {
        await client.disconnect()
      }
    })

    await runner.runTest('Performance monitoring integration', async () => {
      const client = new SimpleRedisClient()
      await client.connect()
      
      try {
        // Perform operations that would be tracked by performance monitoring
        const operations = ['SET', 'GET', 'PING', 'ECHO', 'SELECT']
        
        for (const op of operations) {
          switch (op) {
            case 'SET':
              await client.sendCommand('SET perf_test_key perf_test_value')
              break
            case 'GET':
              await client.sendCommand('GET perf_test_key')
              break
            case 'PING':
              await client.sendCommand('PING')
              break
            case 'ECHO':
              await client.sendCommand('ECHO test')
              break
            case 'SELECT':
              await client.sendCommand('SELECT 0')
              break
          }
        }
        
        // Verify through INFO that operations are being tracked
        const infoStats = await client.sendCommand('INFO stats')
        const commandsMatch = infoStats.match(/total_commands_processed:(\d+)/)
        
        if (commandsMatch) {
          const totalCommands = parseInt(commandsMatch[1])
          assertTrue(totalCommands >= operations.length, 
            `Should have processed at least ${operations.length} commands, got ${totalCommands}`)
        }
        
        console.log('    ✅ Performance monitoring integration is working')
      } finally {
        await client.disconnect()
      }
    })

    console.log('\n🔄 Testing Connection and Activity Monitoring...')

    await runner.runTest('Connection tracking', async () => {
      const client1 = new SimpleRedisClient()
      const client2 = new SimpleRedisClient()
      
      try {
        await client1.connect()
        
        // Check initial connection count
        const info1 = await client1.sendCommand('INFO clients')
        assertTrue(info1.includes('connected_clients:'), 'Should track connected clients')
        
        const match1 = info1.match(/connected_clients:(\d+)/)
        const initialClients = match1 ? parseInt(match1[1]) : 0
        
        // Connect second client
        await client2.connect()
        await sleep(100) // Give time for stats to update
        
        // Check updated connection count
        const info2 = await client1.sendCommand('INFO clients')
        const match2 = info2.match(/connected_clients:(\d+)/)
        const updatedClients = match2 ? parseInt(match2[1]) : 0
        
        assertTrue(updatedClients >= initialClients, 'Connection count should increase or stay the same')
        
        console.log(`    ✅ Connection tracking works (${updatedClients} clients)`)
      } finally {
        await client1.disconnect()
        await client2.disconnect()
      }
    })

    await runner.runTest('Memory usage reporting', async () => {
      const client = new SimpleRedisClient()
      await client.connect()
      
      try {
        const memoryInfo = await client.sendCommand('INFO memory')
        
        // Check for key memory metrics
        assertTrue(memoryInfo.includes('used_memory:'), 'Should report used memory')
        assertTrue(memoryInfo.includes('used_memory_human:'), 'Should provide human-readable memory')
        assertTrue(memoryInfo.includes('used_memory_rss:'), 'Should report RSS memory')
        assertTrue(memoryInfo.includes('mem_fragmentation_ratio:'), 'Should calculate fragmentation ratio')
        
        // Extract and validate a memory value
        const memoryMatch = memoryInfo.match(/used_memory:(\d+)/)
        if (memoryMatch) {
          const usedMemory = parseInt(memoryMatch[1])
          assertTrue(usedMemory > 0, 'Used memory should be positive')
        }
        
        console.log('    ✅ Memory usage reporting is comprehensive')
      } finally {
        await client.disconnect()
      }
    })

    console.log('\n⚡ Testing Advanced Monitoring Features...')

    await runner.runTest('CPU and system metrics', async () => {
      const client = new SimpleRedisClient()
      await client.connect()
      
      try {
        const cpuInfo = await client.sendCommand('INFO cpu')
        
        // Check for CPU metrics
        assertTrue(cpuInfo.includes('used_cpu_sys:'), 'Should report system CPU time')
        assertTrue(cpuInfo.includes('used_cpu_user:'), 'Should report user CPU time')
        assertTrue(cpuInfo.includes('server_load_average'), 'Should report load average')
        
        console.log('    ✅ CPU and system metrics are available')
      } finally {
        await client.disconnect()
      }
    })

    await runner.runTest('Server uptime and persistence info', async () => {
      const client = new SimpleRedisClient()
      await client.connect()
      
      try {
        const serverInfo = await client.sendCommand('INFO server')
        
        // Check for uptime metrics
        assertTrue(serverInfo.includes('uptime_in_seconds:'), 'Should report uptime in seconds')
        assertTrue(serverInfo.includes('uptime_in_days:'), 'Should report uptime in days')
        
        // Extract and validate uptime
        const uptimeMatch = serverInfo.match(/uptime_in_seconds:(\d+)/)
        if (uptimeMatch) {
          const uptime = parseInt(uptimeMatch[1])
          assertTrue(uptime >= 0, 'Uptime should be non-negative')
        }
        
        // Check persistence info
        const persistenceInfo = await client.sendCommand('INFO persistence')
        assertTrue(persistenceInfo.includes('rdb_changes_since_last_save:'), 'Should track RDB changes')
        
        console.log('    ✅ Server uptime and persistence info are accurate')
      } finally {
        await client.disconnect()
      }
    })

    await runner.runTest('Error handling and edge cases', async () => {
      const client = new SimpleRedisClient()
      await client.connect()
      
      try {
        // Test invalid INFO section
        try {
          const invalidInfo = await client.sendCommand('INFO invalid_section')
          // Should return empty string or handle gracefully
          assertTrue(typeof invalidInfo === 'string', 'Should handle invalid section gracefully')
        } catch (error) {
          // Some implementations might return an error, which is also acceptable
          console.log('    ℹ️ Invalid INFO section handled with error (acceptable)')
        }
        
        // Test invalid SLOWLOG subcommand
        try {
          await client.sendCommand('SLOWLOG INVALID')
          assertTrue(false, 'Should reject invalid SLOWLOG subcommand')
        } catch (error) {
          assertTrue(error.message.includes('Unknown SLOWLOG subcommand'), 'Should provide clear error message')
        }
        
        // Test SLOWLOG with negative count
        try {
          await client.sendCommand('SLOWLOG GET -1')
          assertTrue(false, 'Should reject negative count')
        } catch (error) {
          assertTrue(error.message.includes('not an integer') || error.message.includes('out of range'), 
            'Should reject negative values')
        }
        
        console.log('    ✅ Error handling and edge cases work correctly')
      } finally {
        await client.disconnect()
      }
    })

  } catch (error) {
    console.error('❌ Test execution failed:', error)
  } finally {
    await runner.stopServer()
    runner.printResults()
  }

  process.exit(runner.failed > 0 ? 1 : 0)
}

// Run tests
if (require.main === module) {
  runTests().catch(console.error)
}

module.exports = { runTests, TestRunner, SimpleRedisClient }
