#!/usr/bin/env node

/**
 * Key Expiration Compatibility Test
 * Tests EXPIRE, TTL, PERSIST, EXPIREAT, PEXPIRE, PTTL, PEXPIREAT commands
 */

const { spawn } = require('child_process')
const net = require('net')
const path = require('path')

class ExpirationTest {
  constructor() {
    this.server = null
    this.results = []
    this.port = 6384
  }

  async startServer() {
    console.log('🚀 Starting Redis Clone server for expiration testing...')
    
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

  parseInteger(respResponse) {
    const lines = respResponse.split('\r\n')
    if (lines[0].startsWith(':')) {
      return parseInt(lines[0].substring(1))
    }
    return null
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

  async testCommandWithTolerance(name, command, description, validator) {
    try {
      const response = await this.sendCommand(command)
      const passed = validator(response)
      
      const status = passed ? '✅' : '❌'
      console.log(`${status} ${name}: ${passed ? 'PASS' : 'FAIL'}`)
      if (!passed) {
        console.log(`   Command: ${command.join(' ')}`)
        console.log(`   Response: ${response.replace(/\r\n/g, '\\r\\n')}`)
      }
      console.log(`   Description: ${description}`)
      console.log('')
      
      this.results.push({
        test: name,
        passed,
        command: command.join(' '),
        actual: response
      })
      
    } catch (error) {
      console.log(`❌ ${name}: ERROR - ${error.message}`)
      console.log(`   Command: ${command.join(' ')}`)
      console.log('')
      
      this.results.push({
        test: name,
        passed: false,
        error: error.message
      })
    }
  }

  async runExpirationTests() {
    console.log('\n⏰ Testing Key Expiration...')
    
    // Clean slate
    await this.testCommand(this.expectResponse(
      'CLEANUP', ['FLUSHALL'], '+OK\r\n', 
      'Database cleanup'
    ))
    
    // Set key for expiration testing
    await this.testCommand(this.expectResponse(
      'SET_KEY', ['SET', 'expirekey', 'value'], '+OK\r\n',
      'Set key for expiration tests'
    ))
    
    // EXPIRE command
    await this.testCommand(this.expectResponse(
      'EXPIRE_SET', ['EXPIRE', 'expirekey', '2'], ':1\r\n',
      'EXPIRE should return 1 for existing key'
    ))
    
    await this.testCommand(this.expectResponse(
      'EXPIRE_NONEXISTENT', ['EXPIRE', 'nonexistent', '10'], ':0\r\n',
      'EXPIRE should return 0 for non-existent key'
    ))
    
    // TTL command - should be around 2 seconds, but we'll be flexible
    await this.testCommandWithTolerance(
      'TTL_ACTIVE', ['TTL', 'expirekey'], 
      'TTL should return remaining seconds',
      (response) => {
        const ttl = this.parseInteger(response)
        return ttl !== null && ttl > 0 && ttl <= 2
      }
    )
    
    await this.testCommand(this.expectResponse(
      'TTL_NONEXISTENT', ['TTL', 'nonexistent'], ':-2\r\n',
      'TTL should return -2 for non-existent key'
    ))
    
    // Test key with no expiration
    await this.testCommand(this.expectResponse(
      'SET_NO_EXPIRE', ['SET', 'noexpire', 'value'], '+OK\r\n',
      'Set key without expiration'
    ))
    
    await this.testCommand(this.expectResponse(
      'TTL_NO_EXPIRE', ['TTL', 'noexpire'], ':-1\r\n',
      'TTL should return -1 for key without expiration'
    ))
    
    // PERSIST command
    await this.testCommand(this.expectResponse(
      'PERSIST_SUCCESS', ['PERSIST', 'expirekey'], ':1\r\n',
      'PERSIST should return 1 for key with expiration'
    ))
    
    await this.testCommand(this.expectResponse(
      'TTL_AFTER_PERSIST', ['TTL', 'expirekey'], ':-1\r\n',
      'TTL should return -1 after PERSIST'
    ))
    
    await this.testCommand(this.expectResponse(
      'PERSIST_NO_EXPIRE', ['PERSIST', 'noexpire'], ':0\r\n',
      'PERSIST should return 0 for key without expiration'
    ))
    
    // Test PEXPIRE (milliseconds)
    await this.testCommand(this.expectResponse(
      'PEXPIRE_SET', ['PEXPIRE', 'expirekey', '2000'], ':1\r\n',
      'PEXPIRE should return 1 for existing key'
    ))
    
    // PTTL command - should be around 2000ms, but we'll be flexible
    await this.testCommandWithTolerance(
      'PTTL_ACTIVE', ['PTTL', 'expirekey'], 
      'PTTL should return remaining milliseconds',
      (response) => {
        const pttl = this.parseInteger(response)
        return pttl !== null && pttl > 0 && pttl <= 2000
      }
    )
    
    await this.testCommand(this.expectResponse(
      'PTTL_NONEXISTENT', ['PTTL', 'nonexistent'], ':-2\r\n',
      'PTTL should return -2 for non-existent key'
    ))
    
    await this.testCommand(this.expectResponse(
      'PTTL_NO_EXPIRE', ['PTTL', 'noexpire'], ':-1\r\n',
      'PTTL should return -1 for key without expiration'
    ))
    
    // Test SET with EX and PX options
    await this.testCommand(this.expectResponse(
      'SET_WITH_EX', ['SET', 'exkey', 'value', 'EX', '3'], '+OK\r\n',
      'SET with EX option should work'
    ))
    
    await this.testCommandWithTolerance(
      'TTL_SET_EX', ['TTL', 'exkey'], 
      'TTL for SET with EX should return seconds',
      (response) => {
        const ttl = this.parseInteger(response)
        return ttl !== null && ttl > 0 && ttl <= 3
      }
    )
    
    await this.testCommand(this.expectResponse(
      'SET_WITH_PX', ['SET', 'pxkey', 'value', 'PX', '3000'], '+OK\r\n',
      'SET with PX option should work'
    ))
    
    await this.testCommandWithTolerance(
      'PTTL_SET_PX', ['PTTL', 'pxkey'], 
      'PTTL for SET with PX should return milliseconds',
      (response) => {
        const pttl = this.parseInteger(response)
        return pttl !== null && pttl > 0 && pttl <= 3000
      }
    )
  }

  async runExpirationBehaviorTests() {
    console.log('\n🕰️  Testing Expiration Behavior...')
    
    // Test that expired keys are automatically removed
    await this.testCommand(this.expectResponse(
      'SET_SHORT_EXPIRE', ['SET', 'shortlive', 'value'], '+OK\r\n',
      'Set key for expiration behavior test'
    ))
    
    await this.testCommand(this.expectResponse(
      'EXPIRE_SHORT', ['EXPIRE', 'shortlive', '1'], ':1\r\n',
      'Set very short expiration'
    ))
    
    // Key should exist immediately
    await this.testCommand(this.expectResponse(
      'EXISTS_BEFORE_EXPIRE', ['EXISTS', 'shortlive'], ':1\r\n',
      'Key should exist before expiration'
    ))
    
    // Wait for expiration
    console.log('   ⏳ Waiting for key to expire...')
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    // Key should be automatically removed
    await this.testCommand(this.expectResponse(
      'EXISTS_AFTER_EXPIRE', ['EXISTS', 'shortlive'], ':0\r\n',
      'Key should be automatically removed after expiration'
    ))
    
    await this.testCommand(this.expectResponse(
      'GET_EXPIRED_KEY', ['GET', 'shortlive'], '$-1\r\n',
      'GET expired key should return null'
    ))
    
    await this.testCommand(this.expectResponse(
      'TTL_EXPIRED_KEY', ['TTL', 'shortlive'], ':-2\r\n',
      'TTL for expired key should return -2'
    ))
  }

  printResults() {
    const passed = this.results.filter(r => r.passed).length
    const failed = this.results.length - passed
    const passRate = this.results.length > 0 ? ((passed / this.results.length) * 100).toFixed(1) : 0
    
    console.log('='.repeat(60))
    console.log('📊 EXPIRATION TEST RESULTS')
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
        } else if (result.expected) {
          console.log(`    Expected: ${result.expected.replace(/\r\n/g, '\\r\\n')}`)
          console.log(`    Actual:   ${result.actual.replace(/\r\n/g, '\\r\\n')}`)
        }
      })
    }
    
    if (passRate >= 95) {
      console.log('\n🎉 EXCELLENT! Expiration functionality is very good.')
    } else if (passRate >= 85) {
      console.log('\n⚠️  GOOD! Some expiration issues need attention.')
    } else {
      console.log('\n🚨 POOR! Significant expiration issues found.')
    }
  }

  async run() {
    try {
      await this.startServer()
      await this.runExpirationTests()
      await this.runExpirationBehaviorTests()
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
  const test = new ExpirationTest()
  test.run().catch(console.error)
}

module.exports = ExpirationTest
