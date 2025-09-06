/**
 * DataStore Unit Tests - Phase 20
 * 
 * Comprehensive tests for the core DataStore functionality
 * Achieves high test coverage for Phase 20 requirements
 */

const DataStore = require('../../src/core/DataStore')

describe('DataStore Core Operations', () => {
  let dataStore

  beforeEach(() => {
    dataStore = new DataStore()
  })

  afterEach(() => {
    if (dataStore) {
      dataStore.flushdb()
    }
  })

  describe('Initialization and Basic Operations', () => {
    test('should initialize properly', () => {
      expect(dataStore).toBeInstanceOf(DataStore)
      
      const result = dataStore.dbsize()
      expect(result.success).toBe(true)
      expect(result.value).toBe(0)
    })

    test('should handle SET and GET operations', () => {
      const key = TestUtils.generateTestKey('basic')
      const value = TestUtils.generateTestValue()
      
      // SET
      const setResult = dataStore.set(key, value)
      expect(setResult.success).toBe(true)
      expect(setResult.value).toBe('OK')
      
      // GET
      const getResult = dataStore.get(key)
      expect(getResult.success).toBe(true)
      expect(getResult.value).toBe(value)
      
      // DBSIZE
      const sizeResult = dataStore.dbsize()
      expect(sizeResult.value).toBe(1)
    })

    test('should handle EXISTS operations', () => {
      const key = TestUtils.generateTestKey('exists')
      
      // Check non-existent key
      let result = dataStore.exists(key)
      expect(result.success).toBe(true)
      expect(result.value).toBe(0)
      
      // Add key and check again
      dataStore.set(key, 'test_value')
      result = dataStore.exists(key)
      expect(result.success).toBe(true)
      expect(result.value).toBe(1)
    })

    test('should handle DEL operations', () => {
      const key = TestUtils.generateTestKey('delete')
      
      dataStore.set(key, 'test_value')
      expect(dataStore.exists(key).value).toBe(1)
      
      const deleteResult = dataStore.del(key)
      expect(deleteResult.success).toBe(true)
      expect(deleteResult.value).toBe(1)
      
      expect(dataStore.exists(key).value).toBe(0)
    })

    test('should handle multiple keys with KEYS operation', () => {
      const keys = ['test:key1', 'test:key2', 'other:key1']
      keys.forEach(key => dataStore.set(key, 'value'))
      
      // Get all keys
      let result = dataStore.keys('*')
      expect(result.success).toBe(true)
      expect(result.value).toEqual(expect.arrayContaining(keys))
      
      // Pattern matching
      result = dataStore.keys('test:*')
      expect(result.success).toBe(true)
      expect(result.value).toEqual(expect.arrayContaining(['test:key1', 'test:key2']))
      expect(result.value).not.toContain('other:key1')
    })

    test('should handle FLUSHDB operation', () => {
      // Add some data
      for (let i = 0; i < 5; i++) {
        dataStore.set(`key_${i}`, `value_${i}`)
      }
      
      expect(dataStore.dbsize().value).toBe(5)
      
      const flushResult = dataStore.flushdb()
      expect(flushResult.success).toBe(true)
      
      expect(dataStore.dbsize().value).toBe(0)
    })
  })

  describe('TTL and Expiration', () => {
    test('should handle TTL operations', () => {
      const key = TestUtils.generateTestKey('ttl')
      
      dataStore.set(key, 'test_value')
      
      // Set TTL using setExpiration (60 seconds from now)
      const expirationTime = Date.now() + (60 * 1000)
      dataStore.setExpiration(key, expirationTime)
      
      // Check if key exists and is not expired
      expect(dataStore.exists(key).value).toBe(1)
      expect(dataStore.isExpired(key)).toBe(false)
    })

    test('should handle expiration correctly', async () => {
      const key = TestUtils.generateTestKey('expiration')
      
      dataStore.set(key, 'test_value')
      
      // Set expiration to past time (already expired)
      const pastExpirationTime = Date.now() - 1000 // 1 second ago
      dataStore.setExpiration(key, pastExpirationTime)
      
      // Check if expired
      expect(dataStore.isExpired(key)).toBe(true)
    })
  })

  describe('Data Type Operations', () => {
    test('should handle TYPE operation', () => {
      const key = TestUtils.generateTestKey('type')
      
      // Non-existent key
      let result = dataStore.type(key)
      expect(result.success).toBe(true)
      expect(result.value).toBe('none')
      
      // String type
      dataStore.set(key, 'string_value')
      result = dataStore.type(key)
      expect(result.success).toBe(true)
      expect(result.value).toBe('string')
    })

    test('should handle RANDOMKEY operation', () => {
      // Empty database
      let result = dataStore.randomkey()
      expect(result.success).toBe(true)
      expect(result.value).toBeNull()
      
      // Add some keys
      const keys = ['key1', 'key2', 'key3']
      keys.forEach(key => dataStore.set(key, 'value'))
      
      result = dataStore.randomkey()
      expect(result.success).toBe(true)
      expect(keys).toContain(result.value)
    })
  })

  describe('Error Handling', () => {
    test('should handle invalid operations gracefully', () => {
      expect(() => dataStore.get(null)).not.toThrow()
      expect(() => dataStore.set('', '')).not.toThrow()
      expect(() => dataStore.del('nonexistent')).not.toThrow()
    })

    test('should handle edge cases', () => {
      const key = TestUtils.generateTestKey('edge')
      
      // Empty string value
      dataStore.set(key, '')
      const result = dataStore.get(key)
      expect(result.value).toBe('')
      
      // Very long key
      const longKey = 'x'.repeat(1000)
      dataStore.set(longKey, 'value')
      expect(dataStore.get(longKey).value).toBe('value')
      
      // Unicode key and value
      const unicodeKey = '测试🚀'
      const unicodeValue = 'Redis Clone JS 中文'
      dataStore.set(unicodeKey, unicodeValue)
      expect(dataStore.get(unicodeKey).value).toBe(unicodeValue)
    })
  })

  describe('Performance and Scale', () => {
    test('should handle large numbers of keys efficiently', async () => {
      const iterations = 1000
      
      const { executionTime } = await TestUtils.measureExecutionTime(async () => {
        for (let i = 0; i < iterations; i++) {
          dataStore.set(`perf_key_${i}`, `value_${i}`)
        }
      })
      
      expect(dataStore.dbsize().value).toBe(iterations)
      expect(executionTime).toBeLessThan(2000) // Should complete in under 2 seconds
    })

    test('should handle memory usage efficiently', async () => {
      const { memoryDelta } = await TestUtils.measureMemoryUsage(async () => {
        for (let i = 0; i < 100; i++) {
          const key = `memory_test_${i}`
          const value = TestUtils.generateTestValue('string')
          dataStore.set(key, value)
        }
      })
      
      // Memory increase should be reasonable
      expect(memoryDelta.heapUsed).toBeLessThan(10 * 1024 * 1024) // Less than 10MB
    })

    test('should handle concurrent operations', async () => {
      const operations = []
      const concurrentOps = 50
      
      for (let i = 0; i < concurrentOps; i++) {
        operations.push(
          Promise.resolve().then(() => {
            dataStore.set(`concurrent_${i}`, `value_${i}`)
            return dataStore.get(`concurrent_${i}`)
          })
        )
      }
      
      const results = await Promise.all(operations)
      expect(results).toHaveLength(concurrentOps)
      results.forEach((result, index) => {
        expect(result.success).toBe(true)
        expect(result.value).toBe(`value_${index}`)
      })
    })
  })
})
