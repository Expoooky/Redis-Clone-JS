/**
 * Pipeline - Redis command pipelining implementation
 * 
 * Features:
 * - Batch multiple commands for efficient execution
 * - Maintains command order
 * - Error handling for individual commands
 * - Non-blocking execution
 */

class Pipeline {
  constructor(client) {
    this.client = client;
    this.commands = [];
    this.results = [];
  }

  /**
   * Add command to pipeline
   */
  _addCommand(command, ...args) {
    this.commands.push([command, ...args]);
    return this;
  }

  /**
   * Execute all commands in pipeline
   */
  async exec() {
    if (this.commands.length === 0) {
      return [];
    }

    if (!this.client.connected) {
      throw new Error('Client is not connected');
    }

    // Create RESP commands string
    const respCommands = this.commands.map(cmd => {
      return `*${cmd.length}\r\n` + cmd.map(arg => `$${arg.length}\r\n${arg}\r\n`).join('');
    }).join('');
    
    // Clear buffer and send all commands
    this.client.buffer = '';
    this.client.socket.write(respCommands);
    
    // Collect all responses
    const results = [];
    const commandCount = this.commands.length;
    const timeout = this.client.options.timeout;
    const start = Date.now();
    
    while (results.length < commandCount && this.client.connected) {
      if (Date.now() - start > timeout) {
        throw new Error('Pipeline execution timeout');
      }
      
      const response = this.client.parseResponse();
      if (response !== null) {
        // Handle error responses but don't throw - pipeline continues
        if (response && response.error) {
          results.push(new Error(response.error));
        } else {
          results.push(response);
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    
    // Clear commands after execution
    this.commands = [];
    
    return results;
  }



  /**
   * Discard pipeline without executing
   */
  discard() {
    this.commands = [];
    return this;
  }

  /**
   * Get number of queued commands
   */
  length() {
    return this.commands.length;
  }

  // Redis command methods for pipeline

  // String commands
  set(key, value, options = {}) {
    const args = [key, value];
    if (options.ex) args.push('EX', options.ex);
    if (options.px) args.push('PX', options.px);
    if (options.nx) args.push('NX');
    if (options.xx) args.push('XX');
    return this._addCommand('SET', ...args);
  }

  get(key) {
    return this._addCommand('GET', key);
  }

  mget(...keys) {
    return this._addCommand('MGET', ...keys);
  }

  mset(...keyValues) {
    return this._addCommand('MSET', ...keyValues);
  }

  del(...keys) {
    return this._addCommand('DEL', ...keys);
  }

  exists(...keys) {
    return this._addCommand('EXISTS', ...keys);
  }

  expire(key, seconds) {
    return this._addCommand('EXPIRE', key, seconds);
  }

  ttl(key) {
    return this._addCommand('TTL', key);
  }

  // List commands
  lpush(key, ...elements) {
    return this._addCommand('LPUSH', key, ...elements);
  }

  rpush(key, ...elements) {
    return this._addCommand('RPUSH', key, ...elements);
  }

  lpop(key) {
    return this._addCommand('LPOP', key);
  }

  rpop(key) {
    return this._addCommand('RPOP', key);
  }

  lrange(key, start, stop) {
    return this._addCommand('LRANGE', key, start, stop);
  }

  llen(key) {
    return this._addCommand('LLEN', key);
  }

  lset(key, index, element) {
    return this._addCommand('LSET', key, index, element);
  }

  lrem(key, count, element) {
    return this._addCommand('LREM', key, count, element);
  }

  ltrim(key, start, stop) {
    return this._addCommand('LTRIM', key, start, stop);
  }

  // Hash commands
  hset(key, ...fieldValues) {
    return this._addCommand('HSET', key, ...fieldValues);
  }

  hget(key, field) {
    return this._addCommand('HGET', key, field);
  }

  hgetall(key) {
    return this._addCommand('HGETALL', key);
  }

  hdel(key, ...fields) {
    return this._addCommand('HDEL', key, ...fields);
  }

  hexists(key, field) {
    return this._addCommand('HEXISTS', key, field);
  }

  hkeys(key) {
    return this._addCommand('HKEYS', key);
  }

  hvals(key) {
    return this._addCommand('HVALS', key);
  }

  hlen(key) {
    return this._addCommand('HLEN', key);
  }

  hincrby(key, field, increment) {
    return this._addCommand('HINCRBY', key, field, increment);
  }

  // Set commands
  sadd(key, ...members) {
    return this._addCommand('SADD', key, ...members);
  }

  srem(key, ...members) {
    return this._addCommand('SREM', key, ...members);
  }

  smembers(key) {
    return this._addCommand('SMEMBERS', key);
  }

  sismember(key, member) {
    return this._addCommand('SISMEMBER', key, member);
  }

  scard(key) {
    return this._addCommand('SCARD', key);
  }

  spop(key, count = null) {
    return count !== null 
      ? this._addCommand('SPOP', key, count)
      : this._addCommand('SPOP', key);
  }

  srandmember(key, count = null) {
    return count !== null
      ? this._addCommand('SRANDMEMBER', key, count)
      : this._addCommand('SRANDMEMBER', key);
  }

  // Sorted set commands
  zadd(key, ...scoreMembers) {
    return this._addCommand('ZADD', key, ...scoreMembers);
  }

  zrem(key, ...members) {
    return this._addCommand('ZREM', key, ...members);
  }

  zrange(key, start, stop, withScores = false) {
    return withScores
      ? this._addCommand('ZRANGE', key, start, stop, 'WITHSCORES')
      : this._addCommand('ZRANGE', key, start, stop);
  }

  zcard(key) {
    return this._addCommand('ZCARD', key);
  }

  zscore(key, member) {
    return this._addCommand('ZSCORE', key, member);
  }

  // Generic commands
  keys(pattern = '*') {
    return this._addCommand('KEYS', pattern);
  }

  type(key) {
    return this._addCommand('TYPE', key);
  }

  rename(key, newKey) {
    return this._addCommand('RENAME', key, newKey);
  }

  renamenx(key, newKey) {
    return this._addCommand('RENAMENX', key, newKey);
  }

  flushall() {
    return this._addCommand('FLUSHALL');
  }

  flushdb() {
    return this._addCommand('FLUSHDB');
  }

  ping(message = null) {
    return message 
      ? this._addCommand('PING', message)
      : this._addCommand('PING');
  }

  echo(message) {
    return this._addCommand('ECHO', message);
  }

  info(section = null) {
    return section 
      ? this._addCommand('INFO', section)
      : this._addCommand('INFO');
  }

  // Utility methods
  multi() {
    return this._addCommand('MULTI');
  }

  execCommand() {
    return this._addCommand('EXEC');
  }

  discardCommand() {
    return this._addCommand('DISCARD');
  }

  watch(...keys) {
    return this._addCommand('WATCH', ...keys);
  }

  unwatch() {
    return this._addCommand('UNWATCH');
  }
}

module.exports = Pipeline;
