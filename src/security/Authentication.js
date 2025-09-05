/**
 * Authentication - Redis authentication system
 * 
 * Features:
 * - Basic password authentication (AUTH command)
 * - Multi-user authentication
 * - User management with roles
 * - Password hashing and validation
 * - Authentication audit logging
 * - Integration with ACL system
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const logger = require('../utils/Logger');

class Authentication extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      enabled: options.enabled || false,
      defaultPassword: options.defaultPassword || null,
      requireAuth: options.requireAuth || false,
      hashAlgorithm: options.hashAlgorithm || 'sha256',
      saltRounds: options.saltRounds || 12,
      maxAttempts: options.maxAttempts || 5,
      lockoutDuration: options.lockoutDuration || 300000, // 5 minutes
      auditLog: options.auditLog !== false,
      sessionTimeout: options.sessionTimeout || 3600000, // 1 hour
      ...options
    };
    
    // Core authentication data
    this.defaultPasswordHash = null;
    this.users = new Map(); // username -> user data
    this.sessions = new Map(); // sessionId -> session data
    this.auditEntries = [];
    this.loginAttempts = new Map(); // IP -> attempt data
    
    // Initialize system
    this.initializeAuthentication();
  }

  /**
   * Initialize authentication system
   */
  initializeAuthentication() {
    if (this.options.defaultPassword) {
      this.setPassword(this.options.defaultPassword);
    }
    
    // Create default admin user if no users exist
    if (this.users.size === 0 && this.options.enabled) {
      this.createUser('default', this.options.defaultPassword || '', ['admin']);
    }
    
    logger.info('Authentication system initialized', {
      enabled: this.options.enabled,
      requireAuth: this.options.requireAuth,
      users: this.users.size,
      component: 'Authentication'
    });
  }

  /**
   * Check if authentication is enabled
   */
  isEnabled() {
    return this.options.enabled;
  }

  /**
   * Set default password
   */
  setPassword(password) {
    if (!password) {
      this.defaultPasswordHash = null;
      return;
    }
    
    this.defaultPasswordHash = this.hashPassword(password);
    
    logger.info('Default password updated', {
      hasPassword: !!this.defaultPasswordHash,
      component: 'Authentication'
    });
  }

  /**
   * Hash password with salt
   */
  hashPassword(password, salt = null) {
    if (!salt) {
      salt = crypto.randomBytes(16).toString('hex');
    }
    
    const hash = crypto.createHmac(this.options.hashAlgorithm, salt);
    hash.update(password);
    const hashedPassword = hash.digest('hex');
    
    return { salt, hash: hashedPassword };
  }

  /**
   * Verify password against hash
   */
  verifyPassword(password, storedHash) {
    if (!storedHash || !storedHash.salt || !storedHash.hash) {
      return false;
    }
    
    const { hash } = this.hashPassword(password, storedHash.salt);
    return crypto.timingSafeEqual(
      Buffer.from(storedHash.hash, 'hex'),
      Buffer.from(hash, 'hex')
    );
  }

  /**
   * Create a new user
   */
  async createUser(username, password, roles = []) {
    if (this.users.has(username)) {
      throw new Error(`User ${username} already exists`);
    }
    
    const passwordHash = password ? this.hashPassword(password) : null;
    
    const user = {
      username,
      passwordHash,
      roles: new Set(roles),
      active: true,
      createdAt: Date.now(),
      lastLogin: null,
      loginCount: 0,
      failedAttempts: 0,
      lockedUntil: null
    };
    
    this.users.set(username, user);
    
    logger.info('User created', {
      username,
      roles,
      component: 'Authentication'
    });
    
    this.emit('userCreated', { username, roles });
  }

  /**
   * Authenticate with default password (AUTH command)
   */
  async authenticate(password, clientInfo = {}) {
    const startTime = Date.now();
    
    try {
      // Check if authentication is required
      if (!this.options.enabled) {
        return { success: true, message: 'Authentication disabled' };
      }
      
      // Check rate limiting
      if (this.isRateLimited(clientInfo.ip)) {
        const result = { 
          success: false, 
          error: 'Too many authentication attempts. Please try again later.',
          rateLimited: true
        };
        this.logAuthAttempt(null, false, clientInfo, 'Rate limited');
        return result;
      }
      
      // Verify password
      const isValid = this.defaultPasswordHash ? 
        this.verifyPassword(password, this.defaultPasswordHash) :
        !password; // No password set, accept empty
      
      if (isValid) {
        this.recordSuccessfulLogin(clientInfo.ip);
        const sessionId = this.createSession('default', ['admin']);
        const result = { 
          success: true, 
          message: 'Authentication successful',
          sessionId
        };
        this.logAuthAttempt(null, true, clientInfo);
        return result;
      } else {
        this.recordFailedLogin(clientInfo.ip);
        const result = { 
          success: false, 
          error: 'Invalid password' 
        };
        this.logAuthAttempt(null, false, clientInfo, 'Invalid password');
        return result;
      }
    } catch (error) {
      const result = { 
        success: false, 
        error: `Authentication error: ${error.message}` 
      };
      this.logAuthAttempt(null, false, clientInfo, error.message);
      return result;
    } finally {
      const duration = Date.now() - startTime;
      logger.debug('Authentication attempt completed', {
        duration: `${duration}ms`,
        component: 'Authentication'
      });
    }
  }

  /**
   * Authenticate specific user
   */
  async authenticateUser(username, password, clientInfo = {}) {
    const startTime = Date.now();
    
    try {
      // Check if authentication is enabled
      if (!this.options.enabled) {
        return { success: true, message: 'Authentication disabled' };
      }
      
      // Check rate limiting
      if (this.isRateLimited(clientInfo.ip)) {
        const result = { 
          success: false, 
          error: 'Too many authentication attempts. Please try again later.',
          rateLimited: true
        };
        this.logAuthAttempt(username, false, clientInfo, 'Rate limited');
        return result;
      }
      
      // Find user
      const user = this.users.get(username);
      if (!user) {
        this.recordFailedLogin(clientInfo.ip);
        const result = { 
          success: false, 
          error: 'User not found' 
        };
        this.logAuthAttempt(username, false, clientInfo, 'User not found');
        return result;
      }
      
      // Check if user is locked
      if (user.lockedUntil && Date.now() < user.lockedUntil) {
        const result = { 
          success: false, 
          error: 'User account is temporarily locked' 
        };
        this.logAuthAttempt(username, false, clientInfo, 'Account locked');
        return result;
      }
      
      // Check if user is active
      if (!user.active) {
        const result = { 
          success: false, 
          error: 'User account is disabled' 
        };
        this.logAuthAttempt(username, false, clientInfo, 'Account disabled');
        return result;
      }
      
      // Verify password
      const isValid = user.passwordHash ? 
        this.verifyPassword(password, user.passwordHash) :
        !password; // No password set
      
      if (isValid) {
        // Update user login info
        user.lastLogin = Date.now();
        user.loginCount++;
        user.failedAttempts = 0;
        user.lockedUntil = null;
        
        this.recordSuccessfulLogin(clientInfo.ip);
        
        const result = { 
          success: true, 
          message: 'User authentication successful',
          username: user.username,
          roles: Array.from(user.roles),
          sessionId: this.createSession(username, Array.from(user.roles))
        };
        this.logAuthAttempt(username, true, clientInfo);
        return result;
      } else {
        // Update failed attempt count
        user.failedAttempts++;
        if (user.failedAttempts >= this.options.maxAttempts) {
          user.lockedUntil = Date.now() + this.options.lockoutDuration;
          logger.warn('User account locked due to failed attempts', {
            username,
            attempts: user.failedAttempts,
            component: 'Authentication'
          });
        }
        
        this.recordFailedLogin(clientInfo.ip);
        
        const result = { 
          success: false, 
          error: 'Invalid password' 
        };
        this.logAuthAttempt(username, false, clientInfo, 'Invalid password');
        return result;
      }
    } catch (error) {
      const result = { 
        success: false, 
        error: `Authentication error: ${error.message}` 
      };
      this.logAuthAttempt(username, false, clientInfo, error.message);
      return result;
    } finally {
      const duration = Date.now() - startTime;
      logger.debug('User authentication completed', {
        username,
        duration: `${duration}ms`,
        component: 'Authentication'
      });
    }
  }

  /**
   * Create authentication session
   */
  createSession(username, roles) {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const session = {
      id: sessionId,
      username,
      roles,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      expiresAt: Date.now() + this.options.sessionTimeout
    };
    
    this.sessions.set(sessionId, session);
    
    // Clean up expired sessions periodically
    this.cleanupExpiredSessions();
    
    return sessionId;
  }

  /**
   * Validate session
   */
  validateSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { valid: false, error: 'Session not found' };
    }
    
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return { valid: false, error: 'Session expired' };
    }
    
    // Update last activity
    session.lastActivity = Date.now();
    
    return { 
      valid: true, 
      username: session.username,
      roles: session.roles 
    };
  }

  /**
   * Delete user
   */
  deleteUser(username) {
    if (!this.users.has(username)) {
      throw new Error(`User ${username} not found`);
    }
    
    this.users.delete(username);
    
    // Invalidate user sessions
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.username === username) {
        this.sessions.delete(sessionId);
      }
    }
    
    logger.info('User deleted', {
      username,
      component: 'Authentication'
    });
    
    this.emit('userDeleted', { username });
  }

  /**
   * Get user information
   */
  getUser(username) {
    const user = this.users.get(username);
    if (!user) {
      return null;
    }
    
    return {
      username: user.username,
      roles: Array.from(user.roles),
      active: user.active,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      loginCount: user.loginCount,
      failedAttempts: user.failedAttempts,
      locked: user.lockedUntil && Date.now() < user.lockedUntil
    };
  }

  /**
   * List all users
   */
  listUsers() {
    return Array.from(this.users.keys()).map(username => this.getUser(username));
  }

  /**
   * Check rate limiting
   */
  isRateLimited(ip) {
    if (!ip) return false;
    
    const attempts = this.loginAttempts.get(ip);
    if (!attempts) return false;
    
    return attempts.count >= this.options.maxAttempts && 
           Date.now() < attempts.lockedUntil;
  }

  /**
   * Record successful login
   */
  recordSuccessfulLogin(ip) {
    if (!ip) return;
    
    // Clear failed attempts on successful login
    this.loginAttempts.delete(ip);
  }

  /**
   * Record failed login
   */
  recordFailedLogin(ip) {
    if (!ip) return;
    
    const attempts = this.loginAttempts.get(ip) || { count: 0, firstAttempt: Date.now() };
    attempts.count++;
    attempts.lastAttempt = Date.now();
    
    if (attempts.count >= this.options.maxAttempts) {
      attempts.lockedUntil = Date.now() + this.options.lockoutDuration;
    }
    
    this.loginAttempts.set(ip, attempts);
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(sessionId);
      }
    }
  }

  /**
   * Log authentication attempt
   */
  logAuthAttempt(username, success, clientInfo = {}, reason = null) {
    if (!this.options.auditLog) return;
    
    const entry = {
      timestamp: new Date().toISOString(),
      username,
      success,
      ip: clientInfo.ip,
      userAgent: clientInfo.userAgent,
      reason,
      sessionId: success ? this.sessions.get(this.createSession(username || 'default', [])) : null
    };
    
    this.auditEntries.push(entry);
    
    // Limit audit log size
    if (this.auditEntries.length > 10000) {
      this.auditEntries = this.auditEntries.slice(-5000);
    }
    
    // Emit audit event
    this.emit('authAttempt', entry);
    
    logger.info('Authentication attempt', {
      username,
      success,
      ip: clientInfo.ip,
      reason,
      component: 'Authentication'
    });
  }

  /**
   * Get audit log
   */
  getAuditLog(limit = 100) {
    return this.auditEntries.slice(-limit);
  }

  /**
   * Get authentication statistics
   */
  getStats() {
    const now = Date.now();
    const activeSessions = Array.from(this.sessions.values())
      .filter(session => now <= session.expiresAt);
    
    const recentAttempts = this.auditEntries
      .filter(entry => now - new Date(entry.timestamp).getTime() < 3600000); // Last hour
    
    const successfulAttempts = recentAttempts.filter(entry => entry.success).length;
    const failedAttempts = recentAttempts.filter(entry => !entry.success).length;
    
    return {
      enabled: this.options.enabled,
      totalUsers: this.users.size,
      activeSessions: activeSessions.length,
      totalSessions: this.sessions.size,
      recentAttempts: recentAttempts.length,
      successfulAttempts,
      failedAttempts,
      successRate: recentAttempts.length > 0 ? 
        (successfulAttempts / recentAttempts.length) * 100 : 0,
      rateLimitedIPs: Array.from(this.loginAttempts.entries())
        .filter(([ip, attempts]) => now < attempts.lockedUntil).length
    };
  }

  /**
   * Reset rate limiting for IP
   */
  resetRateLimit(ip) {
    this.loginAttempts.delete(ip);
    logger.info('Rate limit reset for IP', { ip, component: 'Authentication' });
  }

  /**
   * Unlock user account
   */
  unlockUser(username) {
    const user = this.users.get(username);
    if (!user) {
      throw new Error(`User ${username} not found`);
    }
    
    user.failedAttempts = 0;
    user.lockedUntil = null;
    
    logger.info('User account unlocked', { username, component: 'Authentication' });
    this.emit('userUnlocked', { username });
  }

  /**
   * Disable user account
   */
  disableUser(username) {
    const user = this.users.get(username);
    if (!user) {
      throw new Error(`User ${username} not found`);
    }
    
    user.active = false;
    
    // Invalidate all user sessions
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.username === username) {
        this.sessions.delete(sessionId);
      }
    }
    
    logger.info('User account disabled', { username, component: 'Authentication' });
    this.emit('userDisabled', { username });
  }

  /**
   * Enable user account
   */
  enableUser(username) {
    const user = this.users.get(username);
    if (!user) {
      throw new Error(`User ${username} not found`);
    }
    
    user.active = true;
    user.failedAttempts = 0;
    user.lockedUntil = null;
    
    logger.info('User account enabled', { username, component: 'Authentication' });
    this.emit('userEnabled', { username });
  }
}

module.exports = Authentication;
