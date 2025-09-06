#!/usr/bin/env node

/**
 * Extended Redis Compatibility Test
 * Tests comprehensive Redis functionality for exact compatibility
 */

const { spawn } = require('child_process')
const net = require('net')
const path = require('path')

class ExtendedCompatibilityTest {
  constructor() {
    this.server = null
    this.results = []
    this.port = 6382
  }

  async startServer() {
    console.log('🚀 Starting Redis Clone server for extended testing...')
    
    this.server = spawn('node', [path.join(__dirname, '../simple-server.js')], {
      env: { 
        ...process.env, 
        REDIS_PORT: this.port.toString(), 
        REDIS_HOST: '127.0.0.1' 
      }
    })
    
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
      
      let response = Buffer.alloc(0)
      client.on('data', (data) => {
        response = Buffer.concat([response, data])
        // Wait a bit for complete response
        setTimeout(() => {
          client.end()
          resolve(response.toString())
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

  expectResponse(name, command, expectedResponse, description) {
    return { name, command, expectedResponse, description }
  }

  async testCommand(test) {
    try {
      const response = await this.sendCommand(test.command)
      const passed = response === test.expectedResponse
      
      const status = passed ? '✅' : '❌'
      console.log(`${status} ${test.name}: ${passed ? 'PASS' : 'FAIL'}`)
      if (!passed) {
        console.log(`   Command: ${test.command.join(' ')}`)
        console.log(`   Expected: ${test.expectedResponse.replace(/\r\n/g, '\\r\\n')}`)
        console.log(`   Actual:   ${response.replace(/\r\n/g, '\\r\\n')}`)
      }
      console.log(`   Description: ${test.description}`)
      console.log('')
      
      this.results.push({
        test: test.name,
        passed,
        command: test.command.join(' '),
        expected: test.expectedResponse,
        actual: response
      })
      
    } catch (error) {
      console.log(`❌ ${test.name}: ERROR - ${error.message}`)
      console.log(`   Command: ${test.command.join(' ')}`)
      console.log('')
      
      this.results.push({
        test: test.name,
        passed: false,
        error: error.message
      })
    }
  }

  async runStringOperationTests() {
    console.log('\n🔤 Testing String Operations...')
    
    // Clean slate
    await this.testCommand(this.expectResponse(
      'CLEANUP', ['FLUSHALL'], '+OK\r\n', 
      'Database cleanup'
    ))
    
    // Basic SET/GET
    await this.testCommand(this.expectResponse(
      'SET_BASIC', ['SET', 'key1', 'hello'], '+OK\r\n',
      'Basic SET operation'
    ))
    
    await this.testCommand(this.expectResponse(
      'GET_BASIC', ['GET', 'key1'], '$5\r\nhello\r\n',
      'Basic GET operation'
    ))
    
    // APPEND operations
    await this.testCommand(this.expectResponse(
      'APPEND_BASIC', ['APPEND', 'key1', ' world'], ':11\r\n',
      'APPEND to existing key should return new length'
    ))
    
    await this.testCommand(this.expectResponse(
      'GET_AFTER_APPEND', ['GET', 'key1'], '$11\r\nhello world\r\n',
      'GET after APPEND should return concatenated value'
    ))
    
    await this.testCommand(this.expectResponse(
      'APPEND_NEW_KEY', ['APPEND', 'newkey', 'test'], ':4\r\n',
      'APPEND to new key should work like SET'
    ))
    
    // STRLEN operations
    await this.testCommand(this.expectResponse(
      'STRLEN_EXISTING', ['STRLEN', 'key1'], ':11\r\n',
      'STRLEN should return correct length'
    ))
    
    await this.testCommand(this.expectResponse(
      'STRLEN_NONEXISTENT', ['STRLEN', 'nonexistent'], ':0\r\n',
      'STRLEN on non-existent key should return 0'
    ))
    
    // Numeric operations
    await this.testCommand(this.expectResponse(
      'SET_NUMBER', ['SET', 'counter', '10'], '+OK\r\n',
      'SET numeric value'
    ))
    
    await this.testCommand(this.expectResponse(
      'INCR_EXISTING', ['INCR', 'counter'], ':11\r\n',
      'INCR should increment and return new value'
    ))
    
    await this.testCommand(this.expectResponse(
      'INCR_NEW', ['INCR', 'newcounter'], ':1\r\n',
      'INCR on new key should start at 1'
    ))
    
    await this.testCommand(this.expectResponse(
      'DECR_EXISTING', ['DECR', 'counter'], ':10\r\n',
      'DECR should decrement and return new value'
    ))
    
    await this.testCommand(this.expectResponse(
      'INCRBY', ['INCRBY', 'counter', '5'], ':15\r\n',
      'INCRBY should increment by amount'
    ))
    
    await this.testCommand(this.expectResponse(
      'DECRBY', ['DECRBY', 'counter', '3'], ':12\r\n',
      'DECRBY should decrement by amount'
    ))
    
    // Test INCR on non-numeric value
    await this.testCommand(this.expectResponse(
      'SET_STRING', ['SET', 'stringkey', 'notanumber'], '+OK\r\n',
      'SET string value'
    ))
    
    // This should return an error
    await this.testCommand(this.expectResponse(
      'INCR_STRING_ERROR', ['INCR', 'stringkey'], '-ERR value is not an integer or out of range\r\n',
      'INCR on string should return error'
    ))
    
    // GETRANGE operations
    await this.testCommand(this.expectResponse(
      'SET_FOR_RANGE', ['SET', 'rangetest', 'Hello World'], '+OK\r\n',
      'SET value for range testing'
    ))
    
    await this.testCommand(this.expectResponse(
      'GETRANGE_BASIC', ['GETRANGE', 'rangetest', '0', '4'], '$5\r\nHello\r\n',
      'GETRANGE should return substring'
    ))
    
    await this.testCommand(this.expectResponse(
      'GETRANGE_NEGATIVE', ['GETRANGE', 'rangetest', '-5', '-1'], '$5\r\nWorld\r\n',
      'GETRANGE with negative indices'
    ))
    
    await this.testCommand(this.expectResponse(
      'GETRANGE_FULL', ['GETRANGE', 'rangetest', '0', '-1'], '$11\r\nHello World\r\n',
      'GETRANGE full string'
    ))
    
    // SETRANGE operations
    await this.testCommand(this.expectResponse(
      'SETRANGE_BASIC', ['SETRANGE', 'rangetest', '6', 'Redis'], ':11\r\n',
      'SETRANGE should return new string length'
    ))
    
    await this.testCommand(this.expectResponse(
      'GET_AFTER_SETRANGE', ['GET', 'rangetest'], '$11\r\nHello Redis\r\n',
      'GET after SETRANGE should show modification'
    ))
    
    // Multiple key operations
    await this.testCommand(this.expectResponse(
      'MSET', ['MSET', 'k1', 'v1', 'k2', 'v2', 'k3', 'v3'], '+OK\r\n',
      'MSET should set multiple keys'
    ))
    
    await this.testCommand(this.expectResponse(
      'MGET', ['MGET', 'k1', 'k2', 'k3'], '*3\r\n$2\r\nv1\r\n$2\r\nv2\r\n$2\r\nv3\r\n',
      'MGET should return array of values'
    ))
    
    await this.testCommand(this.expectResponse(
      'MGET_MIXED', ['MGET', 'k1', 'nonexistent', 'k3'], '*3\r\n$2\r\nv1\r\n$-1\r\n$2\r\nv3\r\n',
      'MGET with non-existent key should include null'
    ))
  }

  async runKeyOperationTests() {
    console.log('\n🔑 Testing Key Operations...')
    
    // EXISTS operations
    await this.testCommand(this.expectResponse(
      'EXISTS_SINGLE', ['EXISTS', 'k1'], ':1\r\n',
      'EXISTS should return 1 for existing key'
    ))
    
    await this.testCommand(this.expectResponse(
      'EXISTS_NONEXISTENT', ['EXISTS', 'nonexistent'], ':0\r\n',
      'EXISTS should return 0 for non-existent key'
    ))
    
    await this.testCommand(this.expectResponse(
      'EXISTS_MULTIPLE', ['EXISTS', 'k1', 'k2', 'nonexistent'], ':2\r\n',
      'EXISTS with multiple keys should return count'
    ))
    
    // DEL operations
    await this.testCommand(this.expectResponse(
      'DEL_SINGLE', ['DEL', 'k1'], ':1\r\n',
      'DEL should return 1 for deleted key'
    ))
    
    await this.testCommand(this.expectResponse(
      'DEL_NONEXISTENT', ['DEL', 'nonexistent'], ':0\r\n',
      'DEL should return 0 for non-existent key'
    ))
    
    await this.testCommand(this.expectResponse(
      'DEL_MULTIPLE', ['DEL', 'k2', 'k3', 'nonexistent'], ':2\r\n',
      'DEL multiple keys should return count of deleted keys'
    ))
    
    // TYPE operations
    await this.testCommand(this.expectResponse(
      'SET_FOR_TYPE', ['SET', 'typetest', 'string'], '+OK\r\n',
      'SET value for type testing'
    ))
    
    await this.testCommand(this.expectResponse(
      'TYPE_STRING', ['TYPE', 'typetest'], '+string\r\n',
      'TYPE should return string for string value'
    ))
    
    await this.testCommand(this.expectResponse(
      'TYPE_NONEXISTENT', ['TYPE', 'nonexistent'], '+none\r\n',
      'TYPE should return none for non-existent key'
    ))
    
    // KEYS operations
    await this.testCommand(this.expectResponse(
      'KEYS_ALL', ['KEYS', '*'], '*1\r\n$8\r\ntypetest\r\n',
      'KEYS * should return array of all keys (only typetest should remain)'
    ))
  }

  async runErrorHandlingTests() {
    console.log('\n⚠️  Testing Error Handling...')
    
    // Wrong number of arguments
    await this.testCommand(this.expectResponse(
      'GET_NO_ARGS', ['GET'], '-ERR wrong number of arguments for \'get\' command\r\n',
      'GET with no arguments should return error'
    ))
    
    await this.testCommand(this.expectResponse(
      'SET_NO_VALUE', ['SET', 'key'], '-ERR wrong number of arguments for \'set\' command\r\n',
      'SET with no value should return error'
    ))
    
    // Invalid command
    await this.testCommand(this.expectResponse(
      'INVALID_COMMAND', ['INVALIDCMD'], '-ERR unknown command \'INVALIDCMD\'\r\n',
      'Invalid command should return error'
    ))
  }

  printResults() {
    const passed = this.results.filter(r => r.passed).length
    const failed = this.results.length - passed
    const passRate = this.results.length > 0 ? ((passed / this.results.length) * 100).toFixed(1) : 0
    
    console.log('='.repeat(60))
    console.log('📊 EXTENDED COMPATIBILITY TEST RESULTS')
    console.log('='.repeat(60))
    console.log(`✅ Passed: ${passed}`)
    console.log(`❌ Failed: ${failed}`)
    console.log(`🎯 Pass Rate: ${passRate}%`)
    
    const failedTests = this.results.filter(r => !r.passed)
    if (failedTests.length > 0) {
      console.log('\n❌ FAILED TESTS:')
      failedTests.forEach(result => {
        console.log(`  - ${result.test}: ${result.command}`)
        if (result.error) {
          console.log(`    Error: ${result.error}`)
        } else {
          console.log(`    Expected: ${result.expected.replace(/\r\n/g, '\\r\\n')}`)
          console.log(`    Actual:   ${result.actual.replace(/\r\n/g, '\\r\\n')}`)
        }
      })
    }
    
    if (passRate >= 95) {
      console.log('\n🎉 EXCELLENT! Redis compatibility is very high.')
    } else if (passRate >= 85) {
      console.log('\n⚠️  GOOD! Some compatibility issues need attention.')
    } else {
      console.log('\n🚨 POOR! Significant compatibility issues found.')
    }
  }

  async run() {
    try {
      await this.startServer()
      await this.runStringOperationTests()
      await this.runKeyOperationTests()
      await this.runErrorHandlingTests()
      this.printResults()
    } catch (error) {
      console.error('❌ Test runner error:', error.message)
    } finally {
      await this.stopServer()
    }
  }
}

// Run if this file is executed directly
if (require.main === module) {
  const test = new ExtendedCompatibilityTest()
  test.run().catch(console.error)
}

module.exports = ExtendedCompatibilityTest
