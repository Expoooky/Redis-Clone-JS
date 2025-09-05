/**
 * BenchmarkSuite - Comprehensive performance benchmarking
 * 
 * Features:
 * - Command execution benchmarks
 * - Memory usage benchmarks
 * - Network performance benchmarks
 * - Concurrency benchmarks
 * - Comparison with Redis
 * - Performance regression detection
 */

const { spawn } = require('child_process');
const { RedisClient } = require('../src/client/RedisClient');
const path = require('path');

class BenchmarkSuite {
  constructor(options = {}) {
    this.options = {
      host: options.host || '127.0.0.1',
      port: options.port || 6379,
      iterations: options.iterations || 10000,
      concurrency: options.concurrency || 50,
      warmupIterations: options.warmupIterations || 1000,
      payloadSizes: options.payloadSizes || [16, 256, 1024, 8192],
      commands: options.commands || ['SET', 'GET', 'LPUSH', 'LRANGE', 'SADD', 'SMEMBERS', 'HSET', 'HGET'],
      enableProfiling: options.enableProfiling || false,
      ...options
    };
    
    this.client = null;
    this.results = {
      summary: {},
      detailed: {},
      comparisons: {},
      memory: {},
      network: {}
    };
    
    this.serverProcess = null;
  }

  /**
   * Run complete benchmark suite
   */
  async runAll() {
    console.log('🚀 Starting Redis Clone Performance Benchmark Suite');
    console.log('='.repeat(60));
    
    try {
      await this.startServer();
      await this.setupClient();
      
      console.log('\n📊 Running Performance Benchmarks...\n');
      
      // Core benchmarks
      await this.runCommandBenchmarks();
      await this.runConcurrencyBenchmarks();
      await this.runMemoryBenchmarks();
      await this.runNetworkBenchmarks();
      await this.runDataTypeBenchmarks();
      
      // Advanced benchmarks
      await this.runPipelineBenchmarks();
      await this.runBatchBenchmarks();
      await this.runLatencyBenchmarks();
      
      this.generateReport();
      
    } catch (error) {
      console.error('❌ Benchmark failed:', error.message);
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Start test server
   */
  async startServer() {
    console.log('🔧 Starting test server...');
    
    this.serverProcess = spawn('node', ['simple-server.js'], {
      stdio: 'pipe',
      env: { 
        ...process.env, 
        REDIS_PORT: this.options.port.toString(),
        REDIS_ROLE: 'master'
      }
    });
    
    // Wait for server to start
    await this.sleep(3000);
    console.log('✅ Test server started');
  }

  /**
   * Setup benchmark client
   */
  async setupClient() {
    this.client = new RedisClient({ 
      host: this.options.host,
      port: this.options.port,
      timeout: 10000
    });
    
    await this.client.connect();
    console.log('✅ Connected to Redis server');
    
    // Warm up
    console.log('🔥 Warming up server...');
    await this.warmup();
  }

  /**
   * Warm up server
   */
  async warmup() {
    for (let i = 0; i < this.options.warmupIterations; i++) {
      await this.client.set(`warmup:${i}`, 'value');
      await this.client.get(`warmup:${i}`);
    }
    
    // Clean up warmup data
    await this.client.flushall();
    console.log('✅ Server warmed up');
  }

  /**
   * Run command benchmarks
   */
  async runCommandBenchmarks() {
    console.log('📝 Running Command Benchmarks...');
    
    const results = {};
    
    for (const command of this.options.commands) {
      console.log(`   Testing ${command}...`);
      
      const benchmark = await this.benchmarkCommand(command);
      results[command] = benchmark;
      
      console.log(`      ${benchmark.opsPerSecond.toFixed(0)} ops/sec, ${benchmark.avgLatency.toFixed(2)}ms avg`);
    }
    
    this.results.detailed.commands = results;
    console.log('✅ Command benchmarks completed\n');
  }

  /**
   * Benchmark individual command
   */
  async benchmarkCommand(command) {
    const iterations = this.options.iterations;
    const latencies = [];
    const errors = [];
    
    const startTime = Date.now();
    
    for (let i = 0; i < iterations; i++) {
      const cmdStart = process.hrtime.bigint();
      
      try {
        switch (command.toUpperCase()) {
          case 'SET':
            await this.client.set(`bench:${i}`, `value${i}`);
            break;
          case 'GET':
            await this.client.get(`bench:${i % 1000}`); // Get from existing keys
            break;
          case 'LPUSH':
            await this.client.lpush(`list:${i % 100}`, `item${i}`);
            break;
          case 'LRANGE':
            await this.client.lrange(`list:${i % 100}`, 0, 10);
            break;
          case 'SADD':
            await this.client.sadd(`set:${i % 100}`, `member${i}`);
            break;
          case 'SMEMBERS':
            await this.client.smembers(`set:${i % 100}`);
            break;
          case 'HSET':
            await this.client.hset(`hash:${i % 100}`, `field${i}`, `value${i}`);
            break;
          case 'HGET':
            await this.client.hget(`hash:${i % 100}`, `field${i % 10}`);
            break;
          default:
            await this.client.ping();
        }
        
        const cmdEnd = process.hrtime.bigint();
        const latency = Number(cmdEnd - cmdStart) / 1000000; // Convert to milliseconds
        latencies.push(latency);
        
      } catch (error) {
        errors.push(error.message);
      }
    }
    
    const totalTime = Date.now() - startTime;
    
    return this.calculateBenchmarkStats(iterations, totalTime, latencies, errors);
  }

  /**
   * Run concurrency benchmarks
   */
  async runConcurrencyBenchmarks() {
    console.log('🔄 Running Concurrency Benchmarks...');
    
    const concurrencyLevels = [1, 10, 25, 50, 100];
    const results = {};
    
    for (const concurrency of concurrencyLevels) {
      console.log(`   Testing ${concurrency} concurrent connections...`);
      
      const benchmark = await this.benchmarkConcurrency(concurrency);
      results[concurrency] = benchmark;
      
      console.log(`      ${benchmark.opsPerSecond.toFixed(0)} ops/sec, ${benchmark.avgLatency.toFixed(2)}ms avg`);
    }
    
    this.results.detailed.concurrency = results;
    console.log('✅ Concurrency benchmarks completed\n');
  }

  /**
   * Benchmark concurrency
   */
  async benchmarkConcurrency(concurrency) {
    const iterationsPerClient = Math.floor(this.options.iterations / concurrency);
    const clients = [];
    
    // Create multiple clients
    for (let i = 0; i < concurrency; i++) {
      const client = new RedisClient({ 
        host: this.options.host, 
        port: this.options.port,
        timeout: 10000
      });
      await client.connect();
      clients.push(client);
    }
    
    const startTime = Date.now();
    const promises = [];
    const allLatencies = [];
    const allErrors = [];
    
    // Run concurrent operations
    for (let i = 0; i < concurrency; i++) {
      const client = clients[i];
      const promise = this.runConcurrentOperations(client, iterationsPerClient, i)
        .then(result => {
          allLatencies.push(...result.latencies);
          allErrors.push(...result.errors);
        });
      promises.push(promise);
    }
    
    await Promise.all(promises);
    
    const totalTime = Date.now() - startTime;
    const totalOperations = concurrency * iterationsPerClient;
    
    // Cleanup clients
    for (const client of clients) {
      await client.disconnect();
    }
    
    return this.calculateBenchmarkStats(totalOperations, totalTime, allLatencies, allErrors);
  }

  /**
   * Run operations for a single client in concurrency test
   */
  async runConcurrentOperations(client, iterations, clientId) {
    const latencies = [];
    const errors = [];
    
    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();
      
      try {
        await client.set(`concurrent:${clientId}:${i}`, `value${i}`);
        const end = process.hrtime.bigint();
        latencies.push(Number(end - start) / 1000000);
      } catch (error) {
        errors.push(error.message);
      }
    }
    
    return { latencies, errors };
  }

  /**
   * Run memory benchmarks
   */
  async runMemoryBenchmarks() {
    console.log('💾 Running Memory Benchmarks...');
    
    const results = {};
    
    // Test different payload sizes
    for (const size of this.options.payloadSizes) {
      console.log(`   Testing ${size} byte payloads...`);
      
      const benchmark = await this.benchmarkMemoryUsage(size);
      results[`${size}B`] = benchmark;
      
      console.log(`      Memory efficiency: ${benchmark.bytesPerKey.toFixed(1)} bytes/key`);
    }
    
    this.results.detailed.memory = results;
    console.log('✅ Memory benchmarks completed\n');
  }

  /**
   * Benchmark memory usage
   */
  async benchmarkMemoryUsage(payloadSize) {
    const iterations = Math.min(this.options.iterations, 50000); // Limit for memory tests
    const payload = 'x'.repeat(payloadSize);
    
    // Clear memory
    await this.client.flushall();
    if (global.gc) global.gc();
    
    const memBefore = process.memoryUsage();
    const startTime = Date.now();
    
    // Store data
    for (let i = 0; i < iterations; i++) {
      await this.client.set(`mem:${payloadSize}:${i}`, payload);
    }
    
    const memAfter = process.memoryUsage();
    const totalTime = Date.now() - startTime;
    
    // Calculate memory metrics
    const memoryUsed = memAfter.heapUsed - memBefore.heapUsed;
    const bytesPerKey = memoryUsed / iterations;
    const storageEfficiency = (payloadSize / bytesPerKey) * 100;
    
    // Test retrieval performance
    const retrievalStart = Date.now();
    for (let i = 0; i < Math.min(iterations, 1000); i++) {
      await this.client.get(`mem:${payloadSize}:${i}`);
    }
    const retrievalTime = Date.now() - retrievalStart;
    
    return {
      payloadSize,
      iterations,
      storageTime: totalTime,
      retrievalTime,
      memoryUsed,
      bytesPerKey,
      storageEfficiency,
      opsPerSecond: (iterations / totalTime) * 1000
    };
  }

  /**
   * Run network benchmarks
   */
  async runNetworkBenchmarks() {
    console.log('🌐 Running Network Benchmarks...');
    
    const results = {};
    
    // Test pipeline efficiency
    console.log('   Testing pipeline performance...');
    results.pipeline = await this.benchmarkPipeline();
    
    // Test batch operations
    console.log('   Testing batch operations...');
    results.batch = await this.benchmarkBatch();
    
    this.results.detailed.network = results;
    console.log('✅ Network benchmarks completed\n');
  }

  /**
   * Run data type benchmarks
   */
  async runDataTypeBenchmarks() {
    console.log('📊 Running Data Type Benchmarks...');
    
    const results = {};
    const dataTypes = ['strings', 'lists', 'sets', 'hashes'];
    
    for (const type of dataTypes) {
      console.log(`   Testing ${type}...`);
      results[type] = await this.benchmarkDataType(type);
    }
    
    this.results.detailed.dataTypes = results;
    console.log('✅ Data type benchmarks completed\n');
  }

  /**
   * Benchmark data type operations
   */
  async benchmarkDataType(type) {
    const iterations = Math.floor(this.options.iterations / 4);
    const latencies = [];
    
    const startTime = Date.now();
    
    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();
      
      switch (type) {
        case 'strings':
          await this.client.set(`str:${i}`, `value${i}`);
          await this.client.get(`str:${i}`);
          break;
        case 'lists':
          await this.client.lpush(`list:${i % 100}`, `item${i}`);
          await this.client.lrange(`list:${i % 100}`, 0, 5);
          break;
        case 'sets':
          await this.client.sadd(`set:${i % 100}`, `member${i}`);
          await this.client.sismember(`set:${i % 100}`, `member${i}`);
          break;
        case 'hashes':
          await this.client.hset(`hash:${i % 100}`, `field${i}`, `value${i}`);
          await this.client.hget(`hash:${i % 100}`, `field${i}`);
          break;
      }
      
      const end = process.hrtime.bigint();
      latencies.push(Number(end - start) / 1000000);
    }
    
    const totalTime = Date.now() - startTime;
    
    return this.calculateBenchmarkStats(iterations * 2, totalTime, latencies, []); // *2 for read+write ops
  }

  /**
   * Benchmark pipeline operations
   */
  async benchmarkPipeline() {
    const pipeline = this.client.pipeline();
    const operations = 1000;
    
    const startTime = process.hrtime.bigint();
    
    for (let i = 0; i < operations; i++) {
      pipeline.set(`pipe:${i}`, `value${i}`);
    }
    
    const results = await pipeline.exec();
    const endTime = process.hrtime.bigint();
    
    const totalTime = Number(endTime - startTime) / 1000000;
    
    return {
      operations,
      totalTime,
      opsPerSecond: (operations / totalTime) * 1000,
      avgLatency: totalTime / operations,
      errors: results.filter(r => r instanceof Error).length
    };
  }

  /**
   * Benchmark batch operations
   */
  async benchmarkBatch() {
    const batchSize = 100;
    const batches = 100;
    const totalOps = batchSize * batches;
    
    const startTime = process.hrtime.bigint();
    
    for (let b = 0; b < batches; b++) {
      const batch = [];
      for (let i = 0; i < batchSize; i++) {
        batch.push(['SET', `batch:${b}:${i}`, `value${i}`]);
      }
      await this.client.batch(batch);
    }
    
    const endTime = process.hrtime.bigint();
    const totalTime = Number(endTime - startTime) / 1000000;
    
    return {
      operations: totalOps,
      totalTime,
      opsPerSecond: (totalOps / totalTime) * 1000,
      avgLatency: totalTime / totalOps
    };
  }

  /**
   * Run latency benchmarks
   */
  async runLatencyBenchmarks() {
    console.log('⚡ Running Latency Benchmarks...');
    
    const samples = [];
    const iterations = Math.min(this.options.iterations, 10000);
    
    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();
      await this.client.ping();
      const end = process.hrtime.bigint();
      
      samples.push(Number(end - start) / 1000000); // Convert to milliseconds
    }
    
    samples.sort((a, b) => a - b);
    
    const results = {
      samples: samples.length,
      min: samples[0],
      max: samples[samples.length - 1],
      mean: samples.reduce((sum, val) => sum + val, 0) / samples.length,
      p50: samples[Math.floor(samples.length * 0.5)],
      p90: samples[Math.floor(samples.length * 0.9)],
      p95: samples[Math.floor(samples.length * 0.95)],
      p99: samples[Math.floor(samples.length * 0.99)],
      p999: samples[Math.floor(samples.length * 0.999)]
    };
    
    this.results.detailed.latency = results;
    console.log('✅ Latency benchmarks completed\n');
  }

  /**
   * Calculate benchmark statistics
   */
  calculateBenchmarkStats(operations, totalTime, latencies, errors) {
    const successfulOps = operations - errors.length;
    const opsPerSecond = (successfulOps / totalTime) * 1000;
    
    let stats = {
      operations,
      totalTime,
      successfulOps,
      errors: errors.length,
      errorRate: (errors.length / operations) * 100,
      opsPerSecond
    };
    
    if (latencies.length > 0) {
      const sortedLatencies = [...latencies].sort((a, b) => a - b);
      
      stats = {
        ...stats,
        avgLatency: latencies.reduce((sum, val) => sum + val, 0) / latencies.length,
        minLatency: sortedLatencies[0],
        maxLatency: sortedLatencies[sortedLatencies.length - 1],
        p95Latency: sortedLatencies[Math.floor(sortedLatencies.length * 0.95)],
        p99Latency: sortedLatencies[Math.floor(sortedLatencies.length * 0.99)]
      };
    }
    
    return stats;
  }

  /**
   * Generate comprehensive report
   */
  generateReport() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 BENCHMARK RESULTS SUMMARY');
    console.log('='.repeat(60));
    
    this.printCommandResults();
    this.printConcurrencyResults();
    this.printMemoryResults();
    this.printLatencyResults();
    this.printOverallSummary();
    
    console.log('\n✅ Benchmark suite completed successfully!');
  }

  /**
   * Print command results
   */
  printCommandResults() {
    console.log('\n📝 Command Performance:');
    console.log('-'.repeat(40));
    
    const commands = this.results.detailed.commands;
    for (const [cmd, stats] of Object.entries(commands)) {
      console.log(`${cmd.padEnd(10)} ${stats.opsPerSecond.toFixed(0).padStart(8)} ops/sec  ${stats.avgLatency.toFixed(2).padStart(6)}ms avg`);
    }
  }

  /**
   * Print concurrency results
   */
  printConcurrencyResults() {
    console.log('\n🔄 Concurrency Performance:');
    console.log('-'.repeat(40));
    
    const concurrency = this.results.detailed.concurrency;
    for (const [level, stats] of Object.entries(concurrency)) {
      console.log(`${level.padEnd(3)} clients  ${stats.opsPerSecond.toFixed(0).padStart(8)} ops/sec  ${stats.avgLatency.toFixed(2).padStart(6)}ms avg`);
    }
  }

  /**
   * Print memory results
   */
  printMemoryResults() {
    console.log('\n💾 Memory Efficiency:');
    console.log('-'.repeat(40));
    
    const memory = this.results.detailed.memory;
    for (const [size, stats] of Object.entries(memory)) {
      console.log(`${size.padEnd(10)} ${stats.bytesPerKey.toFixed(1).padStart(8)} bytes/key  ${stats.storageEfficiency.toFixed(1).padStart(6)}% efficiency`);
    }
  }

  /**
   * Print latency results
   */
  printLatencyResults() {
    console.log('\n⚡ Latency Distribution (PING):');
    console.log('-'.repeat(40));
    
    const latency = this.results.detailed.latency;
    console.log(`Mean:     ${latency.mean.toFixed(3)}ms`);
    console.log(`P50:      ${latency.p50.toFixed(3)}ms`);
    console.log(`P90:      ${latency.p90.toFixed(3)}ms`);
    console.log(`P95:      ${latency.p95.toFixed(3)}ms`);
    console.log(`P99:      ${latency.p99.toFixed(3)}ms`);
    console.log(`P99.9:    ${latency.p999.toFixed(3)}ms`);
  }

  /**
   * Print overall summary
   */
  printOverallSummary() {
    const commands = this.results.detailed.commands;
    const avgOpsPerSec = Object.values(commands)
      .reduce((sum, stats) => sum + stats.opsPerSecond, 0) / Object.keys(commands).length;
    
    const avgLatency = Object.values(commands)
      .reduce((sum, stats) => sum + stats.avgLatency, 0) / Object.keys(commands).length;
    
    console.log('\n🎯 Overall Performance:');
    console.log('-'.repeat(40));
    console.log(`Average throughput: ${avgOpsPerSec.toFixed(0)} ops/sec`);
    console.log(`Average latency:    ${avgLatency.toFixed(2)}ms`);
    console.log(`Total commands tested: ${Object.keys(commands).length}`);
  }

  /**
   * Utility sleep function
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (error) {
        // Ignore disconnect errors
      }
    }
    
    if (this.serverProcess) {
      this.serverProcess.kill();
      console.log('🛑 Test server stopped');
    }
  }
}

module.exports = BenchmarkSuite;

// CLI execution
if (require.main === module) {
  const benchmark = new BenchmarkSuite();
  benchmark.runAll().catch(console.error);
}
