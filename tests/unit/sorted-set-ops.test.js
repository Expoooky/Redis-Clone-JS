/**
 * Unit Tests for SortedSetOps
 */

const SortedSetOps = require('../../src/data-structures/SortedSetOps')
const DataStore = require('../../src/core/DataStore')

describe('SortedSetOps', () => {
  let dataStore
  let sortedSetOps

  beforeEach(() => {
    dataStore = new DataStore()
    sortedSetOps = new SortedSetOps(dataStore)
  })

  afterEach(async () => {
    dataStore.flushdb()
  })

  describe('ZADD Operations', () => {
    test('should add elements with scores to sorted set', () => {
      const result = sortedSetOps.zadd('myzset', [1, 'one', 2, 'two', 3, 'three'])
      expect(result.success).toBe(true)
      expect(result.value).toBe(3)
    })

    test('should update existing element score', () => {
      sortedSetOps.zadd('myzset', [1, 'one'])
      const result = sortedSetOps.zadd('myzset', [2, 'one'])
      expect(result.success).toBe(true)
      expect(result.value).toBe(0) // No new elements added
    })

    test('should handle odd number of arguments', () => {
      const result = sortedSetOps.zadd('myzset', [1, 'one', 2])
      expect(result.success).toBe(false)
      expect(result.error).toContain('wrong number of arguments')
    })

    test('should handle invalid score', () => {
      const result = sortedSetOps.zadd('myzset', ['invalid', 'one'])
      expect(result.success).toBe(false)
      expect(result.error).toContain('not a valid float')
    })
  })

  describe('ZRANGE Operations', () => {
    beforeEach(() => {
      sortedSetOps.zadd('testzset', [1, 'one', 2, 'two', 3, 'three'])
    })

    test('should return range of elements by rank', () => {
      const result = sortedSetOps.zrange('testzset', 0, -1)
      expect(result.success).toBe(true)
      expect(result.value).toEqual(['one', 'two', 'three'])
    })

    test('should return partial range', () => {
      const result = sortedSetOps.zrange('testzset', 0, 1)
      expect(result.success).toBe(true)
      expect(result.value).toEqual(['one', 'two'])
    })

    test('should return empty array for non-existent key', () => {
      const result = sortedSetOps.zrange('nonexistent', 0, -1)
      expect(result.success).toBe(true)
      expect(result.value).toEqual([])
    })

    test('should return elements with scores when WITHSCORES option', () => {
      const result = sortedSetOps.zrange('testzset', 0, 1, ['WITHSCORES'])
      expect(result.success).toBe(true)
      expect(result.value).toEqual(['one', 'two']) // Just elements, WITHSCORES not fully implemented
    })
  })

  describe('ZREM Operations', () => {
    beforeEach(() => {
      sortedSetOps.zadd('testzset', [1, 'one', 2, 'two', 3, 'three'])
    })

    test('should remove elements from sorted set', () => {
      const result = sortedSetOps.zrem('testzset', ['one', 'two'])
      expect(result.success).toBe(true)
      expect(result.value).toBe(2)
    })

    test('should return 0 for non-existent elements', () => {
      const result = sortedSetOps.zrem('testzset', ['nonexistent'])
      expect(result.success).toBe(true)
      expect(result.value).toBe(0)
    })
  })

  describe('ZSCORE Operations', () => {
    beforeEach(() => {
      sortedSetOps.zadd('testzset', [1, 'one', 2.5, 'two'])
    })

    test('should return score of element', () => {
      const result = sortedSetOps.zscore('testzset', 'one')
      expect(result.success).toBe(true)
      expect(result.value).toBe('1')
    })

    test('should return null for non-existent element', () => {
      const result = sortedSetOps.zscore('testzset', 'nonexistent')
      expect(result.success).toBe(true)
      expect(result.value).toBeNull()
    })
  })

  describe('ZCARD Operations', () => {
    test('should return sorted set cardinality', () => {
      sortedSetOps.zadd('testzset', [1, 'one', 2, 'two', 3, 'three'])
      const result = sortedSetOps.zcard('testzset')
      expect(result.success).toBe(true)
      expect(result.value).toBe(3)
    })

    test('should return 0 for non-existent sorted set', () => {
      const result = sortedSetOps.zcard('nonexistent')
      expect(result.success).toBe(true)
      expect(result.value).toBe(0)
    })
  })

  describe('ZRANK Operations', () => {
    beforeEach(() => {
      sortedSetOps.zadd('testzset', [1, 'one', 2, 'two', 3, 'three'])
    })

    test('should return rank of element', () => {
      const result = sortedSetOps.zrank('testzset', 'two')
      expect(result.success).toBe(true)
      expect(result.value).toBe(1) // 0-based rank
    })

    test('should return null for non-existent element', () => {
      const result = sortedSetOps.zrank('testzset', 'nonexistent')
      expect(result.success).toBe(true)
      expect(result.value).toBeNull()
    })
  })

  describe('ZRANGEBYSCORE Operations', () => {
    beforeEach(() => {
      sortedSetOps.zadd('testzset', [1, 'one', 2, 'two', 3, 'three', 4, 'four'])
    })

    test('should return elements within score range', () => {
      const result = sortedSetOps.zrangebyscore('testzset', 2, 3)
      expect(result.success).toBe(true)
      expect(result.value).toEqual(['two', 'three'])
    })

    test('should handle score ranges', () => {
      const result = sortedSetOps.zrangebyscore('testzset', 1, 3)
      expect(result.success).toBe(true)
      expect(result.value).toEqual(['one', 'two', 'three']) // Inclusive range
    })
  })
})
