/**
 * StringOps Unit Tests - Phase 20
 * 
 * Comprehensive tests for StringOps functionality
 */

const DataStore = require('../../src/core/DataStore')
const StringOps = require('../../src/data-structures/StringOps')

describe('StringOps Operations', () => {
  let dataStore
  let stringOps

  beforeEach(() => {
    dataStore = new DataStore()
    stringOps = new StringOps(dataStore)
  })

  afterEach(() => {
    if (dataStore) {
      dataStore.flushdb()
    }
  })

  describe('Basic String Operations', () => {
    test('should handle SET and GET operations', () => {
      const key = TestUtils.generateTestKey('string')
      const value = 'Hello Redis Clone'
      
      // SET
      let result = stringOps.set(key, value)
      expect(result.success).toBe(true)
      expect(result.value).toBe('OK')
      
      // GET
      result = stringOps.get(key)
      expect(result.success).toBe(true)
      expect(result.value).toBe(value)
    })

    test('should handle STRLEN operation', () => {
      const key = TestUtils.generateTestKey('strlen')
      const value = 'Hello World'
      
      stringOps.set(key, value)
      
      const result = stringOps.strlen(key)
      expect(result.success).toBe(true)
      expect(result.value).toBe(value.length)
    })

    test('should handle APPEND operation', () => {
      const key = TestUtils.generateTestKey('append')
      
      stringOps.set(key, 'Hello')
      
      const appendResult = stringOps.append(key, ' World')
      expect(appendResult.success).toBe(true)
      expect(appendResult.value).toBe(11) // New length
      
      const getValue = stringOps.get(key)
      expect(getValue.value).toBe('Hello World')
    })

    test('should handle GETRANGE operation', () => {
      const key = TestUtils.generateTestKey('getrange')
      const value = 'Hello Redis World'
      
      stringOps.set(key, value)
      
      // Get substring
      let result = stringOps.getrange(key, 0, 4)
      expect(result.success).toBe(true)
      expect(result.value).toBe('Hello')
      
      // Get from middle
      result = stringOps.getrange(key, 6, 10)
      expect(result.success).toBe(true)
      expect(result.value).toBe('Redis')
      
      // Negative indices
      result = stringOps.getrange(key, -5, -1)
      expect(result.success).toBe(true)
      expect(result.value).toBe('World')
    })

    test('should handle SETRANGE operation', () => {
      const key = TestUtils.generateTestKey('setrange')
      
      stringOps.set(key, 'Hello World')
      
      const result = stringOps.setrange(key, 6, 'Redis')
      expect(result.success).toBe(true)
      
      const getValue = stringOps.get(key)
      expect(getValue.value).toBe('Hello Redis')
    })
  })

  describe('Numeric Operations', () => {
    test('should handle INCR operation', () => {
      const key = TestUtils.generateTestKey('incr')
      
      stringOps.set(key, '10')
      
      const result = stringOps.incr(key)
      expect(result.success).toBe(true)
      expect(result.value).toBe(11)
      
      // Check that value is updated
      const getValue = stringOps.get(key)
      expect(getValue.value).toBe('11')
    })

    test('should handle DECR operation', () => {
      const key = TestUtils.generateTestKey('decr')
      
      stringOps.set(key, '10')
      
      const result = stringOps.decr(key)
      expect(result.success).toBe(true)
      expect(result.value).toBe(9)
    })

    test('should handle INCRBY operation', () => {
      const key = TestUtils.generateTestKey('incrby')
      
      stringOps.set(key, '10')
      
      const result = stringOps.incrby(key, 5)
      expect(result.success).toBe(true)
      expect(result.value).toBe(15)
    })

    test('should handle DECRBY operation', () => {
      const key = TestUtils.generateTestKey('decrby')
      
      stringOps.set(key, '10')
      
      const result = stringOps.decrby(key, 3)
      expect(result.success).toBe(true)
      expect(result.value).toBe(7)
    })

    test('should handle INCRBYFLOAT operation', () => {
      const key = TestUtils.generateTestKey('incrbyfloat')
      
      stringOps.set(key, '10.5')
      
      const result = stringOps.incrbyfloat(key, 2.1)
      expect(result.success).toBe(true)
      expect(parseFloat(result.value)).toBeCloseTo(12.6)
    })
  })

  describe('Multiple Key Operations', () => {
    test('should handle MSET operation', () => {
      const keyValueArray = [
        'mset:key1', 'value1',
        'mset:key2', 'value2', 
        'mset:key3', 'value3'
      ]
      
      const result = stringOps.mset(keyValueArray)
      expect(result.success).toBe(true)
      expect(result.value).toBe('OK')
      
      // Verify all keys were set
      const keys = ['mset:key1', 'mset:key2', 'mset:key3']
      const values = ['value1', 'value2', 'value3']
      
      keys.forEach((key, index) => {
        const getValue = stringOps.get(key)
        expect(getValue.value).toBe(values[index])
      })
    })

    test('should handle MGET operation', () => {
      const keyValues = {
        'mget:key1': 'value1',
        'mget:key2': 'value2',
        'mget:key3': 'value3'
      }
      
      // Set the keys
      Object.entries(keyValues).forEach(([key, value]) => {
        stringOps.set(key, value)
      })
      
      const keys = Object.keys(keyValues)
      const result = stringOps.mget(keys)
      expect(result.success).toBe(true)
      expect(result.value).toEqual(['value1', 'value2', 'value3'])
    })
  })

  describe('Error Handling', () => {
    test('should handle non-existent keys', () => {
      const key = TestUtils.generateTestKey('nonexistent')
      
      const result = stringOps.get(key)
      expect(result.success).toBe(true)
      expect(result.value).toBeNull()
    })

    test('should handle invalid numeric operations', () => {
      const key = TestUtils.generateTestKey('invalid_numeric')
      
      stringOps.set(key, 'not_a_number')
      
      const result = stringOps.incr(key)
      expect(result.success).toBe(false)
      expect(result.error).toContain('not an integer')
    })

    test('should handle edge cases', () => {
      const key = TestUtils.generateTestKey('edge_cases')
      
      // Empty string
      stringOps.set(key, '')
      let result = stringOps.get(key)
      expect(result.value).toBe('')
      
      // Unicode characters
      const unicodeValue = '🚀 Redis Clone JS 中文'
      stringOps.set(key, unicodeValue)
      result = stringOps.get(key)
      expect(result.value).toBe(unicodeValue)
      
      // Very long string
      const longString = 'x'.repeat(10000)
      stringOps.set(key, longString)
      result = stringOps.get(key)
      expect(result.value).toBe(longString)
    })
  })

  describe('Performance Tests', () => {
    test('should handle high-frequency operations efficiently', async () => {
      const key = TestUtils.generateTestKey('performance')
      const iterations = 100
      
      stringOps.set(key, '0')
      
      const { executionTime } = await TestUtils.measureExecutionTime(async () => {
        for (let i = 0; i < iterations; i++) {
          stringOps.incr(key)
        }
      })
      
      const result = stringOps.get(key)
      expect(parseInt(result.value)).toBe(iterations)
      expect(executionTime).toBeLessThan(1000) // Should complete in under 1 second
    })
  })
})
