/**
 * ACL - Access Control Lists for Redis
 * 
 * Features:
 * - Role-based access control
 * - Command-level permissions
 * - Key pattern-based access control
 * - Channel pattern permissions (pub/sub)
 * - User and role management
 * - Permission inheritance
 * - Real-time permission checking
 */

const { EventEmitter } = require('events');
const logger = require('../utils/Logger');

class ACL extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      enabled: options.enabled || false,
      defaultUser: options.defaultUser || 'default',
      strictMode: options.strictMode || false,
      inheritanceEnabled: options.inheritanceEnabled !== false,
      cachePermissions: options.cachePermissions !== false,
      ...options
    };
    
    // Core ACL data structures
    this.users = new Map(); // username -> user data
    this.roles = new Map(); // roleName -> role data
    this.permissions = new Map(); // Cached permissions for performance
    this.commandCategories = new Map(); // Command categorization
    
    // Initialize system
    this.initializeACL();
  }

  /**
   * Initialize ACL system
   */
  initializeACL() {
    // Create default roles
    this.createDefaultRoles();
    
    // Create default user if enabled
    if (this.options.enabled && !this.users.has(this.options.defaultUser)) {
      this.createUser(this.options.defaultUser, null, ['default']);
    }
    
    // Initialize command categories
    this.initializeCommandCategories();
    
    logger.info('ACL system initialized', {
      enabled: this.options.enabled,
      defaultUser: this.options.defaultUser,
      strictMode: this.options.strictMode,
      component: 'ACL'
    });
  }

  /**
   * Check if ACL is enabled
   */
  isEnabled() {
    return this.options.enabled;
  }

  /**
   * Create default roles
   */
  createDefaultRoles() {
    // Admin role - all permissions
    this.createRole('admin', {
      commands: ['*'],
      keys: ['*'],
      channels: ['*'],
      description: 'Full administrative access'
    });
    
    // Default role - basic permissions
    this.createRole('default', {
      commands: ['ping', 'info', 'hello', 'auth', 'quit'],
      keys: ['*'],
      channels: [],
      description: 'Basic user permissions'
    });
    
    // Read-only role
    this.createRole('readonly', {
      commands: [
        'get', 'mget', 'exists', 'keys', 'scan', 'type', 'ttl', 'pttl',
        'lrange', 'llen', 'lindex', 'smembers', 'scard', 'sismember',
        'hget', 'hmget', 'hgetall', 'hkeys', 'hvals', 'hlen', 'hexists',
        'zrange', 'zrangebyscore', 'zcard', 'zscore', 'zrank',
        'info', 'ping', 'echo', 'time', 'lastsave'
      ],
      keys: ['*'],
      channels: ['*'], // Can subscribe to all channels
      description: 'Read-only access to data'
    });
    
    // Write role
    this.createRole('writer', {
      commands: [
        'set', 'mset', 'del', 'expire', 'persist', 'rename',
        'lpush', 'rpush', 'lpop', 'rpop', 'lset', 'ltrim',
        'sadd', 'srem', 'spop', 'smove',
        'hset', 'hmset', 'hdel', 'hincrby',
        'zadd', 'zrem', 'zincrby', 'zremrangebyscore',
        'publish'
      ],
      keys: ['*'],
      channels: ['*'],
      description: 'Write access to data'
    });
    
    // Cache role - for application caching
    this.createRole('cache', {
      commands: [
        'get', 'set', 'del', 'exists', 'expire', 'ttl',
        'mget', 'mset', 'incr', 'decr', 'incrby', 'decrby'
      ],
      keys: ['cache:*', 'session:*', 'temp:*'],
      channels: [],
      description: 'Application caching access'
    });
  }

  /**
   * Initialize command categories
   */
  initializeCommandCategories() {
    const categories = {
      read: [
        'get', 'mget', 'exists', 'keys', 'scan', 'type', 'ttl', 'pttl',
        'lrange', 'llen', 'lindex', 'smembers', 'scard', 'sismember',
        'hget', 'hmget', 'hgetall', 'hkeys', 'hvals', 'hlen', 'hexists',
        'zrange', 'zrangebyscore', 'zcard', 'zscore', 'zrank'
      ],
      write: [
        'set', 'mset', 'del', 'expire', 'persist', 'rename',
        'lpush', 'rpush', 'lpop', 'rpop', 'lset', 'ltrim',
        'sadd', 'srem', 'spop', 'smove',
        'hset', 'hmset', 'hdel', 'hincrby',
        'zadd', 'zrem', 'zincrby', 'zremrangebyscore'
      ],
      admin: [
        'flushdb', 'flushall', 'config', 'shutdown', 'debug',
        'save', 'bgsave', 'lastsave', 'dbsize', 'info', 'monitor'
      ],
      pubsub: ['publish', 'subscribe', 'unsubscribe', 'psubscribe', 'punsubscribe'],
      connection: ['auth', 'ping', 'echo', 'quit', 'select', 'hello'],
      scripting: ['eval', 'evalsha', 'script'],
      transaction: ['multi', 'exec', 'discard', 'watch', 'unwatch']
    };
    
    for (const [category, commands] of Object.entries(categories)) {
      this.commandCategories.set(category, new Set(commands));
      
      // Also map individual commands to their categories
      commands.forEach(cmd => {
        if (!this.commandCategories.has(cmd)) {
          this.commandCategories.set(cmd, new Set());
        }
        this.commandCategories.get(cmd).add(category);
      });
    }
  }

  /**
   * Create a new role
   */
  createRole(roleName, permissions = {}) {
    if (this.roles.has(roleName)) {
      // Don't throw error, just update existing role
      const existingRole = this.roles.get(roleName)
      if (permissions.commands) {
        existingRole.commands = new Set(permissions.commands)
      }
      if (permissions.keys) {
        existingRole.keys = new Set(permissions.keys)
      }
      if (permissions.channels) {
        existingRole.channels = new Set(permissions.channels)
      }
      return
    }
    
    const role = {
      name: roleName,
      commands: new Set(permissions.commands || []),
      keys: new Set(permissions.keys || []),
      channels: new Set(permissions.channels || []),
      description: permissions.description || '',
      inherits: new Set(permissions.inherits || []),
      createdAt: Date.now(),
      active: true
    };
    
    this.roles.set(roleName, role);
    
    // Clear permission cache as roles changed
    if (this.options.cachePermissions) {
      this.permissions.clear();
    }
    
    logger.info('Role created', {
      roleName,
      commands: Array.from(role.commands),
      component: 'ACL'
    });
    
    this.emit('roleCreated', { roleName, permissions });
  }

  /**
   * Create a new user
   */
  async createUser(username, password = null, roles = []) {
    if (this.users.has(username)) {
      throw new Error(`User ${username} already exists`);
    }
    
    const user = {
      username,
      roles: new Set(roles),
      active: true,
      createdAt: Date.now(),
      lastAccess: null,
      // Custom permissions (override role permissions)
      customCommands: new Set(),
      customKeys: new Set(),
      customChannels: new Set(),
      // Denied permissions (explicit denials)
      deniedCommands: new Set(),
      deniedKeys: new Set(),
      deniedChannels: new Set()
    };
    
    this.users.set(username, user);
    
    // Clear permission cache
    if (this.options.cachePermissions) {
      this.permissions.clear();
    }
    
    logger.info('ACL user created', {
      username,
      roles,
      component: 'ACL'
    });
    
    this.emit('userCreated', { username, roles });
  }

  /**
   * Delete a user
   */
  deleteUser(username) {
    if (!this.users.has(username)) {
      throw new Error(`User ${username} not found`);
    }
    
    this.users.delete(username);
    
    // Clear permission cache
    if (this.options.cachePermissions) {
      this.permissions.clear();
    }
    
    logger.info('ACL user deleted', { username, component: 'ACL' });
    this.emit('userDeleted', { username });
  }

  /**
   * Check if user exists
   */
  userExists(username) {
    return this.users.has(username);
  }

  /**
   * Get user roles
   */
  getUserRoles(username) {
    const user = this.users.get(username);
    return user ? Array.from(user.roles) : [];
  }

  /**
   * Add role to user
   */
  addUserRole(username, roleName) {
    const user = this.users.get(username);
    if (!user) {
      throw new Error(`User ${username} not found`);
    }
    
    if (!this.roles.has(roleName)) {
      throw new Error(`Role ${roleName} not found`);
    }
    
    user.roles.add(roleName);
    
    // Clear permission cache
    if (this.options.cachePermissions) {
      this.permissions.clear();
    }
    
    logger.info('Role added to user', { username, roleName, component: 'ACL' });
    this.emit('roleAdded', { username, roleName });
  }

  /**
   * Remove role from user
   */
  removeUserRole(username, roleName) {
    const user = this.users.get(username);
    if (!user) {
      throw new Error(`User ${username} not found`);
    }
    
    user.roles.delete(roleName);
    
    // Clear permission cache
    if (this.options.cachePermissions) {
      this.permissions.clear();
    }
    
    logger.info('Role removed from user', { username, roleName, component: 'ACL' });
    this.emit('roleRemoved', { username, roleName });
  }

  /**
   * Check command permission for user
   */
  checkPermission(username, command, key = null, channel = null) {
    if (!this.options.enabled) {
      return true; // ACL disabled, allow all
    }
    
    const user = this.users.get(username);
    if (!user) {
      return this.options.strictMode ? false : true;
    }
    
    if (!user.active) {
      return false;
    }
    
    // Update last access
    user.lastAccess = Date.now();
    
    // Check cache first
    const cacheKey = `${username}:${command}:${key || '*'}:${channel || '*'}`;
    if (this.options.cachePermissions && this.permissions.has(cacheKey)) {
      return this.permissions.get(cacheKey);
    }
    
    const result = this.evaluatePermission(user, command, key, channel);
    
    // Cache result
    if (this.options.cachePermissions) {
      this.permissions.set(cacheKey, result);
      
      // Limit cache size
      if (this.permissions.size > 10000) {
        const entries = Array.from(this.permissions.entries());
        this.permissions.clear();
        // Keep most recent half
        entries.slice(-5000).forEach(([k, v]) => this.permissions.set(k, v));
      }
    }
    
    return result;
  }

  /**
   * Evaluate permission for user
   */
  evaluatePermission(user, command, key, channel) {
    const commandLower = command.toLowerCase();
    
    // Check explicit denials first
    if (user.deniedCommands.has('*') || user.deniedCommands.has(commandLower)) {
      return false;
    }
    
    // Check key denial
    if (key && this.isKeyDenied(user, key)) {
      return false;
    }
    
    // Check channel denial
    if (channel && this.isChannelDenied(user, channel)) {
      return false;
    }
    
    // Check custom permissions (highest priority)
    if (user.customCommands.has('*') || user.customCommands.has(commandLower)) {
      return this.checkKeyAndChannelPermission(user, key, channel, 'custom');
    }
    
    // Check role-based permissions
    const hasRolePermission = this.checkRolePermissions(user, commandLower, key, channel);
    if (hasRolePermission) {
      return true;
    }
    
    // Check command categories
    const hasCategory = this.checkCategoryPermissions(user, commandLower);
    if (hasCategory) {
      return this.checkKeyAndChannelPermission(user, key, channel, 'role');
    }
    
    return false;
  }

  /**
   * Check role-based permissions
   */
  checkRolePermissions(user, command, key, channel) {
    for (const roleName of user.roles) {
      const role = this.roles.get(roleName);
      if (!role || !role.active) continue;
      
      // Check direct command permission
      if (role.commands.has('*') || role.commands.has(command)) {
        if (this.checkRoleKeyPermission(role, key) && 
            this.checkRoleChannelPermission(role, channel)) {
          return true;
        }
      }
      
      // Check inherited permissions
      if (this.options.inheritanceEnabled) {
        if (this.checkInheritedPermissions(role, command, key, channel)) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Check inherited permissions from parent roles
   */
  checkInheritedPermissions(role, command, key, channel) {
    for (const parentRole of role.inherits) {
      const parent = this.roles.get(parentRole);
      if (!parent || !parent.active) continue;
      
      if (parent.commands.has('*') || parent.commands.has(command)) {
        if (this.checkRoleKeyPermission(parent, key) && 
            this.checkRoleChannelPermission(parent, channel)) {
          return true;
        }
      }
      
      // Recursive inheritance
      if (this.checkInheritedPermissions(parent, command, key, channel)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check category-based permissions
   */
  checkCategoryPermissions(user, command) {
    // Get command categories
    const commandCategories = this.commandCategories.get(command);
    if (!commandCategories || !commandCategories[Symbol.iterator]) return false;
    
    // Check if user has permission for any category this command belongs to
    const userRoles = user.roles instanceof Set ? user.roles : new Set(user.roles || []);
    for (const roleName of userRoles) {
      const role = this.roles.get(roleName);
      if (!role || !role.active) continue;
      
      for (const category of commandCategories) {
        if (role.commands.has(`@${category}`)) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Check key permission for role
   */
  checkRoleKeyPermission(role, key) {
    if (!key || role.keys.has('*')) return true;
    
    for (const pattern of role.keys) {
      if (this.matchPattern(key, pattern)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check channel permission for role
   */
  checkRoleChannelPermission(role, channel) {
    if (!channel || role.channels.has('*')) return true;
    
    for (const pattern of role.channels) {
      if (this.matchPattern(channel, pattern)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check key and channel permissions for user
   */
  checkKeyAndChannelPermission(user, key, channel, source) {
    let keyOk = true;
    let channelOk = true;
    
    if (key) {
      if (source === 'custom') {
        keyOk = user.customKeys.has('*') || 
                Array.from(user.customKeys).some(pattern => this.matchPattern(key, pattern));
      } else {
        // Already checked in role permissions
        keyOk = true;
      }
    }
    
    if (channel) {
      if (source === 'custom') {
        channelOk = user.customChannels.has('*') || 
                   Array.from(user.customChannels).some(pattern => this.matchPattern(channel, pattern));
      } else {
        // Already checked in role permissions
        channelOk = true;
      }
    }
    
    return keyOk && channelOk;
  }

  /**
   * Check if key is denied for user
   */
  isKeyDenied(user, key) {
    if (user.deniedKeys.has('*')) return true;
    
    for (const pattern of user.deniedKeys) {
      if (this.matchPattern(key, pattern)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check if channel is denied for user
   */
  isChannelDenied(user, channel) {
    if (user.deniedChannels.has('*')) return true;
    
    for (const pattern of user.deniedChannels) {
      if (this.matchPattern(channel, pattern)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Match pattern against string (supports wildcards)
   */
  matchPattern(str, pattern) {
    if (pattern === '*') return true;
    if (pattern === str) return true;
    
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/\*/g, '.*') // Convert * to .*
      .replace(/\?/g, '.'); // Convert ? to .
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(str);
  }

  /**
   * Grant custom permission to user
   */
  grantPermission(username, type, permission) {
    const user = this.users.get(username);
    if (!user) {
      throw new Error(`User ${username} not found`);
    }
    
    switch (type) {
      case 'command':
        user.customCommands.add(permission);
        break;
      case 'key':
        user.customKeys.add(permission);
        break;
      case 'channel':
        user.customChannels.add(permission);
        break;
      default:
        throw new Error(`Invalid permission type: ${type}`);
    }
    
    // Clear permission cache
    if (this.options.cachePermissions) {
      this.permissions.clear();
    }
    
    logger.info('Custom permission granted', { username, type, permission, component: 'ACL' });
    this.emit('permissionGranted', { username, type, permission });
  }

  /**
   * Revoke custom permission from user
   */
  revokePermission(username, type, permission) {
    const user = this.users.get(username);
    if (!user) {
      throw new Error(`User ${username} not found`);
    }
    
    switch (type) {
      case 'command':
        user.customCommands.delete(permission);
        break;
      case 'key':
        user.customKeys.delete(permission);
        break;
      case 'channel':
        user.customChannels.delete(permission);
        break;
      default:
        throw new Error(`Invalid permission type: ${type}`);
    }
    
    // Clear permission cache
    if (this.options.cachePermissions) {
      this.permissions.clear();
    }
    
    logger.info('Custom permission revoked', { username, type, permission, component: 'ACL' });
    this.emit('permissionRevoked', { username, type, permission });
  }

  /**
   * Deny permission to user
   */
  denyPermission(username, type, permission) {
    const user = this.users.get(username);
    if (!user) {
      throw new Error(`User ${username} not found`);
    }
    
    switch (type) {
      case 'command':
        user.deniedCommands.add(permission);
        break;
      case 'key':
        user.deniedKeys.add(permission);
        break;
      case 'channel':
        user.deniedChannels.add(permission);
        break;
      default:
        throw new Error(`Invalid permission type: ${type}`);
    }
    
    // Clear permission cache
    if (this.options.cachePermissions) {
      this.permissions.clear();
    }
    
    logger.info('Permission denied', { username, type, permission, component: 'ACL' });
    this.emit('permissionDenied', { username, type, permission });
  }

  /**
   * Get user permissions summary
   */
  getUserPermissions(username) {
    const user = this.users.get(username);
    if (!user) {
      throw new Error(`User ${username} not found`);
    }
    
    const rolePermissions = {
      commands: new Set(),
      keys: new Set(),
      channels: new Set()
    };
    
    // Collect permissions from roles
    for (const roleName of user.roles) {
      const role = this.roles.get(roleName);
      if (role && role.active) {
        role.commands.forEach(cmd => rolePermissions.commands.add(cmd));
        role.keys.forEach(key => rolePermissions.keys.add(key));
        role.channels.forEach(ch => rolePermissions.channels.add(ch));
      }
    }
    
    return {
      username: user.username,
      active: user.active,
      roles: Array.from(user.roles),
      rolePermissions: {
        commands: Array.from(rolePermissions.commands),
        keys: Array.from(rolePermissions.keys),
        channels: Array.from(rolePermissions.channels)
      },
      customPermissions: {
        commands: Array.from(user.customCommands),
        keys: Array.from(user.customKeys),
        channels: Array.from(user.customChannels)
      },
      deniedPermissions: {
        commands: Array.from(user.deniedCommands),
        keys: Array.from(user.deniedKeys),
        channels: Array.from(user.deniedChannels)
      },
      lastAccess: user.lastAccess,
      createdAt: user.createdAt
    };
  }

  /**
   * List all users
   */
  listUsers() {
    return Array.from(this.users.keys()).map(username => ({
      username,
      active: this.users.get(username).active,
      roles: Array.from(this.users.get(username).roles),
      lastAccess: this.users.get(username).lastAccess,
      createdAt: this.users.get(username).createdAt
    }));
  }

  /**
   * List all roles
   */
  listRoles() {
    return Array.from(this.roles.keys()).map(roleName => ({
      name: roleName,
      active: this.roles.get(roleName).active,
      description: this.roles.get(roleName).description,
      commands: Array.from(this.roles.get(roleName).commands),
      keys: Array.from(this.roles.get(roleName).keys),
      channels: Array.from(this.roles.get(roleName).channels),
      inherits: Array.from(this.roles.get(roleName).inherits),
      createdAt: this.roles.get(roleName).createdAt
    }));
  }

  /**
   * Get ACL statistics
   */
  getStats() {
    const activeUsers = Array.from(this.users.values()).filter(user => user.active).length;
    const activeRoles = Array.from(this.roles.values()).filter(role => role.active).length;
    
    return {
      enabled: this.options.enabled,
      strictMode: this.options.strictMode,
      totalUsers: this.users.size,
      activeUsers,
      totalRoles: this.roles.size,
      activeRoles,
      cachedPermissions: this.permissions.size,
      commandCategories: this.commandCategories.size / 2, // Half are reverse mappings
      lastCacheFlush: this.lastCacheFlush || null
    };
  }

  /**
   * Clear permission cache
   */
  clearCache() {
    this.permissions.clear();
    this.lastCacheFlush = Date.now();
    logger.info('ACL permission cache cleared', { component: 'ACL' });
    this.emit('cacheCleared');
  }

  /**
   * Enable/disable user
   */
  setUserActive(username, active) {
    const user = this.users.get(username);
    if (!user) {
      throw new Error(`User ${username} not found`);
    }
    
    user.active = active;
    
    // Clear permission cache
    if (this.options.cachePermissions) {
      this.permissions.clear();
    }
    
    logger.info('User status changed', { username, active, component: 'ACL' });
    this.emit('userStatusChanged', { username, active });
  }

  /**
   * Enable/disable role
   */
  setRoleActive(roleName, active) {
    const role = this.roles.get(roleName);
    if (!role) {
      throw new Error(`Role ${roleName} not found`);
    }
    
    role.active = active;
    
    // Clear permission cache
    if (this.options.cachePermissions) {
      this.permissions.clear();
    }
    
    logger.info('Role status changed', { roleName, active, component: 'ACL' });
    this.emit('roleStatusChanged', { roleName, active });
  }
}

module.exports = ACL;
