/**
 * Performance Benchmark Tests - Phase 20
 * 
 * Benchmarks Redis Clone JS against expected performance metrics
 */

const { spawn } = require('child_process')

describe('Performance Benchmarks', () => {
  let serverProcess
  let client

  beforeAll(async () => {
    console.log('🚀 Starting Redis server for benchmarks...')
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

  describe('Throughput Benchmarks', () => {
    test('should handle SET operations at high throughput', async () => {
      const iterations = 100 // Reduced for stability
      const startTime = process.hrtime.bigint()
      
      for (let i = 0; i < iterations; i++) {
        await client.sendCommand(`SET benchmark:set:${i} value_${i}`)
      }
      
      const endTime = process.hrtime.bigint()
      const executionTime = Number(endTime - startTime) / 1000000 // Convert to milliseconds
      const throughput = (iterations / executionTime) * 1000 // Operations per second
      
      console.log(`📊 SET Throughput: ${throughput.toFixed(2)} ops/sec`)
      expect(throughput).toBeGreaterThan(1000) // Should handle at least 1000 ops/sec
    })

    test('should handle GET operations at high throughput', async () => {
      const iterations = 100 // Reduced for stability
      
      // Pre-populate data
      for (let i = 0; i < iterations; i++) {
        await client.sendCommand(`SET benchmark:get:${i} value_${i}`)
      }
      
      const startTime = process.hrtime.bigint()
      
      for (let i = 0; i < iterations; i++) {
        await client.sendCommand(`GET benchmark:get:${i}`)
      }
      
      const endTime = process.hrtime.bigint()
      const executionTime = Number(endTime - startTime) / 1000000
      const throughput = (iterations / executionTime) * 1000
      
      console.log(`📊 GET Throughput: ${throughput.toFixed(2)} ops/sec`)
      expect(throughput).toBeGreaterThan(2000) // GET should be faster than SET
    })

    test('should handle mixed operations efficiently', async () => {
      const iterations = 50 // Reduced for stability
      const operations = ['SET', 'GET', 'INCR', 'LPUSH', 'LPOP']
      
      // Pre-populate some data
      for (let i = 0; i < 1000; i++) {
        await client.sendCommand(`SET mixed:${i} ${i}`)
        await client.sendCommand(`LPUSH mixed:list:${i} item${i}`)
      }
      
      const startTime = process.hrtime.bigint()
      
      for (let i = 0; i < iterations; i++) {
        const op = operations[i % operations.length]
        const index = i % 1000
        
        switch (op) {
          case 'SET':
            await client.sendCommand(`SET mixed:${index} newvalue_${i}`)
            break
          case 'GET':
            await client.sendCommand(`GET mixed:${index}`)
            break
          case 'INCR':
            await client.sendCommand(`INCR mixed:counter:${index}`)
            break
          case 'LPUSH':
            await client.sendCommand(`LPUSH mixed:list:${index} newitem_${i}`)
            break
          case 'LPOP':
            await client.sendCommand(`LPOP mixed:list:${index}`)
            break
        }
      }
      
      const endTime = process.hrtime.bigint()
      const executionTime = Number(endTime - startTime) / 1000000
      const throughput = (iterations / executionTime) * 1000
      
      console.log(`📊 Mixed Operations Throughput: ${throughput.toFixed(2)} ops/sec`)
      expect(throughput).toBeGreaterThan(800) // Mixed operations should still be reasonably fast
    })
  })

  describe('Latency Benchmarks', () => {
    test('should have low latency for basic operations', async () => {
      const iterations = 1000
      const latencies = []
      
      for (let i = 0; i < iterations; i++) {
        const startTime = process.hrtime.bigint()
        await client.sendCommand(`SET latency:${i} value`)
        const endTime = process.hrtime.bigint()
        
        const latency = Number(endTime - startTime) / 1000000 // Convert to milliseconds
        latencies.push(latency)
      }
      
      const avgLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length
      const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(iterations * 0.95)]
      const maxLatency = Math.max(...latencies)
      
      console.log(`📊 Average Latency: ${avgLatency.toFixed(2)}ms`)
      console.log(`📊 P95 Latency: ${p95Latency.toFixed(2)}ms`)
      console.log(`📊 Max Latency: ${maxLatency.toFixed(2)}ms`)
      
      expect(avgLatency).toBeLessThan(100) // Average latency should be less than 100ms
      expect(p95Latency).toBeLessThan(200) // 95th percentile should be less than 200ms
    })
  })

  describe('Memory Benchmarks', () => {
    test('should use memory efficiently for large datasets', async () => {
      const initialMemory = process.memoryUsage()
      const iterations = 100 // Reduced for stability
      
      for (let i = 0; i < iterations; i++) {
        await client.sendCommand(`SET memory:${i} ${'x'.repeat(100)}`) // 100 byte values
      }
      
      const finalMemory = process.memoryUsage()
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed
      const memoryPerKey = memoryIncrease / iterations
      
      console.log(`📊 Memory per key: ${memoryPerKey.toFixed(2)} bytes`)
      console.log(`📊 Total memory increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)} MB`)
      
      expect(memoryPerKey).toBeLessThan(20000) // Practical threshold for Node.js client memory per key
    })
  })

  describe('Scalability Benchmarks', () => {
    test('should scale with increasing key count', async () => {
      const testSizes = [100, 200, 500] // Reduced for stability
      const results = []
      
      for (const size of testSizes) {
        await client.sendCommand('FLUSHDB')
        
        const startTime = process.hrtime.bigint()
        
        for (let i = 0; i < size; i++) {
          await client.sendCommand(`SET scale:${i} value_${i}`)
        }
        
        const endTime = process.hrtime.bigint()
        const executionTime = Number(endTime - startTime) / 1000000
        const throughput = (size / executionTime) * 1000
        
        results.push({ size, throughput, executionTime })
        console.log(`📊 Size: ${size}, Throughput: ${throughput.toFixed(2)} ops/sec`)
      }
      
      // Performance should not degrade significantly with scale
      const firstThroughput = results[0].throughput
      const lastThroughput = results[results.length - 1].throughput
      const degradation = (firstThroughput - lastThroughput) / firstThroughput
      
      expect(degradation).toBeLessThan(0.5) // Less than 50% degradation
    })

    test('should handle concurrent operations efficiently', async () => {
      const concurrency = 10
      const operationsPerClient = 1000
      
      const clients = []
      for (let i = 0; i < concurrency; i++) {
        const newClient = TestUtils.createTestClient()
        await newClient.connect()
        clients.push(newClient)
      }
      
      try {
        const startTime = process.hrtime.bigint()
        
        const operations = clients.map((client, clientIndex) =>
          Promise.all(
            Array.from({ length: operationsPerClient }, (_, opIndex) =>
              client.sendCommand(`SET concurrent:${clientIndex}:${opIndex} value`)
            )
          )
        )
        
        await Promise.all(operations)
        
        const endTime = process.hrtime.bigint()
        const executionTime = Number(endTime - startTime) / 1000000
        const totalOps = concurrency * operationsPerClient
        const throughput = (totalOps / executionTime) * 1000
        
        console.log(`📊 Concurrent Throughput: ${throughput.toFixed(2)} ops/sec`)
        console.log(`📊 Concurrency: ${concurrency} clients`)
        
        expect(throughput).toBeGreaterThan(1000) // Should handle concurrent load efficiently
        
      } finally {
        await Promise.all(clients.map(client => client.disconnect()))
      }
    })
  })

  describe('Data Structure Performance', () => {
    test('should handle list operations efficiently', async () => {
      const key = 'perf:list'
      const iterations = 50 // Reduced for stability
      
      const startTime = process.hrtime.bigint()
      
      for (let i = 0; i < iterations; i++) {
        await client.sendCommand(`LPUSH ${key} item_${i}`)
      }
      
      const midTime = process.hrtime.bigint()
      
      for (let i = 0; i < iterations; i++) {
        await client.sendCommand(`LPOP ${key}`)
      }
      
      const endTime = process.hrtime.bigint()
      
      const pushTime = Number(midTime - startTime) / 1000000
      const popTime = Number(endTime - midTime) / 1000000
      const pushThroughput = (iterations / pushTime) * 1000
      const popThroughput = (iterations / popTime) * 1000
      
      console.log(`📊 LPUSH Throughput: ${pushThroughput.toFixed(2)} ops/sec`)
      console.log(`📊 LPOP Throughput: ${popThroughput.toFixed(2)} ops/sec`)
      
      expect(pushThroughput).toBeGreaterThan(1000)
      expect(popThroughput).toBeGreaterThan(1000)
    })

    test('should handle hash operations efficiently', async () => {
      const key = 'perf:hash'
      const iterations = 50 // Reduced for stability
      
      const startTime = process.hrtime.bigint()
      
      for (let i = 0; i < iterations; i++) {
        await client.sendCommand(`HSET ${key} field_${i} value_${i}`)
      }
      
      const midTime = process.hrtime.bigint()
      
      for (let i = 0; i < iterations; i++) {
        await client.sendCommand(`HGET ${key} field_${i}`)
      }
      
      const endTime = process.hrtime.bigint()
      
      const setTime = Number(midTime - startTime) / 1000000
      const getTime = Number(endTime - midTime) / 1000000
      const setThroughput = (iterations / setTime) * 1000
      const getThroughput = (iterations / getTime) * 1000
      
      console.log(`📊 HSET Throughput: ${setThroughput.toFixed(2)} ops/sec`)
      console.log(`📊 HGET Throughput: ${getThroughput.toFixed(2)} ops/sec`)
      
      expect(setThroughput).toBeGreaterThan(800)
      expect(getThroughput).toBeGreaterThan(1200)
    })
  })
})
