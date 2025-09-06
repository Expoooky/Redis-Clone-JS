/**
 * Jest Test Setup Configuration
 * 
 * Global setup for all test suites in Phase 20
 * Provides utilities, mocks, and test environment configuration
 */

const { spawn } = require('child_process')
const net = require('net')
const path = require('path')
const fs = require('fs')

// Global test timeout
jest.setTimeout(30000)

// Test utilities available to all test files
global.TestUtils = {
  /**
   * Sleep utility for async tests
   */
  sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  /**
   * Generate random test data
   */
  randomString: (length = 8) => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  },

  randomInt: (min = 0, max = 1000) => Math.floor(Math.random() * (max - min + 1)) + min,

  randomPort: () => Math.floor(Math.random() * (65535 - 3000 + 1)) + 3000,

  /**
   * Test data generators
   */
  generateTestKey: (prefix = 'test') => `${prefix}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`,

  generateTestValue: (type = 'string') => {
    switch (type) {
      case 'string':
        return `test_value_${TestUtils.randomString()}`
      case 'number':
        return TestUtils.randomInt()
      case 'json':
        return JSON.stringify({ 
          id: TestUtils.randomInt(),
          name: TestUtils.randomString(),
          timestamp: Date.now()
        })
      case 'array':
        return Array.from({ length: 5 }, () => TestUtils.randomString())
      default:
        return `test_${TestUtils.randomString()}`
    }
  },

  /**
   * Server management utilities
   */
  async startTestServer(port = 6379, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const serverProcess = spawn('node', ['simple-server.js'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PORT: port.toString() }
      })

      let serverOutput = ''
      
      const timeoutId = setTimeout(() => {
        serverProcess.kill()
        reject(new Error(`Server start timeout after ${timeout}ms`))
      }, timeout)

      serverProcess.stdout.on('data', (data) => {
        serverOutput += data.toString()
        if (serverOutput.includes('Redis-Clone-JS server is ready!')) {
          clearTimeout(timeoutId)
          resolve(serverProcess)
        }
      })

      serverProcess.stderr.on('data', (data) => {
        const errorOutput = data.toString()
        if (errorOutput.includes('EADDRINUSE')) {
          clearTimeout(timeoutId)
          resolve(serverProcess) // Server already running
        }
      })

      serverProcess.on('error', (error) => {
        clearTimeout(timeoutId)
        reject(error)
      })
    })
  },

  async stopTestServer(serverProcess) {
    if (serverProcess && !serverProcess.killed) {
      return new Promise((resolve) => {
        serverProcess.on('exit', resolve)
        serverProcess.kill()
        setTimeout(resolve, 1000) // Force resolve after 1 second
      })
    }
  },

  /**
   * Connection utilities
   */
  async waitForPort(port, host = '127.0.0.1', timeout = 5000) {
    const start = Date.now()
    
    while (Date.now() - start < timeout) {
      try {
        await new Promise((resolve, reject) => {
          const socket = new net.Socket()
          socket.setTimeout(1000)
          socket.connect(port, host, () => {
            socket.end()
            resolve()
          })
          socket.on('error', reject)
          socket.on('timeout', () => {
            socket.destroy()
            reject(new Error('Connection timeout'))
          })
        })
        return true
      } catch (error) {
        await TestUtils.sleep(100)
      }
    }
    
    throw new Error(`Port ${port} not available after ${timeout}ms`)
  },

  /**
   * Redis client utilities
   */
  createTestClient() {
    return {
      socket: null,
      connected: false,

      async connect(port = 6379, host = '127.0.0.1') {
        this.socket = new net.Socket()
        this.socket.setMaxListeners(100) // Increase listener limit for heavy tests
        return new Promise((resolve, reject) => {
          this.socket.connect(port, host, () => {
            this.connected = true
            resolve()
          })
          this.socket.on('error', reject)
        })
      },

      async sendCommand(command) {
        return new Promise((resolve, reject) => {
          if (!this.connected) {
            reject(new Error('Client is not connected'))
            return
          }

          const args = this.parseCommand(command)
          const resp = this.buildRESP(args)
          
          let response = ''
          let timeoutId = null
          let resolved = false
          
          const cleanup = () => {
            if (timeoutId) {
              clearTimeout(timeoutId)
              timeoutId = null
            }
            this.socket.removeListener('data', onData)
            this.socket.removeListener('error', onError)
          }
          
          const onData = (data) => {
            if (resolved) return
            response += data.toString()
            
            // Check if we have a complete RESP response
            if (this.isCompleteResponse(response)) {
              resolved = true
              cleanup()
              try {
                const result = this.parseResponse(response)
                resolve(result)
              } catch (error) {
                reject(error)
              }
            }
          }
          
          const onError = (error) => {
            if (resolved) return
            resolved = true
            cleanup()
            reject(error)
          }
          
          this.socket.on('data', onData)
          this.socket.on('error', onError)
          this.socket.write(resp)
          
          timeoutId = setTimeout(() => {
            if (resolved) return
            resolved = true
            cleanup()
            reject(new Error('Command timeout'))
          }, 10000) // Increased timeout for stress tests
        })
      },
      
      parseCommand(command) {
        const args = []
        let current = ''
        let inQuotes = false
        let quoteChar = null
        let closedEmptyQuoted = false
        
        for (let i = 0; i < command.length; i++) {
          const char = command[i]
          const nextChar = i + 1 < command.length ? command[i + 1] : ''
          
          if (inQuotes) {
            // Only close quotes if this looks like the terminating quote (followed by whitespace or EOL)
            if (char === quoteChar && (nextChar === '' || /\s/.test(nextChar))) {
              inQuotes = false
              quoteChar = null
              if (current.length === 0) {
                closedEmptyQuoted = true
              }
              continue
            }
            // Otherwise treat the quote as a literal character
            current += char
            continue
          }
          
          if (char === '"' || char === '\'') {
            inQuotes = true
            quoteChar = char
            continue
          }
          
          if (/\s/.test(char)) {
            if (current.length > 0 || closedEmptyQuoted) {
              args.push(current)
              current = ''
              closedEmptyQuoted = false
            }
            continue
          }
          
          current += char
        }
        
        if (current.length > 0 || closedEmptyQuoted) {
          args.push(current)
        }
        
        return args
      },
      
      isCompleteResponse(response) {
        if (!response.includes('\r\n')) return false
        
        const lines = response.split('\r\n')
        const firstLine = lines[0]
        
        if (firstLine.startsWith('+') || firstLine.startsWith('-') || firstLine.startsWith(':')) {
          return lines.length >= 2
        } else if (firstLine.startsWith('$')) {
          const length = parseInt(firstLine.substring(1))
          if (length === -1) return lines.length >= 2
          
          const expectedData = response.substring(response.indexOf('\r\n') + 2)
          return expectedData.length >= length + 2 // +2 for final \r\n
        } else if (firstLine.startsWith('*')) {
          const count = parseInt(firstLine.substring(1))
          if (count === -1) return lines.length >= 2
          if (count === 0) return lines.length >= 2
          
          // For arrays, we need to check if we have all elements
          let elementCount = 0
          let lineIndex = 1
          
          while (lineIndex < lines.length - 1 && elementCount < count) {
            if (lines[lineIndex].startsWith('$')) {
              const length = parseInt(lines[lineIndex].substring(1))
              if (length === -1) {
                elementCount++
                lineIndex += 1
              } else {
                if (lineIndex + 1 < lines.length) {
                  elementCount++
                  lineIndex += 2
                } else {
                  break
                }
              }
            } else if (lines[lineIndex].startsWith(':') || lines[lineIndex].startsWith('+')) {
              elementCount++
              lineIndex += 1
            } else {
              lineIndex += 1
            }
          }
          
          return elementCount === count
        }
        
        return true
      },

      buildRESP(args) {
        let resp = `*${args.length}\r\n`
        for (const arg of args) {
          const argStr = String(arg)
          const byteLen = Buffer.byteLength(argStr, 'utf8')
          resp += `$${byteLen}\r\n${argStr}\r\n`
        }
        return resp
      },

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
      },

      async disconnect() {
        if (this.socket && this.connected) {
          this.socket.removeAllListeners()
          this.socket.destroy()
          this.connected = false
          this.socket = null
        }
      }
    }
  },

  /**
   * Performance measurement utilities
   */
  async measureExecutionTime(fn) {
    const start = process.hrtime.bigint()
    const result = await fn()
    const end = process.hrtime.bigint()
    const executionTime = Number(end - start) / 1000000 // Convert to milliseconds
    
    return { result, executionTime }
  },

  async measureMemoryUsage(fn) {
    const memBefore = process.memoryUsage()
    const result = await fn()
    const memAfter = process.memoryUsage()
    
    return {
      result,
      memoryDelta: {
        rss: memAfter.rss - memBefore.rss,
        heapUsed: memAfter.heapUsed - memBefore.heapUsed,
        heapTotal: memAfter.heapTotal - memBefore.heapTotal,
        external: memAfter.external - memBefore.external
      }
    }
  },

  /**
   * Test data cleanup utilities
   */
  async cleanupTestData(client, prefix = 'test') {
    try {
      const keys = await client.sendCommand(`KEYS ${prefix}:*`)
      if (Array.isArray(keys) && keys.length > 0) {
        await client.sendCommand(`DEL ${keys.join(' ')}`)
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

// Global test configuration
global.TestConfig = {
  DEFAULT_TEST_PORT: 6379,
  TEST_TIMEOUT: 30000,
  SERVER_START_TIMEOUT: 10000,
  COMMAND_TIMEOUT: 5000,
  PERFORMANCE_ITERATIONS: 100,
  STRESS_TEST_CONCURRENT_CONNECTIONS: 50,
  STRESS_TEST_DURATION: 10000, // 10 seconds
  COVERAGE_THRESHOLD: 90
}

// Mock console methods for cleaner test output (optional)
const originalConsole = { ...console }
global.mockConsole = () => {
  console.log = jest.fn()
  console.warn = jest.fn()
  console.error = jest.fn()
  console.info = jest.fn()
}

global.restoreConsole = () => {
  Object.assign(console, originalConsole)
}

// Test environment validation
beforeAll(async () => {
  // Ensure test directories exist
  const testDirs = ['unit', 'integration', 'performance', 'compatibility']
  for (const dir of testDirs) {
    const dirPath = path.join(__dirname, dir)
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
  }
})

console.log('🧪 Jest Test Environment Configured for Phase 20')
console.log(`📊 Coverage Threshold: ${TestConfig.COVERAGE_THRESHOLD}%`)
console.log(`⏱️  Test Timeout: ${TestConfig.TEST_TIMEOUT}ms`)
console.log(`🚀 Test Utilities Loaded`)
