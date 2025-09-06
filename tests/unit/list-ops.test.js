/**
 * Unit Tests for ListOps
 */

const ListOps = require('../../src/data-structures/ListOps')
const DataStore = require('../../src/core/DataStore')

describe('ListOps', () => {
  let dataStore
  let listOps

  beforeEach(() => {
    dataStore = new DataStore()
    listOps = new ListOps(dataStore)
  })

  afterEach(async () => {
    dataStore.flushdb()
  })

  describe('LPUSH Operations', () => {
    test('should push elements to the left of list', () => {
      const result = listOps.lpush('mylist', ['a', 'b', 'c'])
      expect(result.success).toBe(true)
      expect(result.value).toBe(3)
    })

    test('should create new list if key does not exist', () => {
      const result = listOps.lpush('newlist', ['first'])
      expect(result.success).toBe(true)
      expect(result.value).toBe(1)
    })

    test('should handle empty elements array', () => {
      const result = listOps.lpush('mylist', [])
      expect(result.success).toBe(false)
      expect(result.error).toContain('wrong number of arguments')
    })
  })

  describe('RPUSH Operations', () => {
    test('should push elements to the right of list', () => {
      const result = listOps.rpush('mylist', ['x', 'y', 'z'])
      expect(result.success).toBe(true)
      expect(result.value).toBe(3)
    })
  })

  describe('LRANGE Operations', () => {
    beforeEach(() => {
      listOps.lpush('testlist', ['a', 'b', 'c'])
    })

    test('should return range of elements', () => {
      const result = listOps.lrange('testlist', 0, -1)
      expect(result.success).toBe(true)
      expect(result.value).toEqual(['c', 'b', 'a'])
    })

    test('should return empty array for non-existent key', () => {
      const result = listOps.lrange('nonexistent', 0, -1)
      expect(result.success).toBe(true)
      expect(result.value).toEqual([])
    })

    test('should handle partial ranges', () => {
      const result = listOps.lrange('testlist', 0, 1)
      expect(result.success).toBe(true)
      expect(result.value).toEqual(['c', 'b'])
    })
  })

  describe('LLEN Operations', () => {
    test('should return list length', () => {
      listOps.lpush('mylist', ['a', 'b', 'c'])
      const result = listOps.llen('mylist')
      expect(result.success).toBe(true)
      expect(result.value).toBe(3)
    })

    test('should return 0 for non-existent key', () => {
      const result = listOps.llen('nonexistent')
      expect(result.success).toBe(true)
      expect(result.value).toBe(0)
    })
  })
})
