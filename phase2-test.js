#!/usr/bin/env node
/**
 * Phase 2 Testing Script
 * Tests all List, Set, and Hash operations
 */

const net = require('net')
const { spawn } = require('child_process')

class RedisClient {
  constructor(host = '127.0.0.1', port = 6379) {
    this.host = host
    this.port = port
    this.socket = null
    this.buffer = ''
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket()
      this.socket.connect(this.port, this.host, () => {
        console.log('✅ Connected to Redis-Clone-JS server')
        resolve()
      })
      
      this.socket.on('error', (err) => {
        reject(err)
      })
      
      this.socket.on('data', (data) => {
        this.buffer += data.toString()
      })
    })
  }

  async sendCommand(command) {
    return new Promise((resolve, reject) => {
      this.buffer = ''
      
      // Convert command to RESP format
      const parts = command.split(' ')
      let resp = `*${parts.length}\r\n`
      for (const part of parts) {
        resp += `$${part.length}\r\n${part}\r\n`
      }
      
      this.socket.write(resp)
      
      setTimeout(() => {
        const response = this.parseResponse(this.buffer)
        resolve(response)
      }, 100)
    })
  }

  parseResponse(data) {
    if (!data) return null
    
    const lines = data.split('\r\n').filter(line => line.length > 0)
    if (lines.length === 0) return null
    
    const firstLine = lines[0]
    
    if (firstLine.startsWith('+')) {
      return firstLine.substring(1)
    } else if (firstLine.startsWith('-')) {
      return { error: firstLine.substring(1) }
    } else if (firstLine.startsWith(':')) {
      return parseInt(firstLine.substring(1), 10)
    } else if (firstLine.startsWith('$')) {
      const length = parseInt(firstLine.substring(1), 10)
      if (length === -1) return null
      return lines[1] || ''
    } else if (firstLine.startsWith('*')) {
      const count = parseInt(firstLine.substring(1), 10)
      if (count === -1) return null
      
      const array = []
      let lineIndex = 1
      for (let i = 0; i < count; i++) {
        if (lineIndex >= lines.length) break
        
        const sizeLine = lines[lineIndex]
        if (sizeLine.startsWith('$')) {
          const size = parseInt(sizeLine.substring(1), 10)
          if (size === -1) {
            array.push(null)
            lineIndex += 1  // Only increment by 1 for null values
          } else {
            array.push(lines[lineIndex + 1] || '')
            lineIndex += 2  // Increment by 2 for size line + data line
          }
        } else {
          lineIndex++
        }
      }
      return array
    }
    
    return data
  }

  disconnect() {
    if (this.socket) {
      this.socket.end()
    }
  }
}

async function runTests() {
  console.log('🚀 Starting Phase 2 Tests\n')
  
  const client = new RedisClient()
  let testsPassed = 0
  let testsFailed = 0

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ ${message}`)
      testsPassed++
    } else {
      console.log(`❌ ${message}`)
      testsFailed++
    }
  }

  function assertDeepEqual(actual, expected, message) {
    const isEqual = JSON.stringify(actual) === JSON.stringify(expected)
    assert(isEqual, `${message} - Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`)
  }

  try {
    await client.connect()
    
    // Clean up any existing data
    await client.sendCommand('FLUSHALL')
    console.log('🧹 Database cleared\n')

    // === LIST OPERATIONS TESTS ===
    console.log('📋 Testing List Operations...')
    
    // Test LPUSH and RPUSH
    let result = await client.sendCommand('LPUSH mylist a b c')
    assert(result === 3, `LPUSH: Expected 3, got ${result}`)
    
    result = await client.sendCommand('RPUSH mylist d e')
    assert(result === 5, `RPUSH: Expected 5, got ${result}`)
    
    // Test LRANGE
    result = await client.sendCommand('LRANGE mylist 0 -1')
    assertDeepEqual(result, ['c', 'b', 'a', 'd', 'e'], 'LRANGE: Full list')
    
    // Test LLEN
    result = await client.sendCommand('LLEN mylist')
    assert(result === 5, `LLEN: Expected 5, got ${result}`)
    
    // Test LINDEX
    result = await client.sendCommand('LINDEX mylist 0')
    assert(result === 'c', `LINDEX: Expected 'c', got '${result}'`)
    
    result = await client.sendCommand('LINDEX mylist -1')
    assert(result === 'e', `LINDEX: Expected 'e', got '${result}'`)
    
    // Test LSET
    result = await client.sendCommand('LSET mylist 0 x')
    assert(result === 'OK', `LSET: Expected 'OK', got '${result}'`)
    
    result = await client.sendCommand('LINDEX mylist 0')
    assert(result === 'x', `LSET verification: Expected 'x', got '${result}'`)
    
    // Test LPOP and RPOP
    result = await client.sendCommand('LPOP mylist')
    assert(result === 'x', `LPOP: Expected 'x', got '${result}'`)
    
    result = await client.sendCommand('RPOP mylist')
    assert(result === 'e', `RPOP: Expected 'e', got '${result}'`)
    
    result = await client.sendCommand('LLEN mylist')
    assert(result === 3, `LLEN after pops: Expected 3, got ${result}`)
    
    // Test LINSERT
    result = await client.sendCommand('LINSERT mylist BEFORE b inserted')
    assert(result === 4, `LINSERT: Expected 4, got ${result}`)
    
    // Test LREM
    result = await client.sendCommand('LREM mylist 1 b')
    assert(result === 1, `LREM: Expected 1, got ${result}`)
    
    // Test LTRIM
    result = await client.sendCommand('LTRIM mylist 0 1')
    assert(result === 'OK', `LTRIM: Expected 'OK', got '${result}'`)
    
    result = await client.sendCommand('LLEN mylist')
    assert(result === 2, `LLEN after trim: Expected 2, got ${result}`)
    
    console.log()

    // === SET OPERATIONS TESTS ===
    console.log('🔗 Testing Set Operations...')
    
    // Test SADD
    result = await client.sendCommand('SADD myset a b c a')
    assert(result === 3, `SADD: Expected 3, got ${result}`)
    
    // Test SCARD
    result = await client.sendCommand('SCARD myset')
    assert(result === 3, `SCARD: Expected 3, got ${result}`)
    
    // Test SISMEMBER
    result = await client.sendCommand('SISMEMBER myset a')
    assert(result === 1, `SISMEMBER (exists): Expected 1, got ${result}`)
    
    result = await client.sendCommand('SISMEMBER myset z')
    assert(result === 0, `SISMEMBER (not exists): Expected 0, got ${result}`)
    
    // Test SMEMBERS
    result = await client.sendCommand('SMEMBERS myset')
    assert(Array.isArray(result) && result.length === 3, `SMEMBERS: Expected array of 3, got ${JSON.stringify(result)}`)
    assert(result.includes('a') && result.includes('b') && result.includes('c'), 'SMEMBERS: Contains expected elements')
    
    // Test SRANDMEMBER
    result = await client.sendCommand('SRANDMEMBER myset')
    assert(['a', 'b', 'c'].includes(result), `SRANDMEMBER: Expected one of [a,b,c], got '${result}'`)
    
    // Test SREM
    result = await client.sendCommand('SREM myset a z')
    assert(result === 1, `SREM: Expected 1, got ${result}`)
    
    result = await client.sendCommand('SCARD myset')
    assert(result === 2, `SCARD after SREM: Expected 2, got ${result}`)
    
    // Test set operations with multiple sets
    await client.sendCommand('SADD set1 a b c')
    await client.sendCommand('SADD set2 b c d')
    
    // Test SINTER
    result = await client.sendCommand('SINTER set1 set2')
    assert(Array.isArray(result) && result.length === 2, `SINTER: Expected array of 2, got ${JSON.stringify(result)}`)
    assert(result.includes('b') && result.includes('c'), 'SINTER: Contains expected elements')
    
    // Test SUNION
    result = await client.sendCommand('SUNION set1 set2')
    assert(Array.isArray(result) && result.length === 4, `SUNION: Expected array of 4, got ${JSON.stringify(result)}`)
    
    // Test SDIFF
    result = await client.sendCommand('SDIFF set1 set2')
    assert(Array.isArray(result) && result.length === 1, `SDIFF: Expected array of 1, got ${JSON.stringify(result)}`)
    assert(result.includes('a'), 'SDIFF: Contains expected element')
    
    console.log()

    // === HASH OPERATIONS TESTS ===
    console.log('🗂️  Testing Hash Operations...')
    
    // Test HSET
    result = await client.sendCommand('HSET myhash field1 value1 field2 value2')
    assert(result === 2, `HSET: Expected 2, got ${result}`)
    
    // Test HGET
    result = await client.sendCommand('HGET myhash field1')
    assert(result === 'value1', `HGET: Expected 'value1', got '${result}'`)
    
    result = await client.sendCommand('HGET myhash nonexistent')
    assert(result === null, `HGET (nonexistent): Expected null, got ${result}`)
    
    // Test HEXISTS
    result = await client.sendCommand('HEXISTS myhash field1')
    assert(result === 1, `HEXISTS (exists): Expected 1, got ${result}`)
    
    result = await client.sendCommand('HEXISTS myhash nonexistent')
    assert(result === 0, `HEXISTS (not exists): Expected 0, got ${result}`)
    
    // Test HLEN
    result = await client.sendCommand('HLEN myhash')
    assert(result === 2, `HLEN: Expected 2, got ${result}`)
    
    // Test HKEYS
    result = await client.sendCommand('HKEYS myhash')
    assert(Array.isArray(result) && result.length === 2, `HKEYS: Expected array of 2, got ${JSON.stringify(result)}`)
    assert(result.includes('field1') && result.includes('field2'), 'HKEYS: Contains expected fields')
    
    // Test HVALS
    result = await client.sendCommand('HVALS myhash')
    assert(Array.isArray(result) && result.length === 2, `HVALS: Expected array of 2, got ${JSON.stringify(result)}`)
    assert(result.includes('value1') && result.includes('value2'), 'HVALS: Contains expected values')
    
    // Test HGETALL
    result = await client.sendCommand('HGETALL myhash')
    assert(Array.isArray(result) && result.length === 4, `HGETALL: Expected array of 4, got ${JSON.stringify(result)}`)
    
    // Test HMGET
    result = await client.sendCommand('HMGET myhash field1 nonexistent field2')
    assertDeepEqual(result, ['value1', null, 'value2'], 'HMGET: Mixed existing and nonexistent fields')
    
    // Test HINCRBY
    await client.sendCommand('HSET counters count1 10')
    result = await client.sendCommand('HINCRBY counters count1 5')
    assert(result === 15, `HINCRBY: Expected 15, got ${result}`)
    
    result = await client.sendCommand('HINCRBY counters count2 3')
    assert(result === 3, `HINCRBY (new field): Expected 3, got ${result}`)
    
    // Test HINCRBYFLOAT
    result = await client.sendCommand('HINCRBYFLOAT counters float1 2.5')
    assert(result === '2.5', `HINCRBYFLOAT: Expected '2.5', got '${result}'`)
    
    // Test HDEL
    result = await client.sendCommand('HDEL myhash field1 nonexistent')
    assert(result === 1, `HDEL: Expected 1, got ${result}`)
    
    result = await client.sendCommand('HLEN myhash')
    assert(result === 1, `HLEN after HDEL: Expected 1, got ${result}`)
    
    // Test HSETNX
    result = await client.sendCommand('HSETNX myhash field1 newvalue')
    assert(result === 1, `HSETNX (new): Expected 1, got ${result}`)
    
    result = await client.sendCommand('HSETNX myhash field1 anothervalue')
    assert(result === 0, `HSETNX (existing): Expected 0, got ${result}`)
    
    result = await client.sendCommand('HGET myhash field1')
    assert(result === 'newvalue', `HSETNX verification: Expected 'newvalue', got '${result}'`)

    console.log()

    // === MIXED OPERATIONS AND EDGE CASES ===
    console.log('🔄 Testing Mixed Operations and Edge Cases...')
    
    // Test TYPE command with different data types
    result = await client.sendCommand('TYPE mylist')
    assert(result === 'list', `TYPE (list): Expected 'list', got '${result}'`)
    
    result = await client.sendCommand('TYPE myset')
    assert(result === 'set', `TYPE (set): Expected 'set', got '${result}'`)
    
    result = await client.sendCommand('TYPE myhash')
    assert(result === 'hash', `TYPE (hash): Expected 'hash', got '${result}'`)
    
    result = await client.sendCommand('TYPE nonexistent')
    assert(result === 'none', `TYPE (nonexistent): Expected 'none', got '${result}'`)
    
    // Test wrong type operations
    result = await client.sendCommand('LPUSH myset value')
    assert(result.error && result.error.includes('WRONGTYPE'), 'LPUSH on set should return WRONGTYPE error')
    
    result = await client.sendCommand('SADD mylist value')
    assert(result.error && result.error.includes('WRONGTYPE'), 'SADD on list should return WRONGTYPE error')
    
    result = await client.sendCommand('HSET mylist field value')
    assert(result.error && result.error.includes('WRONGTYPE'), 'HSET on list should return WRONGTYPE error')

    console.log()

    // === DATABASE OPERATIONS ===
    console.log('💾 Testing Database Operations...')
    
    // Test DBSIZE
    result = await client.sendCommand('DBSIZE')
    assert(result > 0, `DBSIZE: Expected > 0, got ${result}`)
    
    // Test SELECT
    result = await client.sendCommand('SELECT 1')
    assert(result === 'OK', `SELECT: Expected 'OK', got '${result}'`)
    
    result = await client.sendCommand('DBSIZE')
    assert(result === 0, `DBSIZE (new db): Expected 0, got ${result}`)
    
    // Go back to default database
    await client.sendCommand('SELECT 0')

    console.log()

  } catch (error) {
    console.error('❌ Test failed with error:', error.message)
    testsFailed++
  } finally {
    client.disconnect()
  }

  // Print summary
  console.log('📊 Test Summary:')
  console.log(`✅ Tests Passed: ${testsPassed}`)
  console.log(`❌ Tests Failed: ${testsFailed}`)
  console.log(`📈 Success Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%`)
  
  if (testsFailed === 0) {
    console.log('\n🎉 All Phase 2 tests passed! The implementation is working correctly.')
    process.exit(0)
  } else {
    console.log('\n⚠️  Some tests failed. Please check the implementation.')
    process.exit(1)
  }
}

async function main() {
  console.log('🔍 Checking if server is running...')
  
  const testClient = new RedisClient()
  try {
    await testClient.connect()
    testClient.disconnect()
    console.log('✅ Server is running\n')
    await runTests()
  } catch (error) {
    console.log('❌ Server is not running. Please start the server first.')
    console.log('Run: node server.js --dev\n')
    process.exit(1)
  }
}

if (require.main === module) {
  main().catch(console.error)
}

module.exports = { RedisClient, runTests }
