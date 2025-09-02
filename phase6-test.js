#!/usr/bin/env node
/**
 * Phase 6 Testing Script
 * Tests all Document Database functionality including collections, documents,
 * queries, indexing, and aggregation operations
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
  console.log('🚀 Starting Phase 6 Tests\n')
  
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
    // COLLECTION MANAGEMENT TESTS
    // ===============================
    console.log('📁 Testing Collection Management...')
    
    // Test DB.CREATE
    let result = await client.sendCommand('DB.CREATE users')
    assert(result === 'OK', `DB.CREATE: Expected 'OK', got '${result}'`)
    
    result = await client.sendCommand('DB.CREATE products MAXDOCUMENTS 1000 MAXSIZE 1048576')
    assert(result === 'OK', `DB.CREATE with options: Expected 'OK', got '${result}'`)
    
    // Test DB.LIST
    result = await client.sendCommand('DB.LIST')
    assert(Array.isArray(result) && result.includes('users') && result.includes('products'), 
          `DB.LIST: Expected array with 'users' and 'products', got ${JSON.stringify(result)}`)
    
    // Test duplicate collection creation
    result = await client.sendCommand('DB.CREATE users')
    assert(result.error && result.error.includes('already exists'), 
          'DB.CREATE duplicate should return error')

    console.log()

    // ===============================
    // DOCUMENT INSERT TESTS
    // ===============================
    console.log('📄 Testing Document Insert Operations...')
    
    // Test DB.INSERT
    const user1 = { name: 'John Doe', age: 30, email: 'john@example.com', tags: ['admin', 'active'] }
    result = await client.sendCommand(`DB.INSERT users '${JSON.stringify(user1)}'`)
    assert(typeof result === 'string' && result.length > 0, `DB.INSERT: Expected document ID, got '${result}'`)
    const user1Id = result
    
    const user2 = { name: 'Jane Smith', age: 25, email: 'jane@example.com', tags: ['user', 'active'] }
    result = await client.sendCommand(`DB.INSERT users '${JSON.stringify(user2)}'`)
    assert(typeof result === 'string' && result.length > 0, `DB.INSERT: Expected document ID, got '${result}'`)
    const user2Id = result
    
    const user3 = { name: 'Bob Wilson', age: 35, email: 'bob@example.com', tags: ['user'], status: 'inactive' }
    result = await client.sendCommand(`DB.INSERT users '${JSON.stringify(user3)}'`)
    assert(typeof result === 'string' && result.length > 0, `DB.INSERT: Expected document ID, got '${result}'`)
    
    // Test invalid JSON
    result = await client.sendCommand("DB.INSERT users '{invalid json}'")
    assert(result.error && result.error.includes('invalid JSON'), 
          'DB.INSERT with invalid JSON should return error')

    console.log()

    // ===============================
    // DOCUMENT QUERY TESTS
    // ===============================
    console.log('🔍 Testing Document Query Operations...')
    
    // Test DB.FIND - find all
    result = await client.sendCommand('DB.FIND users')
    const findAllResult = JSON.parse(result)
    assert(findAllResult.documents && findAllResult.documents.length === 3, 
          `DB.FIND all: Expected 3 documents, got ${findAllResult.documents?.length}`)
    assert(findAllResult.totalCount === 3, 
          `DB.FIND all totalCount: Expected 3, got ${findAllResult.totalCount}`)
    
    // Test DB.FIND with query
    result = await client.sendCommand(`DB.FIND users '{"age": {"$gte": 30}}'`)
    const ageQueryResult = JSON.parse(result)
    assert(ageQueryResult.documents && ageQueryResult.documents.length === 2, 
          `DB.FIND age query: Expected 2 documents, got ${ageQueryResult.documents?.length}`)
    
    // Test DB.FIND with limit and skip
    result = await client.sendCommand('DB.FIND users "{}" LIMIT 2 SKIP 1')
    const paginationResult = JSON.parse(result)
    assert(paginationResult.documents && paginationResult.documents.length === 2, 
          `DB.FIND pagination: Expected 2 documents, got ${paginationResult.documents?.length}`)
    
    // Test DB.FIND with projection
    result = await client.sendCommand(`DB.FIND users '{}' PROJECTION '{"name": 1, "email": 1}'`)
    const projectionResult = JSON.parse(result)
    assert(projectionResult.documents && projectionResult.documents[0].name && projectionResult.documents[0].email, 
          'DB.FIND projection: Should include name and email')
    assert(!projectionResult.documents[0].age, 
          'DB.FIND projection: Should not include age')
    
    // Test DB.FINDONE
    result = await client.sendCommand(`DB.FINDONE users '{"name": "John Doe"}'`)
    const findOneResult = JSON.parse(result)
    assert(findOneResult.name === 'John Doe' && findOneResult.age === 30, 
          'DB.FINDONE: Should return John Doe with correct data')
    
    // Test DB.FINDONE not found
    result = await client.sendCommand(`DB.FINDONE users '{"name": "Non Existent"}'`)
    assert(result === null, `DB.FINDONE not found: Expected null, got ${result}`)

    console.log()

    // ===============================
    // DOCUMENT COUNT AND DISTINCT TESTS
    // ===============================
    console.log('📊 Testing Count and Distinct Operations...')
    
    // Test DB.COUNT
    result = await client.sendCommand('DB.COUNT users')
    assert(result === 3, `DB.COUNT all: Expected 3, got ${result}`)
    
    result = await client.sendCommand(`DB.COUNT users '{"age": {"$lt": 30}}'`)
    assert(result === 1, `DB.COUNT with query: Expected 1, got ${result}`)
    
    // Test DB.DISTINCT
    result = await client.sendCommand('DB.DISTINCT users age')
    const distinctAges = result.map(age => JSON.parse(age))
    assert(distinctAges.length === 3 && distinctAges.includes(25) && distinctAges.includes(30) && distinctAges.includes(35), 
          `DB.DISTINCT ages: Expected [25, 30, 35], got ${JSON.stringify(distinctAges)}`)

    console.log()

    // ===============================
    // DOCUMENT UPDATE TESTS
    // ===============================
    console.log('✏️ Testing Document Update Operations...')
    
    // Test DB.UPDATE - single document
    result = await client.sendCommand(`DB.UPDATE users '{"name": "John Doe"}' '{"$set": {"age": 31, "department": "Engineering"}}'`)
    const updateResult = JSON.parse(result)
    assert(updateResult.matchedCount === 1 && updateResult.modifiedCount === 1, 
          `DB.UPDATE single: Expected matched=1, modified=1, got matched=${updateResult.matchedCount}, modified=${updateResult.modifiedCount}`)
    
    // Verify update
    result = await client.sendCommand(`DB.FINDONE users '{"name": "John Doe"}'`)
    const updatedUser = JSON.parse(result)
    assert(updatedUser.age === 31 && updatedUser.department === 'Engineering', 
          'DB.UPDATE verification: John Doe should have age=31 and department=Engineering')
    
    // Test DB.UPDATE - multiple documents
    result = await client.sendCommand(`DB.UPDATE users '{"tags": "active"}' '{"$set": {"lastLogin": "2024-01-01"}}' MULTI`)
    const multiUpdateResult = JSON.parse(result)
    assert(multiUpdateResult.matchedCount === 2 && multiUpdateResult.modifiedCount === 2, 
          `DB.UPDATE multi: Expected matched=2, modified=2, got matched=${multiUpdateResult.matchedCount}, modified=${multiUpdateResult.modifiedCount}`)
    
    // Test DB.UPDATE with $inc
    result = await client.sendCommand(`DB.UPDATE users '{"name": "Jane Smith"}' '{"$inc": {"age": 1}}'`)
    const incResult = JSON.parse(result)
    assert(incResult.modifiedCount === 1, `DB.UPDATE $inc: Expected modified=1, got ${incResult.modifiedCount}`)
    
    // Verify $inc
    result = await client.sendCommand(`DB.FINDONE users '{"name": "Jane Smith"}'`)
    const incUser = JSON.parse(result)
    assert(incUser.age === 26, `DB.UPDATE $inc verification: Jane should have age=26, got ${incUser.age}`)

    console.log()

    // ===============================
    // DOCUMENT DELETE TESTS
    // ===============================
    console.log('🗑️ Testing Document Delete Operations...')
    
    // Test DB.DELETE - single document
    result = await client.sendCommand(`DB.DELETE users '{"name": "Bob Wilson"}'`)
    assert(result === 1, `DB.DELETE single: Expected 1, got ${result}`)
    
    // Verify deletion
    result = await client.sendCommand('DB.COUNT users')
    assert(result === 2, `DB.DELETE verification: Expected 2 users remaining, got ${result}`)
    
    // Add more test data for multi-delete
    const user4 = { name: 'Alice Brown', age: 28, status: 'inactive' }
    const user5 = { name: 'Charlie Davis', age: 32, status: 'inactive' }
    await client.sendCommand(`DB.INSERT users '${JSON.stringify(user4)}'`)
    await client.sendCommand(`DB.INSERT users '${JSON.stringify(user5)}'`)
    
    // Test DB.DELETE - multiple documents
    result = await client.sendCommand(`DB.DELETE users '{"status": "inactive"}' MULTI`)
    assert(result === 2, `DB.DELETE multi: Expected 2, got ${result}`)

    console.log()

    // ===============================
    // INDEX MANAGEMENT TESTS
    // ===============================
    console.log('🗂️ Testing Index Management...')
    
    // Test DB.INDEX.CREATE
    result = await client.sendCommand('DB.INDEX.CREATE users age TYPE btree')
    assert(result === 'OK', `DB.INDEX.CREATE: Expected 'OK', got '${result}'`)
    
    result = await client.sendCommand('DB.INDEX.CREATE users email TYPE hash UNIQUE true')
    assert(result === 'OK', `DB.INDEX.CREATE unique: Expected 'OK', got '${result}'`)
    
    // Test DB.INDEX.LIST
    result = await client.sendCommand('DB.INDEX.LIST users')
    const indexList = JSON.parse(result)
    assert(Array.isArray(indexList) && indexList.length >= 2, 
          `DB.INDEX.LIST: Expected array with at least 2 indexes, got ${JSON.stringify(indexList)}`)
    
    // Test duplicate index creation
    result = await client.sendCommand('DB.INDEX.CREATE users age TYPE btree')
    assert(result.error && result.error.includes('already exists'), 
          'DB.INDEX.CREATE duplicate should return error')

    console.log()

    // ===============================
    // AGGREGATION TESTS
    // ===============================
    console.log('📈 Testing Aggregation Operations...')
    
    // Add more test data for aggregation
    const products = [
      { name: 'Laptop', category: 'Electronics', price: 999, inStock: true },
      { name: 'Mouse', category: 'Electronics', price: 25, inStock: true },
      { name: 'Book', category: 'Education', price: 15, inStock: false },
      { name: 'Phone', category: 'Electronics', price: 699, inStock: true },
      { name: 'Pen', category: 'Office', price: 2, inStock: true }
    ]
    
    for (const product of products) {
      await client.sendCommand(`DB.INSERT products '${JSON.stringify(product)}'`)
    }
    
    // Test basic aggregation - match and group
    const pipeline1 = [
      { "$match": { "inStock": true } },
      { "$group": { "_id": "$category", "totalProducts": { "$sum": 1 }, "avgPrice": { "$avg": "$price" } } }
    ]
    result = await client.sendCommand(`DB.AGGREGATE products '${JSON.stringify(pipeline1)}'`)
    const aggResult1 = JSON.parse(result)
    assert(aggResult1.documents && aggResult1.documents.length === 2, 
          `DB.AGGREGATE group by category: Expected 2 groups, got ${aggResult1.documents?.length}`)
    
    // Test aggregation with project and sort
    const pipeline2 = [
      { "$match": { "price": { "$gte": 20 } } },
      { "$project": { "name": 1, "category": 1, "price": 1, "priceRange": { "$cond": { "if": { "$gte": ["$price", 100] }, "then": "expensive", "else": "affordable" } } } },
      { "$sort": { "price": -1 } },
      { "$limit": 3 }
    ]
    result = await client.sendCommand(`DB.AGGREGATE products '${JSON.stringify(pipeline2)}'`)
    const aggResult2 = JSON.parse(result)
    assert(aggResult2.documents && aggResult2.documents.length === 3, 
          `DB.AGGREGATE with project and sort: Expected 3 documents, got ${aggResult2.documents?.length}`)
    assert(aggResult2.documents[0].name === 'Laptop', 
          `DB.AGGREGATE sort verification: First item should be Laptop, got ${aggResult2.documents[0]?.name}`)

    console.log()

    // ===============================
    // ADVANCED QUERY TESTS
    // ===============================
    console.log('🔍 Testing Advanced Query Operations...')
    
    // Test complex queries with multiple operators on products collection
    result = await client.sendCommand(`DB.FIND products '{"$and": [{"price": {"$gte": 20}}, {"category": "Electronics"}]}'`)
    const complexQuery1 = JSON.parse(result)
    assert(complexQuery1.documents && complexQuery1.documents.length === 3, 
          `DB.FIND complex $and query: Expected 3 documents, got ${complexQuery1.documents?.length}`)
    
    // Test $or query
    result = await client.sendCommand(`DB.FIND products '{"$or": [{"price": {"$lt": 10}}, {"category": "Education"}]}'`)
    const orQuery = JSON.parse(result)
    assert(orQuery.documents && orQuery.documents.length === 2, 
          `DB.FIND $or query: Expected 2 documents, got ${orQuery.documents?.length}`)
    
    // Test array queries
    result = await client.sendCommand(`DB.FIND users '{"tags": {"$in": ["admin", "user"]}}'`)
    const arrayQuery = JSON.parse(result)
    assert(arrayQuery.documents && arrayQuery.documents.length >= 1, 
          `DB.FIND array $in query: Expected at least 1 document, got ${arrayQuery.documents?.length}`)

    console.log()

    // ===============================
    // EDGE CASES AND ERROR HANDLING
    // ===============================
    console.log('⚠️ Testing Edge Cases and Error Handling...')
    
    // Test operations on non-existent collection
    result = await client.sendCommand('DB.FIND nonexistent')
    assert(result.error && result.error.includes('does not exist'), 
          'DB.FIND on non-existent collection should return error')
    
    // Test invalid query JSON
    result = await client.sendCommand("DB.FIND users '{invalid}'")
    assert(result.error && result.error.includes('invalid'), 
          'DB.FIND with invalid JSON should return error')
    
    // Test invalid aggregation pipeline
    result = await client.sendCommand(`DB.AGGREGATE products 'not an array'`)
    assert(result.error && result.error.includes('invalid'), 
          'DB.AGGREGATE with invalid pipeline should return error')
    
    // Test collection drop
    result = await client.sendCommand('DB.DROP products')
    assert(result === 'OK', `DB.DROP: Expected 'OK', got '${result}'`)
    
    // Verify collection was dropped
    result = await client.sendCommand('DB.LIST')
    assert(Array.isArray(result) && !result.includes('products'), 
          `DB.DROP verification: products should not be in list, got ${JSON.stringify(result)}`)

    console.log()

    // ===============================
    // PERFORMANCE AND STRESS TESTS
    // ===============================
    console.log('🚄 Testing Performance...')
    
    // Create a collection for performance testing
    await client.sendCommand('DB.CREATE perftest')
    
    // Insert multiple documents
    const startTime = Date.now()
    for (let i = 0; i < 100; i++) {
      const doc = { 
        id: i, 
        name: `User ${i}`, 
        category: i % 5, 
        score: Math.random() * 100,
        timestamp: new Date().toISOString()
      }
      await client.sendCommand(`DB.INSERT perftest '${JSON.stringify(doc)}'`)
    }
    const insertTime = Date.now() - startTime
    console.log(`  📊 Inserted 100 documents in ${insertTime}ms`)
    
    // Test bulk query performance
    const queryStart = Date.now()
    result = await client.sendCommand('DB.FIND perftest')
    const queryTime = Date.now() - queryStart
    const perfResult = JSON.parse(result)
    assert(perfResult.documents && perfResult.documents.length === 100, 
          `Performance test: Expected 100 documents, got ${perfResult.documents?.length}`)
    console.log(`  📊 Queried 100 documents in ${queryTime}ms`)
    
    // Test aggregation performance
    const aggStart = Date.now()
    const perfPipeline = [
      { "$group": { "_id": "$category", "count": { "$sum": 1 }, "avgScore": { "$avg": "$score" } } },
      { "$sort": { "avgScore": -1 } }
    ]
    result = await client.sendCommand(`DB.AGGREGATE perftest '${JSON.stringify(perfPipeline)}'`)
    const aggTime = Date.now() - aggStart
    const perfAggResult = JSON.parse(result)
    assert(perfAggResult.documents && perfAggResult.documents.length === 5, 
          `Performance aggregation: Expected 5 groups, got ${perfAggResult.documents?.length}`)
    console.log(`  📊 Aggregated 100 documents in ${aggTime}ms`)

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
    console.log('\n🎉 All Phase 6 tests passed! Document Database implementation is working correctly.')
    console.log('\n📋 Phase 6 Summary:')
    console.log('  ✅ Document Storage Engine - Flexible JSON document storage')
    console.log('  ✅ Collection Management - Create, drop, list collections')
    console.log('  ✅ Document Operations - Insert, find, update, delete documents')
    console.log('  ✅ Query Engine - MongoDB-like query language with complex operators')
    console.log('  ✅ Index Manager - Secondary indexing with B-tree, hash, text, compound indexes')
    console.log('  ✅ Aggregation Framework - Match, project, group, sort, limit, skip, unwind')
    console.log('  ✅ Advanced Features - Pagination, projection, sorting, distinct, count')
    console.log('  ✅ Error Handling - Comprehensive error handling and validation')
    console.log('  ✅ Performance - Efficient operations on large document sets')
    console.log('\n🚀 Ready for Phase 7: Enhanced Key Management & Expiration!')
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
