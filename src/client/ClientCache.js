/**
 * ClientCache - Client-side caching with invalidation
 * 
 * Features:
 * - LRU (Least Recently Used) eviction policy
 * - Key-based invalidation
 * - TTL support
 * - Memory-efficient storage
 * - Cache statistics
 */

class ClientCache {
  constructor(maxSize = 1000, defaultTTL = null) {
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
    this.cache = new Map();
    this.keyOrder = new Map(); // For LRU tracking
    this.accessOrder = 0;
    
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      invalidations: 0
    };
  }

  /**
   * Get value from cache
   */
  get(key) {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    
    // Check if entry has expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.keyOrder.delete(key);
      this.stats.misses++;
      return null;
    }
    
    // Update access order for LRU
    this.accessOrder++;
    this.keyOrder.set(key, this.accessOrder);
    entry.lastAccessed = Date.now();
    
    this.stats.hits++;
    return entry.value;
  }

  /**
   * Set value in cache
   */
  set(key, value, ttl = null) {
    const now = Date.now();
    const effectiveTTL = ttl || this.defaultTTL;
    
    const entry = {
      value: this._cloneValue(value),
      createdAt: now,
      lastAccessed: now,
      expiresAt: effectiveTTL ? now + (effectiveTTL * 1000) : null
    };
    
    // If key already exists, update it
    if (this.cache.has(key)) {
      this.cache.set(key, entry);
      this.accessOrder++;
      this.keyOrder.set(key, this.accessOrder);
      return;
    }
    
    // Check if we need to evict entries
    if (this.cache.size >= this.maxSize) {
      this._evictLRU();
    }
    
    // Add new entry
    this.cache.set(key, entry);
    this.accessOrder++;
    this.keyOrder.set(key, this.accessOrder);
  }

  /**
   * Check if key exists in cache
   */
  has(key) {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return false;
    }
    
    // Check if entry has expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.keyOrder.delete(key);
      return false;
    }
    
    return true;
  }

  /**
   * Delete specific key from cache
   */
  delete(key) {
    const deleted = this.cache.delete(key);
    this.keyOrder.delete(key);
    return deleted;
  }

  /**
   * Invalidate cache entry (delete)
   */
  invalidate(key) {
    if (this.delete(key)) {
      this.stats.invalidations++;
    }
  }

  /**
   * Invalidate multiple keys matching pattern
   */
  invalidatePattern(pattern) {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    const keysToDelete = [];
    
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.invalidate(key));
    return keysToDelete.length;
  }

  /**
   * Clear all cache entries
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.keyOrder.clear();
    this.accessOrder = 0;
    return size;
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    const now = Date.now();
    const keysToDelete = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => {
      this.cache.delete(key);
      this.keyOrder.delete(key);
    });
    
    return keysToDelete.length;
  }

  /**
   * Evict least recently used entry
   */
  _evictLRU() {
    if (this.cache.size === 0) return;
    
    let oldestKey = null;
    let oldestOrder = Infinity;
    
    for (const [key, order] of this.keyOrder.entries()) {
      if (order < oldestOrder) {
        oldestOrder = order;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.keyOrder.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  /**
   * Clone value to prevent external mutations
   */
  _cloneValue(value) {
    if (value === null || value === undefined) {
      return value;
    }
    
    if (typeof value === 'object') {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch (error) {
        // If serialization fails, return original value
        return value;
      }
    }
    
    return value;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const totalRequests = this.stats.hits + this.stats.misses;
    
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: totalRequests > 0 ? (this.stats.hits / totalRequests) * 100 : 0,
      evictions: this.stats.evictions,
      invalidations: this.stats.invalidations,
      memoryEstimate: this._estimateMemoryUsage()
    };
  }

  /**
   * Reset cache statistics
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      invalidations: 0
    };
  }

  /**
   * Get all cache keys
   */
  keys() {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache size
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Check if cache is empty
   */
  isEmpty() {
    return this.cache.size === 0;
  }

  /**
   * Check if cache is full
   */
  isFull() {
    return this.cache.size >= this.maxSize;
  }

  /**
   * Get cache utilization percentage
   */
  getUtilization() {
    return (this.cache.size / this.maxSize) * 100;
  }

  /**
   * Estimate memory usage (rough approximation)
   */
  _estimateMemoryUsage() {
    let totalSize = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      // Estimate key size
      totalSize += key.length * 2; // Rough estimate for string
      
      // Estimate value size
      if (typeof entry.value === 'string') {
        totalSize += entry.value.length * 2;
      } else if (typeof entry.value === 'number') {
        totalSize += 8;
      } else if (entry.value === null || entry.value === undefined) {
        totalSize += 8;
      } else {
        // For objects/arrays, use JSON string length as approximation
        try {
          totalSize += JSON.stringify(entry.value).length * 2;
        } catch (error) {
          totalSize += 100; // Fallback estimate
        }
      }
      
      // Add overhead for entry object
      totalSize += 64; // Rough estimate for metadata
    }
    
    return totalSize;
  }

  /**
   * Get entries sorted by access time
   */
  getEntriesByAccessTime(limit = 10) {
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      value: entry.value,
      createdAt: entry.createdAt,
      lastAccessed: entry.lastAccessed,
      expiresAt: entry.expiresAt,
      accessOrder: this.keyOrder.get(key)
    }));
    
    entries.sort((a, b) => b.lastAccessed - a.lastAccessed);
    
    return entries.slice(0, limit);
  }

  /**
   * Get cache hit ratio over time window
   */
  getHitRatio() {
    const totalRequests = this.stats.hits + this.stats.misses;
    return totalRequests > 0 ? this.stats.hits / totalRequests : 0;
  }

  /**
   * Optimize cache by cleaning expired entries and reorganizing
   */
  optimize() {
    const expiredCount = this.cleanup();
    
    // If cache is still too full, evict some LRU entries
    const targetSize = Math.floor(this.maxSize * 0.8); // Target 80% capacity
    let evictedCount = 0;
    
    while (this.cache.size > targetSize) {
      this._evictLRU();
      evictedCount++;
    }
    
    return {
      expiredRemoved: expiredCount,
      lruEvicted: evictedCount,
      finalSize: this.cache.size
    };
  }
}

module.exports = ClientCache;
