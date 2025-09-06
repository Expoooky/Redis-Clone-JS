/**
 * Cuckoo Filter Tests - Advanced Probabilistic Data Structure
 * 
 * Tests for the newly implemented Cuckoo Filter functionality
 */

const { spawn } = require('child_process')

describe('Cuckoo Filter Tests', () => {
  let serverProcess
  let client

  beforeAll(async () => {
    console.log('🚀 Starting Redis server for Cuckoo Filter tests...')
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

  describe('Basic Cuckoo Filter Operations', () => {
    test('should create and use a cuckoo filter', async () => {
      const filterKey = 'test_cuckoo_filter'
      
      // Reserve a cuckoo filter
      const reserveResult = await client.sendCommand(`CF.RESERVE ${filterKey} 1000`)
      expect(reserveResult).toBe('OK')
      
      // Add elements
      const addResult1 = await client.sendCommand(`CF.ADD ${filterKey} element1`)
      expect(parseInt(addResult1)).toBe(1)
      
      const addResult2 = await client.sendCommand(`CF.ADD ${filterKey} element2`)
      expect(parseInt(addResult2)).toBe(1)
      
      // Check existence
      const existsResult1 = await client.sendCommand(`CF.EXISTS ${filterKey} element1`)
      expect(parseInt(existsResult1)).toBe(1)
      
      const existsResult2 = await client.sendCommand(`CF.EXISTS ${filterKey} element2`)
      expect(parseInt(existsResult2)).toBe(1)
      
      const existsResult3 = await client.sendCommand(`CF.EXISTS ${filterKey} nonexistent`)
      expect(parseInt(existsResult3)).toBe(0)
      
      // Get count
      const countResult = await client.sendCommand(`CF.COUNT ${filterKey}`)
      expect(parseInt(countResult)).toBe(2)
    })

    test('should support deletion from cuckoo filter', async () => {
      const filterKey = 'deletion_test_filter'
      
      await client.sendCommand(`CF.RESERVE ${filterKey} 1000`)
      
      // Add elements
      await client.sendCommand(`CF.ADD ${filterKey} element1`)
      await client.sendCommand(`CF.ADD ${filterKey} element2`)
      await client.sendCommand(`CF.ADD ${filterKey} element3`)
      
      // Verify existence
      let exists = await client.sendCommand(`CF.EXISTS ${filterKey} element2`)
      expect(parseInt(exists)).toBe(1)
      
      // Delete element
      const deleteResult = await client.sendCommand(`CF.DEL ${filterKey} element2`)
      expect(parseInt(deleteResult)).toBe(1)
      
      // Verify deletion
      exists = await client.sendCommand(`CF.EXISTS ${filterKey} element2`)
      expect(parseInt(exists)).toBe(0)
      
      // Other elements should still exist
      exists = await client.sendCommand(`CF.EXISTS ${filterKey} element1`)
      expect(parseInt(exists)).toBe(1)
      
      exists = await client.sendCommand(`CF.EXISTS ${filterKey} element3`)
      expect(parseInt(exists)).toBe(1)
      
      // Count should be reduced
      const count = await client.sendCommand(`CF.COUNT ${filterKey}`)
      expect(parseInt(count)).toBe(2)
    })

    test('should provide filter information', async () => {
      const filterKey = 'info_test_filter'
      
      await client.sendCommand(`CF.RESERVE ${filterKey} 10000 4 500`)
      
      // Add some elements
      for (let i = 0; i < 100; i++) {
        await client.sendCommand(`CF.ADD ${filterKey} element${i}`)
      }
      
      // Get filter info
      const infoResult = await client.sendCommand(`CF.INFO ${filterKey}`)
      expect(Array.isArray(infoResult)).toBe(true)
      expect(infoResult.length).toBeGreaterThan(0)
      
      // Should contain capacity information
      const infoStr = infoResult.join(' ')
      expect(infoStr).toContain('Capacity')
      expect(infoStr).toContain('Size')
    })
  })

  describe('Cuckoo Filter Performance', () => {
    test('should handle large number of elements efficiently', async () => {
      const filterKey = 'performance_filter'
      const elementCount = 10000
      
      await client.sendCommand(`CF.RESERVE ${filterKey} ${elementCount * 2}`)
      
      console.log(`🔄 Adding ${elementCount} elements to cuckoo filter...`)
      
      const { executionTime } = await TestUtils.measureExecutionTime(async () => {
        for (let i = 0; i < elementCount; i++) {
          await client.sendCommand(`CF.ADD ${filterKey} element${i}`)
          
          if (i % 1000 === 0) {
            console.log(`   Progress: ${i}/${elementCount}`)
          }
        }
      })
      
      console.log(`✅ Added ${elementCount} elements in ${executionTime}ms`)
      
      // Verify count
      const count = await client.sendCommand(`CF.COUNT ${filterKey}`)
      expect(parseInt(count)).toBe(elementCount)
      
      // Test lookup performance
      console.log(`🔍 Testing lookup performance...`)
      
      const { executionTime: lookupTime } = await TestUtils.measureExecutionTime(async () => {
        for (let i = 0; i < 1000; i++) {
          const randomElement = `element${Math.floor(Math.random() * elementCount)}`
          const exists = await client.sendCommand(`CF.EXISTS ${filterKey} ${randomElement}`)
          expect(parseInt(exists)).toBe(1)
        }
      })
      
      console.log(`✅ 1000 lookups completed in ${lookupTime}ms`)
      
      // Performance expectations
      expect(executionTime).toBeLessThan(60000) // Should complete in under 60 seconds
      expect(lookupTime).toBeLessThan(5000) // 1000 lookups in under 5 seconds
    }, 120000)

    test('should handle concurrent operations', async () => {
      const filterKey = 'concurrent_filter'
      
      await client.sendCommand(`CF.RESERVE ${filterKey} 10000`)
      
      const concurrentOperations = 100
      const promises = []
      
      // Concurrent additions
      for (let i = 0; i < concurrentOperations; i++) {
        const promise = (async () => {
          try {
            await client.sendCommand(`CF.ADD ${filterKey} concurrent_element${i}`)
            return true
          } catch (error) {
            return false
          }
        })()
        promises.push(promise)
      }
      
      const results = await Promise.all(promises)
      const successCount = results.filter(result => result).length
      
      console.log(`📊 Concurrent operations: ${successCount}/${concurrentOperations} successful`)
      
      // Should have high success rate
      expect(successCount).toBeGreaterThan(concurrentOperations * 0.9) // 90% success rate
      
      // Verify elements exist
      for (let i = 0; i < Math.min(10, concurrentOperations); i++) {
        const exists = await client.sendCommand(`CF.EXISTS ${filterKey} concurrent_element${i}`)
        expect(parseInt(exists)).toBe(1)
      }
    })
  })

  describe('Error Handling', () => {
    test('should handle invalid operations gracefully', async () => {
      // Test operations on non-existent filter
      try {
        await client.sendCommand('CF.EXISTS nonexistent_filter element')
        // Should return 0, not error
      } catch (error) {
        fail('Should not throw error for non-existent filter')
      }
      
      // Test invalid arguments
      try {
        await client.sendCommand('CF.ADD') // Missing arguments
        fail('Should throw error for missing arguments')
      } catch (error) {
        expect(error.message).toContain('wrong number of arguments')
      }
      
      // Test duplicate reserve
      const filterKey = 'duplicate_filter'
      await client.sendCommand(`CF.RESERVE ${filterKey} 1000`)
      
      try {
        await client.sendCommand(`CF.RESERVE ${filterKey} 1000`)
        fail('Should throw error for duplicate reserve')
      } catch (error) {
        expect(error.message).toContain('item exists')
      }
    })
  })

  describe('Comparison with Bloom Filter', () => {
    test('should demonstrate deletion capability advantage', async () => {
      const cuckooKey = 'cuckoo_comparison'
      const bloomKey = 'bloom_comparison'
      
      // Create both filters
      await client.sendCommand(`CF.RESERVE ${cuckooKey} 1000`)
      await client.sendCommand(`BF.RESERVE ${bloomKey} 0.01 1000`)
      
      // Add elements to both
      const elements = ['element1', 'element2', 'element3']
      
      for (const element of elements) {
        await client.sendCommand(`CF.ADD ${cuckooKey} ${element}`)
        await client.sendCommand(`BF.ADD ${bloomKey} ${element}`)
      }
      
      // Verify elements exist in both
      for (const element of elements) {
        const cuckooExists = await client.sendCommand(`CF.EXISTS ${cuckooKey} ${element}`)
        const bloomExists = await client.sendCommand(`BF.EXISTS ${bloomKey} ${element}`)
        
        expect(parseInt(cuckooExists)).toBe(1)
        expect(parseInt(bloomExists)).toBe(1)
      }
      
      // Delete from cuckoo filter (bloom filter doesn't support deletion)
      const deleteResult = await client.sendCommand(`CF.DEL ${cuckooKey} element2`)
      expect(parseInt(deleteResult)).toBe(1)
      
      // Verify deletion in cuckoo filter
      const cuckooExists = await client.sendCommand(`CF.EXISTS ${cuckooKey} element2`)
      expect(parseInt(cuckooExists)).toBe(0)
      
      // Element still exists in bloom filter (no deletion support)
      const bloomExists = await client.sendCommand(`BF.EXISTS ${bloomKey} element2`)
      expect(parseInt(bloomExists)).toBe(1)
      
      console.log('✅ Cuckoo filter successfully demonstrated deletion capability')
    })
  })
})
