/**
 * Unit Tests for SetOps
 */

const SetOps = require('../../src/data-structures/SetOps')
const DataStore = require('../../src/core/DataStore')

describe('SetOps', () => {
  let dataStore
  let setOps

  beforeEach(() => {
    dataStore = new DataStore()
    setOps = new SetOps(dataStore)
  })

  afterEach(async () => {
    dataStore.flushdb()
  })

  describe('SADD Operations', () => {
    test('should add members to set', () => {
      const result = setOps.sadd('myset', ['member1', 'member2', 'member3'])
      expect(result.success).toBe(true)
      expect(result.value).toBe(3)
    })

    test('should not add duplicate members', () => {
      setOps.sadd('myset', ['member1', 'member2'])
      const result = setOps.sadd('myset', ['member1', 'member3'])
      expect(result.success).toBe(true)
      expect(result.value).toBe(1) // Only member3 is new
    })

    test('should handle empty members array', () => {
      const result = setOps.sadd('myset', [])
      expect(result.success).toBe(false)
      expect(result.error).toContain('wrong number of arguments')
    })
  })

  describe('SMEMBERS Operations', () => {
    beforeEach(() => {
      setOps.sadd('testset', ['a', 'b', 'c'])
    })

    test('should return all set members', () => {
      const result = setOps.smembers('testset')
      expect(result.success).toBe(true)
      expect(result.value).toHaveLength(3)
      expect(result.value).toContain('a')
      expect(result.value).toContain('b')
      expect(result.value).toContain('c')
    })

    test('should return empty array for non-existent set', () => {
      const result = setOps.smembers('nonexistent')
      expect(result.success).toBe(true)
      expect(result.value).toEqual([])
    })
  })

  describe('SISMEMBER Operations', () => {
    beforeEach(() => {
      setOps.sadd('testset', ['member1', 'member2'])
    })

    test('should return 1 for existing member', () => {
      const result = setOps.sismember('testset', 'member1')
      expect(result.success).toBe(true)
      expect(result.value).toBe(1)
    })

    test('should return 0 for non-existent member', () => {
      const result = setOps.sismember('testset', 'nonexistent')
      expect(result.success).toBe(true)
      expect(result.value).toBe(0)
    })
  })

  describe('SREM Operations', () => {
    beforeEach(() => {
      setOps.sadd('testset', ['member1', 'member2', 'member3'])
    })

    test('should remove members from set', () => {
      const result = setOps.srem('testset', ['member1', 'member2'])
      expect(result.success).toBe(true)
      expect(result.value).toBe(2)
    })

    test('should return 0 for non-existent members', () => {
      const result = setOps.srem('testset', ['nonexistent'])
      expect(result.success).toBe(true)
      expect(result.value).toBe(0)
    })
  })

  describe('SCARD Operations', () => {
    test('should return set cardinality', () => {
      setOps.sadd('testset', ['a', 'b', 'c'])
      const result = setOps.scard('testset')
      expect(result.success).toBe(true)
      expect(result.value).toBe(3)
    })

    test('should return 0 for non-existent set', () => {
      const result = setOps.scard('nonexistent')
      expect(result.success).toBe(true)
      expect(result.value).toBe(0)
    })
  })

  describe('Set Operations', () => {
    beforeEach(() => {
      setOps.sadd('set1', ['a', 'b', 'c'])
      setOps.sadd('set2', ['b', 'c', 'd'])
    })

    test('SUNION should return union of sets', () => {
      const result = setOps.sunion(['set1', 'set2'])
      expect(result.success).toBe(true)
      expect(result.value).toHaveLength(4)
      expect(result.value).toContain('a')
      expect(result.value).toContain('b')
      expect(result.value).toContain('c')
      expect(result.value).toContain('d')
    })

    test('SINTER should return intersection of sets', () => {
      const result = setOps.sinter(['set1', 'set2'])
      expect(result.success).toBe(true)
      expect(result.value).toHaveLength(2)
      expect(result.value).toContain('b')
      expect(result.value).toContain('c')
    })

    test('SDIFF should return difference of sets', () => {
      const result = setOps.sdiff(['set1', 'set2'])
      expect(result.success).toBe(true)
      expect(result.value).toHaveLength(1)
      expect(result.value).toContain('a')
    })
  })
})
