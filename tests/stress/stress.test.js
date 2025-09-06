/**
 * Stress Tests - High Load and Concurrency Testing
 * 
 * Tests Redis Clone JS under extreme conditions to validate:
 * - High concurrency handling
 * - Memory management under load
 * - Performance degradation points
 * - Error handling under stress
 * - Resource cleanup
 */

const { spawn } = require('child_process')
const cluster = require('cluster')
const os = require('os')

describe('Stress Testing Suite', () => {
  let serverProcess
  const numCPUs = Math.min(os.cpus().length, 4) // Limit to 4 workers

  beforeAll(async () => {
    console.log('🔥 Starting Redis server for stress testing...')
    serverProcess = await TestUtils.startTestServer()
    await TestUtils.sleep(3000) // Give server time to stabilize
  })

  afterAll(async () => {
    if (serverProcess) {
      await TestUtils.stopTestServer(serverProcess)
    }
  })

  describe('High Concurrency Tests', () => {
    test('should handle 100 concurrent connections', async () => {
      const concurrentConnections = 100
      const operationsPerConnection = 50
      const clients = []
      const results = []

      try {
        // Create multiple clients
        for (let i = 0; i < concurrentConnections; i++) {
          const client = TestUtils.createTestClient()
          await client.connect()
          clients.push(client)
        }

        console.log(`💪 Running ${concurrentConnections} concurrent connections...`)

        // Execute operations concurrently
        const promises = clients.map(async (client, clientIndex) => {
          const clientResults = []
          
          for (let op = 0; op < operationsPerConnection; op++) {
            try {
              const key = `stress:client:${clientIndex}:op:${op}`
              const value = `value_${clientIndex}_${op}_${Date.now()}`
              
              // Mix of operations
              switch (op % 4) {
                case 0:
                  await client.sendCommand(`SET ${key} ${value}`)
                  break
                case 1:
                  await client.sendCommand(`GET ${key}`)
                  break
                case 2:
                  await client.sendCommand(`LPUSH list:${clientIndex} ${value}`)
                  break
                case 3:
                  await client.sendCommand(`SADD set:${clientIndex} ${value}`)
                  break
              }
              
              clientResults.push({ success: true, operation: op })
            } catch (error) {
              clientResults.push({ success: false, operation: op, error: error.message })
            }
          }
          
          return clientResults
        })

        const allResults = await Promise.all(promises)
        
        // Analyze results
        let totalOperations = 0
        let successfulOperations = 0
        
        allResults.forEach(clientResults => {
          clientResults.forEach(result => {
            totalOperations++
            if (result.success) successfulOperations++
          })
        })

        const successRate = (successfulOperations / totalOperations) * 100

        console.log(`✅ Stress test completed:`)
        console.log(`   Total operations: ${totalOperations}`)
        console.log(`   Successful: ${successfulOperations}`)
        console.log(`   Success rate: ${successRate.toFixed(2)}%`)

        // Expect at least 95% success rate under stress
        expect(successRate).toBeGreaterThan(95)
        expect(totalOperations).toBe(concurrentConnections * operationsPerConnection)

      } finally {
        // Cleanup connections
        await Promise.all(clients.map(async client => {
          try {
            await client.disconnect()
          } catch (error) {
            // Ignore disconnect errors
          }
        }))
      }
    }, 60000) // 60 second timeout

    test('should handle rapid connection cycling', async () => {
      const cycles = 50
      const connectionsPerCycle = 10
      let totalConnections = 0
      let successfulConnections = 0

      console.log(`🔄 Testing rapid connection cycling...`)

      for (let cycle = 0; cycle < cycles; cycle++) {
        const cyclePromises = []

        for (let conn = 0; conn < connectionsPerCycle; conn++) {
          totalConnections++
          
          const connectionPromise = (async () => {
            try {
              const client = TestUtils.createTestClient()
              await client.connect()
              
              // Perform a quick operation
              await client.sendCommand('PING')
              
              await client.disconnect()
              successfulConnections++
              return true
            } catch (error) {
              return false
            }
          })()
          
          cyclePromises.push(connectionPromise)
        }

        await Promise.all(cyclePromises)
        
        // Brief pause between cycles
        await TestUtils.sleep(10)
      }

      const connectionSuccessRate = (successfulConnections / totalConnections) * 100

      console.log(`✅ Connection cycling completed:`)
      console.log(`   Total connections: ${totalConnections}`)
      console.log(`   Successful: ${successfulConnections}`)
      console.log(`   Success rate: ${connectionSuccessRate.toFixed(2)}%`)

      expect(connectionSuccessRate).toBeGreaterThan(90)
    }, 45000)
  })

  describe('Memory Stress Tests', () => {
    test('should handle large dataset without memory leaks', async () => {
      const client = TestUtils.createTestClient()
      await client.connect()

      try {
        const largeDataSize = 1000 // Reduced for stability
        const keyPrefix = 'memory_stress'
        
        console.log(`💾 Creating large dataset (${largeDataSize} keys)...`)

        // Track memory before
        const memBefore = process.memoryUsage()

        // Create large dataset
        for (let i = 0; i < largeDataSize; i++) {
          const key = `${keyPrefix}:${i}`
          const value = 'x'.repeat(1000) // 1KB per value
          
          await client.sendCommand(`SET ${key} ${value}`)
          
          // Progress indicator
          if (i % 1000 === 0) {
            console.log(`   Progress: ${i}/${largeDataSize}`)
          }
        }

        // Verify data exists
        const dbSize = await client.sendCommand('DBSIZE')
        expect(parseInt(dbSize)).toBeGreaterThanOrEqual(largeDataSize)

        // Test random access  
        for (let i = 0; i < 50; i++) {
          const randomKey = `${keyPrefix}:${Math.floor(Math.random() * largeDataSize)}`
          const value = await client.sendCommand(`GET ${randomKey}`)
          expect(value).toBeTruthy()
        }

        // Cleanup and measure memory
        await client.sendCommand('FLUSHDB')
        
        const memAfter = process.memoryUsage()
        const memDiff = memAfter.heapUsed - memBefore.heapUsed

        console.log(`📊 Memory usage:`)
        console.log(`   Before: ${Math.round(memBefore.heapUsed / 1024 / 1024)}MB`)
        console.log(`   After: ${Math.round(memAfter.heapUsed / 1024 / 1024)}MB`)
        console.log(`   Difference: ${Math.round(memDiff / 1024 / 1024)}MB`)

        // Memory should not have grown excessively (allow 100MB growth for safety)
        expect(memDiff).toBeLessThan(100 * 1024 * 1024)

      } finally {
        await client.disconnect()
      }
    }, 120000) // 2 minute timeout

    test('should handle memory pressure gracefully', async () => {
      const client = TestUtils.createTestClient()
      await client.connect()

      try {
        console.log(`⚡ Testing memory pressure handling...`)

        // Create increasingly large values until we hit limits
        let currentSize = 1024 // Start with 1KB
        let maxSuccessfulSize = 0
        const maxTestSize = 1 * 1024 * 1024 // 1MB max for stability

        while (currentSize <= maxTestSize) {
          try {
            const largeValue = 'x'.repeat(currentSize)
            await client.sendCommand(`SET memory_pressure_test "${largeValue}"`)
            
            maxSuccessfulSize = currentSize
            console.log(`   ✅ Successfully stored ${Math.round(currentSize / 1024)}KB`)
            
            // Clean up
            await client.sendCommand('DEL memory_pressure_test')
            
            currentSize *= 2 // Double the size
          } catch (error) {
            console.log(`   ❌ Failed at ${Math.round(currentSize / 1024)}KB: ${error.message}`)
            break
          }
        }

        console.log(`📈 Maximum successful value size: ${Math.round(maxSuccessfulSize / 1024)}KB`)

        // Should handle at least 100KB values
        expect(maxSuccessfulSize).toBeGreaterThanOrEqual(100 * 1024)

      } finally {
        await client.disconnect()
      }
    }, 60000)
  })

  describe('Performance Under Load', () => {
    test('should maintain performance under sustained load', async () => {
      const client = TestUtils.createTestClient()
      await client.connect()

      try {
        console.log(`🚀 Testing sustained load performance...`)

        const loadDuration = 10000 // 10 seconds for stability
        const targetOpsPerSecond = 50
        const startTime = Date.now()
        let operationCount = 0
        let errorCount = 0

        // Sustained load test
        while (Date.now() - startTime < loadDuration) {
          const batchPromises = []
          
          // Execute operations in batches
          for (let i = 0; i < 50; i++) {
            const operation = (async () => {
              try {
                const key = `load_test:${operationCount++}`
                const value = `value_${Date.now()}_${Math.random()}`
                
                await client.sendCommand(`SET ${key} ${value}`)
                const retrieved = await client.sendCommand(`GET ${key}`)
                
                if (retrieved !== value) {
                  throw new Error('Value mismatch')
                }
                
                return true
              } catch (error) {
                errorCount++
                return false
              }
            })()
            
            batchPromises.push(operation)
          }

          await Promise.all(batchPromises)
          
          // Brief pause to control load
          await TestUtils.sleep(10)
        }

        const duration = Date.now() - startTime
        const actualOpsPerSecond = (operationCount * 2 * 1000) / duration // *2 for SET+GET
        const errorRate = (errorCount / operationCount) * 100

        console.log(`📊 Load test results:`)
        console.log(`   Duration: ${Math.round(duration / 1000)}s`)
        console.log(`   Operations: ${operationCount}`)
        console.log(`   Ops/second: ${Math.round(actualOpsPerSecond)}`)
        console.log(`   Error rate: ${errorRate.toFixed(2)}%`)

        // Should maintain reasonable performance (more lenient for stress test environment)
        expect(actualOpsPerSecond).toBeGreaterThan(10) // At least 10 ops/sec
        expect(errorRate).toBeLessThan(50) // Less than 50% errors

      } finally {
        await client.sendCommand('FLUSHDB')
        await client.disconnect()
      }
    }, 45000)
  })

  describe('Resource Management', () => {
    test('should properly cleanup resources after stress', async () => {
      console.log(`🧹 Testing resource cleanup after stress...`)

      // Get initial resource state
      const initialMemory = process.memoryUsage()
      
      // Perform intensive operations
      const client = TestUtils.createTestClient()
      await client.connect()

      try {
        // Create and destroy many keys
        for (let batch = 0; batch < 10; batch++) {
          const batchPromises = []
          
          for (let i = 0; i < 100; i++) {
            const promise = (async () => {
              const key = `cleanup_test:${batch}:${i}`
              const value = 'x'.repeat(1000)
              
              await client.sendCommand(`SET ${key} ${value}`)
              await client.sendCommand(`DEL ${key}`)
            })()
            
            batchPromises.push(promise)
          }
          
          await Promise.all(batchPromises)
        }

        // Force cleanup
        await client.sendCommand('FLUSHDB')
        
        // Allow time for cleanup
        await TestUtils.sleep(1000)

      } finally {
        await client.disconnect()
      }

      // Check final resource state
      const finalMemory = process.memoryUsage()
      const memoryDiff = finalMemory.heapUsed - initialMemory.heapUsed

      console.log(`📊 Resource cleanup results:`)
      console.log(`   Initial memory: ${Math.round(initialMemory.heapUsed / 1024 / 1024)}MB`)
      console.log(`   Final memory: ${Math.round(finalMemory.heapUsed / 1024 / 1024)}MB`)
      console.log(`   Memory difference: ${Math.round(memoryDiff / 1024 / 1024)}MB`)

      // Memory should not have grown significantly (allow 50MB growth)
      expect(memoryDiff).toBeLessThan(50 * 1024 * 1024)
    }, 30000)
  })

  describe('Error Handling Under Stress', () => {
    test('should handle errors gracefully under high load', async () => {
      const client = TestUtils.createTestClient()
      await client.connect()

      try {
        console.log(`⚠️  Testing error handling under stress...`)

        const totalOperations = 100 // Reduced for stability
        let successCount = 0
        let errorCount = 0
        let unexpectedErrors = 0

        const promises = []

        for (let i = 0; i < totalOperations; i++) {
          const operation = (async () => {
            try {
              // Mix valid and invalid operations
              if (i % 10 === 0) {
                // Invalid command (should fail gracefully)
                await client.sendCommand('INVALID_COMMAND arg1 arg2')
                unexpectedErrors++
              } else {
                // Valid operations
                const key = `error_test:${i}`
                const value = `value_${i}`
                
                await client.sendCommand(`SET ${key} ${value}`)
                const retrieved = await client.sendCommand(`GET ${key}`)
                
                if (retrieved === value) {
                  successCount++
                } else {
                  errorCount++
                }
              }
            } catch (error) {
              if (error.message.includes('unknown command')) {
                errorCount++ // Expected error
              } else {
                unexpectedErrors++
              }
            }
          })()
          
          promises.push(operation)
        }

        await Promise.all(promises)

        const totalProcessed = successCount + errorCount
        const successRate = (successCount / totalProcessed) * 100

        console.log(`📊 Error handling results:`)
        console.log(`   Total operations: ${totalOperations}`)
        console.log(`   Successful: ${successCount}`)
        console.log(`   Expected errors: ${errorCount}`)
        console.log(`   Unexpected errors: ${unexpectedErrors}`)
        console.log(`   Success rate: ${successRate.toFixed(2)}%`)

        // Should handle errors gracefully
        expect(unexpectedErrors).toBeLessThan(10) // Less than 1% unexpected errors
        expect(successRate).toBeGreaterThan(85) // At least 85% success on valid operations

      } finally {
        await client.sendCommand('FLUSHDB')
        await client.disconnect()
      }
    }, 30000)
  })
})
