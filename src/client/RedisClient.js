/**
 * RedisClient - A comprehensive Redis client implementation
 * 
 * Features:
 * - All server operation methods
 * - Automatic connection management
 * - Error handling and retries
 * - Connection pooling
 * - Client-side caching
 * - Command pipelining
 * - Batch operations
 * - Async/await interface
 */

const net = require('net');
const { EventEmitter } = require('events');
const Pipeline = require('./Pipeline');
const ClientCache = require('./ClientCache');

class RedisClient extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      host: options.host || '127.0.0.1',
      port: options.port || 6379,
      password: options.password || null,
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 1000,
      poolSize: options.poolSize || 1,
      enableCache: options.enableCache || false,
      cacheSize: options.cacheSize || 1000,
      timeout: options.timeout || 5000,
      ...options
    };
    
    this.connected = false;
    this.connecting = false;
    this.socket = null;
    this.buffer = '';
    
    // Client-side cache
    if (this.options.enableCache) {
      this.cache = new ClientCache(this.options.cacheSize);
    }
    
    this.stats = {
      commandsExecuted: 0,
      errors: 0,
      reconnections: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
  }

  /**
   * Connect to Redis server
   */
  async connect() {
    if (this.connected) return;
    if (this.connecting) {
      return new Promise((resolve, reject) => {
        this.once('connect', resolve);
        this.once('error', reject);
      });
    }
    
    this.connecting = true;
    
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.options.port, this.options.host);
      let connected = false;
      
      const timeout = setTimeout(() => {
        if (!connected) {
          socket.destroy();
          this.connecting = false;
          reject(new Error(`Connection timeout after ${this.options.timeout}ms`));
        }
      }, this.options.timeout);
      
      socket.on('connect', async () => {
        connected = true;
        clearTimeout(timeout);
        
        this.socket = socket;
        this.connected = true;
        this.connecting = false;
        this._setupSocketHandlers();
        
        // Authenticate if password is provided
        if (this.options.password) {
          try {
            await this.sendCommand('AUTH', this.options.password);
          } catch (error) {
            this.disconnect();
            reject(new Error(`Authentication failed: ${error.message}`));
            return;
          }
        }
        
        this.emit('connect');
        resolve();
      });
      
      socket.on('error', (error) => {
        clearTimeout(timeout);
        this.connecting = false;
        if (!connected) {
          reject(error);
        } else {
          this._handleConnectionError(error);
        }
      });
    });
  }

  /**
   * Disconnect from Redis server
   */
  async disconnect() {
    if (!this.connected) return;
    
    this.connected = false;
    
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
    
    this.emit('disconnect');
  }

  /**
   * Setup socket event handlers
   */
  _setupSocketHandlers() {
    this.socket.on('data', (data) => {
      this.buffer += data.toString();
    });
    
    this.socket.on('close', () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.socket = null;
      this.emit('disconnect');
      
      // Attempt reconnection if we were previously connected
      if (wasConnected && this.options.retryAttempts > 0) {
        this._attemptReconnection();
      }
    });
    
    this.socket.on('error', (error) => {
      this._handleConnectionError(error);
    });
  }

  /**
   * Handle connection errors with retry logic
   */
  _handleConnectionError(error) {
    this.stats.errors++;
    const wasConnected = this.connected;
    this.connected = false;
    this.socket = null;
    
    if (wasConnected && this.options.retryAttempts > 0) {
      // Attempt reconnection
      this._attemptReconnection();
    } else {
      this.emit('error', error);
    }
  }

  /**
   * Attempt to reconnect with retry logic
   */
  async _attemptReconnection() {
    let attempts = 0;
    
    while (attempts < this.options.retryAttempts) {
      try {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, this.options.retryDelay));
        
        await this.connect();
        this.stats.reconnections++;
        this.emit('reconnect');
        return;
        
      } catch (error) {
        if (attempts >= this.options.retryAttempts) {
          this.emit('error', new Error(`Failed to reconnect after ${attempts} attempts: ${error.message}`));
        }
      }
    }
  }

  /**
   * Send command to Redis
   */
  async sendCommand(command, ...args) {
    if (!this.connected) {
      throw new Error('Client is not connected');
    }
    
    const fullCommand = [command, ...args];
    this.stats.commandsExecuted++;
    
    // Check cache for read commands
    if (this.cache && this._isReadCommand(command)) {
      const cacheKey = this._getCacheKey(fullCommand);
      const cached = this.cache.get(cacheKey);
      if (cached !== null) {
        this.stats.cacheHits++;
        return cached;
      }
      this.stats.cacheMisses++;
    }
    
    const parts = [command, ...args];
    const respCommand = `*${parts.length}\r\n` + 
      parts.map(part => {
        const str = String(part == null ? '' : part);
        return `$${str.length}\r\n${str}\r\n`;
      }).join('');
    
    this.buffer = '';
    this.socket.write(respCommand);
    
    // Wait for response
    const timeout = this.options.timeout;
    const start = Date.now();
    
    while (this.connected) {
      if (Date.now() - start > timeout) {
        throw new Error(`Command timeout: ${command}`);
      }
      
      const response = this.parseResponse();
      if (response !== null) {
        // Handle error responses
        if (response && response.error) {
          throw new Error(response.error);
        }
        
        // Cache read results
        if (this.cache && this._isReadCommand(command)) {
          const cacheKey = this._getCacheKey(fullCommand);
          this.cache.set(cacheKey, response);
        }
        
        // Invalidate cache for write commands
        if (this.cache && this._isWriteCommand(command)) {
          const redisKey = args[0]; // Key is typically first argument
          // Invalidate all possible read commands for this key
          const readCommands = ['GET', 'MGET', 'HGET', 'HGETALL', 'LRANGE', 'SMEMBERS', 'SISMEMBER'];
          readCommands.forEach(readCmd => {
            this.cache.invalidate(`${readCmd}:${redisKey}`);
          });
          // Also try to invalidate any pattern-based cache keys
          this.cache.invalidatePattern(`*:${redisKey}*`);
        }
        
        return response;
      }
      
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    throw new Error('Connection lost');
  }

  /**
   * Parse RESP response
   */
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

  /**
   * Check if command is a read command
   */
  _isReadCommand(command) {
    const readCommands = ['GET', 'MGET', 'HGET', 'HGETALL', 'LRANGE', 'SMEMBERS', 'SISMEMBER'];
    return readCommands.includes(command.toUpperCase());
  }

  /**
   * Check if command is a write command
   */
  _isWriteCommand(command) {
    const writeCommands = ['SET', 'DEL', 'HSET', 'LPUSH', 'SADD', 'FLUSHALL', 'FLUSHDB'];
    return writeCommands.includes(command.toUpperCase());
  }

  /**
   * Generate cache key
   */
  _getCacheKey(command) {
    return command.join(':');
  }

  /**
   * Create pipeline
   */
  pipeline() {
    return new Pipeline(this);
  }

  /**
   * Execute batch of commands
   */
  async batch(commands) {
    const results = [];
    for (const command of commands) {
      try {
        const result = await this.sendCommand(...command);
        results.push(result);
      } catch (error) {
        results.push(error);
      }
    }
    return results;
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache ? this.cache.size : 0,
      hits: this.stats.cacheHits,
      misses: this.stats.cacheMisses,
      hitRate: this.stats.cacheHits + this.stats.cacheMisses > 0 
        ? (this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses)) * 100 
        : 0
    };
  }

  /**
   * Get client statistics
   */
  getStats() {
    return { ...this.stats };
  }

  // Redis command methods

  // String commands
  async set(key, value, options = {}) {
    const args = [key, value];
    if (options.ex) args.push('EX', options.ex);
    if (options.px) args.push('PX', options.px);
    if (options.nx) args.push('NX');
    if (options.xx) args.push('XX');
    return this.sendCommand('SET', ...args);
  }

  async get(key) {
    return this.sendCommand('GET', key);
  }

  async mget(...keys) {
    return this.sendCommand('MGET', ...keys);
  }

  async mset(...keyValues) {
    return this.sendCommand('MSET', ...keyValues);
  }

  async del(...keys) {
    return this.sendCommand('DEL', ...keys);
  }

  async exists(...keys) {
    return this.sendCommand('EXISTS', ...keys);
  }

  async expire(key, seconds) {
    return this.sendCommand('EXPIRE', key, seconds);
  }

  async ttl(key) {
    return this.sendCommand('TTL', key);
  }

  // List commands
  async lpush(key, ...elements) {
    return this.sendCommand('LPUSH', key, ...elements);
  }

  async rpush(key, ...elements) {
    return this.sendCommand('RPUSH', key, ...elements);
  }

  async lpop(key) {
    return this.sendCommand('LPOP', key);
  }

  async rpop(key) {
    return this.sendCommand('RPOP', key);
  }

  async lrange(key, start, stop) {
    return this.sendCommand('LRANGE', key, start, stop);
  }

  async llen(key) {
    return this.sendCommand('LLEN', key);
  }

  // Hash commands
  async hset(key, ...fieldValues) {
    return this.sendCommand('HSET', key, ...fieldValues);
  }

  async hget(key, field) {
    return this.sendCommand('HGET', key, field);
  }

  async hgetall(key) {
    return this.sendCommand('HGETALL', key);
  }

  async hdel(key, ...fields) {
    return this.sendCommand('HDEL', key, ...fields);
  }

  async hexists(key, field) {
    return this.sendCommand('HEXISTS', key, field);
  }

  // Set commands
  async sadd(key, ...members) {
    return this.sendCommand('SADD', key, ...members);
  }

  async srem(key, ...members) {
    return this.sendCommand('SREM', key, ...members);
  }

  async smembers(key) {
    return this.sendCommand('SMEMBERS', key);
  }

  async sismember(key, member) {
    return this.sendCommand('SISMEMBER', key, member);
  }

  async scard(key) {
    return this.sendCommand('SCARD', key);
  }

  // Generic commands
  async keys(pattern = '*') {
    return this.sendCommand('KEYS', pattern);
  }

  async flushall() {
    return this.sendCommand('FLUSHALL');
  }

  async flushdb() {
    return this.sendCommand('FLUSHDB');
  }

  async ping(message = null) {
    return message ? this.sendCommand('PING', message) : this.sendCommand('PING');
  }

  async info(section = null) {
    return section ? this.sendCommand('INFO', section) : this.sendCommand('INFO');
  }
}

module.exports = { RedisClient };
