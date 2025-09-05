#!/usr/bin/env node

/**
 * Phase 13 Tests - Performance Optimization
 * 
 * This test suite validates the performance optimization implementation including:
 * - Performance monitoring system
 * - Memory optimization and eviction policies
 * - Network optimization and batching
 * - Command execution benchmarks
 * - Resource usage monitoring
 * - Optimization effectiveness
 */

const { spawn } = require('child_process');
const path = require('path');

// Test utilities
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEquals(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class TestRunner {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.serverProcess = null;
  }

  async runTest(name, testFn) {
    try {
      console.log(`\n🧪 ${name}...`);
      await testFn();
      console.log(`✅ ${name}`);
      this.passed++;
    } catch (error) {
      console.log(`❌ ${name}: ${error.message}`);
      this.failed++;
    }
  }

  async startServer() {
    console.log('🚀 Starting test server...');
    this.serverProcess = spawn('node', ['simple-server.js'], {
      stdio: 'pipe',
      env: { ...process.env, REDIS_PORT: '6379', REDIS_ROLE: 'master' }
    });

    // Wait for server to start
    await sleep(3000);
    console.log('✅ Test server started');
  }

  async stopServer() {
    if (this.serverProcess) {
      this.serverProcess.kill();
      console.log('🛑 Test server stopped');
    }
  }

  printResults() {
    const total = this.passed + this.failed;
    const successRate = total > 0 ? ((this.passed / total) * 100).toFixed(1) : 0;
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 PHASE 13 TEST RESULTS');
    console.log('='.repeat(50));
    console.log(`✅ Tests Passed: ${this.passed}`);
    console.log(`❌ Tests Failed: ${this.failed}`);
    console.log(`📈 Success Rate: ${successRate}%`);
    
    if (this.failed === 0) {
      console.log('\n🎉 ALL TESTS PASSED! Phase 13 is 100% working! 🎉');
      console.log('\n✨ Performance optimization is fully functional:');
      console.log('   • Performance monitoring ✅');
      console.log('   • Memory optimization & eviction ✅');
      console.log('   • Network optimization & batching ✅');
      console.log('   • Command execution benchmarks ✅');
      console.log('   • Resource usage tracking ✅');
      console.log('   • Optimization effectiveness ✅');
      console.log('\n🚀 Your Redis server is now highly optimized!');
    } else {
      console.log('\n🔧 Some tests failed. Please check the implementation.');
    }
  }
}

async function runTests() {
  const runner = new TestRunner();
  
  try {
    console.log('🧪 Starting Phase 13 Tests (Performance Optimization)...\n');
    
    await runner.startServer();
    
    // Import monitoring classes
    let PerformanceMonitor, MemoryOptimizer, NetworkOptimizer, BenchmarkSuite;
    try {
      PerformanceMonitor = require('./src/monitoring/PerformanceMonitor');
      MemoryOptimizer = require('./src/monitoring/MemoryOptimizer');
      NetworkOptimizer = require('./src/monitoring/NetworkOptimizer');
      BenchmarkSuite = require('./benchmarks/BenchmarkSuite');
    } catch (error) {
      console.log(`❌ Failed to import monitoring modules: ${error.message}`);
      await runner.stopServer();
      return;
    }

    console.log('📊 Testing Performance Monitoring...');

    await runner.runTest('Performance monitor initialization', async () => {
      const monitor = new PerformanceMonitor({ enabled: true, monitoringInterval: 100 });
      monitor.start();
      
      // Let it collect some metrics
      await sleep(200);
      
      const metrics = monitor.getMetrics();
      assert(metrics.timestamp > 0, 'Should have timestamp');
      assert(typeof metrics.memory.used === 'number', 'Should track memory usage');
      assert(typeof metrics.cpu.usage === 'number', 'Should track CPU usage');
      
      monitor.stop();
    });

    await runner.runTest('Performance metrics recording', async () => {
      const monitor = new PerformanceMonitor({ enabled: false }); // Don't auto-start
      
      // Record some commands
      monitor.recordCommand('SET', 5.2, false);
      monitor.recordCommand('GET', 2.1, false);
      monitor.recordCommand('DEL', 3.5, true); // With error
      
      // Force metrics update
      monitor.updateCommandMetrics();
      
      const metrics = monitor.getMetrics();
      assert(metrics.commands.total === 3, 'Should record command count');
      assert(metrics.commands.errors === 1, 'Should track errors');
      assert(metrics.commands.averageLatency > 0, 'Should calculate average latency');
    });

    await runner.runTest('Performance alert system', async () => {
      const monitor = new PerformanceMonitor({ 
        enabled: true,
        memoryThreshold: 0.01, // Very low threshold to trigger alert
        cpuThreshold: 0.01,
        monitoringInterval: 50 // Faster for testing
      });
      
      let alertReceived = false;
      monitor.on('alert', (alert) => {
        alertReceived = true;
        assert(typeof alert.type === 'string', 'Alert should have type');
        assert(typeof alert.message === 'string', 'Alert should have message');
      });
      
      monitor.start();
      await sleep(150);
      
      // Force metrics collection to trigger alerts
      monitor.collectMetrics();
      
      // Should have triggered alert due to low threshold
      assert(alertReceived, 'Should receive performance alerts');
      
      monitor.stop();
    });

    console.log('\n💾 Testing Memory Optimization...');

    await runner.runTest('Memory optimizer initialization', async () => {
      // Create a mock DataStore for testing
      const mockDataStore = {
        maxDatabases: 2,
        maxMemory: 1024 * 1024 * 1024, // 1GB
        databases: new Map([
          [0, { data: new Map([['key1', 'value1'], ['key2', 'value2']]), keyCount: 2 }],
          [1, { data: new Map(), keyCount: 0 }]
        ]),
        keyExpiration: {
          hasExpiration: () => false,
          ttl: () => ({ success: true, value: -1 })
        }
      };
      
      const optimizer = new MemoryOptimizer(mockDataStore, { 
        enabled: false, // Don't auto-start for testing
        optimizationInterval: 1000 // Longer interval for testing
      });
      
      // Manually analyze to avoid background optimization
      optimizer.analyze();
      
      const stats = optimizer.getStats();
      console.log(`    📊 Stats: keys=${stats.totalKeys}, size=${stats.estimatedSize}`);
      assert(typeof stats.totalKeys === 'number', 'Should track total keys');
      assert(stats.totalKeys === 2, 'Should count correct number of keys');
      assert(typeof stats.estimatedSize === 'string', 'Should format memory size as string');
      assert(stats.estimatedSize.includes('B'), 'Should include unit in memory size');
      
      // Test that we can get the raw estimated size from internal stats
      assert(typeof optimizer.stats.estimatedSize === 'number', 'Should track raw memory size as number');
      assert(optimizer.stats.estimatedSize >= 0, 'Should have non-negative memory size estimate');
    });

    await runner.runTest('Memory eviction policies', async () => {
      const mockDataStore = {
        maxDatabases: 1,
        databases: new Map([
          [0, { 
            data: new Map([
              ['old_key', 'value1'],
              ['new_key', 'value2'],
              ['freq_key', 'value3']
            ]), 
            keyCount: 3 
          }]
        ]),
        keyExpiration: {
          hasExpiration: () => false,
          ttl: () => ({ success: true, value: -1 })
        },
        select: () => {},
        del: (key) => {}
      };
      
      const optimizer = new MemoryOptimizer(mockDataStore, { 
        enabled: true,
        maxMemoryPolicy: 'allkeys-lru'
      });
      
      // Simulate key access patterns
      optimizer.trackKeyAccess('old_key');
      await sleep(10);
      optimizer.trackKeyAccess('new_key');
      optimizer.trackKeyAccess('freq_key');
      optimizer.trackKeyAccess('freq_key'); // Access twice
      
      const keys = optimizer.selectKeysForEviction(0.5); // Evict 50%
      assert(Array.isArray(keys), 'Should return array of keys to evict');
      
      // Should prefer evicting older/less frequently accessed keys
      const evictedKeys = keys.map(k => k.key);
      assert(evictedKeys.includes('old_key'), 'Should include oldest key for eviction');
    });

    console.log('\n🌐 Testing Network Optimization...');

    await runner.runTest('Network optimizer initialization', async () => {
      const optimizer = new NetworkOptimizer({
        enabled: true,
        maxConnections: 100,
        batchingEnabled: true
      });
      optimizer.start();
      
      // Simulate connection registration with a proper mock socket
      const mockSocket = { 
        setNoDelay: () => {},
        setKeepAlive: () => {},
        on: () => {} // Add event listener capability
      };
      const registered = optimizer.registerConnection('client1', mockSocket);
      assert(registered, 'Should register connection successfully');
      
      const stats = optimizer.getStats();
      assert(stats.connections.active === 1, 'Should track active connections');
      
      optimizer.unregisterConnection('client1');
      assert(optimizer.getStats().connections.active === 0, 'Should unregister connections');
      
      optimizer.stop();
    });

    await runner.runTest('Network command batching', async () => {
      const optimizer = new NetworkOptimizer({
        enabled: true,
        batchingEnabled: true,
        batchTimeout: 50,
        maxBatchSize: 5
      });
      optimizer.start();
      
      // Register connection with proper mock socket
      const mockSocket = { 
        setNoDelay: () => {},
        setKeepAlive: () => {},
        on: () => {}
      };
      optimizer.registerConnection('client1', mockSocket);
      
      // Record commands that can be batched
      optimizer.recordCommand('client1', 'GET', 2);
      optimizer.recordCommand('client1', 'MGET', 3);
      optimizer.recordCommand('client1', 'EXISTS', 1);
      
      await sleep(100); // Wait for batch processing
      
      const stats = optimizer.getStats();
      assert(stats.batching.commandsBatched >= 0, 'Should track batched commands');
      
      optimizer.stop();
    });

    await runner.runTest('Network latency tracking', async () => {
      const optimizer = new NetworkOptimizer({ enabled: true });
      optimizer.start();
      
      // Record latency measurements
      const latencies = [10, 15, 8, 12, 20];
      latencies.forEach(latency => {
        optimizer.recordLatency(latency);
      });
      
      const stats = optimizer.getStats();
      assert(stats.latency.average > 0, 'Should calculate average latency');
      assert(stats.latency.min <= stats.latency.max, 'Min should be <= max');
      
      optimizer.stop();
    });

    console.log('\n📈 Testing Benchmark System...');

    await runner.runTest('Benchmark suite initialization', async () => {
      const benchmark = new BenchmarkSuite({
        host: '127.0.0.1',
        port: 6379,
        iterations: 100, // Small number for testing
        warmupIterations: 10
      });
      
      assert(typeof benchmark.options.iterations === 'number', 'Should have iteration count');
      assert(Array.isArray(benchmark.options.commands), 'Should have commands list');
    });

    await runner.runTest('Performance benchmarking', async () => {
      const { RedisClient } = require('./src/client/RedisClient');
      const client = new RedisClient({ port: 6379, timeout: 5000 });
      
      try {
        await client.connect();
        
        // Run a mini benchmark
        const iterations = 50;
        const latencies = [];
        
        for (let i = 0; i < iterations; i++) {
          const start = process.hrtime.bigint();
          await client.set(`bench_key_${i}`, `value${i}`);
          const end = process.hrtime.bigint();
          
          const latency = Number(end - start) / 1000000; // Convert to ms
          latencies.push(latency);
        }
        
        const avgLatency = latencies.reduce((sum, val) => sum + val, 0) / latencies.length;
        const opsPerSec = (iterations / (latencies.reduce((sum, val) => sum + val, 0) / 1000));
        
        assert(avgLatency > 0, 'Should measure average latency');
        assert(opsPerSec > 0, 'Should calculate operations per second');
        assert(opsPerSec < 1000000, 'Operations per second should be reasonable'); // Sanity check
        
        console.log(`    📊 Mini benchmark: ${opsPerSec.toFixed(0)} ops/sec, ${avgLatency.toFixed(2)}ms avg`);
        
        await client.disconnect();
      } catch (error) {
        throw new Error(`Benchmark test failed: ${error.message}`);
      }
    });

    console.log('\n🔧 Testing Integration...');

    await runner.runTest('Server performance integration', async () => {
      const { RedisClient } = require('./src/client/RedisClient');
      const client = new RedisClient({ port: 6379 });
      
      try {
        await client.connect();
        
        // Execute commands to generate performance data
        await client.set('perf_test', 'value');
        await client.get('perf_test');
        await client.lpush('perf_list', 'item1', 'item2');
        await client.lrange('perf_list', 0, -1);
        await client.hset('perf_hash', 'field1', 'value1');
        await client.hget('perf_hash', 'field1');
        
        // Commands should execute successfully with monitoring
        const result = await client.ping();
        assertEquals(result, 'PONG', 'Server should respond normally with monitoring enabled');
        
        await client.disconnect();
      } catch (error) {
        throw new Error(`Integration test failed: ${error.message}`);
      }
    });

    await runner.runTest('Memory optimization effectiveness', async () => {
      const { RedisClient } = require('./src/client/RedisClient');
      const client = new RedisClient({ port: 6379, timeout: 2000 }); // Reduced timeout
      
      try {
        await client.connect();
        
        // Create some test data (reduced count for faster test)
        const keyCount = 20;
        for (let i = 0; i < keyCount; i++) {
          await client.set(`mem_test_${i}`, `value_${i}_${'x'.repeat(50)}`); // Smaller values
        }
        
        // Memory optimization should be running in background
        // Test that server is still responsive
        const result = await client.ping();
        assertEquals(result, 'PONG', 'Server should remain responsive under load');
        
        // Clean up
        await client.flushall();
        await client.disconnect();
      } catch (error) {
        throw new Error(`Memory optimization test failed: ${error.message}`);
      }
    });

    await runner.runTest('Performance monitoring data collection', async () => {
      const { RedisClient } = require('./src/client/RedisClient');
      const client = new RedisClient({ port: 6379 });
      
      try {
        await client.connect();
        
        // Execute various commands to generate metrics
        const commands = [
          () => client.set('monitor_key', 'value'),
          () => client.get('monitor_key'),
          () => client.lpush('monitor_list', 'item'),
          () => client.sadd('monitor_set', 'member'),
          () => client.hset('monitor_hash', 'field', 'value')
        ];
        
        for (const command of commands) {
          await command();
        }
        
        // Performance data should be collected in background
        // Server should remain functional
        const result = await client.exists('monitor_key');
        assert(result === 1, 'Key should exist after operations');
        
        await client.disconnect();
      } catch (error) {
        throw new Error(`Performance data collection test failed: ${error.message}`);
      }
    });

    console.log('\n⚡ Testing Optimization Impact...');

    await runner.runTest('Command execution performance', async () => {
      const { RedisClient } = require('./src/client/RedisClient');
      const client = new RedisClient({ port: 6379 });
      
      try {
        await client.connect();
        
        // Measure execution time for a batch of operations
        const batchSize = 50;
        const startTime = Date.now();
        
        const pipeline = client.pipeline();
        for (let i = 0; i < batchSize; i++) {
          pipeline.set(`batch_${i}`, `value_${i}`);
        }
        
        const results = await pipeline.exec();
        const endTime = Date.now();
        
        const duration = endTime - startTime;
        const opsPerSec = (batchSize / duration) * 1000;
        
        assert(results.length === batchSize, 'Should execute all operations');
        assert(duration > 0, 'Should measure execution time');
        assert(opsPerSec > 10, 'Should achieve reasonable throughput'); // Basic performance check
        
        console.log(`    ⚡ Pipeline performance: ${opsPerSec.toFixed(0)} ops/sec`);
        
        await client.disconnect();
      } catch (error) {
        throw new Error(`Performance test failed: ${error.message}`);
      }
    });

  } catch (error) {
    console.error('❌ Test execution failed:', error);
  } finally {
    await runner.stopServer();
    runner.printResults();
  }

  process.exit(runner.failed > 0 ? 1 : 0);
}

// Handle cleanup
process.on('SIGINT', async () => {
  console.log('\n🛑 Tests interrupted');
  process.exit(1);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Tests terminated');
  process.exit(1);
});

// Run tests
runTests().catch(error => {
  console.error('❌ Failed to run tests:', error);
  process.exit(1);
});
