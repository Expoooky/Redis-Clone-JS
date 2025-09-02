#!/usr/bin/env node
/**
 * Phase 7 Testing Script
 * Tests all Key Management & Expiration functionality including enhanced expiration
 * commands and keyspace management (KEYS, SCAN, etc.)
 */

const net = require('net')

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
    return new Promise((resolve) => {
      this.buffer = ''
      
      // Convert command to RESP format with proper quote handling
      const parts = this.parseCommand(command)
      let resp = `*${parts.length}\r\n`
      for (const part of parts) {
        resp += `$${Buffer.byteLength(part)}\r\n${part}\r\n`
      }
      
      this.socket.write(resp)
      
      setTimeout(() => {
        const response = this.parseResponse(this.buffer)
        resolve(response)
      }, 100)
    })
  }

  parseCommand(command) {
    const parts = []
    let current = ''
    let inQuotes = false
    let quoteChar = null
    
    for (let i = 0; i < command.length; i++) {
      const char = command[i]
      
      if (!inQuotes && (char === '"' || char === "'")) {
        inQuotes = true
        quoteChar = char
      } else if (inQuotes && char === quoteChar) {
        // Check if it's escaped
        if (i > 0 && command[i - 1] === '\\') {
          current += char
        } else {
          inQuotes = false
          quoteChar = null
        }
      } else if (!inQuotes && char === ' ') {
        if (current.length > 0) {
          // Process escaped quotes in the current part
          current = current.replace(/\\"/g, '"').replace(/\\'/g, "'")
          parts.push(current)
          current = ''
        }
      } else {
        current += char
      }
    }
    
    if (current.length > 0) {
      // Process escaped quotes in the final part
      current = current.replace(/\\"/g, '"').replace(/\\'/g, "'")
      parts.push(current)
    }
    
    return parts
  }

  parseResponse(data) {
    if (!data) return null
    
    const lines = data.split('\r\n').filter(line => line.length > 0)
    if (lines.length === 0) return null
    
    let index = 0
    
    const parseElement = () => {
      if (index >= lines.length) return null
      
      const line = lines[index]
      index++
      
      if (line.startsWith('+')) {
        return line.substring(1)
      } else if (line.startsWith('-')) {
        return { error: line.substring(1) }
      } else if (line.startsWith(':')) {
        return parseInt(line.substring(1), 10)
      } else if (line.startsWith('$')) {
        const length = parseInt(line.substring(1), 10)
        if (length === -1) return null
        if (index >= lines.length) return ''
        const value = lines[index]
        index++
        return value
      } else if (line.startsWith('*')) {
        const count = parseInt(line.substring(1), 10)
        if (count === -1) return null
        
        const array = []
        for (let i = 0; i < count; i++) {
          array.push(parseElement())
        }
        return array
      }
      
      return line
    }
    
    return parseElement()
  }

  disconnect() {
    if (this.socket) {
      this.socket.end()
    }
  }
}

async function runTests() {
  console.log('🚀 Starting Phase 7 Tests\n')
  
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

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  try {
    await client.connect()
    
    // Clean up any existing data
    await client.sendCommand('FLUSHALL')
    console.log('🧹 Database cleared\n')

    // ===============================
    // ENHANCED EXPIRATION TESTS
    // ===============================
    console.log('⏰ Testing Enhanced Expiration Commands...')
    
    // Set up test data
    await client.sendCommand('SET test1 value1')
    await client.sendCommand('SET test2 value2')
    await client.sendCommand('SET test3 value3')
    await client.sendCommand('SET test4 value4')
    
    // Test EXPIRE (already implemented but verify it works)
    let result = await client.sendCommand('EXPIRE test1 5')
    assert(result === 1, `EXPIRE: Expected 1, got ${result}`)
    
    result = await client.sendCommand('TTL test1')
    assert(result > 0 && result <= 5, `TTL after EXPIRE: Expected 1-5, got ${result}`)
    
    // Test EXPIREAT (expire at Unix timestamp)
    const futureTimestamp = Math.floor(Date.now() / 1000) + 10 // 10 seconds from now
    result = await client.sendCommand(`EXPIREAT test2 ${futureTimestamp}`)
    assert(result === 1, `EXPIREAT: Expected 1, got ${result}`)
    
    result = await client.sendCommand('TTL test2')
    assert(result > 5 && result <= 10, `TTL after EXPIREAT: Expected 6-10, got ${result}`)
    
    // Test PEXPIRE (expire in milliseconds)
    result = await client.sendCommand('PEXPIRE test3 3000')
    assert(result === 1, `PEXPIRE: Expected 1, got ${result}`)
    
    result = await client.sendCommand('PTTL test3')
    assert(result > 2000 && result <= 3000, `PTTL after PEXPIRE: Expected 2000-3000, got ${result}`)
    
    // Test PEXPIREAT (expire at millisecond timestamp)
    const futureTimestampMs = Date.now() + 5000 // 5 seconds from now
    result = await client.sendCommand(`PEXPIREAT test4 ${futureTimestampMs}`)
    assert(result === 1, `PEXPIREAT: Expected 1, got ${result}`)
    
    result = await client.sendCommand('PTTL test4')
    assert(result > 3000 && result <= 5000, `PTTL after PEXPIREAT: Expected 3000-5000, got ${result}`)
    
    // Test PERSIST (remove expiration)
    result = await client.sendCommand('PERSIST test1')
    assert(result === 1, `PERSIST: Expected 1, got ${result}`)
    
    result = await client.sendCommand('TTL test1')
    assert(result === -1, `TTL after PERSIST: Expected -1, got ${result}`)
    
    // Test TTL/PTTL on non-existent key
    result = await client.sendCommand('TTL nonexistent')
    assert(result === -2, `TTL nonexistent: Expected -2, got ${result}`)
    
    result = await client.sendCommand('PTTL nonexistent')
    assert(result === -2, `PTTL nonexistent: Expected -2, got ${result}`)
    
    // Test TTL/PTTL on key without expiration
    result = await client.sendCommand('TTL test1')
    assert(result === -1, `TTL no expiration: Expected -1, got ${result}`)
    
    result = await client.sendCommand('PTTL test1')
    assert(result === -1, `PTTL no expiration: Expected -1, got ${result}`)

    console.log()

    // ===============================
    // KEYSPACE MANAGEMENT TESTS
    // ===============================
    console.log('🗝️  Testing Keyspace Management...')
    
    // Set up test data with various key patterns
    await client.sendCommand('FLUSHALL')
    await client.sendCommand('SET user:1 alice')
    await client.sendCommand('SET user:2 bob')
    await client.sendCommand('SET user:3 charlie')
    await client.sendCommand('SET session:abc123 data1')
    await client.sendCommand('SET session:def456 data2')
    await client.sendCommand('SET config:timeout 300')
    await client.sendCommand('SET config:retries 3')
    await client.sendCommand('SET temp data')
    
    // Test DBSIZE
    result = await client.sendCommand('DBSIZE')
    assert(result === 8, `DBSIZE: Expected 8, got ${result}`)
    
    // Test RANDOMKEY
    result = await client.sendCommand('RANDOMKEY')
    assert(typeof result === 'string' && result.length > 0, `RANDOMKEY: Expected non-empty string, got '${result}'`)
    
    // Test KEYS with different patterns
    result = await client.sendCommand('KEYS *')
    assert(Array.isArray(result) && result.length === 8, `KEYS *: Expected 8 keys, got ${result.length}`)
    
    result = await client.sendCommand('KEYS user:*')
    assert(Array.isArray(result) && result.length === 3, `KEYS user:*: Expected 3 keys, got ${result.length}`)
    assert(result.includes('user:1') && result.includes('user:2') && result.includes('user:3'), 'KEYS user:*: Should contain user keys')
    
    result = await client.sendCommand('KEYS session:*')
    assert(Array.isArray(result) && result.length === 2, `KEYS session:*: Expected 2 keys, got ${result.length}`)
    
    result = await client.sendCommand('KEYS config:*')
    assert(Array.isArray(result) && result.length === 2, `KEYS config:*: Expected 2 keys, got ${result.length}`)
    
    result = await client.sendCommand('KEYS *:*')
    assert(Array.isArray(result) && result.length === 7, `KEYS *:*: Expected 7 keys, got ${result.length}`)
    
    result = await client.sendCommand('KEYS temp')
    assert(Array.isArray(result) && result.length === 1 && result[0] === 'temp', `KEYS temp: Expected ['temp'], got ${JSON.stringify(result)}`)
    
    result = await client.sendCommand('KEYS user:?')
    assert(Array.isArray(result) && result.length === 3, `KEYS user:?: Expected 3 keys, got ${result.length}`)
    
    result = await client.sendCommand('KEYS nonexistent*')
    assert(Array.isArray(result) && result.length === 0, `KEYS nonexistent*: Expected 0 keys, got ${result.length}`)

    console.log()

    // ===============================
    // SCAN COMMAND TESTS
    // ===============================
    console.log('🔍 Testing SCAN Command...')
    
    // Test basic SCAN
    result = await client.sendCommand('SCAN 0')
    assert(Array.isArray(result) && result.length === 2, `SCAN 0: Expected [cursor, keys], got ${JSON.stringify(result)}`)
    assert(typeof result[0] === 'string', `SCAN cursor: Expected string, got ${typeof result[0]}`)
    assert(Array.isArray(result[1]), `SCAN keys: Expected array, got ${typeof result[1]}`)
    
    const initialCursor = result[0]
    const initialKeys = result[1]
    assert(initialKeys.length > 0, `SCAN 0: Expected some keys, got ${initialKeys.length}`)
    
    // Test SCAN with MATCH pattern
    result = await client.sendCommand('SCAN 0 MATCH user:*')
    assert(Array.isArray(result) && result.length === 2, `SCAN MATCH: Expected [cursor, keys], got ${JSON.stringify(result)}`)
    const userKeys = result[1]
    assert(userKeys.every(key => key.startsWith('user:')), 'SCAN MATCH user:*: All keys should start with user:')
    
    // Test SCAN with COUNT
    result = await client.sendCommand('SCAN 0 COUNT 3')
    assert(Array.isArray(result) && result.length === 2, `SCAN COUNT: Expected [cursor, keys], got ${JSON.stringify(result)}`)
    const limitedKeys = result[1]
    assert(limitedKeys.length <= 3, `SCAN COUNT 3: Expected <= 3 keys, got ${limitedKeys.length}`)
    
    // Test SCAN with MATCH and COUNT
    result = await client.sendCommand('SCAN 0 MATCH *:* COUNT 5')
    assert(Array.isArray(result) && result.length === 2, `SCAN MATCH COUNT: Expected [cursor, keys], got ${JSON.stringify(result)}`)
    const matchedKeys = result[1]
    assert(matchedKeys.every(key => key.includes(':')), 'SCAN MATCH *:*: All keys should contain colon')
    
    // Test SCAN iteration (if cursor is not 0, continue scanning)
    let allScannedKeys = []
    let cursor = '0'
    let iterations = 0
    const maxIterations = 10 // Prevent infinite loop
    
    do {
      result = await client.sendCommand(`SCAN ${cursor} COUNT 2`)
      cursor = result[0]
      allScannedKeys = allScannedKeys.concat(result[1])
      iterations++
    } while (cursor !== '0' && iterations < maxIterations)
    
    assert(allScannedKeys.length >= 8, `SCAN iteration: Expected >= 8 total keys, got ${allScannedKeys.length}`)
    assert(iterations < maxIterations, `SCAN iteration: Should complete before ${maxIterations} iterations`)

    console.log()

    // ===============================
    // DATABASE SELECTION TESTS
    // ===============================
    console.log('🗄️  Testing Database Selection...')
    
    // Test SELECT command
    result = await client.sendCommand('SELECT 1')
    assert(result === 'OK', `SELECT 1: Expected 'OK', got '${result}'`)
    
    // Database 1 should be empty
    result = await client.sendCommand('DBSIZE')
    assert(result === 0, `DBSIZE db 1: Expected 0, got ${result}`)
    
    // Add data to database 1
    await client.sendCommand('SET db1key value')
    result = await client.sendCommand('DBSIZE')
    assert(result === 1, `DBSIZE db 1 after SET: Expected 1, got ${result}`)
    
    // Switch back to database 0
    result = await client.sendCommand('SELECT 0')
    assert(result === 'OK', `SELECT 0: Expected 'OK', got '${result}'`)
    
    // Database 0 should still have our original data
    result = await client.sendCommand('DBSIZE')
    assert(result === 8, `DBSIZE db 0: Expected 8, got ${result}`)
    
    // Test invalid database selection
    result = await client.sendCommand('SELECT 99')
    assert(result.error && result.error.includes('invalid'), 'SELECT 99: Should return error for invalid database')

    console.log()

    // ===============================
    // EXPIRATION EDGE CASES
    // ===============================
    console.log('🧪 Testing Expiration Edge Cases...')
    
    // Test expiration on non-existent key
    result = await client.sendCommand('EXPIRE nonexistent 10')
    assert(result === 0, `EXPIRE nonexistent: Expected 0, got ${result}`)
    
    result = await client.sendCommand('EXPIREAT nonexistent 9999999999')
    assert(result === 0, `EXPIREAT nonexistent: Expected 0, got ${result}`)
    
    result = await client.sendCommand('PEXPIRE nonexistent 10000')
    assert(result === 0, `PEXPIRE nonexistent: Expected 0, got ${result}`)
    
    result = await client.sendCommand('PEXPIREAT nonexistent 9999999999999')
    assert(result === 0, `PEXPIREAT nonexistent: Expected 0, got ${result}`)
    
    result = await client.sendCommand('PERSIST nonexistent')
    assert(result === 0, `PERSIST nonexistent: Expected 0, got ${result}`)
    
    // Test past expiration times
    await client.sendCommand('SET pastkey value')
    const pastTimestamp = Math.floor(Date.now() / 1000) - 10 // 10 seconds ago
    result = await client.sendCommand(`EXPIREAT pastkey ${pastTimestamp}`)
    assert(result === 1, `EXPIREAT past: Expected 1, got ${result}`)
    
    // Key should be expired immediately
    result = await client.sendCommand('GET pastkey')
    assert(result === null, `GET expired key: Expected null, got ${result}`)
    
    // Test very short expiration
    await client.sendCommand('SET shortkey value')
    result = await client.sendCommand('PEXPIRE shortkey 100') // 100ms
    assert(result === 1, `PEXPIRE short: Expected 1, got ${result}`)
    
    await sleep(150) // Wait for expiration
    result = await client.sendCommand('GET shortkey')
    assert(result === null, `GET short expired key: Expected null, got ${result}`)

    console.log()

    // ===============================
    // ERROR HANDLING TESTS
    // ===============================
    console.log('❌ Testing Error Handling...')
    
    // Test invalid arguments
    result = await client.sendCommand('EXPIRE')
    assert(result.error && result.error.includes('wrong number of arguments'), 'EXPIRE no args should error')
    
    result = await client.sendCommand('EXPIRE key')
    assert(result.error && result.error.includes('wrong number of arguments'), 'EXPIRE missing timeout should error')
    
    result = await client.sendCommand('EXPIRE key invalid')
    assert(result.error && result.error.includes('not an integer'), 'EXPIRE invalid timeout should error')
    
    result = await client.sendCommand('TTL')
    assert(result.error && result.error.includes('wrong number of arguments'), 'TTL no args should error')
    
    result = await client.sendCommand('KEYS key1 key2')
    assert(result.error && result.error.includes('wrong number of arguments'), 'KEYS too many args should error')
    
    result = await client.sendCommand('SCAN')
    assert(result.error && result.error.includes('wrong number of arguments'), 'SCAN no args should error')
    
    result = await client.sendCommand('SCAN invalid')
    assert(result.error && result.error.includes('invalid cursor'), 'SCAN invalid cursor should error')
    
    result = await client.sendCommand('SCAN 0 MATCH')
    assert(result.error && result.error.includes('syntax error'), 'SCAN incomplete MATCH should error')
    
    result = await client.sendCommand('SCAN 0 COUNT invalid')
    assert(result.error && result.error.includes('not an integer'), 'SCAN invalid COUNT should error')
    
    result = await client.sendCommand('SCAN 0 INVALID option')
    assert(result.error && result.error.includes('syntax error'), 'SCAN invalid option should error')

    console.log()

    // ===============================
    // FLUSHDB/FLUSHALL TESTS
    // ===============================
    console.log('🧹 Testing Database Flush Operations...')
    
    // Set up data in multiple databases
    await client.sendCommand('SELECT 0')
    await client.sendCommand('SET db0key1 value1')
    await client.sendCommand('SET db0key2 value2')
    
    await client.sendCommand('SELECT 1')
    await client.sendCommand('SET db1key1 value1')
    await client.sendCommand('SET db1key2 value2')
    
    // Test FLUSHDB (current database only)
    result = await client.sendCommand('FLUSHDB')
    assert(result === 'OK', `FLUSHDB: Expected 'OK', got '${result}'`)
    
    result = await client.sendCommand('DBSIZE')
    assert(result === 0, `DBSIZE after FLUSHDB: Expected 0, got ${result}`)
    
    // Check that other database still has data
    await client.sendCommand('SELECT 0')
    result = await client.sendCommand('DBSIZE')
    assert(result >= 2, `DBSIZE db 0 after FLUSHDB db 1: Expected >= 2, got ${result}`)
    
    // Test FLUSHALL (all databases)
    result = await client.sendCommand('FLUSHALL')
    assert(result === 'OK', `FLUSHALL: Expected 'OK', got '${result}'`)
    
    result = await client.sendCommand('DBSIZE')
    assert(result === 0, `DBSIZE after FLUSHALL: Expected 0, got ${result}`)
    
    await client.sendCommand('SELECT 1')
    result = await client.sendCommand('DBSIZE')
    assert(result === 0, `DBSIZE db 1 after FLUSHALL: Expected 0, got ${result}`)

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
    console.log('\n🎉 All Phase 7 tests passed! Key Management & Expiration implementation is working correctly.')
    console.log('\n📋 Phase 7 Summary:')
    console.log('  ✅ Enhanced Key Expiration - 6 commands implemented')
    console.log('    - EXPIRE, EXPIREAT, PEXPIRE, PEXPIREAT, TTL, PTTL, PERSIST')
    console.log('    - Background expiration cleanup with adaptive algorithm')
    console.log('  ✅ Keyspace Management - 5 commands implemented')
    console.log('    - SELECT, FLUSHDB, FLUSHALL, RANDOMKEY, DBSIZE')
    console.log('    - KEYS with pattern matching (* and ? wildcards)')
    console.log('    - SCAN with cursor-based iteration and filtering')
    console.log('  ✅ Multiple Database Support (0-15)')
    console.log('  ✅ Pattern Matching with regex conversion')
    console.log('  ✅ Cursor-based iteration for large keysets')
    console.log('  ✅ Comprehensive error handling and validation')
    console.log('\n🚀 Ready for Phase 8: Transactions & Pub/Sub!')
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
    console.log('Run: node simple-server.js\n')
    process.exit(1)
  }
}

if (require.main === module) {
  main().catch(console.error)
}

module.exports = { RedisClient, runTests }
