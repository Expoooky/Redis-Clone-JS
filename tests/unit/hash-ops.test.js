/**
 * Unit Tests for HashOps
 */

const HashOps = require('../../src/data-structures/HashOps')
const DataStore = require('../../src/core/DataStore')

describe('HashOps', () => {
  let dataStore
  let hashOps

  beforeEach(() => {
    dataStore = new DataStore()
    hashOps = new HashOps(dataStore)
  })

  afterEach(async () => {
    dataStore.flushdb()
  })

  describe('HSET Operations', () => {
    test('should set hash field value', () => {
      const result = hashOps.hset('myhash', ['field1', 'value1'])
      expect(result.success).toBe(true)
      expect(result.value).toBe(1)
    })

    test('should set multiple hash field values', () => {
      const result = hashOps.hset('myhash', ['field1', 'value1', 'field2', 'value2'])
      expect(result.success).toBe(true)
      expect(result.value).toBe(2)
    })

    test('should handle odd number of arguments', () => {
      const result = hashOps.hset('myhash', ['field1', 'value1', 'field2'])
      expect(result.success).toBe(false)
      expect(result.error).toContain('wrong number of arguments')
    })
  })

  describe('HGET Operations', () => {
    beforeEach(() => {
      hashOps.hset('testhash', ['field1', 'value1', 'field2', 'value2'])
    })

    test('should get hash field value', () => {
      const result = hashOps.hget('testhash', 'field1')
      expect(result.success).toBe(true)
      expect(result.value).toBe('value1')
    })

    test('should return null for non-existent field', () => {
      const result = hashOps.hget('testhash', 'nonexistent')
      expect(result.success).toBe(true)
      expect(result.value).toBeNull()
    })

    test('should return null for non-existent hash', () => {
      const result = hashOps.hget('nonexistent', 'field1')
      expect(result.success).toBe(true)
      expect(result.value).toBeNull()
    })
  })

  describe('HGETALL Operations', () => {
    beforeEach(() => {
      hashOps.hset('testhash', ['field1', 'value1', 'field2', 'value2'])
    })

    test('should return all hash fields and values', () => {
      const result = hashOps.hgetall('testhash')
      expect(result.success).toBe(true)
      expect(result.value).toEqual(['field1', 'value1', 'field2', 'value2'])
    })

    test('should return empty array for non-existent hash', () => {
      const result = hashOps.hgetall('nonexistent')
      expect(result.success).toBe(true)
      expect(result.value).toEqual([])
    })
  })

  describe('HDEL Operations', () => {
    beforeEach(() => {
      hashOps.hset('testhash', ['field1', 'value1', 'field2', 'value2', 'field3', 'value3'])
    })

    test('should delete hash fields', () => {
      const result = hashOps.hdel('testhash', ['field1', 'field2'])
      expect(result.success).toBe(true)
      expect(result.value).toBe(2)
    })

    test('should return 0 for non-existent fields', () => {
      const result = hashOps.hdel('testhash', ['nonexistent'])
      expect(result.success).toBe(true)
      expect(result.value).toBe(0)
    })
  })

  describe('HEXISTS Operations', () => {
    beforeEach(() => {
      hashOps.hset('testhash', ['field1', 'value1'])
    })

    test('should return 1 for existing field', () => {
      const result = hashOps.hexists('testhash', 'field1')
      expect(result.success).toBe(true)
      expect(result.value).toBe(1)
    })

    test('should return 0 for non-existent field', () => {
      const result = hashOps.hexists('testhash', 'nonexistent')
      expect(result.success).toBe(true)
      expect(result.value).toBe(0)
    })
  })

  describe('HLEN Operations', () => {
    test('should return hash length', () => {
      hashOps.hset('testhash', ['field1', 'value1', 'field2', 'value2'])
      const result = hashOps.hlen('testhash')
      expect(result.success).toBe(true)
      expect(result.value).toBe(2)
    })

    test('should return 0 for non-existent hash', () => {
      const result = hashOps.hlen('nonexistent')
      expect(result.success).toBe(true)
      expect(result.value).toBe(0)
    })
  })
})
