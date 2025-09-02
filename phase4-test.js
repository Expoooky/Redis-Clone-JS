#!/usr/bin/env node
/**
 * Phase 4 Testing Script
 * Tests all specialized data structures: Geospatial, Bitmap, Bitfield, HyperLogLog, Bloom Filter
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
  console.log('🚀 Starting Phase 4 Tests\n')
  
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
    // GEOSPATIAL OPERATIONS TESTS
    // ===============================
    console.log('🌍 Testing Geospatial Operations...')
    
    // Test GEOADD
    let result = await client.sendCommand('GEOADD cities -122.419 37.775 "San Francisco" -74.006 40.713 "New York"')
    assert(result === 2, `GEOADD: Expected 2, got ${result}`)
    
    result = await client.sendCommand('GEOADD cities -0.127 51.507 London')
    assert(result === 1, `GEOADD single: Expected 1, got ${result}`)
    
    // Test GEODIST
    result = await client.sendCommand('GEODIST cities "San Francisco" "New York" km')
    assert(typeof result === 'string' && parseFloat(result) > 4000, `GEODIST: Expected distance > 4000km, got ${result}`)
    
    result = await client.sendCommand('GEODIST cities "San Francisco" "NonExistent"')
    assert(result === null, `GEODIST nonexistent: Expected null, got ${result}`)
    
    // Test GEOHASH
    result = await client.sendCommand('GEOHASH cities "San Francisco" "New York"')
    assert(Array.isArray(result) && result.length === 2, `GEOHASH: Expected array of 2, got ${JSON.stringify(result)}`)
    assert(result[0] !== null && result[1] !== null, 'GEOHASH: Both hashes should be non-null')
    
    // Test GEOPOS
    result = await client.sendCommand('GEOPOS cities "San Francisco" "New York"')
    assert(Array.isArray(result) && result.length === 2, `GEOPOS: Expected array of 2, got ${JSON.stringify(result)}`)
    assert(Array.isArray(result[0]) && result[0].length === 2, 'GEOPOS: First position should be [lng, lat]')
    
    // Test GEORADIUS
    result = await client.sendCommand('GEORADIUS cities -122.4 37.8 100 km')
    assert(Array.isArray(result) && result.includes('San Francisco'), `GEORADIUS: Expected San Francisco in results`)
    
    result = await client.sendCommand('GEORADIUS cities -122.4 37.8 100 km WITHDIST')
    assert(Array.isArray(result) && Array.isArray(result[0]), 'GEORADIUS WITHDIST: Expected nested arrays')
    
    // Test GEORADIUSBYMEMBER
    result = await client.sendCommand('GEORADIUSBYMEMBER cities "San Francisco" 10000 km')
    assert(Array.isArray(result) && result.length >= 2, 'GEORADIUSBYMEMBER: Expected multiple cities')

    console.log()

    // ===============================
    // BITMAP OPERATIONS TESTS
    // ===============================
    console.log('🔢 Testing Bitmap Operations...')
    
    // Test SETBIT and GETBIT
    result = await client.sendCommand('SETBIT bitmap 0 1')
    assert(result === 0, `SETBIT: Expected 0 (original value), got ${result}`)
    
    result = await client.sendCommand('GETBIT bitmap 0')
    assert(result === 1, `GETBIT: Expected 1, got ${result}`)
    
    result = await client.sendCommand('GETBIT bitmap 1')
    assert(result === 0, `GETBIT unset: Expected 0, got ${result}`)
    
    // Test SETBIT on existing bit
    result = await client.sendCommand('SETBIT bitmap 0 0')
    assert(result === 1, `SETBIT existing: Expected 1 (previous value), got ${result}`)
    
    // Set up bitmap for counting
    await client.sendCommand('SETBIT bitmap 1 1')
    await client.sendCommand('SETBIT bitmap 3 1')
    await client.sendCommand('SETBIT bitmap 5 1')
    
    // Test BITCOUNT
    result = await client.sendCommand('BITCOUNT bitmap')
    assert(result === 3, `BITCOUNT: Expected 3, got ${result}`)
    
    result = await client.sendCommand('BITCOUNT bitmap 0 0')
    assert(result === 3, `BITCOUNT with range: Expected 3, got ${result}`)
    
    // Test BITPOS
    result = await client.sendCommand('BITPOS bitmap 1')
    assert(result === 1, `BITPOS: Expected 1, got ${result}`)
    
    result = await client.sendCommand('BITPOS bitmap 0')
    assert(result === 0, `BITPOS zero: Expected 0, got ${result}`)
    
    // Test BITOP
    await client.sendCommand('SETBIT bitmap1 0 1')
    await client.sendCommand('SETBIT bitmap1 2 1')
    await client.sendCommand('SETBIT bitmap2 1 1')
    await client.sendCommand('SETBIT bitmap2 2 1')
    
    result = await client.sendCommand('BITOP AND result bitmap1 bitmap2')
    assert(result === 1, `BITOP AND: Expected 1 byte result, got ${result}`)
    
    result = await client.sendCommand('BITCOUNT result')
    assert(result === 1, `BITOP AND result: Expected 1 set bit, got ${result}`)
    
    result = await client.sendCommand('BITOP OR result2 bitmap1 bitmap2')
    assert(result === 1, `BITOP OR: Expected 1 byte result, got ${result}`)
    
    result = await client.sendCommand('BITCOUNT result2')
    assert(result === 3, `BITOP OR result: Expected 3 set bits, got ${result}`)

    console.log()

    // ===============================
    // BITFIELD OPERATIONS TESTS
    // ===============================
    console.log('⚡ Testing Bitfield Operations...')
    
    // Test BITFIELD SET
    result = await client.sendCommand('BITFIELD bitfield SET u8 0 255')
    assert(Array.isArray(result) && result[0] === 0, `BITFIELD SET: Expected [0], got ${JSON.stringify(result)}`)
    
    // Test BITFIELD GET
    result = await client.sendCommand('BITFIELD bitfield GET u8 0')
    assert(Array.isArray(result) && result[0] === 255, `BITFIELD GET: Expected [255], got ${JSON.stringify(result)}`)
    
    // Test BITFIELD INCRBY
    result = await client.sendCommand('BITFIELD bitfield INCRBY u8 0 1')
    assert(Array.isArray(result) && result[0] === 0, `BITFIELD INCRBY wrap: Expected [0] (wrap), got ${JSON.stringify(result)}`)
    
    // Test BITFIELD with multiple operations
    result = await client.sendCommand('BITFIELD multifield SET u4 0 15 GET u4 0 INCRBY u4 4 1')
    assert(Array.isArray(result) && result.length === 3, `BITFIELD multi: Expected 3 results, got ${JSON.stringify(result)}`)
    
    // Test BITFIELD with element offset
    result = await client.sendCommand('BITFIELD elements SET u16 #0 1000 SET u16 #1 2000')
    assert(Array.isArray(result) && result.length === 2, `BITFIELD elements: Expected 2 results, got ${JSON.stringify(result)}`)

    console.log()

    // ===============================
    // HYPERLOGLOG OPERATIONS TESTS
    // ===============================
    console.log('🔄 Testing HyperLogLog Operations...')
    
    // Test PFADD
    result = await client.sendCommand('PFADD hll a b c d e')
    assert(result === 1, `PFADD: Expected 1 (updated), got ${result}`)
    
    result = await client.sendCommand('PFADD hll a b c')
    assert(result === 0, `PFADD existing: Expected 0 (not updated), got ${result}`)
    
    // Test PFCOUNT
    result = await client.sendCommand('PFCOUNT hll')
    assert(result >= 4 && result <= 6, `PFCOUNT: Expected ~5, got ${result}`)
    
    // Add more elements for better cardinality test
    await client.sendCommand('PFADD hll f g h i j k l m n o p q r s t u v w x y z')
    result = await client.sendCommand('PFCOUNT hll')
    assert(result >= 20 && result <= 35, `PFCOUNT large: Expected ~26, got ${result}`)
    
    // Test PFMERGE
    await client.sendCommand('PFADD hll2 1 2 3 4 5')
    result = await client.sendCommand('PFMERGE merged hll hll2')
    assert(result === 'OK', `PFMERGE: Expected 'OK', got '${result}'`)
    
    result = await client.sendCommand('PFCOUNT merged')
    assert(result >= 25, `PFCOUNT merged: Expected >= 25, got ${result}`)
    
    // Test PFCOUNT with multiple keys
    result = await client.sendCommand('PFCOUNT hll hll2')
    assert(result >= 25, `PFCOUNT multi: Expected >= 25, got ${result}`)

    console.log()

    // ===============================
    // BLOOM FILTER OPERATIONS TESTS
    // ===============================
    console.log('🌸 Testing Bloom Filter Operations...')
    
    // Test BF.ADD
    result = await client.sendCommand('BF.ADD bloom item1')
    assert(result === 1, `BF.ADD: Expected 1 (new), got ${result}`)
    
    result = await client.sendCommand('BF.ADD bloom item1')
    assert(result === 0, `BF.ADD existing: Expected 0 (existed), got ${result}`)
    
    // Test BF.EXISTS
    result = await client.sendCommand('BF.EXISTS bloom item1')
    assert(result === 1, `BF.EXISTS: Expected 1 (exists), got ${result}`)
    
    result = await client.sendCommand('BF.EXISTS bloom nonexistent')
    assert(result === 0, `BF.EXISTS missing: Expected 0 (doesn't exist), got ${result}`)
    
    // Test BF.MADD
    result = await client.sendCommand('BF.MADD bloom item2 item3 item4 item2')
    assert(Array.isArray(result) && result.length === 4, `BF.MADD: Expected array of 4, got ${JSON.stringify(result)}`)
    assert(result[0] === 1 && result[1] === 1 && result[2] === 1 && result[3] === 0, 'BF.MADD: Expected [1,1,1,0]')
    
    // Test BF.MEXISTS
    result = await client.sendCommand('BF.MEXISTS bloom item1 item2 item3 nonexistent')
    assertDeepEqual(result, [1, 1, 1, 0], 'BF.MEXISTS: Expected [1,1,1,0]')
    
    // Test BF.INFO
    result = await client.sendCommand('BF.INFO bloom')
    assert(Array.isArray(result) && result.length > 0, `BF.INFO: Expected non-empty array, got ${JSON.stringify(result)}`)
    
    // Verify some key stats are present
    const expectedKeys = ['Expected Elements', 'Added Elements', 'Bit Size', 'Hash Functions']
    let hasExpectedKeys = true
    for (const key of expectedKeys) {
      if (!result.includes(key)) {
        hasExpectedKeys = false
        break
      }
    }
    assert(hasExpectedKeys, 'BF.INFO: Should contain expected statistical keys')

    console.log()

    // ===============================
    // MIXED OPERATIONS AND EDGE CASES
    // ===============================
    console.log('🧪 Testing Mixed Operations and Edge Cases...')
    
    // Test TYPE command with specialized data structures
    result = await client.sendCommand('TYPE cities')
    assert(result === 'hash', `TYPE geo: Expected 'hash', got '${result}'`)
    
    result = await client.sendCommand('TYPE bitmap')
    assert(result === 'string', `TYPE bitmap: Expected 'string', got '${result}'`)
    
    result = await client.sendCommand('TYPE hll')
    assert(result === 'string', `TYPE hll: Expected 'string', got '${result}'`) // HLL stored as string internally
    
    // Test GEOADD with invalid coordinates
    result = await client.sendCommand('GEOADD invalid_geo 200 91 invalid')
    assert(result.error && result.error.includes('invalid'), 'GEOADD invalid coords should return error')
    
    // Test SETBIT with invalid offset
    result = await client.sendCommand('SETBIT testbit -1 1')
    assert(result.error && result.error.includes('range'), 'SETBIT negative offset should return error')
    
    // Test BITFIELD with invalid type
    result = await client.sendCommand('BITFIELD testfield SET u0 0 1')
    assert(result.error && result.error.includes('Invalid'), 'BITFIELD invalid type should return error')
    
    // Test operations on wrong data types
    result = await client.sendCommand('GEOADD bitmap 0 0 test')
    assert(result.error && result.error.includes('WRONGTYPE'), 'GEOADD on bitmap should return WRONGTYPE')
    
    result = await client.sendCommand('SETBIT cities 0 1')
    assert(result.error && result.error.includes('WRONGTYPE'), 'SETBIT on geo should return WRONGTYPE')

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
    console.log('\n🎉 All Phase 4 tests passed! Specialized data structures are working correctly.')
    console.log('\n📋 Phase 4 Summary:')
    console.log('  ✅ Geospatial Operations - 6 commands implemented')
    console.log('    - GEOADD, GEODIST, GEOHASH, GEOPOS, GEORADIUS, GEORADIUSBYMEMBER')
    console.log('  ✅ Bitmap Operations - 5 commands implemented')
    console.log('    - SETBIT, GETBIT, BITCOUNT, BITOP, BITPOS')
    console.log('  ✅ Bitfield Operations - BITFIELD command with GET/SET/INCRBY')
    console.log('    - Support for various integer sizes and overflow handling')
    console.log('  ✅ HyperLogLog Operations - 3 commands implemented')
    console.log('    - PFADD, PFCOUNT, PFMERGE with cardinality estimation')
    console.log('  ✅ Bloom Filter Operations - 5 custom commands implemented')
    console.log('    - BF.ADD, BF.EXISTS, BF.MADD, BF.MEXISTS, BF.INFO')
    console.log('  ✅ Geohash algorithm and Haversine distance calculations')
    console.log('  ✅ Efficient bit manipulation and probabilistic data structures')
    console.log('  ✅ Redis-compatible command interface and error handling')
    console.log('\n🚀 Ready for Phase 5: Time Series & Vector Database!')
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
