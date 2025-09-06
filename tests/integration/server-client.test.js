/**
 * Integration Tests - Server-Client Communication
 * 
 * Tests full server-client interaction and RESP protocol
 */

const { spawn } = require('child_process')

describe('Server-Client Integration Tests', () => {
  let serverProcess
  let client

  beforeAll(async () => {
    // Start Redis server
    console.log('🚀 Starting Redis server for integration tests...')
    serverProcess = await TestUtils.startTestServer()
    await TestUtils.sleep(2000)
    
    // Create test client
    client = TestUtils.createTestClient()
    await client.connect()
  })

  afterAll(async () => {
    if (client) {
      await client.disconnect()
    }
    if (serverProcess) {
      await TestUtils.stopTestServer(serverProcess)
    }
  })

  beforeEach(async () => {
    // Clear database before each test
    await client.sendCommand('FLUSHDB')
  })

  describe('Basic Protocol Communication', () => {
    test('should handle PING command', async () => {
      const result = await client.sendCommand('PING')
      expect(result).toBe('PONG')
    })

    test('should handle ECHO command', async () => {
      const message = 'Hello Redis Clone!'
      const result = await client.sendCommand(`ECHO "${message}"`)
      expect(result).toBe(message)
    })

    test('should handle INFO command', async () => {
      const result = await client.sendCommand('INFO')
      expect(typeof result).toBe('string')
      expect(result).toContain('redis_version')
    })
  })

  describe('String Operations Integration', () => {
    test('should handle SET and GET operations', async () => {
      const key = TestUtils.generateTestKey('integration')
      const value = 'Integration Test Value'
      
      // SET
      let result = await client.sendCommand(`SET ${key} "${value}"`)
      expect(result).toBe('OK')
      
      // GET
      result = await client.sendCommand(`GET ${key}`)
      expect(result).toBe(value)
    })

    test('should handle numeric operations', async () => {
      const key = TestUtils.generateTestKey('counter')
      
      // Set initial value
      await client.sendCommand(`SET ${key} 10`)
      
      // INCR
      let result = await client.sendCommand(`INCR ${key}`)
      expect(result).toBe(11)
      
      // INCRBY
      result = await client.sendCommand(`INCRBY ${key} 5`)
      expect(result).toBe(16)
      
      // DECR
      result = await client.sendCommand(`DECR ${key}`)
      expect(result).toBe(15)
    })

    test('should handle multiple key operations', async () => {
      // MSET
      let result = await client.sendCommand('MSET key1 value1 key2 value2 key3 value3')
      expect(result).toBe('OK')
      
      // MGET
      result = await client.sendCommand('MGET key1 key2 key3')
      expect(result).toEqual(['value1', 'value2', 'value3'])
    })
  })

  describe('List Operations Integration', () => {
    test('should handle list push and pop operations', async () => {
      const key = TestUtils.generateTestKey('list')
      
      // LPUSH
      let result = await client.sendCommand(`LPUSH ${key} item1`)
      expect(result).toBe(1)
      
      result = await client.sendCommand(`LPUSH ${key} item2`)
      expect(result).toBe(2)
      
      // LRANGE
      result = await client.sendCommand(`LRANGE ${key} 0 -1`)
      expect(result).toEqual(['item2', 'item1'])
      
      // LPOP
      result = await client.sendCommand(`LPOP ${key}`)
      expect(result).toBe('item2')
      
      // RPOP
      result = await client.sendCommand(`RPOP ${key}`)
      expect(result).toBe('item1')
    })

    test('should handle list index operations', async () => {
      const key = TestUtils.generateTestKey('list_index')
      
      // Add items
      await client.sendCommand(`RPUSH ${key} a b c d`)
      
      // LINDEX
      let result = await client.sendCommand(`LINDEX ${key} 0`)
      expect(result).toBe('a')
      
      result = await client.sendCommand(`LINDEX ${key} -1`)
      expect(result).toBe('d')
      
      // LSET
      result = await client.sendCommand(`LSET ${key} 1 modified`)
      expect(result).toBe('OK')
      
      result = await client.sendCommand(`LINDEX ${key} 1`)
      expect(result).toBe('modified')
    })
  })

  describe('Key Management Integration', () => {
    test('should handle key existence and deletion', async () => {
      const key = TestUtils.generateTestKey('management')
      
      // EXISTS (non-existent)
      let result = await client.sendCommand(`EXISTS ${key}`)
      expect(result).toBe(0)
      
      // Set key
      await client.sendCommand(`SET ${key} value`)
      
      // EXISTS (exists)
      result = await client.sendCommand(`EXISTS ${key}`)
      expect(result).toBe(1)
      
      // DEL
      result = await client.sendCommand(`DEL ${key}`)
      expect(result).toBe(1)
      
      // EXISTS (deleted)
      result = await client.sendCommand(`EXISTS ${key}`)
      expect(result).toBe(0)
    })

    test('should handle TTL operations', async () => {
      const key = TestUtils.generateTestKey('ttl')
      
      await client.sendCommand(`SET ${key} value`)
      
      // Set TTL
      let result = await client.sendCommand(`EXPIRE ${key} 60`)
      expect(result).toBe(1)
      
      // Check TTL
      result = await client.sendCommand(`TTL ${key}`)
      expect(result).toBeGreaterThan(0)
      expect(result).toBeLessThanOrEqual(60)
      
      // Remove TTL
      result = await client.sendCommand(`PERSIST ${key}`)
      expect(result).toBe(1)
      
      result = await client.sendCommand(`TTL ${key}`)
      expect(result).toBe(-1)
    })

    test('should handle KEYS pattern matching', async () => {
      // Set up test keys
      await client.sendCommand('SET user:1 value1')
      await client.sendCommand('SET user:2 value2')
      await client.sendCommand('SET product:1 product1')
      
      // Get all keys
      let result = await client.sendCommand('KEYS *')
      expect(result).toEqual(expect.arrayContaining(['user:1', 'user:2', 'product:1']))
      
      // Pattern matching
      result = await client.sendCommand('KEYS user:*')
      expect(result).toEqual(expect.arrayContaining(['user:1', 'user:2']))
      expect(result).not.toContain('product:1')
    })
  })

  describe('Database Operations Integration', () => {
    test('should handle DBSIZE operation', async () => {
      // Empty database
      let result = await client.sendCommand('DBSIZE')
      expect(result).toBe(0)
      
      // Add some keys
      await client.sendCommand('SET key1 value1')
      await client.sendCommand('SET key2 value2')
      await client.sendCommand('SET key3 value3')
      
      result = await client.sendCommand('DBSIZE')
      expect(result).toBe(3)
    })

    test('should handle FLUSHDB operation', async () => {
      // Add some keys
      await client.sendCommand('SET key1 value1')
      await client.sendCommand('SET key2 value2')
      
      let result = await client.sendCommand('DBSIZE')
      expect(result).toBe(2)
      
      // Flush database
      result = await client.sendCommand('FLUSHDB')
      expect(result).toBe('OK')
      
      result = await client.sendCommand('DBSIZE')
      expect(result).toBe(0)
    })

    test('should handle TYPE operation', async () => {
      const key = TestUtils.generateTestKey('type_test')
      
      // Non-existent key
      let result = await client.sendCommand(`TYPE ${key}`)
      expect(result).toBe('none')
      
      // String type
      await client.sendCommand(`SET ${key} value`)
      result = await client.sendCommand(`TYPE ${key}`)
      expect(result).toBe('string')
      
      // List type
      await client.sendCommand(`DEL ${key}`)
      await client.sendCommand(`LPUSH ${key} item`)
      result = await client.sendCommand(`TYPE ${key}`)
      expect(result).toBe('list')
    })
  })

  describe('Error Handling Integration', () => {
    test('should handle invalid commands gracefully', async () => {
      try {
        await client.sendCommand('INVALID_COMMAND')
        fail('Should have thrown an error')
      } catch (error) {
        expect(error.message).toContain('unknown command')
      }
    })

    test('should handle wrong argument count', async () => {
      try {
        await client.sendCommand('SET') // Missing arguments
        fail('Should have thrown an error')
      } catch (error) {
        expect(error.message).toContain('wrong number of arguments')
      }
    })

    test('should handle type errors', async () => {
      const key = TestUtils.generateTestKey('type_error')
      
      // Set as string
      await client.sendCommand(`SET ${key} string_value`)
      
      // Try to use as list
      try {
        await client.sendCommand(`LPUSH ${key} item`)
        fail('Should have thrown an error')
      } catch (error) {
        expect(error.message).toContain('WRONGTYPE')
      }
    })
  })

  describe('Performance Integration Tests', () => {
    test('should handle high-frequency commands', async () => {
      const iterations = 100
      const key = TestUtils.generateTestKey('performance')
      
      await client.sendCommand(`SET ${key} 0`)
      
      const { executionTime } = await TestUtils.measureExecutionTime(async () => {
        for (let i = 0; i < iterations; i++) {
          await client.sendCommand(`INCR ${key}`)
        }
      })
      
      const result = await client.sendCommand(`GET ${key}`)
      expect(parseInt(result)).toBe(iterations)
      expect(executionTime).toBeLessThan(5000) // Should complete in under 5 seconds
    })

    test('should handle concurrent connections', async () => {
      const concurrentClients = 10
      const clients = []
      
      // Create multiple clients
      for (let i = 0; i < concurrentClients; i++) {
        const newClient = TestUtils.createTestClient()
        await newClient.connect()
        clients.push(newClient)
      }
      
      try {
        // Execute commands concurrently
        const operations = clients.map((client, index) =>
          client.sendCommand(`SET concurrent_${index} value_${index}`)
        )
        
        const results = await Promise.all(operations)
        expect(results).toHaveLength(concurrentClients)
        results.forEach(result => expect(result).toBe('OK'))
        
        // Verify all keys were set
        for (let i = 0; i < concurrentClients; i++) {
          const result = await clients[0].sendCommand(`GET concurrent_${i}`)
          expect(result).toBe(`value_${i}`)
        }
      } finally {
        // Cleanup clients
        await Promise.all(clients.map(client => client.disconnect()))
      }
    })
  })
})
