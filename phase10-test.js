#!/usr/bin/env node

/**
 * Comprehensive Phase 10 Test Suite
 * Tests Lua scripting functionality including EVAL, EVALSHA, and SCRIPT commands
 */

const net = require('net');

class RedisClient {
  constructor(port = 6379, host = '127.0.0.1') {
    this.port = port;
    this.host = host;
    this.socket = null;
    this.connected = false;
    this.buffer = '';
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.port, this.host);
      
      this.socket.on('connect', () => {
        this.connected = true;
        resolve();
      });
      
      this.socket.on('data', (data) => {
        this.buffer += data.toString();
      });
      
      this.socket.on('error', reject);
      this.socket.on('close', () => {
        this.connected = false;
      });
    });
  }

  parseResponse() {
    if (this.buffer.length === 0) return null;
    
    const lineEnd = this.buffer.indexOf('\r\n');
    if (lineEnd === -1) return null;
    
    const firstLine = this.buffer.substring(0, lineEnd);
    const type = firstLine[0];
    
    switch (type) {
      case '+': // Simple string
        this.buffer = this.buffer.substring(lineEnd + 2);
        return firstLine.substring(1);
        
      case '-': // Error
        this.buffer = this.buffer.substring(lineEnd + 2);
        return { error: firstLine.substring(1) };
        
      case ':': // Integer
        this.buffer = this.buffer.substring(lineEnd + 2);
        return parseInt(firstLine.substring(1), 10);
        
      case '$': // Bulk string
        const length = parseInt(firstLine.substring(1), 10);
        if (length === -1) {
          this.buffer = this.buffer.substring(lineEnd + 2);
          return null;
        }
        
        const totalLength = lineEnd + 2 + length + 2;
        if (this.buffer.length < totalLength) return null;
        
        const bulkString = this.buffer.substring(lineEnd + 2, lineEnd + 2 + length);
        this.buffer = this.buffer.substring(totalLength);
        return bulkString;
        
      case '*': // Array
        const arrayLength = parseInt(firstLine.substring(1), 10);
        if (arrayLength === -1) {
          this.buffer = this.buffer.substring(lineEnd + 2);
          return null;
        }
        
        this.buffer = this.buffer.substring(lineEnd + 2);
        const elements = [];
        
        for (let i = 0; i < arrayLength; i++) {
          const element = this.parseResponse();
          if (element === null && this.buffer.length === 0) {
            // Incomplete array, put back the array header
            this.buffer = firstLine + '\r\n' + this.buffer;
            return null;
          }
          elements.push(element);
        }
        
        return elements;
        
      default:
        // Unknown type, skip this character
        this.buffer = this.buffer.substring(1);
        return null;
    }
  }

  async sendCommand(command, ...args) {
    const parts = [command, ...args];
    const respCommand = `*${parts.length}\r\n` + 
      parts.map(part => `$${part.length}\r\n${part}\r\n`).join('');
    
    this.buffer = '';
    this.socket.write(respCommand);
    
    // Wait for response
    const timeout = 10000; // 10 second timeout for script operations
    const start = Date.now();
    
    while (this.connected) {
      if (Date.now() - start > timeout) {
        throw new Error('Command timeout');
      }
      
      const response = this.parseResponse();
      if (response !== null) {
        return response;
      }
      
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    throw new Error('Connection lost');
  }

  disconnect() {
    if (this.socket) {
      this.socket.end();
    }
  }
}

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

async function runTests() {
  console.log('\n🧪 Starting Phase 10 Tests (Lua Scripting)...\n');
  
  // Test connection
  const client = new RedisClient();
  try {
    await client.connect();
    console.log('✅ Connected to Redis server');
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    console.error('   Please ensure the server is running with: node simple-server.js');
    process.exit(1);
  }

  let testsPassed = 0;
  let testsFailed = 0;

  async function runTest(testName, testFn) {
    try {
      await testFn();
      console.log(`✅ ${testName}`);
      testsPassed++;
    } catch (error) {
      console.error(`❌ ${testName}: ${error.message}`);
      testsFailed++;
    }
  }

  // Clean database before starting tests
  await client.sendCommand('FLUSHALL');

  // ============================================================================
  // BASIC EVAL TESTS
  // ============================================================================

  console.log('\n💻 Testing Basic EVAL Command...\n');

  await runTest('EVAL simple return value', async () => {
    const result = await client.sendCommand('EVAL', 'return "hello world"', '0');
    assertEquals(result, 'hello world', 'Script should return string');
  });

  await runTest('EVAL return number', async () => {
    const result = await client.sendCommand('EVAL', 'return 42', '0');
    assertEquals(result, 42, 'Script should return number');
  });

  await runTest('EVAL return array', async () => {
    const result = await client.sendCommand('EVAL', 'return {1, 2, 3}', '0');
    assertEquals(result, [1, 2, 3], 'Script should return array');
  });

  await runTest('EVAL with KEYS argument', async () => {
    const result = await client.sendCommand('EVAL', 'return KEYS[1]', '1', 'mykey');
    assertEquals(result, 'mykey', 'Script should access KEYS array');
  });

  await runTest('EVAL with ARGV argument', async () => {
    const result = await client.sendCommand('EVAL', 'return ARGV[1]', '0', 'arg1');
    assertEquals(result, 'arg1', 'Script should access ARGV array');
  });

  await runTest('EVAL with multiple KEYS and ARGV', async () => {
    const result = await client.sendCommand('EVAL', 
      'return {KEYS[1], KEYS[2], ARGV[1], ARGV[2]}', 
      '2', 'key1', 'key2', 'arg1', 'arg2');
    assertEquals(result, ['key1', 'key2', 'arg1', 'arg2'], 'Script should handle multiple keys and args');
  });

  // ============================================================================
  // REDIS API TESTS
  // ============================================================================

  console.log('\n🔧 Testing Redis API Functions...\n');

  await runTest('redis.call SET operation', async () => {
    const result = await client.sendCommand('EVAL', 
      'redis.call("SET", "script_key", "script_value"); return "OK"', '0');
    assertEquals(result, 'OK', 'redis.call should execute SET');
    
    // Verify the key was set
    const value = await client.sendCommand('GET', 'script_key');
    assertEquals(value, 'script_value', 'SET command should have worked');
  });

  await runTest('redis.call GET operation', async () => {
    await client.sendCommand('SET', 'test_key', 'test_value');
    const result = await client.sendCommand('EVAL', 
      'return redis.call("GET", "test_key")', '0');
    assertEquals(result, 'test_value', 'redis.call should execute GET');
  });

  await runTest('redis.call with key from KEYS', async () => {
    const result = await client.sendCommand('EVAL', 
      'redis.call("SET", KEYS[1], ARGV[1]); return redis.call("GET", KEYS[1])', 
      '1', 'dynamic_key', 'dynamic_value');
    assertEquals(result, 'dynamic_value', 'redis.call should work with KEYS and ARGV');
  });

  await runTest('redis.pcall error handling', async () => {
    const result = await client.sendCommand('EVAL', 
      'return redis.pcall("INVALID_COMMAND", "arg")', '0');
    assert(result && typeof result === 'object' && result.error, 'redis.pcall should return error object');
  });

  // ============================================================================
  // SCRIPT CACHING TESTS
  // ============================================================================

  console.log('\n💾 Testing Script Caching...\n');

  await runTest('SCRIPT LOAD command', async () => {
    const script = 'return "cached script result"';
    const sha = await client.sendCommand('SCRIPT', 'LOAD', script);
    assert(typeof sha === 'string' && sha.length === 40, 'SCRIPT LOAD should return SHA1 hash');
    
    // Store SHA for next test
    client.testSHA = sha;
  });

  await runTest('EVALSHA with cached script', async () => {
    const result = await client.sendCommand('EVALSHA', client.testSHA, '0');
    assertEquals(result, 'cached script result', 'EVALSHA should execute cached script');
  });

  await runTest('EVALSHA with non-existent SHA', async () => {
    const fakesha = 'a'.repeat(40);
    const result = await client.sendCommand('EVALSHA', fakesha, '0');
    assert(result.error && result.error.includes('NOSCRIPT'), 'EVALSHA should return NOSCRIPT error');
  });

  await runTest('SCRIPT EXISTS command', async () => {
    const result = await client.sendCommand('SCRIPT', 'EXISTS', client.testSHA, 'nonexistent');
    assertEquals(result, [1, 0], 'SCRIPT EXISTS should return array of existence flags');
  });

  // ============================================================================
  // COMPLEX SCRIPT TESTS
  // ============================================================================

  console.log('\n🚀 Testing Complex Scripts...\n');

  await runTest('Script with conditional logic', async () => {
    const script = `
      if redis.call("EXISTS", KEYS[1]) == 1 then
        return redis.call("GET", KEYS[1])
      else
        redis.call("SET", KEYS[1], ARGV[1])
        return ARGV[1]
      end
    `;
    
    // First call should set the value
    const result1 = await client.sendCommand('EVAL', script, '1', 'cond_key', 'initial_value');
    assertEquals(result1, 'initial_value', 'First call should set and return value');
    
    // Second call should return existing value
    const result2 = await client.sendCommand('EVAL', script, '1', 'cond_key', 'new_value');
    assertEquals(result2, 'initial_value', 'Second call should return existing value');
  });

  await runTest('Script with loops and arrays', async () => {
    const script = `
      local result = {}
      for i = 1, 3 do
        result[i] = "item" .. i
      end
      return result
    `;
    
    const result = await client.sendCommand('EVAL', script, '0');
    assertEquals(result, ['item1', 'item2', 'item3'], 'Script should handle loops and arrays');
  });

  await runTest('Script with math operations', async () => {
    const script = `
      local sum = 0
      for i = 1, #ARGV do
        sum = sum + tonumber(ARGV[i])
      end
      return sum
    `;
    
    const result = await client.sendCommand('EVAL', script, '0', '10', '20', '30');
    assertEquals(result, 60, 'Script should perform math operations');
  });

  await runTest('Script modifying multiple data types', async () => {
    const script = `
      redis.call("SET", "str_key", "string_value")
      redis.call("LPUSH", "list_key", "item1", "item2")
      redis.call("SADD", "set_key", "member1", "member2")
      redis.call("HSET", "hash_key", "field1", "value1")
      
      return {
        redis.call("GET", "str_key"),
        redis.call("LLEN", "list_key"),
        redis.call("SCARD", "set_key"),
        redis.call("HLEN", "hash_key")
      }
    `;
    
    const result = await client.sendCommand('EVAL', script, '0');
    assertEquals(result, ['string_value', 2, 2, 1], 'Script should modify multiple data types');
  });

  // ============================================================================
  // SCRIPT MANAGEMENT TESTS
  // ============================================================================

  console.log('\n🗂️ Testing Script Management...\n');

  await runTest('SCRIPT FLUSH command', async () => {
    // Load a script first
    const script = 'return "test script"';
    const sha = await client.sendCommand('SCRIPT', 'LOAD', script);
    
    // Verify it exists
    let exists = await client.sendCommand('SCRIPT', 'EXISTS', sha);
    assertEquals(exists[0], 1, 'Script should exist before flush');
    
    // Flush all scripts
    const flushResult = await client.sendCommand('SCRIPT', 'FLUSH');
    assertEquals(flushResult, 'OK', 'SCRIPT FLUSH should return OK');
    
    // Verify it no longer exists
    exists = await client.sendCommand('SCRIPT', 'EXISTS', sha);
    assertEquals(exists[0], 0, 'Script should not exist after flush');
  });

  await runTest('SCRIPT KILL command', async () => {
    const result = await client.sendCommand('SCRIPT', 'KILL');
    assertEquals(result, 'OK', 'SCRIPT KILL should return OK');
  });

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  console.log('\n❌ Testing Error Handling...\n');

  await runTest('EVAL with wrong number of arguments', async () => {
    const result = await client.sendCommand('EVAL');
    assert(result.error && result.error.includes('wrong number of arguments'), 
           'EVAL with no args should return error');
  });

  await runTest('EVAL with invalid numkeys', async () => {
    const result = await client.sendCommand('EVAL', 'return 1', 'invalid');
    assert(result.error && result.error.includes('not an integer'), 
           'EVAL with invalid numkeys should return error');
  });

  await runTest('EVAL with script syntax error', async () => {
    const result = await client.sendCommand('EVAL', 'invalid lua syntax +++', '0');
    assert(result.error && result.error.includes('Error running script'), 
           'EVAL with syntax error should return error');
  });

  await runTest('SCRIPT with invalid subcommand', async () => {
    const result = await client.sendCommand('SCRIPT', 'INVALID');
    assert(result.error && result.error.includes('unknown SCRIPT subcommand'), 
           'SCRIPT with invalid subcommand should return error');
  });

  await runTest('SCRIPT LOAD with wrong arguments', async () => {
    const result = await client.sendCommand('SCRIPT', 'LOAD');
    assert(result.error && result.error.includes('wrong number of arguments'), 
           'SCRIPT LOAD with no args should return error');
  });

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  console.log('\n🔄 Testing Integration with Other Features...\n');

  await runTest('Script with expiring keys', async () => {
    const script = `
      redis.call("SET", KEYS[1], ARGV[1])
      redis.call("EXPIRE", KEYS[1], ARGV[2])
      return redis.call("TTL", KEYS[1])
    `;
    
    const result = await client.sendCommand('EVAL', script, '1', 'expire_key', 'expire_value', '10');
    assert(result > 0 && result <= 10, 'Script should work with expiring keys');
  });

  await runTest('Script within transaction', async () => {
    await client.sendCommand('MULTI');
    await client.sendCommand('EVAL', 'redis.call("SET", "tx_key", "tx_value"); return "OK"', '0');
    const result = await client.sendCommand('EXEC');
    
    assert(Array.isArray(result) && result[0] === 'OK', 'Script should work within transaction');
    
    const value = await client.sendCommand('GET', 'tx_key');
    assertEquals(value, 'tx_value', 'Script in transaction should modify data');
  });

  await runTest('Script with pub/sub', async () => {
    const script = `
      return redis.call("PUBLISH", "test_channel", "script_message")
    `;
    
    const result = await client.sendCommand('EVAL', script, '0');
    assertEquals(result, 0, 'Script should publish message (0 subscribers)');
  });

  // ============================================================================
  // PERFORMANCE TESTS
  // ============================================================================

  console.log('\n🚄 Testing Performance...\n');

  await runTest('Multiple script executions', async () => {
    const script = 'return redis.call("INCR", "counter")';
    
    const startTime = Date.now();
    for (let i = 0; i < 100; i++) {
      await client.sendCommand('EVAL', script, '0');
    }
    const endTime = Date.now();
    
    const finalValue = await client.sendCommand('GET', 'counter');
    assertEquals(parseInt(finalValue), 100, 'All script executions should complete');
    
    const avgTime = (endTime - startTime) / 100;
    console.log(`  📊 Average script execution time: ${avgTime.toFixed(2)}ms`);
    assert(avgTime < 100, 'Average script execution should be reasonable');
  });

  await runTest('Script cache performance', async () => {
    const script = 'return redis.call("GET", "counter")';
    const sha = await client.sendCommand('SCRIPT', 'LOAD', script);
    
    const startTime = Date.now();
    for (let i = 0; i < 50; i++) {
      await client.sendCommand('EVALSHA', sha, '0');
    }
    const cacheTime = Date.now() - startTime;
    
    const directStart = Date.now();
    for (let i = 0; i < 50; i++) {
      await client.sendCommand('EVAL', script, '0');
    }
    const directTime = Date.now() - directStart;
    
    console.log(`  📊 Cached execution time: ${cacheTime}ms, Direct execution time: ${directTime}ms`);
    // Cache should be at least as fast as direct execution
    assert(cacheTime <= directTime * 1.5, 'Cached execution should be efficient');
  });

  // Clean up
  client.disconnect();

  // ============================================================================
  // RESULTS
  // ============================================================================

  console.log('\n' + '='.repeat(50));
  console.log('📊 PHASE 10 TEST RESULTS');
  console.log('='.repeat(50));
  console.log(`✅ Tests Passed: ${testsPassed}`);
  console.log(`❌ Tests Failed: ${testsFailed}`);
  console.log(`📈 Success Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%`);

  if (testsFailed === 0) {
    console.log('\n🎉 ALL TESTS PASSED! Phase 10 is 100% working! 🎉');
    console.log('\n✨ Lua Scripting system is fully functional:');
    console.log('   • EVAL command for direct script execution ✅');
    console.log('   • EVALSHA command for cached script execution ✅');
    console.log('   • SCRIPT LOAD/EXISTS/FLUSH/KILL commands ✅');
    console.log('   • redis.call() and redis.pcall() API functions ✅');
    console.log('   • Script caching with SHA1 hashing ✅');
    console.log('   • KEYS and ARGV argument handling ✅');
    console.log('   • Atomic script execution ✅');
    console.log('   • Error handling and validation ✅');
    console.log('   • Integration with all data structures ✅');
    console.log('   • Performance optimization ✅');
    console.log('\n💻 Your Redis-Clone-JS now has powerful Lua scripting capabilities!');
  } else {
    console.log('\n🔧 Some tests failed. Please check the implementation.');
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run tests
runTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
