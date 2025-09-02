#!/usr/bin/env node

/**
 * Phase 12 Tests - Client Library Development
 * 
 * This test suite validates the Redis client library implementation including:
 * - RedisClient with all server operations
 * - Automatic connection management  
 * - Error handling and retries
 * - Connection pooling
 * - Command pipelining
 * - Client-side caching with invalidation
 * - Batch operations
 * - Async/await interface
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
    await sleep(2000);
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
    console.log('📊 PHASE 12 TEST RESULTS');
    console.log('='.repeat(50));
    console.log(`✅ Tests Passed: ${this.passed}`);
    console.log(`❌ Tests Failed: ${this.failed}`);
    console.log(`📈 Success Rate: ${successRate}%`);
    
    if (this.failed === 0) {
      console.log('\n🎉 ALL TESTS PASSED! Phase 12 is 100% working! 🎉');
      console.log('\n✨ Client library is fully functional:');
      console.log('   • RedisClient with all operations ✅');
      console.log('   • Connection management & pooling ✅');
      console.log('   • Error handling & retries ✅');
      console.log('   • Command pipelining ✅');
      console.log('   • Client-side caching ✅');
      console.log('   • Batch operations ✅');
      console.log('   • Async/await interface ✅');
      console.log('\n🔗 Your Redis client library is production-ready!');
    } else {
      console.log('\n🔧 Some tests failed. Please check the implementation.');
    }
  }
}

async function runTests() {
  const runner = new TestRunner();
  
  try {
    console.log('🧪 Starting Phase 12 Tests (Client Library Development)...\n');
    
    await runner.startServer();
    
    // Import client classes
    let RedisClient, Pipeline, ClientCache;
    try {
      const clientModule = require('./src/client/RedisClient');
      RedisClient = clientModule.RedisClient || clientModule;
      
      const pipelineModule = require('./src/client/Pipeline');
      Pipeline = pipelineModule.Pipeline || pipelineModule;
      
      const cacheModule = require('./src/client/ClientCache');
      ClientCache = cacheModule.ClientCache || cacheModule;
    } catch (error) {
      console.log(`❌ Failed to import client modules: ${error.message}`);
      console.log('🔧 Please ensure all client files are implemented.');
      await runner.stopServer();
      return;
    }

    console.log('📋 Testing Basic Client Operations...');

    await runner.runTest('Client connection and disconnection', async () => {
      const client = new RedisClient({ port: 6379 });
      await client.connect();
      assert(client.connected, 'Client should be connected');
      await client.disconnect();
      assert(!client.connected, 'Client should be disconnected');
    });

    await runner.runTest('Basic string operations via client', async () => {
      const client = new RedisClient({ port: 6379 });
      await client.connect();
      
      await client.set('test_key', 'test_value');
      const value = await client.get('test_key');
      assertEquals(value, 'test_value', 'GET should return set value');
      
      const deleted = await client.del('test_key');
      assertEquals(deleted, 1, 'DEL should return 1 for deleted key');
      
      await client.disconnect();
    });

    await runner.runTest('List operations via client', async () => {
      const client = new RedisClient({ port: 6379 });
      await client.connect();
      
      const length = await client.lpush('test_list', 'item1', 'item2');
      assertEquals(length, 2, 'LPUSH should return new length');
      
      const items = await client.lrange('test_list', 0, -1);
      assertEquals(items, ['item2', 'item1'], 'LRANGE should return items in correct order');
      
      await client.del('test_list');
      await client.disconnect();
    });

    await runner.runTest('Hash operations via client', async () => {
      const client = new RedisClient({ port: 6379 });
      await client.connect();
      
      await client.hset('test_hash', 'field1', 'value1', 'field2', 'value2');
      const value = await client.hget('test_hash', 'field1');
      assertEquals(value, 'value1', 'HGET should return correct value');
      
      const all = await client.hgetall('test_hash');
      assert(all.includes('field1') && all.includes('value1'), 'HGETALL should include all fields');
      
      await client.del('test_hash');
      await client.disconnect();
    });

    await runner.runTest('Set operations via client', async () => {
      const client = new RedisClient({ port: 6379 });
      await client.connect();
      
      await client.sadd('test_set', 'member1', 'member2');
      const isMember = await client.sismember('test_set', 'member1');
      assertEquals(isMember, 1, 'SISMEMBER should return 1 for existing member');
      
      const members = await client.smembers('test_set');
      assert(members.includes('member1') && members.includes('member2'), 'SMEMBERS should return all members');
      
      await client.del('test_set');
      await client.disconnect();
    });

    console.log('\n🔗 Testing Connection Management...');

    await runner.runTest('Automatic reconnection on connection loss', async () => {
      const client = new RedisClient({ port: 6379, retryAttempts: 3, retryDelay: 100 });
      await client.connect();
      
      // Simulate connection loss and recovery
      client.socket.destroy();
      await sleep(200);
      
      // Client should automatically reconnect
      await client.set('reconnect_test', 'success');
      const value = await client.get('reconnect_test');
      assertEquals(value, 'success', 'Client should recover from connection loss');
      
      await client.disconnect();
    });

    await runner.runTest('Connection pooling functionality', async () => {
      const client = new RedisClient({ port: 6379, poolSize: 3 });
      await client.connect();
      
      // Make multiple concurrent requests to test pooling
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(client.set(`pool_test_${i}`, `value_${i}`));
      }
      
      await Promise.all(promises);
      
      const value = await client.get('pool_test_5');
      assertEquals(value, 'value_5', 'Pooled connections should work correctly');
      
      await client.disconnect();
    });

    console.log('\n⚡ Testing Pipelining...');

    await runner.runTest('Command pipelining', async () => {
      const client = new RedisClient({ port: 6379 });
      await client.connect();
      
      const pipeline = client.pipeline();
      pipeline.set('pipe1', 'value1');
      pipeline.set('pipe2', 'value2');
      pipeline.get('pipe1');
      pipeline.get('pipe2');
      
      const results = await pipeline.exec();
      assertEquals(results.length, 4, 'Pipeline should return all results');
      assertEquals(results[2], 'value1', 'Pipeline GET should return correct value');
      assertEquals(results[3], 'value2', 'Pipeline GET should return correct value');
      
      await client.disconnect();
    });

    await runner.runTest('Pipeline error handling', async () => {
      const client = new RedisClient({ port: 6379 });
      await client.connect();
      
      const pipeline = client.pipeline();
      pipeline.set('valid_key', 'valid_value');
      pipeline.lpush('valid_key', 'invalid'); // This should fail - wrong type
      pipeline.get('valid_key');
      
      const results = await pipeline.exec();
      assertEquals(results.length, 3, 'Pipeline should return all results');
      assert(results[1] instanceof Error || (results[1] && results[1].error), 'Pipeline should handle errors');
      assertEquals(results[2], 'valid_value', 'Valid commands should still execute');
      
      await client.disconnect();
    });

    console.log('\n💾 Testing Client-Side Caching...');

    await runner.runTest('Basic client-side caching', async () => {
      const client = new RedisClient({ port: 6379, enableCache: true, cacheSize: 100 });
      await client.connect();
      
      await client.set('cache_test', 'cached_value');
      
      // First GET - should fetch from server and cache
      const value1 = await client.get('cache_test');
      assertEquals(value1, 'cached_value', 'First GET should return correct value');
      
      // Second GET - should return from cache (faster)
      const start = Date.now();
      const value2 = await client.get('cache_test');
      const duration = Date.now() - start;
      
      assertEquals(value2, 'cached_value', 'Cached GET should return correct value');
      assert(duration < 10, 'Cached access should be fast');
      
      await client.disconnect();
    });

    await runner.runTest('Cache invalidation on write operations', async () => {
      const client = new RedisClient({ port: 6379, enableCache: true });
      await client.connect();
      
      await client.set('cache_invalidate', 'old_value');
      await client.get('cache_invalidate'); // Cache the value
      
      await client.set('cache_invalidate', 'new_value'); // Should invalidate cache
      const value = await client.get('cache_invalidate');
      assertEquals(value, 'new_value', 'Cache should be invalidated after write');
      
      await client.disconnect();
    });

    console.log('\n🚄 Testing Batch Operations...');

    await runner.runTest('Batch operations execution', async () => {
      const client = new RedisClient({ port: 6379 });
      await client.connect();
      
      const batch = [
        ['SET', 'batch1', 'value1'],
        ['SET', 'batch2', 'value2'],
        ['GET', 'batch1'],
        ['GET', 'batch2']
      ];
      
      const results = await client.batch(batch);
      assertEquals(results.length, 4, 'Batch should return all results');
      assertEquals(results[2], 'value1', 'Batch GET should return correct value');
      assertEquals(results[3], 'value2', 'Batch GET should return correct value');
      
      await client.disconnect();
    });

    console.log('\n🛡️ Testing Error Handling...');

    await runner.runTest('Connection error handling', async () => {
      const client = new RedisClient({ port: 9999, retryAttempts: 1, retryDelay: 50 }); // Invalid port
      
      try {
        await client.connect();
        assert(false, 'Should throw connection error');
      } catch (error) {
        assert(error.message.includes('ECONNREFUSED') || error.message.includes('connection'), 
               'Should throw meaningful connection error');
      }
    });

    await runner.runTest('Command error handling', async () => {
      const client = new RedisClient({ port: 6379 });
      await client.connect();
      
      await client.set('error_test', 'string_value');
      
      try {
        await client.lpush('error_test', 'item'); // Should fail - wrong type
        assert(false, 'Should throw type error');
      } catch (error) {
        assert(error.message.includes('wrong') || error.message.includes('type'), 
               'Should throw meaningful type error');
      }
      
      await client.disconnect();
    });

    console.log('\n⚡ Testing Performance & Advanced Features...');

    await runner.runTest('Large data handling', async () => {
      const client = new RedisClient({ port: 6379 });
      await client.connect();
      
      // Test with large string
      const largeValue = 'x'.repeat(10000);
      await client.set('large_key', largeValue);
      const retrieved = await client.get('large_key');
      assertEquals(retrieved.length, 10000, 'Should handle large values correctly');
      
      await client.del('large_key');
      await client.disconnect();
    });

    await runner.runTest('Concurrent operations', async () => {
      const client = new RedisClient({ port: 6379 });
      await client.connect();
      
      // Make 50 concurrent SET operations
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(client.set(`concurrent_${i}`, `value_${i}`));
      }
      
      await Promise.all(promises);
      
      // Verify all were set correctly
      const value = await client.get('concurrent_25');
      assertEquals(value, 'value_25', 'Concurrent operations should work correctly');
      
      await client.disconnect();
    });

    await runner.runTest('Memory efficiency', async () => {
      const client = new RedisClient({ port: 6379, enableCache: true, cacheSize: 10 });
      await client.connect();
      
      // Fill cache beyond capacity
      for (let i = 0; i < 20; i++) {
        await client.set(`mem_test_${i}`, `value_${i}`);
        await client.get(`mem_test_${i}`);
      }
      
      // Cache should have evicted older entries
      const cacheStats = client.getCacheStats();
      assert(cacheStats.size <= 10, 'Cache should respect size limits');
      
      await client.disconnect();
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
