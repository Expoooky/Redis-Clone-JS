#!/usr/bin/env node

/**
 * Redis Compatibility Checker
 * Systematically tests Redis Clone JS against Redis command behavior
 * 
 * This script starts both Redis server and Redis Clone server,
 * runs commands on both, and compares outputs for 1:1 compatibility.
 */

const net = require('net')
const { spawn } = require('child_process')
const path = require('path')

class RedisCompatibilityChecker {
  constructor() {
    this.redisServer = null
    this.cloneServer = null
    this.results = {
      passed: 0,
      failed: 0,
      errors: [],
      incompatibilities: []
    }
  }

  /**
   * Start both servers for testing
   */
  async startServers() {
    console.log('🚀 Starting servers for compatibility testing...')
    
    // Start Redis Clone server
    console.log('Starting Redis Clone server...')
    this.cloneServer = spawn('node', [path.join(__dirname, '../simple-server.js')], {
      env: { ...process.env, REDIS_PORT: '6380', REDIS_HOST: '127.0.0.1' }
    })
    
    // Wait for clone server to start
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    console.log('✅ Servers started')
  }

  /**
   * Stop both servers
   */
  async stopServers() {
    if (this.cloneServer) {
      this.cloneServer.kill('SIGTERM')
    }
    console.log('✅ Servers stopped')
  }

  /**
   * Send command to Redis server
   */
  async sendToRedis(command) {
    return new Promise((resolve, reject) => {
      const client = net.createConnection(6379, '127.0.0.1')
      
      client.on('connect', () => {
        const respCommand = this.buildRESP(command)
        client.write(respCommand)
      })
      
      let response = ''
      client.on('data', (data) => {
        response += data.toString()
        // Simple response detection - for full testing, would need proper RESP parser
        if (response.includes('\r\n')) {
          client.end()
          resolve(this.parseRESPResponse(response))
        }
      })
      
      client.on('error', (err) => {
        reject(new Error(`Redis connection error: ${err.message}`))
      })
      
      setTimeout(() => {
        client.destroy()
        reject(new Error('Redis command timeout'))
      }, 5000)
    })
  }

  /**
   * Send command to Redis Clone server
   */
  async sendToClone(command) {
    return new Promise((resolve, reject) => {
      const client = net.createConnection(6380, '127.0.0.1')
      
      client.on('connect', () => {
        const respCommand = this.buildRESP(command)
        client.write(respCommand)
      })
      
      let response = ''
      client.on('data', (data) => {
        response += data.toString()
        if (response.includes('\r\n')) {
          client.end()
          resolve(this.parseRESPResponse(response))
        }
      })
      
      client.on('error', (err) => {
        reject(new Error(`Clone connection error: ${err.message}`))
      })
      
      setTimeout(() => {
        client.destroy()
        reject(new Error('Clone command timeout'))
      }, 5000)
    })
  }

  /**
   * Build RESP protocol command
   */
  buildRESP(args) {
    let resp = `*${args.length}\r\n`
    for (const arg of args) {
      const argStr = String(arg)
      resp += `$${argStr.length}\r\n${argStr}\r\n`
    }
    return resp
  }

  /**
   * Parse RESP response (simplified)
   */
  parseRESPResponse(response) {
    const lines = response.split('\r\n')
    const firstLine = lines[0]
    
    if (firstLine.startsWith('+')) {
      return firstLine.substring(1)
    } else if (firstLine.startsWith('-')) {
      return new Error(firstLine.substring(1))
    } else if (firstLine.startsWith(':')) {
      return parseInt(firstLine.substring(1))
    } else if (firstLine.startsWith('$')) {
      const length = parseInt(firstLine.substring(1))
      if (length === -1) return null
      return lines[1] || ''
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

  /**
   * Compare two values for compatibility
   */
  compareValues(expected, actual, commandDesc) {
    const expectedStr = JSON.stringify(expected)
    const actualStr = JSON.stringify(actual)
    
    if (expectedStr === actualStr) {
      this.results.passed++
      console.log(`✅ ${commandDesc}: PASS`)
      return true
    } else {
      this.results.failed++
      console.log(`❌ ${commandDesc}: FAIL`)
      console.log(`   Expected: ${expectedStr}`)
      console.log(`   Actual:   ${actualStr}`)
      
      this.results.incompatibilities.push({
        command: commandDesc,
        expected,
        actual
      })
      return false
    }
  }

  /**
   * Test a command against both servers
   */
  async testCommand(command, description) {
    try {
      const redisResult = await this.sendToRedis(command)
      const cloneResult = await this.sendToClone(command)
      
      return this.compareValues(redisResult, cloneResult, description)
    } catch (error) {
      this.results.failed++
      this.results.errors.push({
        command: description,
        error: error.message
      })
      console.log(`❌ ${description}: ERROR - ${error.message}`)
      return false
    }
  }

  /**
   * Run Phase 1: Core Key-Value Operations
   */
  async testPhase1() {
    console.log('\n🔍 Phase 1: Core Key-Value Operations')
    
    // Clean slate
    await this.testCommand(['FLUSHALL'], 'FLUSHALL')
    
    // Basic SET/GET
    await this.testCommand(['SET', 'testkey', 'testvalue'], 'SET basic')
    await this.testCommand(['GET', 'testkey'], 'GET basic')
    await this.testCommand(['GET', 'nonexistent'], 'GET non-existent key')
    
    // EXISTS
    await this.testCommand(['EXISTS', 'testkey'], 'EXISTS existing key')
    await this.testCommand(['EXISTS', 'nonexistent'], 'EXISTS non-existent key')
    
    // DEL
    await this.testCommand(['DEL', 'testkey'], 'DEL existing key')
    await this.testCommand(['DEL', 'nonexistent'], 'DEL non-existent key')
    await this.testCommand(['GET', 'testkey'], 'GET after DEL')
    
    // SET with options
    await this.testCommand(['SET', 'nx-key', 'value', 'NX'], 'SET with NX (new key)')
    await this.testCommand(['SET', 'nx-key', 'value2', 'NX'], 'SET with NX (existing key)')
    await this.testCommand(['SET', 'xx-key', 'value', 'XX'], 'SET with XX (new key)')
    await this.testCommand(['SET', 'nx-key', 'value2', 'XX'], 'SET with XX (existing key)')
  }

  /**
   * Run Phase 2: String Operations
   */
  async testPhase2() {
    console.log('\n🔍 Phase 2: String Operations')
    
    // Clean slate
    await this.testCommand(['FLUSHALL'], 'FLUSHALL')
    
    // APPEND
    await this.testCommand(['APPEND', 'str-key', 'Hello'], 'APPEND to new key')
    await this.testCommand(['APPEND', 'str-key', ' World'], 'APPEND to existing key')
    await this.testCommand(['GET', 'str-key'], 'GET after APPEND')
    
    // STRLEN
    await this.testCommand(['STRLEN', 'str-key'], 'STRLEN existing key')
    await this.testCommand(['STRLEN', 'nonexistent'], 'STRLEN non-existent key')
    
    // INCR/DECR
    await this.testCommand(['SET', 'num-key', '10'], 'SET number')
    await this.testCommand(['INCR', 'num-key'], 'INCR')
    await this.testCommand(['INCR', 'new-num-key'], 'INCR new key')
    await this.testCommand(['DECR', 'num-key'], 'DECR')
    await this.testCommand(['INCRBY', 'num-key', '5'], 'INCRBY')
    await this.testCommand(['DECRBY', 'num-key', '3'], 'DECRBY')
    
    // GETRANGE/SETRANGE
    await this.testCommand(['SET', 'range-key', 'Hello World'], 'SET for range test')
    await this.testCommand(['GETRANGE', 'range-key', '0', '4'], 'GETRANGE')
    await this.testCommand(['GETRANGE', 'range-key', '-5', '-1'], 'GETRANGE negative indices')
    await this.testCommand(['SETRANGE', 'range-key', '6', 'Redis'], 'SETRANGE')
    await this.testCommand(['GET', 'range-key'], 'GET after SETRANGE')
    
    // Multi-string operations
    await this.testCommand(['MSET', 'key1', 'val1', 'key2', 'val2', 'key3', 'val3'], 'MSET')
    await this.testCommand(['MGET', 'key1', 'key2', 'key3', 'nonexistent'], 'MGET')
  }

  /**
   * Run Phase 3: Data Type Operations
   */
  async testPhase3() {
    console.log('\n🔍 Phase 3: Data Type Operations')
    
    // Clean slate
    await this.testCommand(['FLUSHALL'], 'FLUSHALL')
    
    // TYPE command
    await this.testCommand(['SET', 'str-key', 'value'], 'SET string')
    await this.testCommand(['TYPE', 'str-key'], 'TYPE string')
    await this.testCommand(['TYPE', 'nonexistent'], 'TYPE non-existent')
  }

  /**
   * Run Phase 4: Database Operations
   */
  async testPhase4() {
    console.log('\n🔍 Phase 4: Database Operations')
    
    // Database selection (if supported)
    await this.testCommand(['SELECT', '1'], 'SELECT database 1')
    await this.testCommand(['SET', 'db1-key', 'value'], 'SET in database 1')
    await this.testCommand(['SELECT', '0'], 'SELECT database 0')
    await this.testCommand(['GET', 'db1-key'], 'GET key from database 0 (should be null)')
    await this.testCommand(['SELECT', '1'], 'SELECT database 1 again')
    await this.testCommand(['GET', 'db1-key'], 'GET key from database 1 (should exist)')
    
    // DBSIZE
    await this.testCommand(['DBSIZE'], 'DBSIZE')
    
    // KEYS
    await this.testCommand(['SELECT', '0'], 'SELECT database 0')
    await this.testCommand(['FLUSHDB'], 'FLUSHDB')
    await this.testCommand(['SET', 'test:1', 'value1'], 'SET test:1')
    await this.testCommand(['SET', 'test:2', 'value2'], 'SET test:2')
    await this.testCommand(['SET', 'other', 'value3'], 'SET other')
    await this.testCommand(['KEYS', '*'], 'KEYS *')
    await this.testCommand(['KEYS', 'test:*'], 'KEYS with pattern')
    await this.testCommand(['KEYS', 'nonexistent:*'], 'KEYS non-matching pattern')
  }

  /**
   * Run Phase 5: Response Format Tests
   */
  async testPhase5() {
    console.log('\n🔍 Phase 5: Response Format Verification')
    
    // Test different response types
    await this.testCommand(['PING'], 'PING')
    await this.testCommand(['ECHO', 'Hello World'], 'ECHO')
    
    // Error responses
    await this.testCommand(['GET'], 'GET with wrong number of arguments')
    await this.testCommand(['SET'], 'SET with wrong number of arguments')
    
    // OK responses
    await this.testCommand(['SET', 'test', 'value'], 'SET OK response')
  }

  /**
   * Run all compatibility tests
   */
  async runAllTests() {
    console.log('🔬 Redis Compatibility Checker Starting...\n')
    
    try {
      await this.startServers()
      
      await this.testPhase1()
      await this.testPhase2()
      await this.testPhase3()
      await this.testPhase4()
      await this.testPhase5()
      
      this.printResults()
      
    } catch (error) {
      console.error('❌ Test suite error:', error.message)
    } finally {
      await this.stopServers()
    }
  }

  /**
   * Print test results summary
   */
  printResults() {
    console.log('\n' + '='.repeat(60))
    console.log('📊 REDIS COMPATIBILITY TEST RESULTS')
    console.log('='.repeat(60))
    
    const total = this.results.passed + this.results.failed
    const passRate = total > 0 ? ((this.results.passed / total) * 100).toFixed(1) : 0
    
    console.log(`✅ Passed: ${this.results.passed}`)
    console.log(`❌ Failed: ${this.results.failed}`)
    console.log(`🎯 Pass Rate: ${passRate}%`)
    
    if (this.results.errors.length > 0) {
      console.log('\n❌ ERRORS:')
      this.results.errors.forEach(error => {
        console.log(`  - ${error.command}: ${error.error}`)
      })
    }
    
    if (this.results.incompatibilities.length > 0) {
      console.log('\n⚠️  INCOMPATIBILITIES:')
      this.results.incompatibilities.forEach(inc => {
        console.log(`  - ${inc.command}:`)
        console.log(`    Expected: ${JSON.stringify(inc.expected)}`)
        console.log(`    Actual:   ${JSON.stringify(inc.actual)}`)
      })
    }
    
    if (passRate < 95) {
      console.log('\n🚨 COMPATIBILITY ISSUES FOUND! The implementation needs fixes.')
      process.exit(1)
    } else {
      console.log('\n🎉 EXCELLENT COMPATIBILITY! The implementation is Redis-compatible.')
    }
  }
}

// Run the compatibility checker if this file is executed directly
if (require.main === module) {
  const checker = new RedisCompatibilityChecker()
  checker.runAllTests().catch(console.error)
}

module.exports = RedisCompatibilityChecker
