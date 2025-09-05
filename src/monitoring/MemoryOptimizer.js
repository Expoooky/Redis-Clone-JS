/**
 * MemoryOptimizer - Advanced memory management and optimization
 * 
 * Features:
 * - Memory usage tracking and optimization
 * - Automatic garbage collection triggering
 * - Memory leak detection
 * - Cache optimization
 * - Key eviction policies (LRU, LFU, TTL)
 * - Memory fragmentation analysis
 */

const { EventEmitter } = require('events');
const logger = require('../utils/Logger');
const config = require('../utils/Config');

class MemoryOptimizer extends EventEmitter {
  constructor(dataStore, options = {}) {
    super();
    
    this.dataStore = dataStore;
    this.options = {
      maxMemoryPolicy: options.maxMemoryPolicy || config.get('memory.maxMemoryPolicy', 'allkeys-lru'),
      maxMemoryThreshold: options.maxMemoryThreshold || 0.8, // 80%
      gcThreshold: options.gcThreshold || 0.9, // 90% - trigger GC
      optimizationInterval: options.optimizationInterval || 30000, // 30 seconds
      fragmentationThreshold: options.fragmentationThreshold || 1.5,
      enabled: options.enabled !== false,
      ...options
    };
    
    this.stats = {
      totalKeys: 0,
      memoryUsage: 0,
      estimatedSize: 0,
      fragmentation: 1.0,
      evictions: 0,
      gcRuns: 0,
      optimizations: 0,
      keysByType: new Map(),
      keysByDatabase: new Map(),
      sizeDistribution: {
        small: 0,    // < 1KB
        medium: 0,   // 1KB - 100KB
        large: 0,    // 100KB - 1MB
        huge: 0      // > 1MB
      }
    };
    
    this.keyAccessTimes = new Map(); // key -> last access time
    this.keyFrequency = new Map(); // key -> access count
    this.keySizes = new Map(); // key -> estimated size
    this.keyCreationTimes = new Map(); // key -> creation time
    
    this.optimizationTimer = null;
    
    if (this.options.enabled) {
      this.start();
    }
  }

  /**
   * Start memory optimization
   */
  start() {
    if (this.optimizationTimer) return;
    
    logger.info('Starting memory optimization', {
      policy: this.options.maxMemoryPolicy,
      threshold: this.options.maxMemoryThreshold,
      component: 'MemoryOptimizer'
    });
    
    this.optimizationTimer = setInterval(() => {
      this.optimize();
    }, this.options.optimizationInterval);
    
    // Initial optimization
    this.analyze();
  }

  /**
   * Stop memory optimization
   */
  stop() {
    if (this.optimizationTimer) {
      clearInterval(this.optimizationTimer);
      this.optimizationTimer = null;
      
      logger.info('Memory optimization stopped', { component: 'MemoryOptimizer' });
    }
  }

  /**
   * Perform memory optimization
   */
  optimize() {
    this.analyze();
    
    const memoryUsage = this.getMemoryUsagePercentage();
    
    // Check if we need to free memory
    if (memoryUsage > this.options.maxMemoryThreshold) {
      this.freeMemory();
    }
    
    // Check if we need garbage collection
    if (memoryUsage > this.options.gcThreshold) {
      this.triggerGarbageCollection();
    }
    
    // Check for memory fragmentation
    if (this.stats.fragmentation > this.options.fragmentationThreshold) {
      this.defragment();
    }
    
    this.stats.optimizations++;
    this.emit('optimized', this.getStats());
  }

  /**
   * Analyze current memory usage
   */
  analyze() {
    this.stats.totalKeys = 0;
    this.stats.estimatedSize = 0;
    this.stats.keysByType.clear();
    this.stats.keysByDatabase.clear();
    this.stats.sizeDistribution = { small: 0, medium: 0, large: 0, huge: 0 };
    
    // Analyze all databases
    for (let dbIndex = 0; dbIndex < this.dataStore.maxDatabases; dbIndex++) {
      const db = this.dataStore.databases.get(dbIndex);
      if (!db) continue;
      
      let dbKeyCount = 0;
      let dbSize = 0;
      
      for (const [key, value] of db.data.entries()) {
        this.stats.totalKeys++;
        dbKeyCount++;
        
        const keySize = this.estimateKeySize(key, value);
        this.keySizes.set(key, keySize);
        this.stats.estimatedSize += keySize;
        dbSize += keySize;
        
        // Track by type
        const type = this.getValueType(value);
        this.stats.keysByType.set(type, (this.stats.keysByType.get(type) || 0) + 1);
        
        // Track by size
        this.categorizeBySize(keySize);
        
        // Update access tracking
        this.trackKeyAccess(key);
      }
      
      this.stats.keysByDatabase.set(dbIndex, { keys: dbKeyCount, size: dbSize });
    }
    
    // Calculate fragmentation
    this.calculateFragmentation();
    
    // Clean up stale tracking data
    this.cleanupTrackingData();
  }

  /**
   * Free memory by evicting keys
   */
  freeMemory() {
    const targetReduction = 0.1; // Free 10% of memory
    const targetSize = this.stats.estimatedSize * (1 - targetReduction);
    let freedSize = 0;
    
    const keysToEvict = this.selectKeysForEviction(targetReduction);
    
    logger.info('Starting memory eviction', {
      policy: this.options.maxMemoryPolicy,
      keysToEvict: keysToEvict.length,
      targetReduction: `${(targetReduction * 100).toFixed(1)}%`,
      component: 'MemoryOptimizer'
    });
    
    for (const { key, dbIndex, size } of keysToEvict) {
      if (freedSize >= (this.stats.estimatedSize * targetReduction)) break;
      
      try {
        // Use the DataStore API correctly
        if (this.dataStore.select) {
          this.dataStore.select(dbIndex);
        }
        
        if (this.dataStore.del) {
          this.dataStore.del(key);
        } else if (this.dataStore.databases) {
          // Direct manipulation if del method doesn't exist
          const db = this.dataStore.databases.get(dbIndex);
          if (db && db.data) {
            db.data.delete(key);
            db.keyCount = Math.max(0, db.keyCount - 1);
          }
        }
        
        freedSize += size;
        this.stats.evictions++;
        
        // Clean up tracking
        this.keyAccessTimes.delete(key);
        this.keyFrequency.delete(key);
        this.keySizes.delete(key);
        this.keyCreationTimes.delete(key);
        
      } catch (error) {
        logger.error('Failed to evict key', { key, error: error.message, component: 'MemoryOptimizer' });
      }
    }
    
    logger.info('Memory eviction completed', {
      keysEvicted: keysToEvict.length,
      sizeFreed: this.formatBytes(freedSize),
      component: 'MemoryOptimizer'
    });
    
    this.emit('eviction', { keysEvicted: keysToEvict.length, sizeFreed: freedSize });
  }

  /**
   * Select keys for eviction based on policy
   */
  selectKeysForEviction(targetReduction) {
    const keys = [];
    
    // Collect all keys with metadata
    for (let dbIndex = 0; dbIndex < this.dataStore.maxDatabases; dbIndex++) {
      const db = this.dataStore.databases.get(dbIndex);
      if (!db) continue;
      
      for (const [key] of db.data.entries()) {
        const size = this.keySizes.get(key) || 0;
        const lastAccess = this.keyAccessTimes.get(key) || 0;
        const frequency = this.keyFrequency.get(key) || 0;
        const creationTime = this.keyCreationTimes.get(key) || Date.now();
        
        keys.push({
          key,
          dbIndex,
          size,
          lastAccess,
          frequency,
          creationTime,
          score: this.calculateEvictionScore(key, size, lastAccess, frequency, creationTime)
        });
      }
    }
    
    // Sort by eviction score (higher score = more likely to evict)
    keys.sort((a, b) => b.score - a.score);
    
    // Select keys to evict
    const targetKeys = Math.ceil(keys.length * targetReduction);
    return keys.slice(0, targetKeys);
  }

  /**
   * Calculate eviction score based on policy
   */
  calculateEvictionScore(key, size, lastAccess, frequency, creationTime) {
    const now = Date.now();
    const age = now - creationTime;
    const timeSinceAccess = now - lastAccess;
    
    switch (this.options.maxMemoryPolicy) {
      case 'allkeys-lru':
        return timeSinceAccess;
        
      case 'allkeys-lfu':
        return frequency > 0 ? 1 / frequency : Infinity;
        
      case 'allkeys-random':
        return Math.random();
        
      case 'volatile-lru':
        // Only evict keys with expiration
        return this.dataStore.keyExpiration && this.dataStore.keyExpiration.hasExpiration(key) 
          ? timeSinceAccess : 0;
          
      case 'volatile-lfu':
        return this.dataStore.keyExpiration && this.dataStore.keyExpiration.hasExpiration(key)
          ? (frequency > 0 ? 1 / frequency : Infinity) : 0;
          
      case 'volatile-ttl':
        if (this.dataStore.keyExpiration && this.dataStore.keyExpiration.hasExpiration(key)) {
          const ttl = this.dataStore.keyExpiration.ttl(key);
          return ttl.success ? ttl.value : 0;
        }
        return 0;
        
      case 'allkeys-size':
        return size;
        
      default:
        return timeSinceAccess; // Default to LRU
    }
  }

  /**
   * Trigger garbage collection
   */
  triggerGarbageCollection() {
    if (global.gc) {
      logger.info('Triggering garbage collection', { component: 'MemoryOptimizer' });
      
      const memBefore = process.memoryUsage();
      global.gc();
      const memAfter = process.memoryUsage();
      
      const freed = memBefore.heapUsed - memAfter.heapUsed;
      this.stats.gcRuns++;
      
      logger.info('Garbage collection completed', {
        freed: this.formatBytes(freed),
        heapBefore: this.formatBytes(memBefore.heapUsed),
        heapAfter: this.formatBytes(memAfter.heapUsed),
        component: 'MemoryOptimizer'
      });
      
      this.emit('gc', { freed, memBefore, memAfter });
    } else {
      logger.warn('Garbage collection not available (use --expose-gc flag)', { component: 'MemoryOptimizer' });
    }
  }

  /**
   * Defragment memory (reorganize data structures)
   */
  defragment() {
    logger.info('Starting memory defragmentation', { 
      fragmentation: this.stats.fragmentation.toFixed(2),
      component: 'MemoryOptimizer' 
    });
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    // Reorganize data structures by recreating Maps
    for (let dbIndex = 0; dbIndex < this.dataStore.maxDatabases; dbIndex++) {
      const db = this.dataStore.databases.get(dbIndex);
      if (!db || db.data.size === 0) continue;
      
      const entries = Array.from(db.data.entries());
      db.data.clear();
      
      for (const [key, value] of entries) {
        db.data.set(key, value);
      }
    }
    
    this.emit('defragmented', { fragmentation: this.stats.fragmentation });
  }

  /**
   * Track key access for LRU/LFU policies
   */
  trackKeyAccess(key) {
    const now = Date.now();
    this.keyAccessTimes.set(key, now);
    this.keyFrequency.set(key, (this.keyFrequency.get(key) || 0) + 1);
    
    if (!this.keyCreationTimes.has(key)) {
      this.keyCreationTimes.set(key, now);
    }
  }

  /**
   * Clean up stale tracking data
   */
  cleanupTrackingData() {
    const allKeys = new Set();
    
    // Collect all existing keys
    for (let dbIndex = 0; dbIndex < this.dataStore.maxDatabases; dbIndex++) {
      const db = this.dataStore.databases.get(dbIndex);
      if (!db) continue;
      
      for (const key of db.data.keys()) {
        allKeys.add(key);
      }
    }
    
    // Clean up tracking for deleted keys
    for (const key of this.keyAccessTimes.keys()) {
      if (!allKeys.has(key)) {
        this.keyAccessTimes.delete(key);
        this.keyFrequency.delete(key);
        this.keySizes.delete(key);
        this.keyCreationTimes.delete(key);
      }
    }
  }

  /**
   * Estimate key size in bytes
   */
  estimateKeySize(key, value) {
    let size = key.length * 2; // Key size (assuming UTF-16)
    
    if (value === null || value === undefined) {
      return size + 8;
    }
    
    switch (typeof value) {
      case 'string':
        size += value.length * 2;
        break;
      case 'number':
        size += 8;
        break;
      case 'boolean':
        size += 4;
        break;
      case 'object':
        if (Array.isArray(value)) {
          size += 24; // Array overhead
          size += value.reduce((sum, item) => sum + this.estimateValueSize(item), 0);
        } else if (value instanceof Set) {
          size += 24; // Set overhead
          for (const item of value) {
            size += this.estimateValueSize(item);
          }
        } else if (value instanceof Map) {
          size += 24; // Map overhead
          for (const [k, v] of value) {
            size += this.estimateValueSize(k) + this.estimateValueSize(v);
          }
        } else {
          size += JSON.stringify(value).length * 2;
        }
        break;
      default:
        size += 16; // Default overhead
    }
    
    return size;
  }

  /**
   * Estimate individual value size
   */
  estimateValueSize(value) {
    if (value === null || value === undefined) return 8;
    
    switch (typeof value) {
      case 'string': return value.length * 2;
      case 'number': return 8;
      case 'boolean': return 4;
      case 'object': return JSON.stringify(value).length * 2;
      default: return 16;
    }
  }

  /**
   * Get value type
   */
  getValueType(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    if (Array.isArray(value)) return 'list';
    if (value instanceof Set) return 'set';
    if (value instanceof Map) return 'hash';
    return 'object';
  }

  /**
   * Categorize key by size
   */
  categorizeBySize(size) {
    if (size < 1024) {
      this.stats.sizeDistribution.small++;
    } else if (size < 102400) {
      this.stats.sizeDistribution.medium++;
    } else if (size < 1048576) {
      this.stats.sizeDistribution.large++;
    } else {
      this.stats.sizeDistribution.huge++;
    }
  }

  /**
   * Calculate memory fragmentation
   */
  calculateFragmentation() {
    const memInfo = process.memoryUsage();
    this.stats.memoryUsage = memInfo.heapUsed;
    
    if (this.stats.estimatedSize > 0) {
      this.stats.fragmentation = memInfo.heapUsed / this.stats.estimatedSize;
    } else {
      this.stats.fragmentation = 1.0;
    }
  }

  /**
   * Get memory usage percentage
   */
  getMemoryUsagePercentage() {
    const memInfo = process.memoryUsage();
    const maxMemory = this.dataStore.maxMemory || (1024 * 1024 * 1024); // 1GB default
    return (memInfo.heapUsed / maxMemory) * 100;
  }

  /**
   * Format bytes to human readable
   */
  formatBytes(bytes) {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  }

  /**
   * Get optimization statistics
   */
  getStats() {
    return {
      ...this.stats,
      memoryUsage: this.formatBytes(this.stats.memoryUsage),
      estimatedSize: this.formatBytes(this.stats.estimatedSize),
      fragmentation: this.stats.fragmentation.toFixed(2),
      policy: this.options.maxMemoryPolicy,
      thresholds: {
        maxMemory: this.options.maxMemoryThreshold,
        gc: this.options.gcThreshold,
        fragmentation: this.options.fragmentationThreshold
      }
    };
  }

  /**
   * Get memory summary
   */
  getSummary() {
    return {
      totalKeys: this.stats.totalKeys,
      memoryUsage: this.formatBytes(this.stats.memoryUsage),
      estimatedSize: this.formatBytes(this.stats.estimatedSize),
      fragmentation: this.stats.fragmentation.toFixed(2),
      evictions: this.stats.evictions,
      policy: this.options.maxMemoryPolicy,
      status: this.getMemoryUsagePercentage() > (this.options.maxMemoryThreshold * 100) ? 'high' : 'normal'
    };
  }
}

module.exports = MemoryOptimizer;
