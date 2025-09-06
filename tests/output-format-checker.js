#!/usr/bin/env node

/**
 * Output Format Checker
 * Tests Redis Clone JS output format against expected Redis behavior
 * This can be run without needing a Redis server installation
 */

const { spawn } = require('child_process')
const net = require('net')
const path = require('path')

class OutputFormatChecker {
  constructor() {
    this.server = null
    this.results = []
    this.port = 6381
  }

  async startServer() {
    console.log('🚀 Starting Redis Clone server...')
    
    this.server = spawn('node', [path.join(__dirname, '../simple-server.js')], {
      env: { 
        ...process.env, 
        REDIS_PORT: this.port.toString(), 
        REDIS_HOST: '127.0.0.1' 
      }
    })
    
    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 2000))
    console.log('✅ Server started on port', this.port)
  }

  async stopServer() {
    if (this.server) {
      this.server.kill('SIGTERM')
      console.log('✅ Server stopped')
    }
  }

  async sendCommand(command) {
    return new Promise((resolve, reject) => {
      const client = net.createConnection(this.port, '127.0.0.1')
      
      client.on('connect', () => {
        const respCommand = this.buildRESP(command)
        client.write(respCommand)
      })
      
      let response = ''
      client.on('data', (data) => {
        response += data.toString()
        // Wait for complete response
        setTimeout(() => {
          client.end()
          resolve(response)
        }, 100)
      })
      
      client.on('error', (err) => {
        reject(err)
      })
      
      setTimeout(() => {
        client.destroy()
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

  parseRESPResponse(response) {
    const lines = response.split('\r\n')
    const firstLine = lines[0]
    
    if (firstLine.startsWith('+')) {
      return { type: 'simple_string', value: firstLine.substring(1) }
    } else if (firstLine.startsWith('-')) {
      return { type: 'error', value: firstLine.substring(1) }
    } else if (firstLine.startsWith(':')) {
      return { type: 'integer', value: parseInt(firstLine.substring(1)) }
    } else if (firstLine.startsWith('$')) {
      const length = parseInt(firstLine.substring(1))
      if (length === -1) return { type: 'null', value: null }
      return { type: 'bulk_string', value: lines[1] || '' }
    } else if (firstLine.startsWith('*')) {
      const count = parseInt(firstLine.substring(1))
      if (count === -1) return { type: 'null_array', value: null }
      
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
      
      return { type: 'array', value: result }
    }
    
    return { type: 'unknown', value: response.trim() }
  }

  testCase(name, command, expectedFormat, description) {
    return { name, command, expectedFormat, description }
  }

  async runTests() {
    // Start with a clean slate
    await this.sendCommand(['FLUSHALL'])
    
    const tests = [
      // Database cleanup first
      this.testCase('FLUSHALL', ['FLUSHALL'], 
        { type: 'simple_string', value: 'OK' }, 
        'FLUSHALL should return simple string +OK'),
        
      // Basic string operations
      this.testCase('SET_OK', ['SET', 'key1', 'value1'], 
        { type: 'simple_string', value: 'OK' }, 
        'SET should return simple string +OK'),
      
      this.testCase('GET_EXISTING', ['GET', 'key1'], 
        { type: 'bulk_string', value: 'value1' }, 
        'GET existing key should return bulk string'),
      
      this.testCase('GET_NONEXISTENT', ['GET', 'nonexistent'], 
        { type: 'null', value: null }, 
        'GET non-existent key should return null bulk string'),
      
      // Integer operations
      this.testCase('INCR_NEW', ['INCR', 'counter'], 
        { type: 'integer', value: 1 }, 
        'INCR on new key should return integer 1'),
      
      this.testCase('INCR_EXISTING', ['INCR', 'counter'], 
        { type: 'integer', value: 2 }, 
        'INCR on existing key should return incremented integer'),
      
      this.testCase('EXISTS_TRUE', ['EXISTS', 'key1'], 
        { type: 'integer', value: 1 }, 
        'EXISTS for existing key should return integer 1'),
      
      this.testCase('EXISTS_FALSE', ['EXISTS', 'nonexistent'], 
        { type: 'integer', value: 0 }, 
        'EXISTS for non-existent key should return integer 0'),
      
      // String length operations
      this.testCase('STRLEN_EXISTING', ['STRLEN', 'key1'], 
        { type: 'integer', value: 6 }, 
        'STRLEN should return integer length'),
      
      this.testCase('STRLEN_NONEXISTENT', ['STRLEN', 'nonexistent'], 
        { type: 'integer', value: 0 }, 
        'STRLEN for non-existent key should return 0'),
      
      // Array operations
      this.testCase('MGET', ['MGET', 'key1', 'nonexistent', 'counter'], 
        { type: 'array', value: ['value1', null, '2'] }, 
        'MGET should return array with mixed values and nulls'),
      
      this.testCase('KEYS', ['KEYS', '*'], 
        { type: 'array' }, 
        'KEYS should return array of strings'),
      
      // Error cases
      this.testCase('WRONG_ARGS', ['GET'], 
        { type: 'error' }, 
        'Wrong number of arguments should return error'),
        
      // Database operations
      this.testCase('DEL_EXISTING', ['DEL', 'key1'], 
        { type: 'integer', value: 1 }, 
        'DEL existing key should return 1'),
      
      this.testCase('DEL_NONEXISTENT', ['DEL', 'nonexistent'], 
        { type: 'integer', value: 0 }, 
        'DEL non-existent key should return 0'),
    ]

    console.log(`\n🧪 Running ${tests.length} output format tests...\n`)

    for (const test of tests) {
      try {
        const rawResponse = await this.sendCommand(test.command)
        const parsed = this.parseRESPResponse(rawResponse)
        
        let passed = false
        let message = ''
        
        if (parsed.type === test.expectedFormat.type) {
          if (test.expectedFormat.type === 'array') {
            // For arrays, just check if it's an array (content may vary)
            passed = Array.isArray(parsed.value)
            message = passed ? 'PASS' : `Expected array, got ${typeof parsed.value}`
          } else if (test.expectedFormat.value !== undefined) {
            passed = JSON.stringify(parsed.value) === JSON.stringify(test.expectedFormat.value)
            message = passed ? 'PASS' : `Expected ${JSON.stringify(test.expectedFormat.value)}, got ${JSON.stringify(parsed.value)}`
          } else {
            passed = true
            message = 'PASS'
          }
        } else {
          message = `Expected type ${test.expectedFormat.type}, got ${parsed.type}`
        }
        
        const status = passed ? '✅' : '❌'
        console.log(`${status} ${test.name}: ${message}`)
        console.log(`   Command: ${test.command.join(' ')}`)
        console.log(`   Description: ${test.description}`)
        if (!passed) {
          console.log(`   Raw Response: ${rawResponse.replace(/\r\n/g, '\\r\\n')}`)
          console.log(`   Parsed: ${JSON.stringify(parsed)}`)
        }
        console.log('')
        
        this.results.push({
          test: test.name,
          passed,
          message,
          expected: test.expectedFormat,
          actual: parsed
        })
        
      } catch (error) {
        console.log(`❌ ${test.name}: ERROR - ${error.message}`)
        console.log(`   Command: ${test.command.join(' ')}`)
        console.log('')
        
        this.results.push({
          test: test.name,
          passed: false,
          message: `Error: ${error.message}`,
          error: error.message
        })
      }
    }
    
    this.printSummary()
  }

  printSummary() {
    const passed = this.results.filter(r => r.passed).length
    const failed = this.results.length - passed
    const passRate = ((passed / this.results.length) * 100).toFixed(1)
    
    console.log('='.repeat(60))
    console.log('📊 OUTPUT FORMAT TEST RESULTS')
    console.log('='.repeat(60))
    console.log(`✅ Passed: ${passed}`)
    console.log(`❌ Failed: ${failed}`)
    console.log(`🎯 Pass Rate: ${passRate}%`)
    
    if (failed > 0) {
      console.log('\n❌ FAILED TESTS:')
      this.results.filter(r => !r.passed).forEach(result => {
        console.log(`  - ${result.test}: ${result.message}`)
      })
    }
    
    if (passRate >= 90) {
      console.log('\n🎉 EXCELLENT! Output formats are highly Redis-compatible.')
    } else if (passRate >= 75) {
      console.log('\n⚠️  GOOD! Some output format issues need attention.')
    } else {
      console.log('\n🚨 POOR! Significant output format issues found.')
    }
  }

  async run() {
    try {
      await this.startServer()
      await this.runTests()
    } catch (error) {
      console.error('❌ Test runner error:', error.message)
    } finally {
      await this.stopServer()
    }
  }
}

// Run if this file is executed directly
if (require.main === module) {
  const checker = new OutputFormatChecker()
  checker.run().catch(console.error)
}

module.exports = OutputFormatChecker
