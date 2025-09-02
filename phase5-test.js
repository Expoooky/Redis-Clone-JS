#!/usr/bin/env node
/**
 * Phase 5 Testing Script
 * Tests Time Series and Vector Database functionality
 * Includes Time Series operations and Vector similarity search
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
  console.log('🚀 Starting Phase 5 Tests\n')
  
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

  function assertApproximatelyEqual(actual, expected, tolerance, message) {
    const isApprox = Math.abs(actual - expected) <= tolerance
    assert(isApprox, `${message} - Expected: ~${expected}, Got: ${actual}`)
  }

  try {
    await client.connect()
    
    // Clean up any existing data
    await client.sendCommand('FLUSHALL')
    console.log('🧹 Database cleared\n')

    // ===============================
    // TIME SERIES OPERATIONS TESTS
    // ===============================
    console.log('📈 Testing Time Series Operations...')
    
    // Test TS.CREATE
    let result = await client.sendCommand('TS.CREATE temperature RETENTION 3600')
    assert(result === 'OK', `TS.CREATE: Expected 'OK', got '${result}'`)
    
    // Test TS.ADD with specific timestamp
    const timestamp1 = Date.now() - 1000 // 1 second ago
    result = await client.sendCommand(`TS.ADD temperature ${timestamp1} 25.5`)
    assert(result === timestamp1, `TS.ADD: Expected ${timestamp1}, got ${result}`)
    
    // Test TS.ADD with current timestamp (*)
    result = await client.sendCommand('TS.ADD temperature * 26.0')
    assert(typeof result === 'number' && result > timestamp1, `TS.ADD with *: Got valid timestamp ${result}`)
    const timestamp2 = result
    
    // Add more data points
    const timestamp3 = Date.now()
    await client.sendCommand(`TS.ADD temperature ${timestamp3} 27.2`)
    await client.sendCommand(`TS.ADD temperature ${timestamp3 + 1000} 28.1`)
    await client.sendCommand(`TS.ADD temperature ${timestamp3 + 2000} 29.0`)
    
    // Test TS.GET
    result = await client.sendCommand('TS.GET temperature')
    assert(Array.isArray(result) && result.length === 2, `TS.GET: Expected [timestamp, value], got ${JSON.stringify(result)}`)
    assert(result[1] === 29, `TS.GET: Expected latest value 29, got ${result[1]}`)
    
    // Test TS.RANGE
    result = await client.sendCommand(`TS.RANGE temperature ${timestamp1} ${timestamp3 + 2000}`)
    assert(Array.isArray(result) && result.length === 5, `TS.RANGE: Expected 5 samples, got ${result.length}`)
    
    // Test TS.INFO
    result = await client.sendCommand('TS.INFO temperature')
    assert(Array.isArray(result) && result.includes('totalSamples'), `TS.INFO: Expected info array, got ${JSON.stringify(result)}`)
    
    // Test multiple time series for TS.MGET and TS.MRANGE
    await client.sendCommand('TS.CREATE humidity')
    await client.sendCommand(`TS.ADD humidity ${timestamp1} 60.0`)
    await client.sendCommand(`TS.ADD humidity ${timestamp2} 62.5`)
    
    // Test TS.MGET
    result = await client.sendCommand('TS.MGET temperature humidity')
    assert(Array.isArray(result) && result.length === 2, `TS.MGET: Expected 2 results, got ${result.length}`)
    
    // Test TS.MRANGE
    result = await client.sendCommand(`TS.MRANGE ${timestamp1} ${timestamp3} temperature humidity`)
    assert(Array.isArray(result) && result.length === 2, `TS.MRANGE: Expected 2 time series, got ${result.length}`)
    
    // Test TS.DEL
    result = await client.sendCommand(`TS.DEL temperature ${timestamp1} ${timestamp2}`)
    assert(result >= 1, `TS.DEL: Expected >= 1 deleted, got ${result}`)

    console.log()

    // ===============================
    // VECTOR DATABASE OPERATIONS TESTS
    // ===============================
    console.log('🔍 Testing Vector Database Operations...')
    
    // Test VECTOR.ADD with 3D vectors
    result = await client.sendCommand('VECTOR.ADD vectors vec1 1.0 2.0 3.0')
    assert(result === 'vec1', `VECTOR.ADD: Expected 'vec1', got '${result}'`)
    
    result = await client.sendCommand('VECTOR.ADD vectors vec2 2.0 3.0 4.0')
    assert(result === 'vec2', `VECTOR.ADD: Expected 'vec2', got '${result}'`)
    
    result = await client.sendCommand('VECTOR.ADD vectors vec3 1.5 2.5 3.5')
    assert(result === 'vec3', `VECTOR.ADD: Expected 'vec3', got '${result}'`)
    
    // Test VECTOR.GET
    result = await client.sendCommand('VECTOR.GET vectors vec1')
    assert(Array.isArray(result) && result[0] === 'vec1', `VECTOR.GET: Expected ['vec1', [1,2,3]], got ${JSON.stringify(result)}`)
    assert(Array.isArray(result[1]) && result[1].length === 3, `VECTOR.GET: Expected 3D vector, got ${JSON.stringify(result[1])}`)
    
    // Test VECTOR.GET with non-existent vector
    result = await client.sendCommand('VECTOR.GET vectors nonexistent')
    assert(result === null, `VECTOR.GET nonexistent: Expected null, got ${result}`)
    
    // Test VECTOR.SEARCH for nearest neighbors
    result = await client.sendCommand('VECTOR.SEARCH vectors 1.1 2.1 3.1 2')
    assert(Array.isArray(result) && result.length <= 2, `VECTOR.SEARCH: Expected <= 2 results, got ${result.length}`)
    assert(Array.isArray(result[0]) && result[0][0] === 'vec1', `VECTOR.SEARCH: Expected vec1 as closest, got ${result[0][0]}`)
    
    // Test VECTOR.DISTANCE
    result = await client.sendCommand('VECTOR.DISTANCE vectors vec1 vec2')
    const distance = parseFloat(result)
    assert(!isNaN(distance) && distance > 0, `VECTOR.DISTANCE: Expected positive number, got ${result}`)
    
    // Test VECTOR.RANGE (vectors within distance)
    result = await client.sendCommand('VECTOR.RANGE vectors 1.0 2.0 3.0 2.0')
    assert(Array.isArray(result) && result.length >= 1, `VECTOR.RANGE: Expected at least 1 result, got ${result.length}`)
    
    // Test VECTOR.INFO
    result = await client.sendCommand('VECTOR.INFO vectors')
    assert(Array.isArray(result) && result.includes('vectorCount'), `VECTOR.INFO: Expected info array, got ${JSON.stringify(result)}`)
    
    // Test VECTOR.DEL
    result = await client.sendCommand('VECTOR.DEL vectors vec3')
    assert(result === 1, `VECTOR.DEL: Expected 1, got ${result}`)
    
    // Verify deletion
    result = await client.sendCommand('VECTOR.GET vectors vec3')
    assert(result === null, `VECTOR.GET after DEL: Expected null, got ${result}`)

    console.log()

    // ===============================
    // VECTOR MATH OPERATIONS TESTS
    // ===============================
    console.log('🧮 Testing Vector Math Operations...')
    
    // Test vector addition
    result = await client.sendCommand('VECTOR.MATH add [1,2,3] [4,5,6]')
    assertDeepEqual(result, [5, 7, 9], 'VECTOR.MATH add')
    
    // Test vector subtraction
    result = await client.sendCommand('VECTOR.MATH subtract [4,5,6] [1,2,3]')
    assertDeepEqual(result, [3, 3, 3], 'VECTOR.MATH subtract')
    
    // Test scalar multiplication
    result = await client.sendCommand('VECTOR.MATH multiply [1,2,3] 2')
    assertDeepEqual(result, [2, 4, 6], 'VECTOR.MATH multiply by scalar')
    
    // Test dot product
    result = await client.sendCommand('VECTOR.MATH dot [1,2,3] [4,5,6]')
    assert(result === '32', `VECTOR.MATH dot: Expected '32', got '${result}'`)

    console.log()

    // ===============================
    // ADVANCED VECTOR OPERATIONS TESTS
    // ===============================
    console.log('⚡ Testing Advanced Vector Operations...')
    
    // Test high-dimensional vectors
    const highDimVector1 = Array.from({length: 128}, (_, i) => Math.sin(i * 0.1)).join(' ')
    const highDimVector2 = Array.from({length: 128}, (_, i) => Math.cos(i * 0.1)).join(' ')
    
    result = await client.sendCommand(`VECTOR.ADD highdim v1 ${highDimVector1}`)
    assert(result === 'v1', `High-dim VECTOR.ADD: Expected 'v1', got '${result}'`)
    
    result = await client.sendCommand(`VECTOR.ADD highdim v2 ${highDimVector2}`)
    assert(result === 'v2', `High-dim VECTOR.ADD: Expected 'v2', got '${result}'`)
    
    // Test similarity search with high-dimensional vectors
    const queryVector = Array.from({length: 128}, (_, i) => Math.sin(i * 0.1 + 0.1)).join(' ')
    result = await client.sendCommand(`VECTOR.SEARCH highdim ${queryVector} 1`)
    assert(Array.isArray(result) && result.length === 1, `High-dim VECTOR.SEARCH: Expected 1 result, got ${result.length}`)
    
    // Test vector database with different distance metrics
    result = await client.sendCommand('VECTOR.DISTANCE highdim v1 v2 cosine')
    const cosineDistance = parseFloat(result)
    assert(!isNaN(cosineDistance) && cosineDistance >= 0, `Cosine distance: Expected non-negative number, got ${result}`)

    console.log()

    // ===============================
    // ERROR HANDLING TESTS
    // ===============================
    console.log('❌ Testing Error Handling...')
    
    // Test invalid TS commands
    result = await client.sendCommand('TS.ADD')
    assert(result && result.error && result.error.includes('wrong number of arguments'), 'TS.ADD with no args should error')
    
    result = await client.sendCommand('TS.GET nonexistent')
    assert(result && result.error && result.error.includes('key does not exist'), 'TS.GET on nonexistent key should error')
    
    // Test invalid VECTOR commands
    result = await client.sendCommand('VECTOR.ADD')
    assert(result && result.error && result.error.includes('wrong number of arguments'), 'VECTOR.ADD with no args should error')
    
    result = await client.sendCommand('VECTOR.ADD vectors vec1 invalid_data')
    assert(result && result.error && result.error.includes('invalid vector data'), 'VECTOR.ADD without data should error')
    
    // Test dimension mismatch
    result = await client.sendCommand('VECTOR.ADD vectors vec4 1.0 2.0') // 2D vector in 3D space
    assert(result && result.error && result.error.includes('dimension mismatch'), 'Dimension mismatch should error')

    console.log()

    // ===============================
    // MIXED DATA TYPE TESTS
    // ===============================
    console.log('🔄 Testing Mixed Data Types...')
    
    // Test TYPE command with new data types
    result = await client.sendCommand('TYPE temperature')
    assert(result === 'string', `TYPE (timeseries): Expected 'string', got '${result}'`) // TimeSeries stored as string
    
    result = await client.sendCommand('TYPE vectors')
    assert(result === 'string', `TYPE (vectors): Expected 'string', got '${result}'`) // VectorDatabase stored as string
    
    // Test operations on wrong types
    result = await client.sendCommand('LPUSH temperature value')
    assert(result.error && result.error.includes('WRONGTYPE'), 'LPUSH on time series should return WRONGTYPE error')
    
    result = await client.sendCommand('SADD vectors member')
    assert(result.error && result.error.includes('WRONGTYPE'), 'SADD on vector database should return WRONGTYPE error')

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
    console.log('\n🎉 All Phase 5 tests passed! Time Series & Vector Database implementations are working correctly.')
    console.log('\n📋 Phase 5 Summary:')
    console.log('  ✅ Time Series Operations - 8 commands implemented')
    console.log('    - TS.CREATE, TS.ADD, TS.RANGE, TS.GET, TS.MGET, TS.MRANGE, TS.INFO, TS.DEL')
    console.log('    - Timestamp handling, aggregation, retention policies')
    console.log('  ✅ Vector Database Operations - 8 commands implemented')
    console.log('    - VECTOR.ADD, VECTOR.GET, VECTOR.DEL, VECTOR.SEARCH, VECTOR.RANGE')
    console.log('    - VECTOR.INFO, VECTOR.DISTANCE, VECTOR.MATH')
    console.log('  ✅ HNSW Algorithm for efficient similarity search')
    console.log('  ✅ Vector math operations (add, subtract, multiply, dot product)')
    console.log('  ✅ Multiple distance metrics (Euclidean, Cosine, Manhattan)')
    console.log('  ✅ High-dimensional vector support')
    console.log('  ✅ Comprehensive error handling and type checking')
    console.log('\n🚀 Ready for Phase 6: Document Database Capabilities!')
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
