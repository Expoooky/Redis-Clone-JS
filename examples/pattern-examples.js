/**
 * Pattern Examples - Practical demonstrations of Redis patterns
 * 
 * This file contains real-world examples of how to use the various
 * Redis patterns implemented in Phase 18.
 */

const { DistributedLock, LockManager } = require('../src/patterns/DistributedLock')
const { TokenBucketLimiter, SlidingWindowLimiter, RateLimiterFactory } = require('../src/patterns/RateLimiter')
const { FIFOQueue, PriorityQueue, DelayedQueue, ReliableQueue } = require('../src/patterns/MessageQueue')
const { CacheAside, WriteThrough, CachingFactory } = require('../src/patterns/CachingPatterns')

/**
 * Example 1: Distributed Lock for Critical Sections
 */
class BankAccountService {
  constructor(redisClient, database) {
    this.redisClient = redisClient
    this.database = database
    this.lockManager = new LockManager(redisClient, {
      lockTimeout: 30000, // 30 seconds
      autoRenew: true
    })
  }

  /**
   * Transfer money between accounts with distributed locking
   */
  async transferMoney(fromAccountId, toAccountId, amount) {
    const lockKeys = [`account:${fromAccountId}`, `account:${toAccountId}`]
    
    return await this.lockManager.withMultipleLocks(lockKeys, async () => {
      // Critical section - both accounts are locked
      const fromAccount = await this.database.getAccount(fromAccountId)
      const toAccount = await this.database.getAccount(toAccountId)
      
      if (fromAccount.balance < amount) {
        throw new Error('Insufficient funds')
      }
      
      // Perform the transfer
      await this.database.updateAccount(fromAccountId, {
        balance: fromAccount.balance - amount
      })
      
      await this.database.updateAccount(toAccountId, {
        balance: toAccount.balance + amount
      })
      
      return {
        success: true,
        fromBalance: fromAccount.balance - amount,
        toBalance: toAccount.balance + amount
      }
    }, {
      lockTimeout: 60000 // 1 minute for complex operations
    })
  }

  /**
   * Process daily interest with single lock
   */
  async processDailyInterest() {
    const distributedLock = new DistributedLock(this.redisClient)
    
    const lockResult = await distributedLock.acquire('daily_interest_job', {
      lockTimeout: 300000, // 5 minutes
      maxRetries: 1 // Don't retry - job should run only once
    })
    
    if (!lockResult.success) {
      console.log('Daily interest job already running')
      return { skipped: true }
    }
    
    try {
      // Process interest for all accounts
      const accounts = await this.database.getAllAccounts()
      const results = []
      
      for (const account of accounts) {
        const interest = account.balance * 0.001 // 0.1% daily interest
        await this.database.updateAccount(account.id, {
          balance: account.balance + interest
        })
        results.push({ accountId: account.id, interest })
      }
      
      return { success: true, processedAccounts: results.length }
    } finally {
      await distributedLock.release('daily_interest_job', lockResult.token)
    }
  }
}

/**
 * Example 2: API Rate Limiting
 */
class APIGateway {
  constructor(redisClient) {
    this.redisClient = redisClient
    this.rateLimiterFactory = new RateLimiterFactory(redisClient)
    
    // Different rate limiters for different scenarios
    this.apiLimiter = this.rateLimiterFactory.createAPILimiter(100) // 100 req/min
    this.loginLimiter = this.rateLimiterFactory.createLoginLimiter(5) // 5 attempts/hour
    this.burstLimiter = this.rateLimiterFactory.createBurstLimiter(20, 5) // 20 capacity, 5/sec refill
    this.compositeProtection = this.rateLimiterFactory.createAPIProtection()
  }

  /**
   * Handle API request with rate limiting
   */
  async handleAPIRequest(userId, endpoint) {
    // Check general API rate limit
    const apiCheck = await this.apiLimiter.isAllowed(userId)
    
    if (!apiCheck.allowed) {
      return {
        error: 'API rate limit exceeded',
        retryAfter: apiCheck.retryAfter
      }
    }
    
    // Check burst protection
    const burstCheck = await this.burstLimiter.isAllowed(userId, 1)
    
    if (!burstCheck.allowed) {
      return {
        error: 'Burst rate limit exceeded',
        retryAfter: burstCheck.retryAfter
      }
    }
    
    // Process the actual request
    return await this.processRequest(endpoint)
  }

  /**
   * Handle login attempt with rate limiting
   */
  async handleLogin(ipAddress, username, password) {
    // Check login attempt rate limit
    const loginCheck = await this.loginLimiter.isAllowed(ipAddress)
    
    if (!loginCheck.allowed) {
      return {
        error: 'Too many login attempts',
        resetTime: loginCheck.resetTime
      }
    }
    
    // Process login
    const loginResult = await this.authenticateUser(username, password)
    
    if (!loginResult.success) {
      // Track failed attempt
      console.log(`Failed login attempt from ${ipAddress} for user ${username}`)
    }
    
    return loginResult
  }

  /**
   * Handle premium API with composite rate limiting
   */
  async handlePremiumAPI(userId, complexity = 1) {
    const params = {
      burst: complexity, // Complex operations consume more burst tokens
      api_minute: 1,     // Still counts as one API call
      api_hour: complexity // But uses more from hourly quota
    }
    
    const check = await this.compositeProtection.isAllowed(userId, params)
    
    if (!check.allowed) {
      return {
        error: 'Rate limit exceeded',
        restrictiveLimiter: check.restrictiveLimiter.name,
        details: check.restrictiveLimiter
      }
    }
    
    return await this.processPremiumRequest(complexity)
  }

  async processRequest(endpoint) {
    // Simulate request processing
    return { success: true, endpoint, timestamp: Date.now() }
  }

  async authenticateUser(username, password) {
    // Simulate authentication
    return { success: password === 'correct', username }
  }

  async processPremiumRequest(complexity) {
    // Simulate complex processing
    return { success: true, complexity, result: 'premium data' }
  }
}

/**
 * Example 3: Message Queue for Background Jobs
 */
class JobProcessor {
  constructor(redisClient) {
    this.redisClient = redisClient
    
    // Different queues for different job types
    this.emailQueue = new ReliableQueue(redisClient, 'emails', {
      processingTimeout: 60000, // 1 minute
      maxRetries: 3
    })
    
    this.priorityQueue = new PriorityQueue(redisClient, 'priority_jobs')
    this.delayedQueue = new DelayedQueue(redisClient, 'scheduled_jobs')
    
    this.isProcessing = false
  }

  /**
   * Send email (reliable processing)
   */
  async sendEmail(to, subject, body, priority = 'normal') {
    const emailJob = {
      type: 'email',
      to,
      subject,
      body,
      priority,
      createdAt: Date.now()
    }
    
    if (priority === 'high') {
      // High priority emails go to priority queue
      await this.priorityQueue.enqueue(emailJob, 10) // Priority 10
    } else {
      // Normal emails go to reliable queue
      await this.emailQueue.enqueue(emailJob)
    }
    
    return { success: true, queued: true }
  }

  /**
   * Schedule a job for later
   */
  async scheduleJob(jobData, delay) {
    return await this.delayedQueue.enqueue(jobData, delay)
  }

  /**
   * Process jobs from queues
   */
  async startProcessing() {
    if (this.isProcessing) return
    
    this.isProcessing = true
    const consumerId = `processor-${Date.now()}`
    
    while (this.isProcessing) {
      try {
        // Process high priority jobs first
        const priorityJob = await this.priorityQueue.dequeue()
        if (priorityJob.message) {
          await this.processJob(priorityJob.message)
          continue
        }
        
        // Process reliable queue
        const reliableJob = await this.emailQueue.dequeue(consumerId)
        if (reliableJob.message) {
          try {
            await this.processJob(reliableJob.message)
            await this.emailQueue.ack(reliableJob.message.id, consumerId)
          } catch (error) {
            await this.emailQueue.reject(reliableJob.message.id, consumerId, error.message)
          }
          continue
        }
        
        // Process delayed jobs
        const delayedJobs = await this.delayedQueue.dequeueReady(5)
        if (delayedJobs.messages.length > 0) {
          for (const job of delayedJobs.messages) {
            await this.processJob(job)
          }
          continue
        }
        
        // No jobs available, wait a bit
        await this.sleep(1000)
        
      } catch (error) {
        console.error('Job processing error:', error)
        await this.sleep(5000) // Wait longer on error
      }
    }
  }

  async processJob(job) {
    console.log(`Processing job: ${job.type}`, job.id)
    
    if (job.type === 'email') {
      // Simulate email sending
      await this.sleep(2000)
      console.log(`Email sent to ${job.data.to}: ${job.data.subject}`)
    } else {
      // Generic job processing
      await this.sleep(1000)
      console.log(`Job completed: ${job.type}`)
    }
  }

  stopProcessing() {
    this.isProcessing = false
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

/**
 * Example 4: Multi-Layer Caching
 */
class UserService {
  constructor(redisClient, database) {
    this.redisClient = redisClient
    this.database = database
    this.cachingFactory = new CachingFactory(redisClient)
    
    // Different caching strategies for different data
    this.userCache = this.cachingFactory.createCacheAside(
      {
        get: async (userId) => await this.database.getUser(userId),
        getMultiple: async (userIds) => await this.database.getUsers(userIds)
      },
      {
        keyPrefix: 'user:cache:',
        defaultTTL: 3600 // 1 hour
      }
    )
    
    this.sessionCache = this.cachingFactory.createSessionCache(
      {
        get: async (sessionId) => await this.database.getSession(sessionId),
        set: async (sessionId, session) => await this.database.saveSession(sessionId, session),
        delete: async (sessionId) => await this.database.deleteSession(sessionId)
      }
    )
    
    this.configCache = this.cachingFactory.createLongTermCache(
      {
        get: async (key) => await this.database.getConfig(key),
        set: async (key, value) => await this.database.setConfig(key, value),
        delete: async (key) => await this.database.deleteConfig(key)
      }
    )
  }

  /**
   * Get user with caching
   */
  async getUser(userId) {
    return await this.userCache.get(userId, async (id) => {
      console.log(`Loading user ${id} from database`)
      return await this.database.getUser(id)
    })
  }

  /**
   * Get multiple users efficiently
   */
  async getUsers(userIds) {
    return await this.userCache.getMultiple(userIds, async (missingIds) => {
      console.log(`Loading ${missingIds.length} users from database`)
      return await this.database.getUsers(missingIds)
    })
  }

  /**
   * Update user (invalidate cache)
   */
  async updateUser(userId, updates) {
    // Update database
    const updatedUser = await this.database.updateUser(userId, updates)
    
    // Invalidate cache
    await this.userCache.delete(userId)
    
    // Pre-warm cache with new data
    await this.userCache.set(userId, updatedUser)
    
    return updatedUser
  }

  /**
   * Session management
   */
  async createSession(userId) {
    const sessionId = `session-${Date.now()}-${Math.random()}`
    const session = {
      userId,
      createdAt: Date.now(),
      lastAccess: Date.now()
    }
    
    await this.sessionCache.set(sessionId, session)
    return { sessionId, session }
  }

  async getSession(sessionId) {
    return await this.sessionCache.get(sessionId)
  }

  async updateSession(sessionId, updates) {
    const session = await this.sessionCache.get(sessionId)
    if (session.value) {
      const updatedSession = { ...session.value, ...updates, lastAccess: Date.now() }
      await this.sessionCache.set(sessionId, updatedSession)
      return updatedSession
    }
    return null
  }

  /**
   * Configuration management
   */
  async getConfig(key) {
    return await this.configCache.get(key)
  }

  async setConfig(key, value) {
    return await this.configCache.set(key, value)
  }
}

/**
 * Example 5: E-commerce Order Processing
 */
class OrderService {
  constructor(redisClient, database) {
    this.redisClient = redisClient
    this.database = database
    
    // Distributed lock for inventory
    this.inventoryLock = new DistributedLock(redisClient, {
      lockTimeout: 30000,
      autoRenew: true
    })
    
    // Rate limiting for order creation
    this.orderLimiter = new SlidingWindowLimiter(redisClient, {
      limit: 10, // 10 orders per minute per user
      windowSize: 60000,
      keyPrefix: 'order_limit:'
    })
    
    // Order processing queue
    this.orderQueue = new ReliableQueue(redisClient, 'orders', {
      processingTimeout: 120000, // 2 minutes
      maxRetries: 3
    })
    
    // Product cache
    this.productCache = new CacheAside(redisClient, {
      get: async (productId) => await this.database.getProduct(productId)
    }, {
      keyPrefix: 'product:',
      defaultTTL: 1800
    })
  }

  /**
   * Create order with inventory locking and rate limiting
   */
  async createOrder(userId, items) {
    // Check rate limit
    const rateLimitCheck = await this.orderLimiter.isAllowed(userId)
    if (!rateLimitCheck.allowed) {
      throw new Error('Order rate limit exceeded')
    }
    
    // Sort product IDs to prevent deadlocks
    const productIds = items.map(item => item.productId).sort()
    const lockKeys = productIds.map(id => `inventory:${id}`)
    
    return await this.inventoryLock.withMultipleLocks(lockKeys, async () => {
      // Check inventory and calculate total
      let total = 0
      const orderItems = []
      
      for (const item of items) {
        const product = await this.productCache.get(item.productId, 
          async (id) => await this.database.getProduct(id)
        )
        
        if (!product.value) {
          throw new Error(`Product ${item.productId} not found`)
        }
        
        const inventory = await this.database.getInventory(item.productId)
        if (inventory.quantity < item.quantity) {
          throw new Error(`Insufficient inventory for product ${item.productId}`)
        }
        
        const itemTotal = product.value.price * item.quantity
        total += itemTotal
        
        orderItems.push({
          productId: item.productId,
          quantity: item.quantity,
          price: product.value.price,
          total: itemTotal
        })
      }
      
      // Create order
      const order = {
        id: `order-${Date.now()}-${Math.random()}`,
        userId,
        items: orderItems,
        total,
        status: 'pending',
        createdAt: Date.now()
      }
      
      // Save order and queue for processing
      await this.database.createOrder(order)
      await this.orderQueue.enqueue({
        type: 'process_order',
        orderId: order.id
      })
      
      return order
    }, {
      lockTimeout: 60000 // 1 minute for complex orders
    })
  }

  /**
   * Process orders from queue
   */
  async processOrders() {
    const consumerId = `order-processor-${Date.now()}`
    
    while (true) {
      try {
        const job = await this.orderQueue.dequeue(consumerId)
        
        if (!job.message) {
          await this.sleep(1000)
          continue
        }
        
        try {
          if (job.message.data.type === 'process_order') {
            await this.processOrder(job.message.data.orderId)
          }
          
          await this.orderQueue.ack(job.message.id, consumerId)
        } catch (error) {
          console.error('Order processing failed:', error)
          await this.orderQueue.reject(job.message.id, consumerId, error.message)
        }
      } catch (error) {
        console.error('Queue processing error:', error)
        await this.sleep(5000)
      }
    }
  }

  async processOrder(orderId) {
    console.log(`Processing order ${orderId}`)
    
    // Simulate order processing steps
    await this.sleep(2000) // Payment processing
    await this.sleep(1000) // Inventory reservation
    await this.sleep(500)  // Shipping label creation
    
    // Update order status
    await this.database.updateOrder(orderId, { status: 'processed' })
    
    console.log(`Order ${orderId} processed successfully`)
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

module.exports = {
  BankAccountService,
  APIGateway,
  JobProcessor,
  UserService,
  OrderService
}
