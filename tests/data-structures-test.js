#!/usr/bin/env node

/**
 * Data Structures Compatibility Test
 * Tests Lists, Sets, Hashes, Sorted Sets, and other Redis data structures
 */

const { spawn } = require('child_process')
const net = require('net')
const path = require('path')

class DataStructuresTest {
  constructor() {
    this.server = null
    this.results = []
    this.port = 6383
  }

  async startServer() {
    console.log('🚀 Starting Redis Clone server for data structures testing...')
    
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

  async runListTests() {
    console.log('\n📋 Testing List Operations...')
    
    // Clean slate
    await this.testCommand(this.expectResponse(
      'CLEANUP', ['FLUSHALL'], '+OK\r\n', 
      'Database cleanup'
    ))
    
    // LPUSH operations
    await this.testCommand(this.expectResponse(
      'LPUSH_SINGLE', ['LPUSH', 'mylist', 'world'], ':1\r\n',
      'LPUSH should return length after push'
    ))
    
    await this.testCommand(this.expectResponse(
      'LPUSH_MULTI', ['LPUSH', 'mylist', 'hello'], ':2\r\n',
      'LPUSH should return updated length'
    ))
    
    // RPUSH operations
    await this.testCommand(this.expectResponse(
      'RPUSH_SINGLE', ['RPUSH', 'mylist', 'foo'], ':3\r\n',
      'RPUSH should return length after push'
    ))
    
    // LRANGE operations
    await this.testCommand(this.expectResponse(
      'LRANGE_ALL', ['LRANGE', 'mylist', '0', '-1'], '*3\r\n$5\r\nhello\r\n$5\r\nworld\r\n$3\r\nfoo\r\n',
      'LRANGE should return all elements'
    ))
    
    await this.testCommand(this.expectResponse(
      'LRANGE_PARTIAL', ['LRANGE', 'mylist', '0', '1'], '*2\r\n$5\r\nhello\r\n$5\r\nworld\r\n',
      'LRANGE should return partial range'
    ))
    
    // LLEN operation
    await this.testCommand(this.expectResponse(
      'LLEN', ['LLEN', 'mylist'], ':3\r\n',
      'LLEN should return list length'
    ))
    
    // LINDEX operations
    await this.testCommand(this.expectResponse(
      'LINDEX_FIRST', ['LINDEX', 'mylist', '0'], '$5\r\nhello\r\n',
      'LINDEX should return first element'
    ))
    
    await this.testCommand(this.expectResponse(
      'LINDEX_LAST', ['LINDEX', 'mylist', '-1'], '$3\r\nfoo\r\n',
      'LINDEX should return last element with negative index'
    ))
    
    await this.testCommand(this.expectResponse(
      'LINDEX_OUT_OF_RANGE', ['LINDEX', 'mylist', '10'], '$-1\r\n',
      'LINDEX out of range should return null'
    ))
    
    // LPOP operations
    await this.testCommand(this.expectResponse(
      'LPOP', ['LPOP', 'mylist'], '$5\r\nhello\r\n',
      'LPOP should return and remove first element'
    ))
    
    await this.testCommand(this.expectResponse(
      'LLEN_AFTER_POP', ['LLEN', 'mylist'], ':2\r\n',
      'LLEN should be decremented after pop'
    ))
    
    // RPOP operations
    await this.testCommand(this.expectResponse(
      'RPOP', ['RPOP', 'mylist'], '$3\r\nfoo\r\n',
      'RPOP should return and remove last element'
    ))
    
    // Test empty list operations
    await this.testCommand(this.expectResponse(
      'RPOP_UNTIL_EMPTY', ['RPOP', 'mylist'], '$5\r\nworld\r\n',
      'RPOP should return last remaining element'
    ))
    
    await this.testCommand(this.expectResponse(
      'LPOP_EMPTY', ['LPOP', 'mylist'], '$-1\r\n',
      'LPOP on empty list should return null'
    ))
    
    await this.testCommand(this.expectResponse(
      'LLEN_EMPTY', ['LLEN', 'mylist'], ':0\r\n',
      'LLEN on empty list should return 0'
    ))
  }

  async runSetTests() {
    console.log('\n🎯 Testing Set Operations...')
    
    // SADD operations
    await this.testCommand(this.expectResponse(
      'SADD_SINGLE', ['SADD', 'myset', 'member1'], ':1\r\n',
      'SADD should return number of added members'
    ))
    
    await this.testCommand(this.expectResponse(
      'SADD_MULTIPLE', ['SADD', 'myset', 'member2', 'member3'], ':2\r\n',
      'SADD multiple members should return count'
    ))
    
    await this.testCommand(this.expectResponse(
      'SADD_DUPLICATE', ['SADD', 'myset', 'member1'], ':0\r\n',
      'SADD duplicate member should return 0'
    ))
    
    // SCARD operation
    await this.testCommand(this.expectResponse(
      'SCARD', ['SCARD', 'myset'], ':3\r\n',
      'SCARD should return set size'
    ))
    
    // SISMEMBER operations
    await this.testCommand(this.expectResponse(
      'SISMEMBER_EXISTS', ['SISMEMBER', 'myset', 'member1'], ':1\r\n',
      'SISMEMBER should return 1 for existing member'
    ))
    
    await this.testCommand(this.expectResponse(
      'SISMEMBER_NOT_EXISTS', ['SISMEMBER', 'myset', 'nonexistent'], ':0\r\n',
      'SISMEMBER should return 0 for non-existent member'
    ))
    
    // SMEMBERS operation (Note: order may vary, so this test might be fragile)
    const smembersResponse = await this.sendCommand(['SMEMBERS', 'myset'])
    const isMembersResponse = smembersResponse.startsWith('*3\r\n') && 
                              smembersResponse.includes('member1') &&
                              smembersResponse.includes('member2') &&
                              smembersResponse.includes('member3')
    
    console.log(`${isMembersResponse ? '✅' : '❌'} SMEMBERS: ${isMembersResponse ? 'PASS' : 'FAIL'}`)
    console.log('   Description: SMEMBERS should return all set members')
    console.log('')
    
    this.results.push({
      test: 'SMEMBERS',
      passed: isMembersResponse,
      command: 'SMEMBERS myset',
      actual: smembersResponse
    })
    
    // SREM operations
    await this.testCommand(this.expectResponse(
      'SREM_EXISTING', ['SREM', 'myset', 'member1'], ':1\r\n',
      'SREM should return 1 for removed member'
    ))
    
    await this.testCommand(this.expectResponse(
      'SREM_NONEXISTENT', ['SREM', 'myset', 'nonexistent'], ':0\r\n',
      'SREM should return 0 for non-existent member'
    ))
    
    await this.testCommand(this.expectResponse(
      'SCARD_AFTER_REM', ['SCARD', 'myset'], ':2\r\n',
      'SCARD should be decremented after SREM'
    ))
  }

  async runHashTests() {
    console.log('\n🗂️  Testing Hash Operations...')
    
    // HSET operations
    await this.testCommand(this.expectResponse(
      'HSET_SINGLE', ['HSET', 'myhash', 'field1', 'value1'], ':1\r\n',
      'HSET should return 1 for new field'
    ))
    
    await this.testCommand(this.expectResponse(
      'HSET_UPDATE', ['HSET', 'myhash', 'field1', 'newvalue1'], ':0\r\n',
      'HSET should return 0 for updated field'
    ))
    
    await this.testCommand(this.expectResponse(
      'HSET_MULTIPLE', ['HSET', 'myhash', 'field2', 'value2', 'field3', 'value3'], ':2\r\n',
      'HSET multiple fields should return count of new fields'
    ))
    
    // HGET operations
    await this.testCommand(this.expectResponse(
      'HGET_EXISTING', ['HGET', 'myhash', 'field1'], '$9\r\nnewvalue1\r\n',
      'HGET should return field value'
    ))
    
    await this.testCommand(this.expectResponse(
      'HGET_NONEXISTENT', ['HGET', 'myhash', 'nonexistent'], '$-1\r\n',
      'HGET non-existent field should return null'
    ))
    
    // HLEN operation
    await this.testCommand(this.expectResponse(
      'HLEN', ['HLEN', 'myhash'], ':3\r\n',
      'HLEN should return number of fields'
    ))
    
    // HEXISTS operations
    await this.testCommand(this.expectResponse(
      'HEXISTS_TRUE', ['HEXISTS', 'myhash', 'field2'], ':1\r\n',
      'HEXISTS should return 1 for existing field'
    ))
    
    await this.testCommand(this.expectResponse(
      'HEXISTS_FALSE', ['HEXISTS', 'myhash', 'nonexistent'], ':0\r\n',
      'HEXISTS should return 0 for non-existent field'
    ))
    
    // HDEL operations
    await this.testCommand(this.expectResponse(
      'HDEL_EXISTING', ['HDEL', 'myhash', 'field2'], ':1\r\n',
      'HDEL should return 1 for deleted field'
    ))
    
    await this.testCommand(this.expectResponse(
      'HDEL_NONEXISTENT', ['HDEL', 'myhash', 'nonexistent'], ':0\r\n',
      'HDEL should return 0 for non-existent field'
    ))
    
    await this.testCommand(this.expectResponse(
      'HLEN_AFTER_DEL', ['HLEN', 'myhash'], ':2\r\n',
      'HLEN should be decremented after HDEL'
    ))
  }

  async runTypeTests() {
    console.log('\n🏷️  Testing TYPE Operations...')
    
    await this.testCommand(this.expectResponse(
      'TYPE_HASH', ['TYPE', 'myhash'], '+hash\r\n',
      'TYPE should return hash for hash key'
    ))
    
    await this.testCommand(this.expectResponse(
      'TYPE_SET', ['TYPE', 'myset'], '+set\r\n',
      'TYPE should return set for set key'
    ))
    
    // Create a string for comparison
    await this.testCommand(this.expectResponse(
      'SET_STRING_FOR_TYPE', ['SET', 'mystring', 'value'], '+OK\r\n',
      'SET string for type test'
    ))
    
    await this.testCommand(this.expectResponse(
      'TYPE_STRING', ['TYPE', 'mystring'], '+string\r\n',
      'TYPE should return string for string key'
    ))
  }

  printResults() {
    const passed = this.results.filter(r => r.passed).length
    const failed = this.results.length - passed
    const passRate = this.results.length > 0 ? ((passed / this.results.length) * 100).toFixed(1) : 0
    
    console.log('='.repeat(60))
    console.log('📊 DATA STRUCTURES TEST RESULTS')
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
      console.log('\n🎉 EXCELLENT! Data structures compatibility is very high.')
    } else if (passRate >= 85) {
      console.log('\n⚠️  GOOD! Some data structure issues need attention.')
    } else {
      console.log('\n🚨 POOR! Significant data structure issues found.')
    }
  }

  async run() {
    try {
      await this.startServer()
      await this.runListTests()
      await this.runSetTests()
      await this.runHashTests()
      await this.runTypeTests()
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
  const test = new DataStructuresTest()
  test.run().catch(console.error)
}

module.exports = DataStructuresTest
