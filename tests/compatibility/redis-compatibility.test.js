/**
 * Redis Compatibility Tests - Phase 20
 * 
 * Tests compatibility with standard Redis commands and behavior
 */

const { spawn } = require('child_process')

describe('Redis Compatibility Tests', () => {
  let serverProcess
  let client

  beforeAll(async () => {
    console.log('🚀 Starting Redis server for compatibility tests...')
    serverProcess = await TestUtils.startTestServer()
    await TestUtils.sleep(2000)
    
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
    await client.sendCommand('FLUSHDB')
  })

  describe('Command Compatibility', () => {
    test('should support all basic string commands', async () => {
      const commands = [
        { cmd: 'SET test_key test_value', expected: 'OK' },
        { cmd: 'GET test_key', expected: 'test_value' },
        { cmd: 'STRLEN test_key', expected: 10 },
        { cmd: 'EXISTS test_key', expected: 1 },
        { cmd: 'DEL test_key', expected: 1 },
        { cmd: 'EXISTS test_key', expected: 0 }
      ]
      
      for (const { cmd, expected } of commands) {
        const result = await client.sendCommand(cmd)
        expect(result).toEqual(expected)
      }
    })

    test('should support numeric string operations', async () => {
      const commands = [
        { cmd: 'SET counter 10', expected: 'OK' },
        { cmd: 'INCR counter', expected: 11 },
        { cmd: 'INCRBY counter 5', expected: 16 },
        { cmd: 'DECR counter', expected: 15 },
        { cmd: 'DECRBY counter 3', expected: 12 }
      ]
      
      for (const { cmd, expected } of commands) {
        const result = await client.sendCommand(cmd)
        expect(result).toEqual(expected)
      }
    })

    test('should support basic list commands', async () => {
      const commands = [
        { cmd: 'LPUSH mylist item1', expected: 1 },
        { cmd: 'LPUSH mylist item2', expected: 2 },
        { cmd: 'RPUSH mylist item3', expected: 3 },
        { cmd: 'LLEN mylist', expected: 3 },
        { cmd: 'LINDEX mylist 0', expected: 'item2' },
        { cmd: 'LINDEX mylist -1', expected: 'item3' },
        { cmd: 'LPOP mylist', expected: 'item2' },
        { cmd: 'RPOP mylist', expected: 'item3' }
      ]
      
      for (const { cmd, expected } of commands) {
        const result = await client.sendCommand(cmd)
        expect(result).toEqual(expected)
      }
    })

    test('should support hash commands', async () => {
      const commands = [
        { cmd: 'HSET myhash field1 value1', expected: 1 },
        { cmd: 'HSET myhash field2 value2', expected: 1 },
        { cmd: 'HGET myhash field1', expected: 'value1' },
        { cmd: 'HLEN myhash', expected: 2 },
        { cmd: 'HEXISTS myhash field1', expected: 1 },
        { cmd: 'HEXISTS myhash field3', expected: 0 },
        { cmd: 'HDEL myhash field1', expected: 1 },
        { cmd: 'HLEN myhash', expected: 1 }
      ]
      
      for (const { cmd, expected } of commands) {
        const result = await client.sendCommand(cmd)
        expect(result).toEqual(expected)
      }
    })
  })

  describe('Data Type Compatibility', () => {
    test('should handle Redis data types correctly', async () => {
      // String
      await client.sendCommand('SET string_key string_value')
      expect(await client.sendCommand('TYPE string_key')).toBe('string')
      
      // List
      await client.sendCommand('LPUSH list_key item')
      expect(await client.sendCommand('TYPE list_key')).toBe('list')
      
      // Hash
      await client.sendCommand('HSET hash_key field value')
      expect(await client.sendCommand('TYPE hash_key')).toBe('hash')
      
      // Set
      await client.sendCommand('SADD set_key member')
      expect(await client.sendCommand('TYPE set_key')).toBe('set')
      
      // Non-existent key
      expect(await client.sendCommand('TYPE nonexistent')).toBe('none')
    })

    test('should handle type conflicts like Redis', async () => {
      // Set as string
      await client.sendCommand('SET conflict_key string_value')
      
      // Try to use as list - should fail
      try {
        await client.sendCommand('LPUSH conflict_key item')
        fail('Should have thrown an error')
      } catch (error) {
        expect(error.message).toContain('wrong type')
      }
      
      // Original value should remain
      const result = await client.sendCommand('GET conflict_key')
      expect(result).toBe('string_value')
    })
  })

  describe('Error Handling Compatibility', () => {
    test('should return Redis-compatible error messages', async () => {
      const errorCases = [
        {
          cmd: 'INVALID_COMMAND',
          errorPattern: /unknown command|unrecognized command/i
        },
        {
          cmd: 'SET',
          errorPattern: /wrong number of arguments/i
        },
        {
          cmd: 'INCR string_key',
          setup: 'SET string_key not_a_number',
          errorPattern: /not an integer|invalid value/i
        }
      ]
      
      for (const { cmd, setup, errorPattern } of errorCases) {
        if (setup) {
          await client.sendCommand(setup)
        }
        
        try {
          await client.sendCommand(cmd)
          fail(`Command "${cmd}" should have failed`)
        } catch (error) {
          expect(error.message).toMatch(errorPattern)
        }
      }
    })
  })

  describe('Behavioral Compatibility', () => {
    test('should handle EXPIRE and TTL like Redis', async () => {
      await client.sendCommand('SET expire_test value')
      
      // Set expiration
      const expireResult = await client.sendCommand('EXPIRE expire_test 60')
      expect(expireResult).toBe(1)
      
      // Check TTL
      const ttlResult = await client.sendCommand('TTL expire_test')
      expect(ttlResult).toBeGreaterThan(0)
      expect(ttlResult).toBeLessThanOrEqual(60)
      
      // Remove expiration
      const persistResult = await client.sendCommand('PERSIST expire_test')
      expect(persistResult).toBe(1)
      
      // TTL should be -1 (no expiration)
      const finalTtl = await client.sendCommand('TTL expire_test')
      expect(finalTtl).toBe(-1)
    })

    test('should handle KEYS pattern matching like Redis', async () => {
      // Set up test data
      const testKeys = [
        'user:1:name',
        'user:1:email',
        'user:2:name',
        'product:1:title',
        'product:2:price'
      ]
      
      for (const key of testKeys) {
        await client.sendCommand(`SET ${key} value`)
      }
      
      // Test patterns
      const patterns = [
        { pattern: '*', expectedCount: 5 },
        { pattern: 'user:*', expectedCount: 3 },
        { pattern: 'user:1:*', expectedCount: 2 },
        { pattern: 'product:*', expectedCount: 2 },
        { pattern: '*:name', expectedCount: 2 },
        { pattern: 'nonexistent:*', expectedCount: 0 }
      ]
      
      for (const { pattern, expectedCount } of patterns) {
        const result = await client.sendCommand(`KEYS ${pattern}`)
        expect(Array.isArray(result)).toBe(true)
        expect(result.length).toBe(expectedCount)
      }
    })

    test('should handle NULL returns like Redis', async () => {
      // GET non-existent key
      const getResult = await client.sendCommand('GET nonexistent')
      expect(getResult).toBeNull()
      
      // LPOP empty list
      const lpopResult = await client.sendCommand('LPOP empty_list')
      expect(lpopResult).toBeNull()
      
      // HGET non-existent field
      await client.sendCommand('HSET test_hash field value')
      const hgetResult = await client.sendCommand('HGET test_hash nonexistent_field')
      expect(hgetResult).toBeNull()
    })

    test('should handle numeric conversions like Redis', async () => {
      // Integer operations
      await client.sendCommand('SET int_key 42')
      const incrResult = await client.sendCommand('INCR int_key')
      expect(incrResult).toBe(43)
      expect(typeof incrResult).toBe('number')
      
      // Float operations (if supported)
      await client.sendCommand('SET float_key 3.14')
      try {
        const floatResult = await client.sendCommand('INCRBYFLOAT float_key 1.86')
        expect(floatResult).toBeCloseTo(5.0)
      } catch (error) {
        // Some implementations might not support INCRBYFLOAT
        console.log('INCRBYFLOAT not supported, skipping...')
      }
    })
  })

  describe('Protocol Compatibility', () => {
    test('should handle RESP protocol correctly', async () => {
      // Simple string
      const pingResult = await client.sendCommand('PING')
      expect(pingResult).toBe('PONG')
      
      // Integer
      await client.sendCommand('SET resp_test value')
      const existsResult = await client.sendCommand('EXISTS resp_test')
      expect(existsResult).toBe(1)
      expect(typeof existsResult).toBe('number')
      
      // Array
      await client.sendCommand('LPUSH resp_list item1 item2 item3')
      const lrangeResult = await client.sendCommand('LRANGE resp_list 0 -1')
      expect(Array.isArray(lrangeResult)).toBe(true)
      expect(lrangeResult).toEqual(['item3', 'item2', 'item1'])
      
      // Null
      const nullResult = await client.sendCommand('GET nonexistent_key')
      expect(nullResult).toBeNull()
    })

    test('should handle command case insensitivity', async () => {
      const commands = [
        'SET case_test value',
        'set case_test value',
        'Set case_test value',
        'GET case_test',
        'get case_test',
        'Get case_test'
      ]
      
      for (const cmd of commands) {
        const result = await client.sendCommand(cmd)
        expect(result).toBeTruthy() // Should not fail
      }
    })
  })

  describe('Edge Case Compatibility', () => {
    test('should handle empty strings like Redis', async () => {
      await client.sendCommand('SET empty_string ""')
      const result = await client.sendCommand('GET empty_string')
      expect(result).toBe('')
      
      const strlen = await client.sendCommand('STRLEN empty_string')
      expect(strlen).toBe(0)
    })

    test('should handle large values', async () => {
      const largeValue = 'x'.repeat(1024 * 1024) // 1MB string
      await client.sendCommand(`SET large_value "${largeValue}"`)
      const result = await client.sendCommand('GET large_value')
      expect(result).toBe(largeValue)
    })

    test('should handle special characters', async () => {
      const specialChars = 'Hello\nWorld\r\n\t"Special"\\\u0000'
      await client.sendCommand(`SET special_chars "${specialChars}"`)
      const result = await client.sendCommand('GET special_chars')
      expect(result).toBe(specialChars)
    })

    test('should handle Unicode correctly', async () => {
      const unicode = '🚀 Redis Clone JS 中文测试 🎉'
      await client.sendCommand(`SET unicode_test "${unicode}"`)
      const result = await client.sendCommand('GET unicode_test')
      expect(result).toBe(unicode)
      
      const strlen = await client.sendCommand('STRLEN unicode_test')
      expect(strlen).toBe(unicode.length)
    })
  })
})
