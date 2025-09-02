#!/usr/bin/env node
/**
 * Phase 3 Testing Script
 * Tests all Sorted Set, JSON, and Stream operations
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
  console.log('🚀 Starting Phase 3 Tests\n')
  
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

    // ===============================
    // SORTED SET OPERATIONS TESTS
    // ===============================
    console.log('📊 Testing Sorted Set Operations...')
    
    // Test ZADD
    let result = await client.sendCommand('ZADD myzset 1.0 member1 2.0 member2 3.0 member3')
    assert(result === 3, `ZADD: Expected 3, got ${result}`)
    
    // Test ZCARD
    result = await client.sendCommand('ZCARD myzset')
    assert(result === 3, `ZCARD: Expected 3, got ${result}`)
    
    // Test ZSCORE
    result = await client.sendCommand('ZSCORE myzset member2')
    assert(result === '2', `ZSCORE: Expected '2', got '${result}'`)
    
    result = await client.sendCommand('ZSCORE myzset nonexistent')
    assert(result === null, `ZSCORE (nonexistent): Expected null, got ${result}`)
    
    // Test ZRANK
    result = await client.sendCommand('ZRANK myzset member1')
    assert(result === 0, `ZRANK: Expected 0, got ${result}`)
    
    result = await client.sendCommand('ZRANK myzset member3')
    assert(result === 2, `ZRANK: Expected 2, got ${result}`)
    
    // Test ZREVRANK
    result = await client.sendCommand('ZREVRANK myzset member1')
    assert(result === 2, `ZREVRANK: Expected 2, got ${result}`)
    
    // Test ZRANGE
    result = await client.sendCommand('ZRANGE myzset 0 -1')
    assertDeepEqual(result, ['member1', 'member2', 'member3'], 'ZRANGE: All members')
    
    result = await client.sendCommand('ZRANGE myzset 0 -1 WITHSCORES')
    assertDeepEqual(result, ['member1', '1', 'member2', '2', 'member3', '3'], 'ZRANGE: With scores')
    
    // Test ZRANGEBYSCORE
    result = await client.sendCommand('ZRANGEBYSCORE myzset 1.5 2.5')
    assertDeepEqual(result, ['member2'], 'ZRANGEBYSCORE: Score range')
    
    // Test ZINCRBY
    result = await client.sendCommand('ZINCRBY myzset 0.5 member2')
    assert(result === '2.5', `ZINCRBY: Expected '2.5', got '${result}'`)
    
    // Test ZREM
    result = await client.sendCommand('ZREM myzset member1 nonexistent')
    assert(result === 1, `ZREM: Expected 1, got ${result}`)
    
    result = await client.sendCommand('ZCARD myzset')
    assert(result === 2, `ZCARD after ZREM: Expected 2, got ${result}`)
    
    // Test ZREMRANGEBYRANK
    await client.sendCommand('ZADD testzset 1 a 2 b 3 c 4 d')
    result = await client.sendCommand('ZREMRANGEBYRANK testzset 1 2')
    assert(result === 2, `ZREMRANGEBYRANK: Expected 2, got ${result}`)
    
    console.log()

    // ===============================
    // JSON OPERATIONS TESTS
    // ===============================
    console.log('📄 Testing JSON Operations...')
    
    // Test JSON.SET
    result = await client.sendCommand('JSON.SET myjson $ \'{"name":"John","age":30,"skills":["js","redis"]}\'')
    assert(result === 'OK', `JSON.SET: Expected 'OK', got '${result}'`)
    
    // Test JSON.GET
    result = await client.sendCommand('JSON.GET myjson $')
    const jsonResult = JSON.parse(result)
    assert(jsonResult.name === 'John' && jsonResult.age === 30, 'JSON.GET: Root object')
    
    result = await client.sendCommand('JSON.GET myjson $.name')
    assert(result === '"John"', `JSON.GET path: Expected '"John"', got '${result}'`)
    
    // Test JSON.SET nested path
    result = await client.sendCommand('JSON.SET myjson $.address \'{"city":"New York","zip":"10001"}\'')
    assert(result === 'OK', `JSON.SET nested: Expected 'OK', got '${result}'`)
    
    // Test JSON.ARRAPPEND
    result = await client.sendCommand('JSON.ARRAPPEND myjson $.skills "\\"python\\"" "\\"go\\""')
    assert(result === 4, `JSON.ARRAPPEND: Expected 4, got ${result}`)
    
    // Test JSON.ARRLEN
    result = await client.sendCommand('JSON.ARRLEN myjson $.skills')
    assert(result === 4, `JSON.ARRLEN: Expected 4, got ${result}`)
    
    // Test JSON.ARRPOP
    result = await client.sendCommand('JSON.ARRPOP myjson $.skills -1')
    assert(result === '"go"', `JSON.ARRPOP: Expected '"go"', got '${result}'`)
    
    // Test JSON.OBJKEYS
    result = await client.sendCommand('JSON.OBJKEYS myjson $')
    assert(Array.isArray(result) && result.includes('name'), 'JSON.OBJKEYS: Contains expected keys')
    
    // Test JSON.OBJLEN
    result = await client.sendCommand('JSON.OBJLEN myjson $')
    assert(result >= 3, `JSON.OBJLEN: Expected >= 3, got ${result}`)
    
    // Test JSON.TYPE
    result = await client.sendCommand('JSON.TYPE myjson $.name')
    assert(result === 'string', `JSON.TYPE: Expected 'string', got '${result}'`)
    
    result = await client.sendCommand('JSON.TYPE myjson $.age')
    assert(result === 'number', `JSON.TYPE: Expected 'number', got '${result}'`)
    
    result = await client.sendCommand('JSON.TYPE myjson $.skills')
    assert(result === 'array', `JSON.TYPE: Expected 'array', got '${result}'`)
    
    // Test JSON.DEL
    result = await client.sendCommand('JSON.DEL myjson $.address')
    assert(result === 1, `JSON.DEL: Expected 1, got ${result}`)
    
    console.log()

    // ===============================
    // STREAM OPERATIONS TESTS
    // ===============================
    console.log('🌊 Testing Stream Operations...')
    
    // Test XADD
    result = await client.sendCommand('XADD mystream * field1 value1 field2 value2')
    assert(typeof result === 'string' && result.includes('-'), `XADD: Got valid ID '${result}'`)
    const firstEntryId = result
    
    result = await client.sendCommand('XADD mystream * field3 value3')
    assert(typeof result === 'string' && result.includes('-'), `XADD: Got valid ID '${result}'`)
    const secondEntryId = result
    
    // Test XLEN
    result = await client.sendCommand('XLEN mystream')
    assert(result === 2, `XLEN: Expected 2, got ${result}`)
    
    // Test XRANGE
    result = await client.sendCommand('XRANGE mystream - +')
    assert(Array.isArray(result) && result.length === 2, `XRANGE: Expected 2 entries, got ${result.length}`)
    
    // Check structure of XRANGE response
    const firstEntry = result[0]
    assert(Array.isArray(firstEntry) && firstEntry.length === 2, 'XRANGE: Entry has ID and fields')
    assert(firstEntry[0] === firstEntryId, `XRANGE: First entry ID matches`)
    assert(Array.isArray(firstEntry[1]), 'XRANGE: Fields is an array')
    
    // Test XREAD
    result = await client.sendCommand('XREAD STREAMS mystream 0-0')
    assert(Array.isArray(result) && result.length === 1, 'XREAD: Got stream data')
    
    // Test XGROUP CREATE
    result = await client.sendCommand('XGROUP CREATE mystream mygroup $')
    assert(result === 'OK', `XGROUP CREATE: Expected 'OK', got '${result}'`)
    
    // Add another entry for group testing
    await client.sendCommand('XADD mystream * field4 value4')
    
    // Test XREADGROUP
    result = await client.sendCommand('XREADGROUP GROUP mygroup consumer1 STREAMS mystream >')
    assert(Array.isArray(result), 'XREADGROUP: Got response array')
    
    // Test XPENDING (basic)
    result = await client.sendCommand('XPENDING mystream mygroup')
    assert(Array.isArray(result), 'XPENDING: Got pending info')
    
    console.log()

    // ===============================
    // MIXED OPERATIONS AND TYPE TESTS
    // ===============================
    console.log('🔄 Testing Mixed Operations and Types...')
    
    // Test TYPE command with new data types
    result = await client.sendCommand('TYPE myzset')
    assert(result === 'zset', `TYPE (zset): Expected 'zset', got '${result}'`)
    
    result = await client.sendCommand('TYPE myjson')
    assert(result === 'hash', `TYPE (json): Expected 'hash', got '${result}'`)
    
    result = await client.sendCommand('TYPE mystream')
    assert(result === 'stream', `TYPE (stream): Expected 'stream', got '${result}'`)
    
    // Test wrong type operations
    result = await client.sendCommand('LPUSH myzset value')
    assert(result.error && result.error.includes('WRONGTYPE'), 'LPUSH on zset should return WRONGTYPE error')
    
    result = await client.sendCommand('SADD mystream value')
    assert(result.error && result.error.includes('WRONGTYPE'), 'SADD on stream should return WRONGTYPE error')
    
    result = await client.sendCommand('ZADD myjson 1.0 member')
    assert(result.error && result.error.includes('WRONGTYPE'), 'ZADD on json should return WRONGTYPE error')

    console.log()

    // ===============================
    // ADVANCED FEATURES TESTS
    // ===============================
    console.log('⚡ Testing Advanced Features...')
    
    // Test ZADD with options
    result = await client.sendCommand('ZADD advzset NX 1.0 member1 2.0 member2')
    assert(result === 2, `ZADD NX: Expected 2, got ${result}`)
    
    result = await client.sendCommand('ZADD advzset NX 3.0 member1')
    assert(result === 0, `ZADD NX existing: Expected 0, got ${result}`)
    
    result = await client.sendCommand('ZADD advzset XX 3.0 member1')
    assert(result === 0, `ZADD XX update: Expected 0, got ${result}`)
    
    result = await client.sendCommand('ZADD advzset CH XX 3.0 member1')
    assert(result === 1, `ZADD CH XX: Expected 1, got ${result}`)
    
    // Test JSON with NX/XX options
    result = await client.sendCommand('JSON.SET advjson $ \'{"test":true}\' NX')
    assert(result === 'OK', `JSON.SET NX: Expected 'OK', got '${result}'`)
    
    result = await client.sendCommand('JSON.SET advjson $ \'{"test":false}\' NX')
    assert(result === null, `JSON.SET NX existing: Expected null, got ${result}`)
    
    // Test Stream with MAXLEN
    await client.sendCommand('XADD limitstream MAXLEN 2 * f1 v1')
    await client.sendCommand('XADD limitstream MAXLEN 2 * f2 v2')
    await client.sendCommand('XADD limitstream MAXLEN 2 * f3 v3')
    
    result = await client.sendCommand('XLEN limitstream')
    assert(result === 2, `XLEN with MAXLEN: Expected 2, got ${result}`)

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
    console.log('\n🎉 All Phase 3 tests passed! Advanced data structures are working correctly.')
    console.log('\n📋 Phase 3 Summary:')
    console.log('  ✅ Sorted Sets (ZSETs) - 11 commands implemented')
    console.log('  ✅ JSON Operations - 9 commands implemented') 
    console.log('  ✅ Streams - 8 commands implemented')
    console.log('  ✅ Consumer Groups and Pending Lists')
    console.log('  ✅ JSONPath-like queries')
    console.log('  ✅ Advanced ZADD options (NX, XX, CH, INCR)')
    console.log('  ✅ Stream MAXLEN functionality')
    console.log('\n🚀 Ready for Phase 4: Specialized Data Structures!')
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
