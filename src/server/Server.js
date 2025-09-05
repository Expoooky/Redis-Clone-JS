/**
 * Redis-Clone TCP Server
 * Handles client connections, command parsing, and response sending
 */

const net = require('net')
const { EventEmitter } = require('events')
const RESPParser = require('./RESPParser')
const DataStore = require('../core/DataStore')
const KeyExpiration = require('../core/KeyExpiration')
const StringOps = require('../data-structures/StringOps')
const ListOps = require('../data-structures/ListOps')
const SetOps = require('../data-structures/SetOps')
const HashOps = require('../data-structures/HashOps')
const SortedSetOps = require('../data-structures/SortedSetOps')
const JsonOps = require('../data-structures/JsonOps')
const StreamOps = require('../data-structures/StreamOps')
const GeospatialOps = require('../data-structures/GeospatialOps')
const BitmapOps = require('../data-structures/BitmapOps')
const BitfieldOps = require('../data-structures/BitfieldOps')
const { HyperLogLogOps } = require('../data-structures/HyperLogLog')
const { BloomFilterOps } = require('../data-structures/BloomFilter')
const { TimeSeriesOps } = require('../data-structures/TimeSeries')
const { VectorOps } = require('../vector-db/VectorOps')
const { DocumentStore } = require('../document-db/DocumentStore')
const { QueryEngine } = require('../document-db/QueryEngine')
const { AggregationEngine } = require('../document-db/AggregationEngine')
const { MultiExecManager } = require('../transactions/MultiExec')
const { PubSubManager } = require('./PubSub')
const { PersistenceManager } = require('../persistence/PersistenceManager')
const { LuaEngine } = require('../scripting/LuaEngine')
const ScriptManager = require('../scripting/ScriptManager')
const { ReplicationManager } = require('../replication/ReplicationManager')
const { Master } = require('../replication/Master')
const { Slave } = require('../replication/Slave')
const { ClusterManager } = require('../clustering/ClusterManager')
const PerformanceMonitor = require('../monitoring/PerformanceMonitor')
const MemoryOptimizer = require('../monitoring/MemoryOptimizer')
const NetworkOptimizer = require('../monitoring/NetworkOptimizer')
const ServerInfo = require('../monitoring/Info')
const SlowLog = require('../monitoring/SlowLog')
const Metrics = require('../monitoring/Metrics')
const KeyspaceNotifications = require('../notifications/KeyspaceNotifications')
const NotificationManager = require('../notifications/NotificationManager')
const Authentication = require('../security/Authentication')
const ACL = require('../security/ACL')
const TLSManager = require('../security/TLS')
const logger = require('../utils/Logger')
const config = require('../utils/Config')

class RedisServer extends EventEmitter {
  constructor(options = {}) {
    super()
    
    this.config = {
      port: options.port || config.get('server.port', 6379),
      host: options.host || config.get('server.host', '127.0.0.1'),
      maxClients: options.maxClients || config.get('server.maxClients', 10000),
      timeout: options.timeout || config.get('server.timeout', 0)
    }

    this.server = null
    this.clients = new Map()
    this.clientIdCounter = 0
    this.isRunning = false
    this.startTime = Date.now()
    
    // Initialize core components
    this.dataStore = new DataStore()
    this.keyExpiration = new KeyExpiration(this.dataStore)
    this.stringOps = new StringOps(this.dataStore)
    this.listOps = new ListOps(this.dataStore)
    this.setOps = new SetOps(this.dataStore)
    this.hashOps = new HashOps(this.dataStore)
    this.sortedSetOps = new SortedSetOps(this.dataStore)
    this.jsonOps = new JsonOps(this.dataStore)
    this.streamOps = new StreamOps(this.dataStore)
    this.geospatialOps = new GeospatialOps(this.dataStore)
    this.bitmapOps = new BitmapOps(this.dataStore)
    this.bitfieldOps = new BitfieldOps(this.dataStore)
    this.hyperLogLogOps = new HyperLogLogOps(this.dataStore)
    this.bloomFilterOps = new BloomFilterOps(this.dataStore)
    this.timeSeriesOps = new TimeSeriesOps(this.dataStore)
    this.vectorOps = new VectorOps(this.dataStore)
    this.documentStore = new DocumentStore(this.dataStore)
    this.queryEngine = new QueryEngine(this.documentStore)
    this.aggregationEngine = new AggregationEngine(this.documentStore)
    this.multiExecManager = new MultiExecManager()
    this.pubSubManager = new PubSubManager()
    this.persistenceManager = new PersistenceManager(this.dataStore, {
      rdbEnabled: config.get('persistence.rdb.enabled', true),
      rdbFilename: config.get('persistence.rdb.filename', 'dump.rdb'),
      aofEnabled: config.get('persistence.aof.enabled', false),
      aofFilename: config.get('persistence.aof.filename', 'appendonly.aof'),
      aofFsync: config.get('persistence.aof.fsync', 'everysec'),
      autoSaveEnabled: config.get('persistence.autosave.enabled', true),
      autoSaveInterval: config.get('persistence.autosave.interval', 900),
      autoSaveChanges: config.get('persistence.autosave.changes', 1)
    })
    this.luaEngine = new LuaEngine(this)
    this.scriptManager = new ScriptManager(this.luaEngine)
    
    // Initialize clustering system
    this.clusterManager = new ClusterManager({
      port: this.config.port,
      host: this.config.host,
      clusterEnabled: this.config.cluster?.enabled || false,
      clusterConfigFile: this.config.cluster?.configFile || 'nodes.conf',
      clusterNodeTimeout: this.config.cluster?.nodeTimeout || 15000,
      clusterRequireFullCoverage: this.config.cluster?.requireFullCoverage !== false
    })
    
    // Initialize replication system
    this.replicationManager = new ReplicationManager(this)
    this.masterServer = null // Will be initialized if acting as master
    this.slaveServer = null // Will be initialized if acting as slave
    
    // Initialize performance monitoring and optimization
    this.performanceMonitor = new PerformanceMonitor({
      enabled: config.get('monitoring.performance.enabled', true),
      monitoringInterval: config.get('monitoring.performance.interval', 1000),
      memoryThreshold: config.get('monitoring.performance.memoryThreshold', 0.8),
      cpuThreshold: config.get('monitoring.performance.cpuThreshold', 0.7)
    })
    
    this.memoryOptimizer = new MemoryOptimizer(this.dataStore, {
      enabled: config.get('optimization.memory.enabled', true),
      maxMemoryPolicy: config.get('optimization.memory.policy', 'allkeys-lru'),
      optimizationInterval: config.get('optimization.memory.interval', 30000)
    })
    
    this.networkOptimizer = new NetworkOptimizer({
      enabled: config.get('optimization.network.enabled', true),
      maxConnections: this.config.maxClients,
      batchingEnabled: config.get('optimization.network.batching', true)
    })
    
    // Initialize monitoring systems (Phase 16)
    this.serverInfo = new ServerInfo(this)
    
    this.slowLog = new SlowLog({
      enabled: config.get('monitoring.slowlog.enabled', true),
      slowlogMaxLen: config.get('monitoring.slowlog.maxLen', 128),
      slowlogLogSlowerThan: config.get('monitoring.slowlog.threshold', 10000) // microseconds
    })
    
    this.metrics = new Metrics({
      enabled: config.get('monitoring.metrics.enabled', true),
      collectionInterval: config.get('monitoring.metrics.interval', 1000),
      retentionPeriod: config.get('monitoring.metrics.retention', 3600000), // 1 hour
      maxDataPoints: config.get('monitoring.metrics.maxDataPoints', 3600)
    })
    
    // Initialize keyspace notifications system (Phase 17)
    this.keyspaceNotifications = new KeyspaceNotifications(this.pubSubManager)
    this.notificationManager = new NotificationManager(this.pubSubManager, this.keyspaceNotifications)
    
    // Configure keyspace notifications from config
    const notifyConfig = config.get('notifications.keyspace.events', '')
    if (notifyConfig) {
      this.keyspaceNotifications.configure(notifyConfig)
    }
    
    // Initialize security systems
    this.authentication = new Authentication({
      enabled: config.get('security.auth.enabled', false),
      defaultPassword: config.get('security.auth.password', null),
      requireAuth: config.get('security.auth.required', false),
      maxAttempts: config.get('security.auth.maxAttempts', 5),
      lockoutDuration: config.get('security.auth.lockoutDuration', 300000),
      auditLog: config.get('security.auth.auditLog', true)
    })
    
    this.acl = new ACL({
      enabled: config.get('security.acl.enabled', false),
      defaultUser: config.get('security.acl.defaultUser', 'default'),
      strictMode: config.get('security.acl.strictMode', false)
    })
    
    this.tlsManager = new TLSManager({
      enabled: config.get('security.tls.enabled', false),
      certFile: config.get('security.tls.certFile', null),
      keyFile: config.get('security.tls.keyFile', null),
      requireClientCert: config.get('security.tls.requireClientCert', false)
    })
    
    // Set server reference after construction to avoid circular dependency
    this.multiExecManager.setServer(this)
    
    // Initialize logger with server context
    this.logger = logger.child({ component: 'RedisServer' })
    
    // Bind methods to preserve context
    this.handleConnection = this.handleConnection.bind(this)
    this.handleData = this.handleData.bind(this)
    this.handleClose = this.handleClose.bind(this)
    this.handleError = this.handleError.bind(this)
    
    this.logger.info('Redis server initialized', this.config)
  }

  /**
   * Start the server
   * @returns {Promise} Resolves when server is listening
   */
  async start() {
    if (this.isRunning) {
      throw new Error('Server is already running')
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer()
      
      this.server.on('connection', this.handleConnection)
      this.server.on('error', (error) => {
        this.logger.error('Server error', error)
        reject(error)
      })
      
      this.server.listen(this.config.port, this.config.host, async () => {
        this.isRunning = true
        
        // Start key expiration cleanup
        this.keyExpiration.start()
        
        // Initialize persistence manager
        try {
          await this.persistenceManager.initialize()
          this.logger.info('Persistence system initialized')
        } catch (error) {
          this.logger.error('Failed to initialize persistence', error)
        }
        
        // Initialize replication system
        try {
          await this.replicationManager.initialize()
          this.logger.info('Replication system initialized')
          
          // Initialize role-specific components
          const role = config.get('replication.role', 'master')
          if (role === 'master') {
            this.masterServer = new Master(this, this.replicationManager)
          } else if (role === 'slave') {
            this.slaveServer = new Slave(this, this.replicationManager)
            
            // The slave will connect to master via ReplicationManager
            // No additional connection needed here - it happens automatically
          }
        } catch (error) {
          this.logger.error('Failed to initialize replication', error)
        }
        
        // Initialize clustering system
        try {
          await this.clusterManager.initialize()
          this.logger.info('Cluster system initialized', {
            clusterEnabled: this.clusterManager.options.clusterEnabled
          })
        } catch (error) {
          this.logger.error('Failed to initialize cluster system', error)
        }
        
        // Start performance monitoring and optimization
        try {
          this.performanceMonitor.start()
          this.memoryOptimizer.start()
          this.networkOptimizer.start()
          this.logger.info('Performance monitoring and optimization started')
        } catch (error) {
          this.logger.error('Failed to start performance systems', error)
        }
        
        this.logger.info('Server started', {
          host: this.config.host,
          port: this.config.port
        })
        
        this.emit('ready')
        resolve()
      })
    })
  }

  /**
   * Stop the server
   * @returns {Promise} Resolves when server is stopped
   */
  async stop() {
    if (!this.isRunning) {
      return
    }

    return new Promise((resolve) => {
      // Stop key expiration cleanup
      this.keyExpiration.stop()
      
      // Shutdown persistence manager
      this.persistenceManager.shutdown().then(() => {
        this.logger.info('Persistence shutdown completed')
      }).catch((error) => {
        this.logger.error('Error during persistence shutdown', error)
      })
      
      // Cleanup replication system
      if (this.replicationManager) {
        this.replicationManager.cleanup()
      }
      if (this.masterServer) {
        this.masterServer.cleanup()
      }
      if (this.slaveServer) {
        this.slaveServer.cleanup()
      }
      
      // Cleanup clustering system
      if (this.clusterManager) {
        try {
          this.clusterManager.cleanup().then(() => {
            this.logger.info('Cluster system cleaned up')
          }).catch((error) => {
            this.logger.error('Failed to cleanup cluster system', error)
          })
        } catch (error) {
          this.logger.error('Failed to cleanup cluster system', error)
        }
      }
      
      // Stop performance monitoring and optimization
      try {
        this.performanceMonitor.stop()
        this.memoryOptimizer.stop()
        this.networkOptimizer.stop()
        this.logger.info('Performance monitoring and optimization stopped')
      } catch (error) {
        this.logger.error('Failed to stop performance systems', error)
      }
      
      // Close all client connections
      for (const [clientId, client] of this.clients) {
        this.logger.debug('Closing client connection', { clientId })
        client.socket.end()
      }
      this.clients.clear()

      // Close server
      this.server.close(() => {
        this.isRunning = false
        this.logger.info('Server stopped')
        this.emit('stopped')
        resolve()
      })
    })
  }

  /**
   * Handle new client connection
   * @param {net.Socket} socket - Client socket
   */
  handleConnection(socket) {
    const clientId = ++this.clientIdCounter
    
    // Check max clients limit
    if (this.clients.size >= this.config.maxClients) {
      this.logger.warn('Max clients reached, rejecting connection', {
        maxClients: this.config.maxClients,
        currentClients: this.clients.size
      })
      
      // Track rejected connection for monitoring (Phase 16)
      if (this.serverInfo) {
        this.serverInfo.recordConnection('reject')
      }
      
      socket.end('-ERR max number of clients reached\r\n')
      return
    }

    const client = {
      id: clientId,
      socket,
      parser: new RESPParser(),
      database: 0, // Current database
      lastActivity: Date.now(),
      address: `${socket.remoteAddress}:${socket.remotePort}`
    }

    this.clients.set(clientId, client)
    
    // Track connection for monitoring (Phase 16)
    if (this.serverInfo) {
      this.serverInfo.recordConnection('connect')
    }
    
    // Set socket options
    socket.setKeepAlive(true, 300000) // 5 minutes
    socket.setNoDelay(true)
    
    // Set timeout if configured
    if (this.config.timeout > 0) {
      socket.setTimeout(this.config.timeout * 1000)
      socket.on('timeout', () => {
        this.logger.debug('Client connection timeout', { clientId })
        socket.end()
      })
    }

    // Setup event handlers
    socket.on('data', (data) => this.handleData(clientId, data))
    socket.on('close', () => this.handleClose(clientId))
    socket.on('error', (error) => this.handleError(clientId, error))

    this.logger.info('Client connected', {
      clientId,
      address: client.address,
      totalClients: this.clients.size
    })

    this.emit('clientConnected', client)
  }

  /**
   * Handle data from client
   * @param {number} clientId - Client ID
   * @param {Buffer} data - Received data
   */
  handleData(clientId, data) {
    const client = this.clients.get(clientId)
    if (!client) {
      return
    }

    client.lastActivity = Date.now()

    try {
      // Parse commands from data
      const commands = client.parser.parse(data)
      
      // Process each command
      for (const command of commands) {
        this.processCommand(client, command)
      }
    } catch (error) {
      this.logger.error('Error parsing command', { clientId, error: error.message })
      this.sendError(client, `ERR Protocol error: ${error.message}`)
    }
  }

  /**
   * Process a single command
   * @param {Object} client - Client object
   * @param {Array} command - Parsed command array
   */
  async processCommand(client, command) {
    if (!Array.isArray(command) || command.length === 0) {
      this.sendError(client, 'ERR empty command')
      return
    }

    const commandName = command[0].toString().toUpperCase()
    const args = command.slice(1)

    this.logger.debug('Processing command', {
      clientId: client.id,
      command: commandName,
      argCount: args.length
    })

    try {
      // Check if client is in a transaction and command should be queued
      if (this.multiExecManager.isInTransaction(client.id)) {
        // Commands that can be executed immediately even in a transaction
        const immediateCommands = new Set(['MULTI', 'EXEC', 'DISCARD', 'WATCH', 'UNWATCH', 'QUIT'])
        
        if (immediateCommands.has(commandName)) {
          await this.routeCommand(client, commandName, args)
        } else {
          // Queue the command for later execution
          const result = this.multiExecManager.queueCommand(client.id, commandName, args)
          if (result) {
            if (result.success) {
              this.sendSimpleString(client, result.response)
            } else {
              this.sendError(client, result.error)
            }
          }
        }
      } else {
        // Not in a transaction, execute command immediately
        await this.routeCommand(client, commandName, args)
      }
    } catch (error) {
      this.logger.error('Error processing command', {
        clientId: client.id,
        command: commandName,
        error: error.message
      })
      this.sendError(client, `ERR ${error.message}`)
    }
  }

  /**
   * Execute a command and return the result (for transaction execution)
   * @param {string} command - Command name
   * @param {Array} args - Command arguments
   * @param {number} database - Database number
   * @returns {*} Command result
   */
  async executeCommand(command, args, database = 0) {
    // Select appropriate database
    this.dataStore.select(database)

    switch (command.toUpperCase()) {
      // Basic commands
      case 'PING':
        return args.length > 0 ? args[0] : 'PONG'
      case 'ECHO':
        return args.length > 0 ? args[0] : { error: 'ERR wrong number of arguments for \'echo\' command' }
      
      // String operations
      case 'GET':
        if (args.length !== 1) return { error: 'ERR wrong number of arguments for \'get\' command' }
        const getResult = this.dataStore.get(args[0])
        return getResult.success ? getResult.value : { error: getResult.error }
      case 'SET':
        if (args.length < 2) return { error: 'ERR wrong number of arguments for \'set\' command' }
        this.dataStore.set(args[0], args[1])
        return 'OK'
      case 'DEL':
        if (args.length === 0) return { error: 'ERR wrong number of arguments for \'del\' command' }
        let deleted = 0
        for (const key of args) {
          if (this.dataStore.del(key)) deleted++
        }
        return deleted
      case 'EXISTS':
        if (args.length === 0) return { error: 'ERR wrong number of arguments for \'exists\' command' }
        let exists = 0
        for (const key of args) {
          const existsResult = this.dataStore.exists(key)
          if (existsResult.success) {
            exists += existsResult.value
          }
        }
        return exists
      case 'TYPE':
        if (args.length !== 1) return { error: 'ERR wrong number of arguments for \'type\' command' }
        return this.dataStore.type(args[0])
      
      // List operations (add key ones for testing)
      case 'LPUSH':
        if (args.length < 2) return { error: 'ERR wrong number of arguments for \'lpush\' command' }
        const result = this.listOps.lpush(args[0], args.slice(1))
        return result.success ? result.value : result
      case 'LLEN':
        if (args.length !== 1) return { error: 'ERR wrong number of arguments for \'llen\' command' }
        const lenResult = this.listOps.llen(args[0])
        return lenResult.success ? lenResult.value : lenResult
      
      // Set operations
      case 'SADD':
        if (args.length < 2) return { error: 'ERR wrong number of arguments for \'sadd\' command' }
        const saddResult = this.setOps.sadd(args[0], args.slice(1))
        return saddResult.success ? saddResult.value : saddResult
      case 'SCARD':
        if (args.length !== 1) return { error: 'ERR wrong number of arguments for \'scard\' command' }
        const scardResult = this.setOps.scard(args[0])
        return scardResult.success ? scardResult.value : scardResult
      
      // Hash operations
      case 'HSET':
        if (args.length < 3) return { error: 'ERR wrong number of arguments for \'hset\' command' }
        const hsetResult = this.hashOps.hset(args[0], [args[1], args[2]])
        return hsetResult.success ? hsetResult.value : { error: hsetResult.error }
      case 'HLEN':
        if (args.length !== 1) return { error: 'ERR wrong number of arguments for \'hlen\' command' }
        const hlenResult = this.hashOps.hlen(args[0])
        return hlenResult.success ? hlenResult.value : hlenResult
      
      // String operations continued
      case 'INCR':
        if (args.length !== 1) return { error: 'ERR wrong number of arguments for \'incr\' command' }
        const incrResult = this.stringOps.incr(args[0])
        return incrResult.success ? incrResult.value : { error: incrResult.error }
      
      // Expiration commands
      case 'EXPIRE':
        if (args.length !== 2) return { error: 'ERR wrong number of arguments for \'expire\' command' }
        const expireSeconds = parseInt(args[1], 10)
        if (isNaN(expireSeconds)) return { error: 'ERR value is not an integer or out of range' }
        return this.keyExpiration.expireIn(args[0], expireSeconds) ? 1 : 0
      case 'TTL':
        if (args.length !== 1) return { error: 'ERR wrong number of arguments for \'ttl\' command' }
        const ttlResult = this.keyExpiration.ttl(args[0])
        return ttlResult.success ? ttlResult.value : { error: ttlResult.error }
      
      // Pub/Sub commands
      case 'PUBLISH':
        if (args.length !== 2) return { error: 'ERR wrong number of arguments for \'publish\' command' }
        const publishResult = this.pubSubManager.publish(args[0], args[1])
        return publishResult.subscriberCount || 0
      
      // Lua scripting commands
      case 'EVAL':
        if (args.length < 2) return { error: 'ERR wrong number of arguments for \'eval\' command' }
        const script = args[0]
        const numKeys = parseInt(args[1], 10)
        if (isNaN(numKeys) || numKeys < 0) return { error: 'ERR value is not an integer or out of range' }
        if (args.length < 2 + numKeys) return { error: 'ERR wrong number of arguments for \'eval\' command' }
        const scriptArgs = args.slice(2)
        try {
          return await this.luaEngine.eval(script, numKeys, ...scriptArgs)
        } catch (error) {
          return { error: `ERR Error running script: ${error.message}` }
        }
      case 'EVALSHA':
        if (args.length < 2) return { error: 'ERR wrong number of arguments for \'evalsha\' command' }
        const sha = args[0]
        const numKeys2 = parseInt(args[1], 10)
        if (isNaN(numKeys2) || numKeys2 < 0) return { error: 'ERR value is not an integer or out of range' }
        if (args.length < 2 + numKeys2) return { error: 'ERR wrong number of arguments for \'evalsha\' command' }
        const scriptArgs2 = args.slice(2)
        try {
          return await this.luaEngine.evalSha(sha, numKeys2, ...scriptArgs2)
        } catch (error) {
          return { error: error.message }
        }
      
      default:
        return { error: `ERR unknown command '${command}'` }
    }
  }

  /**
   * Route command to appropriate handler
   * @param {Object} client - Client object
   * @param {string} command - Command name
   * @param {Array} args - Command arguments
   */
  async routeCommand(client, command, args) {
    // Performance tracking
    const startTime = process.hrtime.bigint()
    let error = false
    
    try {
      // Select appropriate database for this client
      this.dataStore.select(client.database)

      // Check authentication if required (except for AUTH and HELLO commands)
      if (!['AUTH', 'HELLO', 'QUIT'].includes(command) && this.authentication.isEnabled()) {
        if (!client.authenticated && this.authentication.options.requireAuth) {
          this.sendError(client, 'NOAUTH Authentication required.')
          error = true
          return
        }
      }

      // Check ACL permissions (if enabled and user authenticated)
      if (this.acl.isEnabled() && client.authenticated) {
        const username = client.username || this.acl.options.defaultUser
        const key = args[0] || null
        
        if (!this.acl.checkPermission(username, command, key)) {
          this.sendError(client, `NOPERM this user has no permissions to run the '${command}' command`)
          error = true
          return
        }
      }

      // Check read-only mode for slaves
      if (this.slaveServer && this.slaveServer.shouldRejectWrites() && this.isWriteCommand(command)) {
        this.sendError(client, 'READONLY You can\'t write against a read only replica.')
        error = true
        return
      }
      
      // Track memory optimization
      if (this.memoryOptimizer) {
        this.memoryOptimizer.trackKeyAccess(args[0] || 'unknown')
      }

      // Handle cluster routing (if cluster is enabled)
      if (this.clusterManager.options.clusterEnabled && !['CLUSTER', 'PING', 'AUTH', 'HELLO'].includes(command)) {
        const key = args[0]
        if (key) {
          const routingResult = this.clusterManager.routeCommand(key, command, args)
          if (!routingResult.execute) {
            // Need to redirect to another node
            const redirect = routingResult.redirect
            if (redirect.type === 'MOVED') {
              this.sendError(client, `MOVED ${redirect.slot} ${redirect.host}:${redirect.port}`)
            } else if (redirect.type === 'ASK') {
              this.sendError(client, `ASK ${redirect.slot} ${redirect.host}:${redirect.port}`)
            }
            error = true
            return
          }
        }
      }

    switch (command) {
      // Basic commands
      case 'PING':
        this.handlePing(client, args)
        break
      case 'ECHO':
        this.handleEcho(client, args)
        break
      case 'SELECT':
        this.handleSelect(client, args)
        break
      case 'QUIT':
        this.handleQuit(client)
        break

      // String operations
      case 'GET':
        this.handleGet(client, args)
        break
      case 'SET':
        this.handleSet(client, args)
        break
      case 'DEL':
        this.handleDel(client, args)
        break
      case 'EXISTS':
        this.handleExists(client, args)
        break
      case 'TYPE':
        this.handleType(client, args)
        break
      case 'APPEND':
        this.handleAppend(client, args)
        break
      case 'STRLEN':
        this.handleStrlen(client, args)
        break
      case 'INCR':
        this.handleIncr(client, args)
        break
      case 'DECR':
        this.handleDecr(client, args)
        break
      case 'INCRBY':
        this.handleIncrby(client, args)
        break
      case 'DECRBY':
        this.handleDecrby(client, args)
        break
      case 'GETRANGE':
        this.handleGetrange(client, args)
        break
      case 'SETRANGE':
        this.handleSetrange(client, args)
        break

      // Key expiration
      case 'EXPIRE':
        this.handleExpire(client, args)
        break
      case 'EXPIREAT':
        this.handleExpireat(client, args)
        break
      case 'PEXPIRE':
        this.handlePexpire(client, args)
        break
      case 'PEXPIREAT':
        this.handlePexpireat(client, args)
        break
      case 'TTL':
        this.handleTTL(client, args)
        break
      case 'PTTL':
        this.handlePttl(client, args)
        break
      case 'PERSIST':
        this.handlePersist(client, args)
        break

      // Database operations
      case 'FLUSHDB':
        this.handleFlushdb(client)
        break
      case 'FLUSHALL':
        this.handleFlushall(client)
        break
      case 'DBSIZE':
        this.handleDbsize(client)
        break
      case 'RANDOMKEY':
        this.handleRandomkey(client)
        break
      case 'KEYS':
        this.handleKeys(client, args)
        break
      case 'SCAN':
        this.handleScan(client, args)
        break

      // Persistence operations
      case 'SAVE':
        this.handleSave(client, args)
        break
      case 'BGSAVE':
        this.handleBgsave(client, args)
        break
      case 'LASTSAVE':
        this.handleLastsave(client, args)
        break

      // List operations
      case 'LPUSH':
        this.handleLpush(client, args)
        break
      case 'RPUSH':
        this.handleRpush(client, args)
        break
      case 'LPOP':
        this.handleLpop(client, args)
        break
      case 'RPOP':
        this.handleRpop(client, args)
        break
      case 'LLEN':
        this.handleLlen(client, args)
        break
      case 'LINDEX':
        this.handleLindex(client, args)
        break
      case 'LSET':
        this.handleLset(client, args)
        break
      case 'LRANGE':
        this.handleLrange(client, args)
        break
      case 'LTRIM':
        this.handleLtrim(client, args)
        break
      case 'LINSERT':
        this.handleLinsert(client, args)
        break
      case 'LREM':
        this.handleLrem(client, args)
        break

      // Set operations
      case 'SADD':
        this.handleSadd(client, args)
        break
      case 'SREM':
        this.handleSrem(client, args)
        break
      case 'SISMEMBER':
        this.handleSismember(client, args)
        break
      case 'SMEMBERS':
        this.handleSmembers(client, args)
        break
      case 'SCARD':
        this.handleScard(client, args)
        break
      case 'SRANDMEMBER':
        this.handleSrandmember(client, args)
        break
      case 'SINTER':
        this.handleSinter(client, args)
        break
      case 'SUNION':
        this.handleSunion(client, args)
        break
      case 'SDIFF':
        this.handleSdiff(client, args)
        break
      case 'SINTERSTORE':
        this.handleSinterstore(client, args)
        break
      case 'SUNIONSTORE':
        this.handleSunionstore(client, args)
        break
      case 'SDIFFSTORE':
        this.handleSdiffstore(client, args)
        break

      // Hash operations
      case 'HSET':
        this.handleHset(client, args)
        break
      case 'HGET':
        this.handleHget(client, args)
        break
      case 'HMSET':
        this.handleHmset(client, args)
        break
      case 'HMGET':
        this.handleHmget(client, args)
        break
      case 'HGETALL':
        this.handleHgetall(client, args)
        break
      case 'HDEL':
        this.handleHdel(client, args)
        break
      case 'HEXISTS':
        this.handleHexists(client, args)
        break
      case 'HKEYS':
        this.handleHkeys(client, args)
        break
      case 'HVALS':
        this.handleHvals(client, args)
        break
      case 'HLEN':
        this.handleHlen(client, args)
        break
      case 'HINCRBY':
        this.handleHincrby(client, args)
        break
      case 'HINCRBYFLOAT':
        this.handleHincrbyfloat(client, args)
        break
      case 'HSETNX':
        this.handleHsetnx(client, args)
        break

      // Sorted Set operations
      case 'ZADD':
        this.handleZadd(client, args)
        break
      case 'ZREM':
        this.handleZrem(client, args)
        break
      case 'ZRANGE':
        this.handleZrange(client, args)
        break
      case 'ZRANGEBYSCORE':
        this.handleZrangebyscore(client, args)
        break
      case 'ZRANK':
        this.handleZrank(client, args)
        break
      case 'ZREVRANK':
        this.handleZrevrank(client, args)
        break
      case 'ZSCORE':
        this.handleZscore(client, args)
        break
      case 'ZCARD':
        this.handleZcard(client, args)
        break
      case 'ZINCRBY':
        this.handleZincrby(client, args)
        break
      case 'ZREMRANGEBYRANK':
        this.handleZremrangebyrank(client, args)
        break
      case 'ZREMRANGEBYSCORE':
        this.handleZremrangebyscore(client, args)
        break

      // JSON operations
      case 'JSON.SET':
        this.handleJsonSet(client, args)
        break
      case 'JSON.GET':
        this.handleJsonGet(client, args)
        break
      case 'JSON.DEL':
        this.handleJsonDel(client, args)
        break
      case 'JSON.ARRAPPEND':
        this.handleJsonArrappend(client, args)
        break
      case 'JSON.ARRLEN':
        this.handleJsonArrlen(client, args)
        break
      case 'JSON.ARRPOP':
        this.handleJsonArrpop(client, args)
        break
      case 'JSON.OBJKEYS':
        this.handleJsonObjkeys(client, args)
        break
      case 'JSON.OBJLEN':
        this.handleJsonObjlen(client, args)
        break
      case 'JSON.TYPE':
        this.handleJsonType(client, args)
        break

      // Stream operations
      case 'XADD':
        this.handleXadd(client, args)
        break
      case 'XREAD':
        this.handleXread(client, args)
        break
      case 'XRANGE':
        this.handleXrange(client, args)
        break
      case 'XLEN':
        this.handleXlen(client, args)
        break
      case 'XGROUP':
        this.handleXgroup(client, args)
        break
      case 'XREADGROUP':
        this.handleXreadgroup(client, args)
        break
      case 'XACK':
        this.handleXack(client, args)
        break
      case 'XPENDING':
        this.handleXpending(client, args)
        break

      // Geospatial operations
      case 'GEOADD':
        this.handleGeoadd(client, args)
        break
      case 'GEODIST':
        this.handleGeodist(client, args)
        break
      case 'GEOHASH':
        this.handleGeohash(client, args)
        break
      case 'GEOPOS':
        this.handleGeopos(client, args)
        break
      case 'GEORADIUS':
        this.handleGeoradius(client, args)
        break
      case 'GEORADIUSBYMEMBER':
        this.handleGeoradiusbymember(client, args)
        break

      // Bitmap operations
      case 'SETBIT':
        this.handleSetbit(client, args)
        break
      case 'GETBIT':
        this.handleGetbit(client, args)
        break
      case 'BITCOUNT':
        this.handleBitcount(client, args)
        break
      case 'BITOP':
        this.handleBitop(client, args)
        break
      case 'BITPOS':
        this.handleBitpos(client, args)
        break

      // Bitfield operations
      case 'BITFIELD':
        this.handleBitfield(client, args)
        break

      // HyperLogLog operations
      case 'PFADD':
        this.handlePfadd(client, args)
        break
      case 'PFCOUNT':
        this.handlePfcount(client, args)
        break
      case 'PFMERGE':
        this.handlePfmerge(client, args)
        break

      // Bloom Filter operations (custom commands)
      case 'BF.ADD':
        this.handleBfAdd(client, args)
        break
      case 'BF.EXISTS':
        this.handleBfExists(client, args)
        break
      case 'BF.MADD':
        this.handleBfMAdd(client, args)
        break
      case 'BF.MEXISTS':
        this.handleBfMExists(client, args)
        break
      case 'BF.INFO':
        this.handleBfInfo(client, args)
        break

      // Time Series operations
      case 'TS.CREATE':
        this.handleTsCreate(client, args)
        break
      case 'TS.ADD':
        this.handleTsAdd(client, args)
        break
      case 'TS.RANGE':
        this.handleTsRange(client, args)
        break
      case 'TS.GET':
        this.handleTsGet(client, args)
        break
      case 'TS.MGET':
        this.handleTsMget(client, args)
        break
      case 'TS.MRANGE':
        this.handleTsMrange(client, args)
        break
      case 'TS.INFO':
        this.handleTsInfo(client, args)
        break
      case 'TS.DEL':
        this.handleTsDel(client, args)
        break

      // Vector Database operations
      case 'VECTOR.ADD':
        this.handleVectorAdd(client, args)
        break
      case 'VECTOR.GET':
        this.handleVectorGet(client, args)
        break
      case 'VECTOR.DEL':
        this.handleVectorDel(client, args)
        break
      case 'VECTOR.SEARCH':
        this.handleVectorSearch(client, args)
        break
      case 'VECTOR.RANGE':
        this.handleVectorRange(client, args)
        break
      case 'VECTOR.INFO':
        this.handleVectorInfo(client, args)
        break
      case 'VECTOR.DISTANCE':
        this.handleVectorDistance(client, args)
        break
      case 'VECTOR.MATH':
        this.handleVectorMath(client, args)
        break

      // Document Database operations
      case 'DB.CREATE':
        this.handleDbCreate(client, args)
        break
      case 'DB.DROP':
        this.handleDbDrop(client, args)
        break
      case 'DB.LIST':
        this.handleDbList(client, args)
        break
      case 'DB.INSERT':
        this.handleDbInsert(client, args)
        break
      case 'DB.FIND':
        this.handleDbFind(client, args)
        break
      case 'DB.FINDONE':
        this.handleDbFindOne(client, args)
        break
      case 'DB.UPDATE':
        this.handleDbUpdate(client, args)
        break
      case 'DB.DELETE':
        this.handleDbDelete(client, args)
        break
      case 'DB.COUNT':
        this.handleDbCount(client, args)
        break
      case 'DB.DISTINCT':
        this.handleDbDistinct(client, args)
        break
      case 'DB.INDEX.CREATE':
        this.handleDbIndexCreate(client, args)
        break
      case 'DB.INDEX.DROP':
        this.handleDbIndexDrop(client, args)
        break
      case 'DB.INDEX.LIST':
        this.handleDbIndexList(client, args)
        break
      case 'DB.AGGREGATE':
        this.handleDbAggregate(client, args)
        break

      // Transaction commands
      case 'MULTI':
        this.handleMulti(client, args)
        break
      case 'EXEC':
        this.handleExec(client, args)
        break
      case 'DISCARD':
        this.handleDiscard(client, args)
        break
      case 'WATCH':
        this.handleWatch(client, args)
        break
      case 'UNWATCH':
        this.handleUnwatch(client, args)
        break

      // Pub/Sub commands
      case 'PUBLISH':
        this.handlePublish(client, args)
        break
      case 'SUBSCRIBE':
        this.handleSubscribe(client, args)
        break
      case 'UNSUBSCRIBE':
        this.handleUnsubscribe(client, args)
        break
      case 'PSUBSCRIBE':
        this.handlePsubscribe(client, args)
        break
      case 'PUNSUBSCRIBE':
        this.handlePunsubscribe(client, args)
        break

      // Lua scripting commands
      case 'EVAL':
        await this.handleEval(client, args)
        break
      case 'EVALSHA':
        await this.handleEvalSha(client, args)
        break
      case 'SCRIPT':
        this.handleScript(client, args)
        break

      // Replication commands
      case 'REPLICAOF':
        await this.handleReplicaOf(client, args)
        break
      case 'SLAVEOF':
        // SLAVEOF is an alias for REPLICAOF
        await this.handleReplicaOf(client, args)
        break
      case 'INFO':
        this.handleInfo(client, args)
        break
      case 'SLOWLOG':
        this.handleSlowLog(client, args)
        break
      case 'PSYNC':
        await this.handlePSync(client, args)
        break
      case 'REPLCONF':
        this.handleReplConf(client, args)
        break

      // Authentication commands
      case 'AUTH':
        await this.handleAuth(client, args)
        break
      case 'HELLO':
        await this.handleHello(client, args)
        break
      
      // ACL commands
      case 'ACL':
        await this.handleACL(client, args)
        break
      
      // Configuration commands
      case 'CONFIG':
        this.handleConfig(client, args)
        break
      
      // Cluster commands
      case 'CLUSTER':
        await this.handleCluster(client, args)
        break

      default:
        this.sendError(client, `ERR unknown command '${command}'`)
        error = true
    }

    // Log command for persistence (only for write operations)
    if (this.persistenceManager && this.isWriteCommand(command)) {
      this.persistenceManager.logCommand(command, args, client.database).catch(error => {
        this.logger.error('Failed to log command to persistence', error, {
          component: 'RedisServer',
          command,
          clientId: client.id
        })
      })
    }
    
    // Replicate command to slaves (only for write operations and if this is a master)
    if (this.isWriteCommand(command) && this.masterServer) {
      // Don't wait for replication to complete - fire and forget for better performance
      setImmediate(() => {
        this.masterServer.broadcastCommand(command, args, client.database).catch(error => {
          this.logger.error('Failed to replicate command to slaves', error, {
            component: 'RedisServer',
            command,
            clientId: client.id
          })
        })
      })
    }
    
    } catch (cmdError) {
      error = true
      this.logger.error('Error in command execution', {
        command,
        error: cmdError.message,
        clientId: client.id,
        component: 'RedisServer'
      })
    } finally {
      // Record performance metrics
      const endTime = process.hrtime.bigint()
      const latency = Number(endTime - startTime) / 1000000 // Convert to milliseconds
      const latencyMicros = Number(endTime - startTime) / 1000 // Convert to microseconds
      
      // Phase 13 monitoring (existing)
      if (this.performanceMonitor) {
        this.performanceMonitor.recordCommand(command, latency, error)
      }
      
      if (this.networkOptimizer) {
        this.networkOptimizer.recordCommand(client.id, command, latency)
      }
      
      // Phase 16 monitoring (new)
      // Update server statistics
      if (this.serverInfo) {
        const inputBytes = args.reduce((sum, arg) => sum + (arg ? arg.toString().length : 0), 0)
        const outputBytes = 64 // Rough estimate for response size
        this.serverInfo.updateStats(command, latencyMicros, inputBytes, outputBytes)
      }
      
      // Log slow queries
      if (this.slowLog) {
        const clientInfo = {
          host: client.remoteAddress || '127.0.0.1',
          port: client.remotePort || 0,
          name: client.name || ''
        }
        this.slowLog.logCommand(command, args, latencyMicros, Math.floor(Date.now() / 1000), clientInfo)
      }
      
      // Record metrics
      if (this.metrics) {
        this.metrics.increment('commands.total')
        this.metrics.increment(`commands.${command.toLowerCase()}`)
        this.metrics.timing('commands.latency', latency)
        this.metrics.timing(`commands.${command.toLowerCase()}.latency`, latency)
        
        if (error) {
          this.metrics.increment('commands.errors')
          this.metrics.increment(`commands.${command.toLowerCase()}.errors`)
        } else {
          this.metrics.increment('commands.success')
        }
      }
    }
  }

  // Command handlers

  handlePing(client, args) {
    if (args.length === 0) {
      this.sendSimpleString(client, 'PONG')
    } else {
      this.sendBulkString(client, args[0])
    }
  }

  handleEcho(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'echo\' command')
      return
    }
    this.sendBulkString(client, args[0])
  }

  handleSelect(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'select\' command')
      return
    }

    const dbIndex = parseInt(args[0], 10)
    if (isNaN(dbIndex) || !this.dataStore.select(dbIndex)) {
      this.sendError(client, 'ERR invalid DB index')
      return
    }

    client.database = dbIndex
    this.sendSimpleString(client, 'OK')
  }

  handleQuit(client) {
    this.sendSimpleString(client, 'OK')
    client.socket.end()
  }

  handleGet(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'get\' command')
      return
    }

    const result = this.stringOps.get(args[0])
    
    // Track cache hit/miss for monitoring (Phase 16)
    if (this.serverInfo) {
      if (result.success && result.value !== null && result.value !== undefined) {
        this.serverInfo.recordCacheAccess(true) // Hit
      } else {
        this.serverInfo.recordCacheAccess(false) // Miss
      }
    }
    
    if (result.success) {
      this.sendBulkString(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleSet(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'set\' command')
      return
    }

    const key = args[0]
    const value = args[1]
    const options = this.parseSetOptions(args.slice(2))

    if (options.error) {
      this.sendError(client, options.error)
      return
    }

    const result = this.stringOps.set(key, value, options)
    if (result.success) {
      // Notify keyspace event for SET operation
      this.notifyKeyspaceEvent('set', key, client.database, client)
      this.sendSimpleString(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleDel(client, args) {
    if (args.length === 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'del\' command')
      return
    }

    let deletedCount = 0
    for (const key of args) {
      const result = this.dataStore.del(key)
      if (result.success) {
        // Notify keyspace event for DEL operation
        this.notifyKeyspaceEvent('del', key, client.database, client)
        deletedCount += result.value
      }
    }

    this.sendInteger(client, deletedCount)
  }

  handleExists(client, args) {
    if (args.length === 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'exists\' command')
      return
    }

    let existsCount = 0
    for (const key of args) {
      const result = this.dataStore.exists(key)
      if (result.success) {
        existsCount += result.value
      }
    }

    this.sendInteger(client, existsCount)
  }

  handleType(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'type\' command')
      return
    }

    const result = this.dataStore.type(args[0])
    if (result.success) {
      this.sendSimpleString(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleAppend(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'append\' command')
      return
    }

    const result = this.stringOps.append(args[0], args[1])
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleStrlen(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'strlen\' command')
      return
    }

    const result = this.stringOps.strlen(args[0])
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleIncr(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'incr\' command')
      return
    }

    const result = this.stringOps.incr(args[0])
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleDecr(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'decr\' command')
      return
    }

    const result = this.stringOps.decr(args[0])
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleIncrby(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'incrby\' command')
      return
    }

    const increment = parseInt(args[1], 10)
    if (isNaN(increment)) {
      this.sendError(client, 'ERR value is not an integer or out of range')
      return
    }

    const result = this.stringOps.incrby(args[0], increment)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleDecrby(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'decrby\' command')
      return
    }

    const decrement = parseInt(args[1], 10)
    if (isNaN(decrement)) {
      this.sendError(client, 'ERR value is not an integer or out of range')
      return
    }

    const result = this.stringOps.decrby(args[0], decrement)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleGetrange(client, args) {
    if (args.length !== 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'getrange\' command')
      return
    }

    const start = parseInt(args[1], 10)
    const end = parseInt(args[2], 10)

    if (isNaN(start) || isNaN(end)) {
      this.sendError(client, 'ERR value is not an integer or out of range')
      return
    }

    const result = this.stringOps.getrange(args[0], start, end)
    if (result.success) {
      this.sendBulkString(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleSetrange(client, args) {
    if (args.length !== 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'setrange\' command')
      return
    }

    const offset = parseInt(args[1], 10)
    if (isNaN(offset)) {
      this.sendError(client, 'ERR value is not an integer or out of range')
      return
    }

    const result = this.stringOps.setrange(args[0], offset, args[2])
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleExpire(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'expire\' command')
      return
    }

    const seconds = parseInt(args[1], 10)
    if (isNaN(seconds)) {
      this.sendError(client, 'ERR value is not an integer or out of range')
      return
    }

    const result = this.keyExpiration.expireIn(args[0], seconds)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleTTL(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'ttl\' command')
      return
    }

    const result = this.keyExpiration.ttl(args[0])
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handlePersist(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'persist\' command')
      return
    }

    const result = this.keyExpiration.persist(args[0])
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleExpireat(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'expireat\' command')
      return
    }

    const unixTimestamp = parseInt(args[1], 10)
    if (isNaN(unixTimestamp)) {
      this.sendError(client, 'ERR value is not an integer or out of range')
      return
    }

    const result = this.keyExpiration.expireAt(args[0], unixTimestamp)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handlePexpire(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'pexpire\' command')
      return
    }

    const milliseconds = parseInt(args[1], 10)
    if (isNaN(milliseconds)) {
      this.sendError(client, 'ERR value is not an integer or out of range')
      return
    }

    const result = this.keyExpiration.pexpire(args[0], milliseconds)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handlePexpireat(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'pexpireat\' command')
      return
    }

    const timestamp = parseInt(args[1], 10)
    if (isNaN(timestamp)) {
      this.sendError(client, 'ERR value is not an integer or out of range')
      return
    }

    const result = this.keyExpiration.pexpireAt(args[0], timestamp)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handlePttl(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'pttl\' command')
      return
    }

    const result = this.keyExpiration.pttl(args[0])
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleFlushdb(client) {
    const result = this.dataStore.flushdb()
    if (result.success) {
      this.sendSimpleString(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleFlushall(client) {
    const result = this.dataStore.flushall()
    if (result.success) {
      // Also clear document database collections
      this.documentStore.flushall()
      this.sendSimpleString(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleDbsize(client) {
    const result = this.dataStore.dbsize()
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleRandomkey(client) {
    const result = this.dataStore.randomkey()
    if (result.success) {
      if (result.value === null) {
        this.sendNull(client)
      } else {
        this.sendBulkString(client, result.value)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handleKeys(client, args) {
    if (args.length > 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'keys\' command')
      return
    }

    const pattern = args.length === 1 ? args[0] : '*'
    const result = this.dataStore.keys(pattern)
    
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleScan(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'scan\' command')
      return
    }

    const cursor = parseInt(args[0], 10)
    if (isNaN(cursor)) {
      this.sendError(client, 'ERR invalid cursor')
      return
    }

    // Parse optional arguments
    const options = {}
    for (let i = 1; i < args.length; i += 2) {
      if (i + 1 >= args.length) {
        this.sendError(client, 'ERR syntax error')
        return
      }

      const option = args[i].toUpperCase()
      const value = args[i + 1]

      switch (option) {
        case 'MATCH':
          options.match = value
          break
        case 'COUNT':
          const count = parseInt(value, 10)
          if (isNaN(count) || count <= 0) {
            this.sendError(client, 'ERR value is not an integer or out of range')
            return
          }
          options.count = count
          break
        default:
          this.sendError(client, `ERR syntax error`)
          return
      }
    }

    const result = this.dataStore.scan(cursor, options)
    if (result.success) {
      // SCAN returns an array with [nextCursor, [keys...]]
      const response = [
        result.value.nextCursor.toString(),
        result.value.keys
      ]
      this.sendArray(client, response)
    } else {
      this.sendError(client, result.error)
    }
  }

  // Persistence command handlers

  handleSave(client, args) {
    if (args.length > 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'save\' command')
      return
    }

    this.persistenceManager.save()
      .then((result) => {
        this.sendSimpleString(client, 'OK')
        this.logger.info('Manual save completed', {
          component: 'RedisServer',
          clientId: client.id,
          duration: result.duration,
          size: result.size,
          keys: result.keys
        })
      })
      .catch((error) => {
        this.sendError(client, `ERR save failed: ${error.message}`)
        this.logger.error('Manual save failed', error, {
          component: 'RedisServer',
          clientId: client.id
        })
      })
  }

  handleBgsave(client, args) {
    if (args.length > 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'bgsave\' command')
      return
    }

    this.persistenceManager.backgroundSave()
      .then((result) => {
        this.sendSimpleString(client, 'Background saving started')
        this.logger.info('Background save started', {
          component: 'RedisServer',
          clientId: client.id
        })
      })
      .catch((error) => {
        this.sendError(client, `ERR background save failed: ${error.message}`)
        this.logger.error('Background save failed', error, {
          component: 'RedisServer',
          clientId: client.id
        })
      })
  }

  handleLastsave(client, args) {
    if (args.length > 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'lastsave\' command')
      return
    }

    const lastSaveTime = this.persistenceManager.getLastSaveTime()
    this.sendInteger(client, lastSaveTime)
  }

  // List command handlers

  handleLpush(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'lpush\' command')
      return
    }

    const key = args[0]
    const elements = args.slice(1)
    
    const result = this.listOps.lpush(key, elements)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleRpush(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'rpush\' command')
      return
    }

    const key = args[0]
    const elements = args.slice(1)
    
    const result = this.listOps.rpush(key, elements)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleLpop(client, args) {
    if (args.length === 0 || args.length > 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'lpop\' command')
      return
    }

    const key = args[0]
    const count = args.length === 2 ? parseInt(args[1], 10) : 1
    
    if (isNaN(count) || count <= 0) {
      this.sendError(client, 'ERR value is not an integer or out of range')
      return
    }

    const result = this.listOps.lpop(key, count)
    if (result.success) {
      if (result.value === null) {
        this.sendNull(client)
      } else if (Array.isArray(result.value)) {
        this.sendArray(client, result.value)
      } else {
        this.sendBulkString(client, result.value)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handleRpop(client, args) {
    if (args.length === 0 || args.length > 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'rpop\' command')
      return
    }

    const key = args[0]
    const count = args.length === 2 ? parseInt(args[1], 10) : 1
    
    if (isNaN(count) || count <= 0) {
      this.sendError(client, 'ERR value is not an integer or out of range')
      return
    }

    const result = this.listOps.rpop(key, count)
    if (result.success) {
      if (result.value === null) {
        this.sendNull(client)
      } else if (Array.isArray(result.value)) {
        this.sendArray(client, result.value)
      } else {
        this.sendBulkString(client, result.value)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handleLlen(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'llen\' command')
      return
    }

    const key = args[0]
    const result = this.listOps.llen(key)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleLindex(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'lindex\' command')
      return
    }

    const key = args[0]
    const index = parseInt(args[1], 10)
    
    if (isNaN(index)) {
      this.sendError(client, 'ERR value is not an integer or out of range')
      return
    }

    const result = this.listOps.lindex(key, index)
    if (result.success) {
      if (result.value === null) {
        this.sendNull(client)
      } else {
        this.sendBulkString(client, result.value)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handleLset(client, args) {
    if (args.length !== 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'lset\' command')
      return
    }

    const key = args[0]
    const index = parseInt(args[1], 10)
    const element = args[2]
    
    if (isNaN(index)) {
      this.sendError(client, 'ERR value is not an integer or out of range')
      return
    }

    const result = this.listOps.lset(key, index, element)
    if (result.success) {
      this.sendSimpleString(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleLrange(client, args) {
    if (args.length !== 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'lrange\' command')
      return
    }

    const key = args[0]
    const start = parseInt(args[1], 10)
    const stop = parseInt(args[2], 10)
    
    if (isNaN(start) || isNaN(stop)) {
      this.sendError(client, 'ERR value is not an integer or out of range')
      return
    }

    const result = this.listOps.lrange(key, start, stop)
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleLtrim(client, args) {
    if (args.length !== 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'ltrim\' command')
      return
    }

    const key = args[0]
    const start = parseInt(args[1], 10)
    const stop = parseInt(args[2], 10)
    
    if (isNaN(start) || isNaN(stop)) {
      this.sendError(client, 'ERR value is not an integer or out of range')
      return
    }

    const result = this.listOps.ltrim(key, start, stop)
    if (result.success) {
      this.sendSimpleString(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleLinsert(client, args) {
    if (args.length !== 4) {
      this.sendError(client, 'ERR wrong number of arguments for \'linsert\' command')
      return
    }

    const key = args[0]
    const where = args[1]
    const pivot = args[2]
    const element = args[3]

    const result = this.listOps.linsert(key, where, pivot, element)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleLrem(client, args) {
    if (args.length !== 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'lrem\' command')
      return
    }

    const key = args[0]
    const count = parseInt(args[1], 10)
    const element = args[2]
    
    if (isNaN(count)) {
      this.sendError(client, 'ERR value is not an integer or out of range')
      return
    }

    const result = this.listOps.lrem(key, count, element)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  // Set command handlers

  handleSadd(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'sadd\' command')
      return
    }

    const key = args[0]
    const members = args.slice(1)
    
    const result = this.setOps.sadd(key, members)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleSrem(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'srem\' command')
      return
    }

    const key = args[0]
    const members = args.slice(1)
    
    const result = this.setOps.srem(key, members)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleSismember(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'sismember\' command')
      return
    }

    const key = args[0]
    const member = args[1]
    
    const result = this.setOps.sismember(key, member)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleSmembers(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'smembers\' command')
      return
    }

    const key = args[0]
    
    const result = this.setOps.smembers(key)
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleScard(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'scard\' command')
      return
    }

    const key = args[0]
    
    const result = this.setOps.scard(key)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleSrandmember(client, args) {
    if (args.length === 0 || args.length > 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'srandmember\' command')
      return
    }

    const key = args[0]
    const count = args.length === 2 ? parseInt(args[1], 10) : 1
    
    if (args.length === 2 && isNaN(count)) {
      this.sendError(client, 'ERR value is not an integer or out of range')
      return
    }

    const result = this.setOps.srandmember(key, count)
    if (result.success) {
      if (result.value === null) {
        this.sendNull(client)
      } else if (Array.isArray(result.value)) {
        this.sendArray(client, result.value)
      } else {
        this.sendBulkString(client, result.value)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handleSinter(client, args) {
    if (args.length === 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'sinter\' command')
      return
    }

    const result = this.setOps.sinter(args)
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleSunion(client, args) {
    if (args.length === 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'sunion\' command')
      return
    }

    const result = this.setOps.sunion(args)
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleSdiff(client, args) {
    if (args.length === 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'sdiff\' command')
      return
    }

    const result = this.setOps.sdiff(args)
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleSinterstore(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'sinterstore\' command')
      return
    }

    const destination = args[0]
    const keys = args.slice(1)
    
    const result = this.setOps.sinterstore(destination, keys)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleSunionstore(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'sunionstore\' command')
      return
    }

    const destination = args[0]
    const keys = args.slice(1)
    
    const result = this.setOps.sunionstore(destination, keys)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleSdiffstore(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'sdiffstore\' command')
      return
    }

    const destination = args[0]
    const keys = args.slice(1)
    
    const result = this.setOps.sdiffstore(destination, keys)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  // Hash command handlers

  handleHset(client, args) {
    if (args.length < 3 || args.length % 2 === 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'hset\' command')
      return
    }

    const key = args[0]
    const fieldValuePairs = args.slice(1)
    
    const result = this.hashOps.hset(key, fieldValuePairs)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleHget(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'hget\' command')
      return
    }

    const key = args[0]
    const field = args[1]
    
    const result = this.hashOps.hget(key, field)
    if (result.success) {
      if (result.value === null) {
        this.sendNull(client)
      } else {
        this.sendBulkString(client, result.value)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handleHmset(client, args) {
    if (args.length < 3 || args.length % 2 === 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'hmset\' command')
      return
    }

    const key = args[0]
    const fieldValuePairs = args.slice(1)
    
    const result = this.hashOps.hmset(key, fieldValuePairs)
    if (result.success) {
      this.sendSimpleString(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleHmget(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'hmget\' command')
      return
    }

    const key = args[0]
    const fields = args.slice(1)
    
    const result = this.hashOps.hmget(key, fields)
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleHgetall(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'hgetall\' command')
      return
    }

    const key = args[0]
    
    const result = this.hashOps.hgetall(key)
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleHdel(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'hdel\' command')
      return
    }

    const key = args[0]
    const fields = args.slice(1)
    
    const result = this.hashOps.hdel(key, fields)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleHexists(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'hexists\' command')
      return
    }

    const key = args[0]
    const field = args[1]
    
    const result = this.hashOps.hexists(key, field)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleHkeys(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'hkeys\' command')
      return
    }

    const key = args[0]
    
    const result = this.hashOps.hkeys(key)
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleHvals(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'hvals\' command')
      return
    }

    const key = args[0]
    
    const result = this.hashOps.hvals(key)
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleHlen(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'hlen\' command')
      return
    }

    const key = args[0]
    
    const result = this.hashOps.hlen(key)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleHincrby(client, args) {
    if (args.length !== 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'hincrby\' command')
      return
    }

    const key = args[0]
    const field = args[1]
    const increment = parseInt(args[2], 10)
    
    if (isNaN(increment)) {
      this.sendError(client, 'ERR value is not an integer or out of range')
      return
    }

    const result = this.hashOps.hincrby(key, field, increment)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleHincrbyfloat(client, args) {
    if (args.length !== 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'hincrbyfloat\' command')
      return
    }

    const key = args[0]
    const field = args[1]
    const increment = parseFloat(args[2])
    
    if (isNaN(increment)) {
      this.sendError(client, 'ERR value is not a valid float')
      return
    }

    const result = this.hashOps.hincrbyfloat(key, field, increment)
    if (result.success) {
      this.sendBulkString(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleHsetnx(client, args) {
    if (args.length !== 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'hsetnx\' command')
      return
    }

    const key = args[0]
    const field = args[1]
    const value = args[2]
    
    const result = this.hashOps.hsetnx(key, field, value)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  /**
   * Parse SET command options
   * @param {Array} args - Arguments after key and value
   * @returns {Object} Parsed options or error
   */
  parseSetOptions(args) {
    const options = {}
    
    for (let i = 0; i < args.length; i++) {
      const arg = args[i].toUpperCase()
      
      switch (arg) {
        case 'EX':
          if (i + 1 >= args.length) {
            return { error: 'ERR syntax error' }
          }
          const seconds = parseInt(args[++i], 10)
          if (isNaN(seconds)) {
            return { error: 'ERR value is not an integer or out of range' }
          }
          options.ex = seconds
          break
          
        case 'PX':
          if (i + 1 >= args.length) {
            return { error: 'ERR syntax error' }
          }
          const milliseconds = parseInt(args[++i], 10)
          if (isNaN(milliseconds)) {
            return { error: 'ERR value is not an integer or out of range' }
          }
          options.px = milliseconds
          break
          
        case 'NX':
          options.nx = true
          break
          
        case 'XX':
          options.xx = true
          break
          
        default:
          return { error: 'ERR syntax error' }
      }
    }

    return options
  }

  // Response methods

  sendSimpleString(client, message) {
    const response = client.parser.serializeSimpleString(message)
    client.socket.write(response)
  }

  sendBulkString(client, data) {
    const response = client.parser.serialize(data)
    client.socket.write(response)
  }

  sendInteger(client, number) {
    const response = client.parser.serialize(number)
    client.socket.write(response)
  }

  sendError(client, message) {
    const response = client.parser.serializeError(message)
    client.socket.write(response)
  }

  sendArray(client, array) {
    const response = client.parser.serialize(array)
    client.socket.write(response)
  }

  sendNull(client) {
    const response = client.parser.serialize(null)
    client.socket.write(response)
  }

  /**
   * Handle client disconnection
   * @param {number} clientId - Client ID
   */
  handleClose(clientId) {
    const client = this.clients.get(clientId)
    if (client) {
      // Clean up transactions and subscriptions
      this.multiExecManager.cleanupClient(clientId)
      this.pubSubManager.cleanupClient(clientId)
      
      this.clients.delete(clientId)
      this.logger.info('Client disconnected', {
        clientId,
        address: client.address,
        totalClients: this.clients.size
      })
      this.emit('clientDisconnected', client)
    }
  }

  /**
   * Handle client error
   * @param {number} clientId - Client ID
   * @param {Error} error - Error object
   */
  handleError(clientId, error) {
    const client = this.clients.get(clientId)
    if (client) {
      this.logger.error('Client error', {
        clientId,
        address: client.address,
        error: error.message
      })
      
      // Close connection on error
      client.socket.destroy()
    }
  }

  /**
   * Get server statistics
   * @returns {Object} Server statistics
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      connectedClients: this.clients.size,
      maxClients: this.config.maxClients,
      totalConnections: this.clientIdCounter,
      config: this.config,
      memory: this.dataStore.getMemoryStats(),
      expiration: this.keyExpiration.getStats()
    }
  }

  // ===============================
  // SORTED SET COMMAND HANDLERS
  // ===============================

  handleZadd(client, args) {
    if (args.length < 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'zadd\' command')
      return
    }

    const key = args[0]
    let scoreElementPairs = []
    let options = {}
    let i = 1

    // Parse options (NX, XX, CH, INCR)
    while (i < args.length) {
      const arg = args[i].toUpperCase()
      if (arg === 'NX') {
        options.nx = true
        i++
      } else if (arg === 'XX') {
        options.xx = true
        i++
      } else if (arg === 'CH') {
        options.ch = true
        i++
      } else if (arg === 'INCR') {
        options.incr = true
        i++
      } else {
        break
      }
    }

    // Remaining arguments should be score-element pairs
    scoreElementPairs = args.slice(i)

    const result = this.sortedSetOps.zadd(key, scoreElementPairs, options)
    
    if (result.success) {
      if (options.incr) {
        this.sendBulkString(client, result.value)
      } else {
        this.sendInteger(client, result.value)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handleZrem(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'zrem\' command')
      return
    }

    const key = args[0]
    const elements = args.slice(1)

    const result = this.sortedSetOps.zrem(key, elements)
    
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleZrange(client, args) {
    if (args.length < 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'zrange\' command')
      return
    }

    const key = args[0]
    const start = parseInt(args[1], 10)
    const stop = parseInt(args[2], 10)
    
    const options = {}
    
    // Parse options
    for (let i = 3; i < args.length; i++) {
      const arg = args[i].toUpperCase()
      if (arg === 'WITHSCORES') {
        options.withscores = true
      } else if (arg === 'REV') {
        options.rev = true
      }
    }

    const result = this.sortedSetOps.zrange(key, start, stop, options)
    
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleZrangebyscore(client, args) {
    if (args.length < 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'zrangebyscore\' command')
      return
    }

    const key = args[0]
    const min = parseFloat(args[1])
    const max = parseFloat(args[2])
    
    const options = {}
    
    // Parse options
    for (let i = 3; i < args.length; i++) {
      const arg = args[i].toUpperCase()
      if (arg === 'WITHSCORES') {
        options.withscores = true
      } else if (arg === 'LIMIT' && i + 2 < args.length) {
        options.limit = {
          offset: parseInt(args[i + 1], 10),
          count: parseInt(args[i + 2], 10)
        }
        i += 2
      }
    }

    const result = this.sortedSetOps.zrangebyscore(key, min, max, options)
    
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleZrank(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'zrank\' command')
      return
    }

    const key = args[0]
    const element = args[1]

    const result = this.sortedSetOps.zrank(key, element)
    
    if (result.success) {
      if (result.value === null) {
        this.sendNull(client)
      } else {
        this.sendInteger(client, result.value)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handleZrevrank(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'zrevrank\' command')
      return
    }

    const key = args[0]
    const element = args[1]

    const result = this.sortedSetOps.zrevrank(key, element)
    
    if (result.success) {
      if (result.value === null) {
        this.sendNull(client)
      } else {
        this.sendInteger(client, result.value)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handleZscore(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'zscore\' command')
      return
    }

    const key = args[0]
    const element = args[1]

    const result = this.sortedSetOps.zscore(key, element)
    
    if (result.success) {
      if (result.value === null) {
        this.sendNull(client)
      } else {
        this.sendBulkString(client, result.value)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handleZcard(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'zcard\' command')
      return
    }

    const key = args[0]

    const result = this.sortedSetOps.zcard(key)
    
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleZincrby(client, args) {
    if (args.length !== 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'zincrby\' command')
      return
    }

    const key = args[0]
    const increment = parseFloat(args[1])
    const element = args[2]

    const result = this.sortedSetOps.zincrby(key, increment, element)
    
    if (result.success) {
      this.sendBulkString(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleZremrangebyrank(client, args) {
    if (args.length !== 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'zremrangebyrank\' command')
      return
    }

    const key = args[0]
    const start = parseInt(args[1], 10)
    const stop = parseInt(args[2], 10)

    const result = this.sortedSetOps.zremrangebyrank(key, start, stop)
    
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleZremrangebyscore(client, args) {
    if (args.length !== 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'zremrangebyscore\' command')
      return
    }

    const key = args[0]
    const min = parseFloat(args[1])
    const max = parseFloat(args[2])

    const result = this.sortedSetOps.zremrangebyscore(key, min, max)
    
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  // ===============================
  // JSON COMMAND HANDLERS
  // ===============================

  handleJsonSet(client, args) {
    if (args.length < 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'JSON.SET\' command')
      return
    }

    const key = args[0]
    const path = args[1]
    const jsonValue = args[2]
    
    const options = {}
    
    // Parse options
    for (let i = 3; i < args.length; i++) {
      const arg = args[i].toUpperCase()
      if (arg === 'NX') {
        options.nx = true
      } else if (arg === 'XX') {
        options.xx = true
      }
    }

    const result = this.jsonOps.jsonSet(key, path, jsonValue, options)
    
    if (result.success) {
      if (result.value === null) {
        this.sendNull(client)
      } else {
        this.sendSimpleString(client, result.value)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handleJsonGet(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'JSON.GET\' command')
      return
    }

    const key = args[0]
    const paths = args.length > 1 ? args.slice(1) : ['$']

    const result = this.jsonOps.jsonGet(key, paths)
    
    if (result.success) {
      if (result.value === null) {
        this.sendNull(client)
      } else {
        this.sendBulkString(client, result.value)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handleJsonDel(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'JSON.DEL\' command')
      return
    }

    const key = args[0]
    const path = args[1] || '$'

    const result = this.jsonOps.jsonDel(key, path)
    
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleJsonArrappend(client, args) {
    if (args.length < 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'JSON.ARRAPPEND\' command')
      return
    }

    const key = args[0]
    const path = args[1]
    const jsonValues = args.slice(2)

    const result = this.jsonOps.jsonArrAppend(key, path, jsonValues)
    
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleJsonArrlen(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'JSON.ARRLEN\' command')
      return
    }

    const key = args[0]
    const path = args[1] || '$'

    const result = this.jsonOps.jsonArrLen(key, path)
    
    if (result.success) {
      if (result.value === null) {
        this.sendNull(client)
      } else {
        this.sendInteger(client, result.value)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handleJsonArrpop(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'JSON.ARRPOP\' command')
      return
    }

    const key = args[0]
    const path = args[1] || '$'
    const index = args[2] ? parseInt(args[2], 10) : -1

    const result = this.jsonOps.jsonArrPop(key, path, index)
    
    if (result.success) {
      if (result.value === null) {
        this.sendNull(client)
      } else {
        this.sendBulkString(client, result.value)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handleJsonObjkeys(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'JSON.OBJKEYS\' command')
      return
    }

    const key = args[0]
    const path = args[1] || '$'

    const result = this.jsonOps.jsonObjKeys(key, path)
    
    if (result.success) {
      if (result.value === null) {
        this.sendNull(client)
      } else {
        this.sendArray(client, result.value)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handleJsonObjlen(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'JSON.OBJLEN\' command')
      return
    }

    const key = args[0]
    const path = args[1] || '$'

    const result = this.jsonOps.jsonObjLen(key, path)
    
    if (result.success) {
      if (result.value === null) {
        this.sendNull(client)
      } else {
        this.sendInteger(client, result.value)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handleJsonType(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'JSON.TYPE\' command')
      return
    }

    const key = args[0]
    const path = args[1] || '$'

    const result = this.jsonOps.jsonType(key, path)
    
    if (result.success) {
      if (result.value === null) {
        this.sendNull(client)
      } else {
        this.sendBulkString(client, result.value)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  // ===============================
  // STREAM COMMAND HANDLERS
  // ===============================

  handleXadd(client, args) {
    if (args.length < 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'xadd\' command')
      return
    }

    const key = args[0]
    let id = null
    let fields = []
    let options = {}

    // Parse arguments from position 1 onwards
    let i = 1
    
    // Check for MAXLEN option first
    if (i < args.length && args[i].toUpperCase() === 'MAXLEN' && i + 1 < args.length) {
      options.maxlen = parseInt(args[i + 1], 10)
      i += 2
    }
    
    // Next should be the ID
    if (i < args.length) {
      id = args[i]
      i++
    } else {
      this.sendError(client, 'ERR wrong number of arguments for \'xadd\' command')
      return
    }
    
    // Everything else should be field-value pairs
    fields = args.slice(i)

    const result = this.streamOps.xadd(key, id, fields, options)
    
    if (result.success) {
      this.sendBulkString(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleXread(client, args) {
    if (args.length < 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'xread\' command')
      return
    }

    let options = {}
    let i = 0

    // Parse options
    while (i < args.length) {
      const arg = args[i].toUpperCase()
      if (arg === 'COUNT' && i + 1 < args.length) {
        options.count = parseInt(args[i + 1], 10)
        i += 2
      } else if (arg === 'BLOCK' && i + 1 < args.length) {
        options.block = parseInt(args[i + 1], 10)
        i += 2
      } else if (arg === 'STREAMS') {
        i++
        break
      } else {
        i++
      }
    }

    // Parse streams and IDs
    const remaining = args.slice(i)
    if (remaining.length % 2 !== 0) {
      this.sendError(client, 'ERR Unbalanced XREAD list of streams')
      return
    }

    const streamCount = remaining.length / 2
    const streamKeys = remaining.slice(0, streamCount)
    const startIds = remaining.slice(streamCount)

    const result = this.streamOps.xread(streamKeys, startIds, options)
    
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleXrange(client, args) {
    if (args.length < 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'xrange\' command')
      return
    }

    const key = args[0]
    const start = args[1]
    const end = args[2]
    let count = -1

    // Parse COUNT option
    if (args.length >= 5 && args[3].toUpperCase() === 'COUNT') {
      count = parseInt(args[4], 10)
    }

    const result = this.streamOps.xrange(key, start, end, count)
    
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleXlen(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'xlen\' command')
      return
    }

    const key = args[0]

    const result = this.streamOps.xlen(key)
    
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleXgroup(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'xgroup\' command')
      return
    }

    const subcommand = args[0].toUpperCase()

    if (subcommand === 'CREATE') {
      if (args.length < 4) {
        this.sendError(client, 'ERR wrong number of arguments for \'xgroup create\' command')
        return
      }

      const key = args[1]
      const groupName = args[2]
      const startId = args[3]
      const options = {}

      // Parse MKSTREAM option
      if (args.length > 4 && args[4].toUpperCase() === 'MKSTREAM') {
        options.mkstream = true
      }

      const result = this.streamOps.xgroupCreate(key, groupName, startId, options)
      
      if (result.success) {
        this.sendSimpleString(client, result.value)
      } else {
        this.sendError(client, result.error)
      }
    } else {
      this.sendError(client, `ERR Unknown subcommand '${subcommand}'`)
    }
  }

  handleXreadgroup(client, args) {
    if (args.length < 6) {
      this.sendError(client, 'ERR wrong number of arguments for \'xreadgroup\' command')
      return
    }

    if (args[0].toUpperCase() !== 'GROUP') {
      this.sendError(client, 'ERR syntax error')
      return
    }

    const groupName = args[1]
    const consumerName = args[2]
    let options = {}
    let i = 3

    // Parse options
    while (i < args.length) {
      const arg = args[i].toUpperCase()
      if (arg === 'COUNT' && i + 1 < args.length) {
        options.count = parseInt(args[i + 1], 10)
        i += 2
      } else if (arg === 'STREAMS') {
        i++
        break
      } else {
        i++
      }
    }

    // Parse streams and IDs
    const remaining = args.slice(i)
    if (remaining.length % 2 !== 0) {
      this.sendError(client, 'ERR Unbalanced XREADGROUP list of streams')
      return
    }

    const streamCount = remaining.length / 2
    const streamKeys = remaining.slice(0, streamCount)
    const startIds = remaining.slice(streamCount)

    const result = this.streamOps.xreadgroup(groupName, consumerName, streamKeys, startIds, options)
    
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleXack(client, args) {
    if (args.length < 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'xack\' command')
      return
    }

    const key = args[0]
    const groupName = args[1]
    const entryIds = args.slice(2)

    const result = this.streamOps.xack(key, groupName, entryIds)
    
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleXpending(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'xpending\' command')
      return
    }

    const key = args[0]
    const groupName = args[1]
    const consumerName = args[2] || null

    const result = this.streamOps.xpending(key, groupName, consumerName)
    
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  // ===============================
  // Phase 4: Specialized Data Structures Handlers
  // ===============================

  // Geospatial Operations
  handleGeoadd(client, args) {
    if (args.length < 4 || args.length % 3 !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'geoadd\' command')
      return
    }

    const key = args[0]
    const coordinates = args.slice(1)

    const result = this.geospatialOps.geoadd(key, coordinates)
    
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleGeodist(client, args) {
    if (args.length < 3 || args.length > 4) {
      this.sendError(client, 'ERR wrong number of arguments for \'geodist\' command')
      return
    }

    const key = args[0]
    const member1 = args[1]
    const member2 = args[2]
    const unit = args[3] || 'm'

    const result = this.geospatialOps.geodist(key, member1, member2, unit)
    
    if (result.success) {
      if (result.value === null) {
        this.sendNull(client)
      } else {
        this.sendBulkString(client, result.value)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handleGeohash(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'geohash\' command')
      return
    }

    const key = args[0]
    const members = args.slice(1)

    const result = this.geospatialOps.geohash(key, members)
    
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleGeopos(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'geopos\' command')
      return
    }

    const key = args[0]
    const members = args.slice(1)

    const result = this.geospatialOps.geopos(key, members)
    
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleGeoradius(client, args) {
    if (args.length < 5) {
      this.sendError(client, 'ERR wrong number of arguments for \'georadius\' command')
      return
    }

    const key = args[0]
    const longitude = parseFloat(args[1])
    const latitude = parseFloat(args[2])
    const radius = parseFloat(args[3])
    const unit = args[4]

    // Parse options
    const options = {}
    for (let i = 5; i < args.length; i++) {
      const arg = args[i].toUpperCase()
      if (arg === 'WITHCOORD') {
        options.withcoord = true
      } else if (arg === 'WITHDIST') {
        options.withdist = true
      } else if (arg === 'COUNT' && i + 1 < args.length) {
        options.count = parseInt(args[i + 1], 10)
        i++
      }
    }

    const result = this.geospatialOps.georadius(key, longitude, latitude, radius, unit, options)
    
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleGeoradiusbymember(client, args) {
    if (args.length < 4) {
      this.sendError(client, 'ERR wrong number of arguments for \'georadiusbymember\' command')
      return
    }

    const key = args[0]
    const member = args[1]
    const radius = parseFloat(args[2])
    const unit = args[3]

    // Parse options
    const options = {}
    for (let i = 4; i < args.length; i++) {
      const arg = args[i].toUpperCase()
      if (arg === 'WITHCOORD') {
        options.withcoord = true
      } else if (arg === 'WITHDIST') {
        options.withdist = true
      } else if (arg === 'COUNT' && i + 1 < args.length) {
        options.count = parseInt(args[i + 1], 10)
        i++
      }
    }

    const result = this.geospatialOps.georadiusbymember(key, member, radius, unit, options)
    
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  // Bitmap Operations
  handleSetbit(client, args) {
    if (args.length !== 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'setbit\' command')
      return
    }

    const key = args[0]
    const offset = parseInt(args[1], 10)
    const value = parseInt(args[2], 10)

    const result = this.bitmapOps.setbit(key, offset, value)
    
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleGetbit(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'getbit\' command')
      return
    }

    const key = args[0]
    const offset = parseInt(args[1], 10)

    const result = this.bitmapOps.getbit(key, offset)
    
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleBitcount(client, args) {
    if (args.length < 1 || args.length > 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'bitcount\' command')
      return
    }

    const key = args[0]
    const start = args.length > 1 ? parseInt(args[1], 10) : null
    const end = args.length > 2 ? parseInt(args[2], 10) : null

    const result = this.bitmapOps.bitcount(key, start, end)
    
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleBitop(client, args) {
    if (args.length < 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'bitop\' command')
      return
    }

    const operation = args[0]
    const destkey = args[1]
    const keys = args.slice(2)

    const result = this.bitmapOps.bitop(operation, destkey, keys)
    
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleBitpos(client, args) {
    if (args.length < 2 || args.length > 4) {
      this.sendError(client, 'ERR wrong number of arguments for \'bitpos\' command')
      return
    }

    const key = args[0]
    const bit = parseInt(args[1], 10)
    const start = args.length > 2 ? parseInt(args[2], 10) : null
    const end = args.length > 3 ? parseInt(args[3], 10) : null

    const result = this.bitmapOps.bitpos(key, bit, start, end)
    
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  // Bitfield Operations
  handleBitfield(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'bitfield\' command')
      return
    }

    const key = args[0]
    const operationArgs = args.slice(1)

    try {
      const operations = this.bitfieldOps.parseOperations(operationArgs)
      const result = this.bitfieldOps.bitfield(key, operations)
      
      if (result.success) {
        this.sendArray(client, result.value)
      } else {
        this.sendError(client, result.error)
      }
    } catch (error) {
      this.sendError(client, `ERR ${error.message}`)
    }
  }

  // HyperLogLog Operations
  handlePfadd(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'pfadd\' command')
      return
    }

    const key = args[0]
    const elements = args.slice(1)

    const result = this.hyperLogLogOps.pfadd(key, elements)
    
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handlePfcount(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'pfcount\' command')
      return
    }

    const result = this.hyperLogLogOps.pfcount(args)
    
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handlePfmerge(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'pfmerge\' command')
      return
    }

    const destkey = args[0]
    const sourcekeys = args.slice(1)

    const result = this.hyperLogLogOps.pfmerge(destkey, sourcekeys)
    
    if (result.success) {
      this.sendSimpleString(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  // Bloom Filter Operations
  handleBfAdd(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'bf.add\' command')
      return
    }

    const key = args[0]
    const element = args[1]

    const result = this.bloomFilterOps.bfAdd(key, element)
    
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleBfExists(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'bf.exists\' command')
      return
    }

    const key = args[0]
    const element = args[1]

    const result = this.bloomFilterOps.bfExists(key, element)
    
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleBfMAdd(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'bf.madd\' command')
      return
    }

    const key = args[0]
    const elements = args.slice(1)

    const result = this.bloomFilterOps.bfMAdd(key, elements)
    
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleBfMExists(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'bf.mexists\' command')
      return
    }

    const key = args[0]
    const elements = args.slice(1)

    const result = this.bloomFilterOps.bfMExists(key, elements)
    
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleBfInfo(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'bf.info\' command')
      return
    }

    const key = args[0]

    const result = this.bloomFilterOps.bfInfo(key)
    
    if (result.success) {
      if (result.value === null) {
        this.sendNull(client)
      } else {
        // Convert stats object to array format
        const stats = result.value
        const response = [
          'Expected Elements', stats.expectedElements,
          'Added Elements', stats.addedElements,
          'Target FP Rate', stats.targetFalsePositiveRate,
          'Current FP Rate', stats.currentFalsePositiveRate,
          'Bit Size', stats.bitSize,
          'Hash Functions', stats.hashFunctions,
          'Set Bits', stats.setBits,
          'Fill Ratio', stats.fillRatio,
          'Capacity', stats.capacity
        ]
        this.sendArray(client, response)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  // ===========================
  // TIME SERIES OPERATIONS
  // ===========================

  /**
   * Handle TS.CREATE command
   */
  handleTsCreate(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'ts.create\' command')
      return
    }

    const key = args[0]
    const options = this.parseTimeSeriesOptions(args.slice(1))
    
    const result = this.timeSeriesOps.tsCreate(key, options)
    if (result.success) {
      this.sendSimpleString(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  /**
   * Handle TS.ADD command
   */
  handleTsAdd(client, args) {
    if (args.length < 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'ts.add\' command')
      return
    }

    const key = args[0]
    const timestamp = args[1]
    const value = parseFloat(args[2])
    const options = this.parseTimeSeriesOptions(args.slice(3))
    
    const result = this.timeSeriesOps.tsAdd(key, timestamp, value, options)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  /**
   * Handle TS.RANGE command
   */
  handleTsRange(client, args) {
    if (args.length < 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'ts.range\' command')
      return
    }

    const key = args[0]
    const fromTimestamp = args[1]
    const toTimestamp = args[2]
    const options = this.parseTimeSeriesOptions(args.slice(3))
    
    const result = this.timeSeriesOps.tsRange(key, fromTimestamp, toTimestamp, options)
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  /**
   * Handle TS.GET command
   */
  handleTsGet(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'ts.get\' command')
      return
    }

    const key = args[0]
    
    const result = this.timeSeriesOps.tsGet(key)
    if (result.success) {
      if (result.value === null) {
        this.sendNull(client)
      } else {
        this.sendArray(client, result.value)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  /**
   * Handle TS.MGET command
   */
  handleTsMget(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'ts.mget\' command')
      return
    }

    const keys = args
    const options = {}
    
    const result = this.timeSeriesOps.tsMGet(keys, options)
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  /**
   * Handle TS.MRANGE command
   */
  handleTsMrange(client, args) {
    if (args.length < 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'ts.mrange\' command')
      return
    }

    const fromTimestamp = args[0]
    const toTimestamp = args[1]
    const keys = args.slice(2)
    const options = {}
    
    const result = this.timeSeriesOps.tsMRange(fromTimestamp, toTimestamp, keys, options)
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  /**
   * Handle TS.INFO command
   */
  handleTsInfo(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'ts.info\' command')
      return
    }

    const key = args[0]
    
    const result = this.timeSeriesOps.tsInfo(key)
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  /**
   * Handle TS.DEL command
   */
  handleTsDel(client, args) {
    if (args.length < 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'ts.del\' command')
      return
    }

    const key = args[0]
    const fromTimestamp = parseInt(args[1], 10)
    const toTimestamp = parseInt(args[2], 10)
    
    const result = this.timeSeriesOps.tsDel(key, fromTimestamp, toTimestamp)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  // ===========================
  // VECTOR DATABASE OPERATIONS
  // ===========================

  /**
   * Handle VECTOR.ADD command
   */
  handleVectorAdd(client, args) {
    if (args.length < 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'vector.add\' command')
      return
    }

    const key = args[0]
    const vectorId = args[1]
    
    // Parse vector data (should be space-separated numbers)
    const vectorData = []
    let i = 2
    
    // Find vector data (all numeric arguments)
    while (i < args.length && !isNaN(parseFloat(args[i]))) {
      vectorData.push(parseFloat(args[i]))
      i++
    }
    
    if (vectorData.length === 0) {
      this.sendError(client, 'ERR invalid vector data')
      return
    }

    const options = this.parseVectorOptions(args.slice(i))
    
    const result = this.vectorOps.vectorAdd(key, vectorId, vectorData, options)
    if (result.success) {
      this.sendBulkString(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  /**
   * Handle VECTOR.GET command
   */
  handleVectorGet(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'vector.get\' command')
      return
    }

    const key = args[0]
    const vectorId = args[1]
    const options = this.parseVectorOptions(args.slice(2))
    
    const result = this.vectorOps.vectorGet(key, vectorId, options)
    if (result.success) {
      if (result.value === null) {
        this.sendNull(client)
      } else {
        // Format as [id, data] or [id, data, metadata]
        const response = [result.value.id, result.value.data]
        if (result.value.metadata) {
          response.push(result.value.metadata)
        }
        this.sendArray(client, response)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  /**
   * Handle VECTOR.DEL command
   */
  handleVectorDel(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'vector.del\' command')
      return
    }

    const key = args[0]
    const vectorIds = args.slice(1)
    
    const result = this.vectorOps.vectorDel(key, vectorIds)
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  /**
   * Handle VECTOR.SEARCH command
   */
  handleVectorSearch(client, args) {
    if (args.length < 4) {
      this.sendError(client, 'ERR wrong number of arguments for \'vector.search\' command')
      return
    }

    const key = args[0]
    
    // Get vector database to determine dimensions
    const dbResult = this.vectorOps.ensureVectorDatabase(key)
    let expectedDimensions = null
    
    if (dbResult.success && dbResult.exists) {
      const stats = dbResult.value.getStats()
      expectedDimensions = stats.dimensions
    }
    
    // Parse query vector - either use expected dimensions or parse until we hit k
    const queryVector = []
    let i = 1
    
    if (expectedDimensions) {
      // Parse exactly expectedDimensions values
      for (let j = 0; j < expectedDimensions && i < args.length; j++, i++) {
        if (!isNaN(parseFloat(args[i]))) {
          queryVector.push(parseFloat(args[i]))
        } else {
          this.sendError(client, 'ERR invalid query vector component')
          return
        }
      }
    } else {
      // Parse until we hit a non-numeric value or reach the k parameter
      // We expect at least one more numeric argument after the vector (for k)
      while (i < args.length - 1 && !isNaN(parseFloat(args[i]))) {
        queryVector.push(parseFloat(args[i]))
        i++
      }
    }
    
    if (queryVector.length === 0) {
      this.sendError(client, 'ERR invalid query vector')
      return
    }

    // Parse k parameter (required now)
    let k = 10
    if (i < args.length && !isNaN(parseInt(args[i], 10))) {
      k = parseInt(args[i], 10)
      i++
    }

    const options = this.parseVectorOptions(args.slice(i))
    
    const result = this.vectorOps.vectorSearch(key, queryVector, k, options)
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  /**
   * Handle VECTOR.RANGE command
   */
  handleVectorRange(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'vector.range\' command')
      return
    }

    const key = args[0]
    // Get vector database to determine dimensions
    const dbResult = this.vectorOps.ensureVectorDatabase(key)
    let expectedDimensions = null
    
    if (dbResult.success && dbResult.exists) {
      const stats = dbResult.value.getStats()
      expectedDimensions = stats.dimensions
    }
    
    // Parse query vector - either use expected dimensions or parse until we hit max distance
    const queryVector = []
    let i = 1
    
    if (expectedDimensions) {
      // Parse exactly expectedDimensions values
      for (let j = 0; j < expectedDimensions && i < args.length; j++, i++) {
        if (!isNaN(parseFloat(args[i]))) {
          queryVector.push(parseFloat(args[i]))
        } else {
          this.sendError(client, 'ERR invalid query vector component')
          return
        }
      }
    } else {
      // Parse until we hit a non-numeric value or reach the max distance parameter
      // We expect at least one more numeric argument after the vector (for max distance)
      while (i < args.length - 1 && !isNaN(parseFloat(args[i]))) {
        queryVector.push(parseFloat(args[i]))
        i++
      }
    }
    
    if (queryVector.length === 0) {
      this.sendError(client, 'ERR invalid query vector')
      return
    }

    // Parse max distance (required now)
    let maxDistance
    if (i < args.length && !isNaN(parseFloat(args[i]))) {
      maxDistance = parseFloat(args[i])
      i++
    } else {
      this.sendError(client, 'ERR missing max distance parameter')
      return
    }

    const options = this.parseVectorOptions(args.slice(i))
    
    const result = this.vectorOps.vectorRange(key, queryVector, maxDistance, options)
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  /**
   * Handle VECTOR.INFO command
   */
  handleVectorInfo(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'vector.info\' command')
      return
    }

    const key = args[0]
    
    const result = this.vectorOps.vectorInfo(key)
    if (result.success) {
      this.sendArray(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  /**
   * Handle VECTOR.DISTANCE command
   */
  handleVectorDistance(client, args) {
    if (args.length < 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'vector.distance\' command')
      return
    }

    const key = args[0]
    const vectorId1 = args[1]
    const vectorId2 = args[2]
    const metric = args[3] || null
    
    const result = this.vectorOps.vectorDistance(key, vectorId1, vectorId2, metric)
    if (result.success) {
      this.sendBulkString(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  /**
   * Handle VECTOR.MATH command
   */
  handleVectorMath(client, args) {
    if (args.length < 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'vector.math\' command')
      return
    }

    const operation = args[0]
    
    // Parse operands (vectors or scalars)
    const operands = []
    for (let i = 1; i < args.length; i++) {
      // Try to parse as vector (array of numbers)
      if (args[i].startsWith('[') && args[i].endsWith(']')) {
        const vectorStr = args[i].slice(1, -1)
        const vector = vectorStr.split(',').map(x => parseFloat(x.trim()))
        operands.push(vector)
      } else if (!isNaN(parseFloat(args[i]))) {
        // Single number (scalar)
        operands.push(parseFloat(args[i]))
      } else {
        this.sendError(client, 'ERR invalid operand format')
        return
      }
    }
    
    const result = this.vectorOps.vectorMath(operation, operands)
    if (result.success) {
      if (Array.isArray(result.value)) {
        this.sendArray(client, result.value)
      } else {
        this.sendBulkString(client, result.value.toString())
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  // Helper methods for parsing options

  /**
   * Parse time series options from arguments
   * @param {Array} args - Arguments to parse
   * @returns {Object} Parsed options
   */
  parseTimeSeriesOptions(args) {
    const options = {}
    
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i]?.toUpperCase()
      const value = args[i + 1]
      
      switch (key) {
        case 'RETENTION':
          options.retentionMs = parseInt(value, 10) * 1000 // Convert seconds to ms
          break
        case 'DUPLICATE_POLICY':
          options.duplicatePolicy = value.toLowerCase()
          break
        case 'LABELS':
          // Parse labels (format: label1 value1 label2 value2...)
          options.labels = {}
          for (let j = i + 1; j < args.length; j += 2) {
            if (j + 1 < args.length) {
              options.labels[args[j]] = args[j + 1]
            }
          }
          break
        case 'AGGREGATION':
          options.aggregation = value.toLowerCase()
          break
        case 'BUCKET_SIZE':
          options.bucketSize = parseInt(value, 10)
          break
      }
    }
    
    return options
  }

  /**
   * Parse vector options from arguments
   * @param {Array} args - Arguments to parse
   * @returns {Object} Parsed options
   */
  parseVectorOptions(args) {
    const options = {}
    
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]?.toUpperCase()
      
      switch (arg) {
        case 'WITHMETADATA':
          options.withMetadata = true
          break
        case 'WITHVECTORS':
          options.withVectors = true
          break
        case 'METRIC':
          options.metric = args[i + 1]?.toLowerCase()
          i++ // Skip next argument
          break
        case 'DIMENSIONS':
          options.dimensions = parseInt(args[i + 1], 10)
          i++
          break
        case 'INDEXED':
          options.indexed = args[i + 1]?.toLowerCase() === 'true'
          i++
          break
        case 'NORMALIZED':
          options.normalized = args[i + 1]?.toLowerCase() === 'true'
          i++
          break
      }
    }
    
    return options
  }

  // Document Database command handlers

  handleDbCreate(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'db.create\' command')
      return
    }

    const collectionName = args[0]
    const options = this.parseDocumentOptions(args.slice(1))

    const result = this.documentStore.createCollection(collectionName, options)
    
    if (result.success) {
      this.sendSimpleString(client, 'OK')
    } else {
      this.sendError(client, result.error)
    }
  }

  handleDbDrop(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'db.drop\' command')
      return
    }

    const collectionName = args[0]
    const result = this.documentStore.dropCollection(collectionName)
    
    if (result.success) {
      this.sendSimpleString(client, 'OK')
    } else {
      this.sendError(client, result.error)
    }
  }

  handleDbList(client, args) {
    const result = this.documentStore.listCollections()
    
    if (result.success) {
      this.sendArray(client, result.value.map(collection => collection.name))
    } else {
      this.sendError(client, result.error)
    }
  }

  handleDbInsert(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'db.insert\' command')
      return
    }

    const collectionName = args[0]
    const documentJson = args[1]

    try {
      const document = JSON.parse(documentJson)
      const collectionResult = this.documentStore.getCollection(collectionName)
      
      if (!collectionResult.success) {
        this.sendError(client, collectionResult.error)
        return
      }

      const collection = collectionResult.value
      const insertResult = collection.insert(document)
      
      if (insertResult.success) {
        this.sendBulkString(client, insertResult.value)
      } else {
        this.sendError(client, insertResult.error)
      }
    } catch (error) {
      this.sendError(client, `ERR invalid JSON: ${error.message}`)
    }
  }

  handleDbFind(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'db.find\' command')
      return
    }

    const collectionName = args[0]
    const query = args.length > 1 ? this.parseJson(args[1]) : {}
    const options = this.parseQueryOptions(args.slice(2))

    if (query === null) {
      this.sendError(client, 'ERR invalid query JSON')
      return
    }

    const result = this.queryEngine.find(collectionName, query, options)
    
    if (result.success) {
      const response = {
        documents: result.value.documents,
        totalCount: result.value.totalCount,
        hasMore: result.value.hasMore || false
      }
      this.sendBulkString(client, JSON.stringify(response))
    } else {
      this.sendError(client, result.error)
    }
  }

  handleDbFindOne(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'db.findone\' command')
      return
    }

    const collectionName = args[0]
    const query = args.length > 1 ? this.parseJson(args[1]) : {}
    const options = this.parseQueryOptions(args.slice(2))

    if (query === null) {
      this.sendError(client, 'ERR invalid query JSON')
      return
    }

    const result = this.queryEngine.findOne(collectionName, query, options)
    
    if (result.success) {
      if (result.value) {
        this.sendBulkString(client, JSON.stringify(result.value))
      } else {
        this.sendNull(client)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handleDbUpdate(client, args) {
    if (args.length < 3) {
      this.sendError(client, 'ERR wrong number of arguments for \'db.update\' command')
      return
    }

    const collectionName = args[0]
    const query = this.parseJson(args[1])
    const update = this.parseJson(args[2])
    const options = this.parseUpdateOptions(args.slice(3))

    if (query === null || update === null) {
      this.sendError(client, 'ERR invalid JSON')
      return
    }

    const collectionResult = this.documentStore.getCollection(collectionName)
    
    if (!collectionResult.success) {
      this.sendError(client, collectionResult.error)
      return
    }

    const collection = collectionResult.value
    const updateResult = collection.update(query, update, options)
    
    if (updateResult.success) {
      const response = {
        matchedCount: updateResult.value.matchedCount,
        modifiedCount: updateResult.value.modifiedCount
      }
      this.sendBulkString(client, JSON.stringify(response))
    } else {
      this.sendError(client, updateResult.error)
    }
  }

  handleDbDelete(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'db.delete\' command')
      return
    }

    const collectionName = args[0]
    const query = this.parseJson(args[1])
    const options = this.parseDeleteOptions(args.slice(2))

    if (query === null) {
      this.sendError(client, 'ERR invalid query JSON')
      return
    }

    const collectionResult = this.documentStore.getCollection(collectionName)
    
    if (!collectionResult.success) {
      this.sendError(client, collectionResult.error)
      return
    }

    const collection = collectionResult.value
    const deleteResult = collection.delete(query, options)
    
    if (deleteResult.success) {
      this.sendInteger(client, deleteResult.value.deletedCount)
    } else {
      this.sendError(client, deleteResult.error)
    }
  }

  handleDbCount(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'db.count\' command')
      return
    }

    const collectionName = args[0]
    const query = args.length > 1 ? this.parseJson(args[1]) : {}

    if (query === null) {
      this.sendError(client, 'ERR invalid query JSON')
      return
    }

    const result = this.queryEngine.count(collectionName, query)
    
    if (result.success) {
      this.sendInteger(client, result.value)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleDbDistinct(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'db.distinct\' command')
      return
    }

    const collectionName = args[0]
    const field = args[1]
    const query = args.length > 2 ? this.parseJson(args[2]) : {}

    if (query === null) {
      this.sendError(client, 'ERR invalid query JSON')
      return
    }

    const result = this.queryEngine.distinct(collectionName, field, query)
    
    if (result.success) {
      this.sendArray(client, result.value.map(value => JSON.stringify(value)))
    } else {
      this.sendError(client, result.error)
    }
  }

  handleDbIndexCreate(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'db.index.create\' command')
      return
    }

    const collectionName = args[0]
    const field = args[1]
    const options = this.parseIndexOptions(args.slice(2))

    const collectionResult = this.documentStore.getCollection(collectionName)
    
    if (!collectionResult.success) {
      this.sendError(client, collectionResult.error)
      return
    }

    const collection = collectionResult.value
    let indexResult
    
    if (collection.indexManager) {
      indexResult = collection.indexManager.createIndex(field, options)
    } else {
      indexResult = collection.createIndex(field, options)
    }
    
    if (indexResult.success) {
      this.sendSimpleString(client, 'OK')
    } else {
      this.sendError(client, indexResult.error)
    }
  }

  handleDbIndexDrop(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'db.index.drop\' command')
      return
    }

    const collectionName = args[0]
    const indexName = args[1]

    const collectionResult = this.documentStore.getCollection(collectionName)
    
    if (!collectionResult.success) {
      this.sendError(client, collectionResult.error)
      return
    }

    const collection = collectionResult.value
    let dropResult
    
    if (collection.indexManager) {
      dropResult = collection.indexManager.dropIndex(indexName)
    } else {
      dropResult = collection.dropIndex(indexName)
    }
    
    if (dropResult.success) {
      this.sendSimpleString(client, 'OK')
    } else {
      this.sendError(client, dropResult.error)
    }
  }

  handleDbIndexList(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'db.index.list\' command')
      return
    }

    const collectionName = args[0]

    const collectionResult = this.documentStore.getCollection(collectionName)
    
    if (!collectionResult.success) {
      this.sendError(client, collectionResult.error)
      return
    }

    const collection = collectionResult.value
    let listResult
    
    if (collection.indexManager) {
      listResult = collection.indexManager.listIndexes()
    } else {
      listResult = { success: true, value: [] }
    }
    
    if (listResult.success) {
      this.sendBulkString(client, JSON.stringify(listResult.value))
    } else {
      this.sendError(client, listResult.error)
    }
  }

  handleDbAggregate(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'db.aggregate\' command')
      return
    }

    const collectionName = args[0]
    const pipeline = this.parseJson(args[1])

    if (pipeline === null || !Array.isArray(pipeline)) {
      this.sendError(client, 'ERR invalid pipeline JSON')
      return
    }

    const result = this.aggregationEngine.aggregate(collectionName, pipeline)
    
    if (result.success) {
      const response = {
        documents: result.value.documents,
        stats: result.value.stats
      }
      this.sendBulkString(client, JSON.stringify(response))
    } else {
      this.sendError(client, result.error)
    }
  }

  // Helper methods for document database operations

  parseDocumentOptions(args) {
    const options = {}
    
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i]
      const value = args[i + 1]
      
      switch (key?.toUpperCase()) {
        case 'MAXDOCUMENTS':
          options.maxDocuments = parseInt(value, 10)
          break
        case 'MAXSIZE':
          options.maxSize = parseInt(value, 10)
          break
        case 'SCHEMA':
          options.schema = this.parseJson(value)
          options.schemaValidation = true
          break
      }
    }
    
    return options
  }

  parseQueryOptions(args) {
    const options = {}
    
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i]
      const value = args[i + 1]
      
      switch (key?.toUpperCase()) {
        case 'LIMIT':
          options.limit = parseInt(value, 10)
          break
        case 'SKIP':
          options.skip = parseInt(value, 10)
          break
        case 'SORT':
          options.sort = this.parseJson(value)
          break
        case 'PROJECTION':
          options.projection = this.parseJson(value)
          break
      }
    }
    
    return options
  }

  parseUpdateOptions(args) {
    const options = {}
    
    for (const arg of args) {
      switch (arg?.toUpperCase()) {
        case 'MULTI':
          options.multi = true
          break
        case 'UPSERT':
          options.upsert = true
          break
      }
    }
    
    return options
  }

  parseDeleteOptions(args) {
    const options = {}
    
    for (const arg of args) {
      switch (arg?.toUpperCase()) {
        case 'MULTI':
          options.multi = true
          break
      }
    }
    
    return options
  }

  parseIndexOptions(args) {
    const options = {}
    
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i]
      const value = args[i + 1]
      
      switch (key?.toUpperCase()) {
        case 'TYPE':
          options.type = value?.toLowerCase()
          break
        case 'UNIQUE':
          options.unique = value?.toLowerCase() === 'true'
          break
        case 'SPARSE':
          options.sparse = value?.toLowerCase() === 'true'
          break
      }
    }
    
    return options
  }

  parseJson(jsonString) {
    try {
      return JSON.parse(jsonString)
    } catch (error) {
      return null
    }
  }

  // Transaction command handlers

  handleMulti(client, args) {
    if (args.length !== 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'multi\' command')
      return
    }

    const result = this.multiExecManager.multi(client.id)
    
    if (result.success) {
      this.sendSimpleString(client, result.response)
    } else {
      this.sendError(client, result.error)
    }
  }

  async handleExec(client, args) {
    if (args.length !== 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'exec\' command')
      return
    }

    const result = await this.multiExecManager.exec(client.id)
    
    if (result.success) {
      if (result.response === null) {
        // Transaction was aborted due to watched key modification
        this.sendNull(client)
      } else {
        // Send array of results
        this.sendArray(client, result.response)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handleDiscard(client, args) {
    if (args.length !== 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'discard\' command')
      return
    }

    const result = this.multiExecManager.discard(client.id)
    
    if (result.success) {
      this.sendSimpleString(client, result.response)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleWatch(client, args) {
    if (args.length === 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'watch\' command')
      return
    }

    const result = this.multiExecManager.watch(client.id, args)
    
    if (result.success) {
      this.sendSimpleString(client, result.response)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleUnwatch(client, args) {
    if (args.length > 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'unwatch\' command')
      return
    }

    const result = this.multiExecManager.unwatch(client.id)
    
    if (result.success) {
      this.sendSimpleString(client, result.response)
    } else {
      this.sendError(client, result.error)
    }
  }

  // Pub/Sub command handlers

  handlePublish(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'publish\' command')
      return
    }

    const [channel, message] = args
    const result = this.pubSubManager.publish(channel, message)
    
    if (result.success) {
      // Send message to all subscribers
      this.sendPubSubMessages(result.directSubscribers, ['message', channel, message])
      
      // Send pattern messages
      for (const [pattern, subscribers] of result.patternSubscribers) {
        this.sendPubSubMessages(subscribers, ['pmessage', pattern, channel, message])
      }
      
      // Return number of receivers
      this.sendInteger(client, result.receivers)
    } else {
      this.sendError(client, result.error)
    }
  }

  handleSubscribe(client, args) {
    if (args.length === 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'subscribe\' command')
      return
    }

    const result = this.pubSubManager.subscribe(client.id, args)
    
    if (result.success) {
      // Send subscription confirmations
      for (const subscription of result.subscriptions) {
        this.sendArray(client, subscription)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handleUnsubscribe(client, args) {
    const channels = args.length > 0 ? args : null
    const result = this.pubSubManager.unsubscribe(client.id, channels)
    
    if (result.success) {
      // Send unsubscription confirmations
      for (const subscription of result.subscriptions) {
        this.sendArray(client, subscription)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handlePsubscribe(client, args) {
    if (args.length === 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'psubscribe\' command')
      return
    }

    const result = this.pubSubManager.psubscribe(client.id, args)
    
    if (result.success) {
      // Send subscription confirmations
      for (const subscription of result.subscriptions) {
        this.sendArray(client, subscription)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  handlePunsubscribe(client, args) {
    const patterns = args.length > 0 ? args : null
    const result = this.pubSubManager.punsubscribe(client.id, patterns)
    
    if (result.success) {
      // Send unsubscription confirmations
      for (const subscription of result.subscriptions) {
        this.sendArray(client, subscription)
      }
    } else {
      this.sendError(client, result.error)
    }
  }

  // Lua scripting commands
  async handleEval(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'eval\' command')
      return
    }

    try {
      const script = args[0]
      const numKeys = parseInt(args[1], 10)
      
      if (isNaN(numKeys) || numKeys < 0) {
        this.sendError(client, 'ERR value is not an integer or out of range')
        return
      }

      if (args.length < 2 + numKeys) {
        this.sendError(client, 'ERR wrong number of arguments for \'eval\' command')
        return
      }

      const scriptArgs = args.slice(2)
      const result = await this.luaEngine.eval(script, numKeys, ...scriptArgs)
      
      // Convert result to appropriate RESP format
      this.sendLuaResult(client, result)
    } catch (error) {
      this.sendError(client, `ERR Error running script: ${error.message}`)
    }
  }

  async handleEvalSha(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'evalsha\' command')
      return
    }

    try {
      const sha = args[0]
      const numKeys = parseInt(args[1], 10)
      
      if (isNaN(numKeys) || numKeys < 0) {
        this.sendError(client, 'ERR value is not an integer or out of range')
        return
      }

      if (args.length < 2 + numKeys) {
        this.sendError(client, 'ERR wrong number of arguments for \'evalsha\' command')
        return
      }

      const scriptArgs = args.slice(2)
      const result = await this.luaEngine.evalSha(sha, numKeys, ...scriptArgs)
      
      // Convert result to appropriate RESP format
      this.sendLuaResult(client, result)
    } catch (error) {
      this.sendError(client, `ERR ${error.message}`)
    }
  }

  handleScript(client, args) {
    if (args.length === 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'script\' command')
      return
    }

    const subcommand = args[0].toUpperCase()

    try {
      switch (subcommand) {
        case 'LOAD':
          if (args.length !== 2) {
            this.sendError(client, 'ERR wrong number of arguments for \'script load\' command')
            return
          }
          const sha = this.luaEngine.scriptLoad(args[1])
          this.sendBulkString(client, sha)
          break

        case 'EXISTS':
          if (args.length < 2) {
            this.sendError(client, 'ERR wrong number of arguments for \'script exists\' command')
            return
          }
          const shas = args.slice(1)
          const exists = this.luaEngine.scriptExists(shas)
          this.sendArray(client, exists)
          break

        case 'FLUSH':
          if (args.length !== 1) {
            this.sendError(client, 'ERR wrong number of arguments for \'script flush\' command')
            return
          }
          this.luaEngine.scriptFlush()
          this.sendSimpleString(client, 'OK')
          break

        case 'KILL':
          if (args.length !== 1) {
            this.sendError(client, 'ERR wrong number of arguments for \'script kill\' command')
            return
          }
          this.luaEngine.scriptKill()
          this.sendSimpleString(client, 'OK')
          break

        default:
          this.sendError(client, `ERR unknown SCRIPT subcommand or wrong # of args. Try SCRIPT HELP.`)
      }
    } catch (error) {
      this.sendError(client, `ERR Error in script command: ${error.message}`)
    }
  }

  // Helper method to send Lua script results in appropriate RESP format
  sendLuaResult(client, result) {
    if (result === null || result === undefined) {
      this.sendNull(client)
    } else if (typeof result === 'string') {
      this.sendBulkString(client, result)
    } else if (typeof result === 'number') {
      this.sendInteger(client, Math.floor(result))
    } else if (typeof result === 'boolean') {
      this.sendInteger(client, result ? 1 : 0)
    } else if (Array.isArray(result)) {
      this.sendArray(client, result)
    } else if (result && typeof result === 'object' && result.error) {
      this.sendError(client, result.error)
    } else {
      // Convert complex objects to strings
      this.sendBulkString(client, JSON.stringify(result))
    }
  }

  // Replication command handlers
  async handleReplicaOf(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'replicaof\' command')
      return
    }

    const [host, port] = args

    if (host.toUpperCase() === 'NO' && port.toUpperCase() === 'ONE') {
      // Stop replication and become master
      try {
        await this.replicationManager.changeRole('master')
        this.sendSimpleString(client, 'OK')
      } catch (error) {
        this.sendError(client, `ERR ${error.message}`)
      }
    } else {
      // Become slave of the specified master
      const masterPort = parseInt(port, 10)
      if (isNaN(masterPort) || masterPort < 1 || masterPort > 65535) {
        this.sendError(client, 'ERR invalid port number')
        return
      }

      try {
        await this.replicationManager.changeRole('slave', host, masterPort)
        this.sendSimpleString(client, 'OK')
      } catch (error) {
        this.sendError(client, `ERR ${error.message}`)
      }
    }
  }

  handleInfo(client, args) {
    const section = args.length > 0 ? args[0].toLowerCase() : 'default'

    let info = []

    switch (section) {
      case 'replication':
        info.push(this.replicationManager.getReplicationInfo())
        break
      case 'server':
        info.push(`# Server`)
        info.push(`redis_version:7.0.0`)
        info.push(`redis_mode:standalone`)
        info.push(`os:${process.platform}`)
        info.push(`arch_bits:64`)
        info.push(`multiplexing_api:epoll`)
        info.push(`atomicvar_api:atomic-builtin`)
        info.push(`gcc_version:4.9.2`)
        info.push(`process_id:${process.pid}`)
        info.push(`tcp_port:${this.config.port}`)
        info.push(`uptime_in_seconds:${Math.floor((Date.now() - this.startTime) / 1000)}`)
        info.push(`uptime_in_days:${Math.floor((Date.now() - this.startTime) / (1000 * 60 * 60 * 24))}`)
        break
      case 'memory':
        const memUsage = process.memoryUsage()
        info.push(`# Memory`)
        info.push(`used_memory:${memUsage.heapUsed}`)
        info.push(`used_memory_human:${this.formatBytes(memUsage.heapUsed)}`)
        info.push(`used_memory_rss:${memUsage.rss}`)
        info.push(`used_memory_peak:${memUsage.heapTotal}`)
        info.push(`mem_fragmentation_ratio:${(memUsage.rss / memUsage.heapUsed).toFixed(2)}`)
        break
      case 'clients':
        info.push(`# Clients`)
        info.push(`connected_clients:${this.clients.size}`)
        info.push(`client_longest_output_list:0`)
        info.push(`client_biggest_input_buf:0`)
        info.push(`blocked_clients:0`)
        break
      default:
        // Return all sections
        info.push(`# Server`)
        info.push(`redis_version:7.0.0`)
        info.push(`uptime_in_seconds:${Math.floor((Date.now() - this.startTime) / 1000)}`)
        info.push(``)
        info.push(`# Clients`)
        info.push(`connected_clients:${this.clients.size}`)
        info.push(``)
        info.push(`# Memory`)
        info.push(`used_memory:${process.memoryUsage().heapUsed}`)
        info.push(``)
        info.push(`# Replication`)
        info.push(this.replicationManager.getReplicationInfo())
        break
    }

    this.sendBulkString(client, info.join('\r\n'))
  }

  async handlePSync(client, args) {
    if (this.replicationManager.role !== 'master') {
      this.sendError(client, 'ERR PSYNC not allowed on slave')
      return
    }

    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'psync\' command')
      return
    }

    const [replId, offset] = args

    try {
      // Register this client as a slave and perform full sync
      if (this.masterServer) {
        const slaveId = await this.masterServer.registerSlave(client)
        logger.info('Slave registered and synchronized', {
          component: 'RedisServer',
          slaveId,
          clientId: client.id
        })
      } else {
        logger.warn('Master server not initialized for PSYNC', {
          component: 'RedisServer'
        })
        this.sendError(client, 'ERR Master not ready for replication')
      }
    } catch (error) {
      this.sendError(client, `ERR ${error.message}`)
    }
  }

  handleReplConf(client, args) {
    if (args.length === 0 || args.length % 2 !== 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'replconf\' command')
      return
    }

    // Parse configuration pairs
    const config = {}
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i].toLowerCase()
      const value = args[i + 1]
      config[key] = value
    }

    // Handle different REPLCONF options
    if (config.hasOwnProperty('listening-port')) {
      // Slave is informing master of its listening port
      this.sendSimpleString(client, 'OK')
    } else if (config.hasOwnProperty('ack')) {
      // Slave is acknowledging replication offset
      this.sendSimpleString(client, 'OK')
    } else if (config.hasOwnProperty('capa')) {
      // Slave is declaring its capabilities
      this.sendSimpleString(client, 'OK')
    } else {
      this.sendError(client, 'ERR unknown REPLCONF option')
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0B'
    const k = 1024
    const sizes = ['B', 'K', 'M', 'G', 'T']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + sizes[i]
  }

  /**
   * Connect slave to master server for data synchronization
   */
  async connectSlaveToMaster(masterHost, masterPort) {
    this.logger.info('Connecting slave to master', {
      masterHost,
      masterPort
    })

    return new Promise((resolve, reject) => {
      const net = require('net')
      const socket = net.createConnection(masterPort, masterHost)
      
      let syncComplete = false
      
      socket.on('connect', () => {
        this.logger.info('Slave connected to master', {
          masterHost,
          masterPort
        })
        
        // Send PSYNC command to register as slave and request data
        const psyncCommand = '*3\r\n$5\r\nPSYNC\r\n$1\r\n?\r\n$2\r\n-1\r\n'
        socket.write(psyncCommand)
        
        // Store the master connection for replication
        if (this.replicationManager) {
          this.replicationManager.master = {
            socket,
            host: masterHost,
            port: masterPort,
            connected: true,
            lastPingTime: Date.now()
          }
        }
        
        resolve()
      })
      
      socket.on('data', (data) => {
        // Handle data from master (commands to replicate)
        this.handleMasterReplicationData(data.toString())
      })
      
      socket.on('error', (error) => {
        this.logger.error('Slave connection error', error)
        if (!syncComplete) {
          reject(error)
        }
      })
      
      socket.on('close', () => {
        this.logger.warn('Slave connection to master closed')
        if (this.replicationManager && this.replicationManager.master) {
          this.replicationManager.master.connected = false
        }
      })
      
      // Connection timeout
      setTimeout(() => {
        if (!syncComplete) {
          socket.destroy()
          reject(new Error('Connection to master timed out'))
        }
      }, 5000)
      
      syncComplete = true
    })
  }

  /**
   * Handle replication data received from master
   */
  handleMasterReplicationData(data) {
    this.logger.info('Received replication data from master', {
      dataLength: data.length,
      data: data.substring(0, 200) + (data.length > 200 ? '...' : '') // Log first 200 chars
    })
    
    // Parse RESP commands and execute them locally
    // This is a simplified implementation
    try {
      if (data.includes('FULLRESYNC')) {
        this.logger.info('Received FULLRESYNC from master')
        // In a real implementation, we would parse RDB data here
      }
      
      // Handle replicated commands
      // For now, we'll implement a simple command replication mechanism
      if (data.includes('*') && data.includes('$') && !data.includes('FULLRESYNC')) {
        // This looks like a RESP command, try to parse and execute it
        this.parseAndExecuteReplicatedCommand(data)
      }
    } catch (error) {
      this.logger.error('Failed to handle master replication data', error)
    }
  }

  /**
   * Parse and execute a replicated command from master
   */
  parseAndExecuteReplicatedCommand(respData) {
    // This is a simplified RESP parser for replicated commands
    // In a real implementation, this would be more robust
    
    try {
      // Simple parsing - look for command patterns
      const lines = respData.split('\r\n').filter(line => line.length > 0)
      
      if (lines.length >= 3 && lines[0].startsWith('*')) {
        const argc = parseInt(lines[0].substring(1))
        if (argc >= 1) {
          // Extract command and arguments
          const command = lines[2] // Skip array length and first arg length
          const args = []
          
          let lineIndex = 3
          for (let i = 1; i < argc && lineIndex < lines.length; i++) {
            if (lines[lineIndex].startsWith('$')) {
              lineIndex++ // Skip length indicator
              if (lineIndex < lines.length) {
                args.push(lines[lineIndex])
                lineIndex++
              }
            }
          }
          
          // Execute the command locally (without triggering replication)
          if (command && command.length > 0) {
            this.logger.debug('Executing replicated command', {
              command,
              argCount: args.length
            })
            
            // Create a fake client for command execution
            const fakeClient = {
              id: 'replication',
              database: 0,
              socket: { write: () => {}, end: () => {} }
            }
            
            // Execute command without triggering replication again
            this.executeCommandDirectly(fakeClient, command, args)
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to parse replicated command', error)
    }
  }

  /**
   * Execute command directly without triggering replication
   */
  async executeCommandDirectly(client, command, args) {
    // Select appropriate database
    this.dataStore.select(client.database)
    
    // Execute command directly using the core command execution logic
    // but skip the replication step
    
    try {
      switch (command.toUpperCase()) {
        case 'SET':
          if (args.length >= 2) {
            this.dataStore.set(args[0], args[1])
          }
          break
          
        case 'DEL':
          if (args.length >= 1) {
            for (const key of args) {
              this.dataStore.del(key)
            }
          }
          break
          
        case 'FLUSHALL':
          // Clear all databases
          this.dataStore.flushall()
          break
          
        case 'FLUSHDB':
          this.dataStore.flushdb()
          break
          
        case 'LPUSH':
          if (args.length >= 2) {
            this.listOps.lpush(args[0], args.slice(1))
          }
          break
          
        case 'RPUSH':
          if (args.length >= 2) {
            this.listOps.rpush(args[0], args.slice(1))
          }
          break
          
        case 'SADD':
          if (args.length >= 2) {
            this.setOps.sadd(args[0], args.slice(1))
          }
          break
          
        case 'SREM':
          if (args.length >= 2) {
            this.setOps.srem(args[0], args.slice(1))
          }
          break
          
        case 'HSET':
          if (args.length >= 3) {
            // Pass all field-value pairs as array
            this.hashOps.hset(args[0], args.slice(1))
          }
          break
          
        case 'HDEL':
          if (args.length >= 2) {
            this.hashOps.hdel(args[0], args.slice(1))
          }
          break
          
        case 'EXPIRE':
          if (args.length === 2) {
            const seconds = parseInt(args[1], 10)
            if (!isNaN(seconds)) {
              this.keyExpiration.setExpire(args[0], seconds * 1000)
            }
          }
          break
          
        case 'PERSIST':
          if (args.length === 1) {
            this.keyExpiration.persist(args[0])
          }
          break
          
        default:
          this.logger.debug('Unhandled replicated command', { command })
      }
    } catch (error) {
      this.logger.error('Failed to execute replicated command', error, {
        command,
        args
      })
    }
  }

  /**
   * Handle AUTH command
   */
  async handleAuth(client, args) {
    if (args.length === 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'auth\' command')
      return
    }

    try {
      let result

      if (args.length === 1) {
        // AUTH password - default authentication
        const password = args[0]
        result = await this.authentication.authenticate(password, {
          ip: client.remoteAddress,
          userAgent: 'redis-client'
        })
      } else if (args.length === 2) {
        // AUTH username password - user authentication
        const [username, password] = args
        result = await this.authentication.authenticateUser(username, password, {
          ip: client.remoteAddress,
          userAgent: 'redis-client'
        })
        
        if (result.success) {
          client.username = username
          client.roles = result.roles || []
        }
      } else {
        this.sendError(client, 'ERR syntax error')
        return
      }

      if (result.success) {
        client.authenticated = true
        client.sessionId = result.sessionId
        this.sendSimpleString(client, 'OK')
      } else {
        this.sendError(client, result.error || 'ERR invalid password')
      }
    } catch (error) {
      this.logger.error('Authentication error', { error: error.message, clientId: client.id })
      this.sendError(client, 'ERR authentication failed')
    }
  }

  /**
   * Handle HELLO command (Redis 6+ protocol negotiation with auth)
   */
  async handleHello(client, args) {
    const version = args.length > 0 ? parseInt(args[0]) : 3
    
    if (version < 2 || version > 3) {
      this.sendError(client, 'NOPROTO unsupported protocol version')
      return
    }

    // Parse optional AUTH parameters
    let authResult = { success: true }
    
    for (let i = 1; i < args.length; i += 2) {
      const option = args[i] ? args[i].toUpperCase() : ''
      const value = args[i + 1]
      
      if (option === 'AUTH' && i + 2 < args.length) {
        const username = value
        const password = args[i + 2]
        i++ // Skip password in next iteration
        
        try {
          authResult = await this.authentication.authenticateUser(username, password, {
            ip: client.remoteAddress,
            userAgent: 'redis-client'
          })
          
          if (authResult.success) {
            client.authenticated = true
            client.username = username
            client.roles = authResult.roles || []
            client.sessionId = authResult.sessionId
          }
        } catch (error) {
          authResult = { success: false, error: 'ERR authentication failed' }
        }
      }
    }

    if (!authResult.success) {
      this.sendError(client, authResult.error || 'ERR authentication failed')
      return
    }

    // Send HELLO response
    const response = [
      'server', 'redis',
      'version', '7.0.0',
      'proto', version,
      'id', client.id,
      'mode', this.slaveServer ? 'replica' : 'master',
      'role', this.slaveServer ? 'replica' : 'master',
      'modules', []
    ]

    this.sendArray(client, response)
  }

  /**
   * Handle ACL command
   */
  async handleACL(client, args) {
    if (args.length === 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'acl\' command')
      return
    }

    const subcommand = args[0].toUpperCase()

    try {
      switch (subcommand) {
        case 'LIST':
          await this.handleACLList(client, args.slice(1))
          break
        
        case 'USERS':
          await this.handleACLUsers(client, args.slice(1))
          break
          
        case 'GETUSER':
          await this.handleACLGetUser(client, args.slice(1))
          break
          
        case 'SETUSER':
          await this.handleACLSetUser(client, args.slice(1))
          break
          
        case 'DELUSER':
          await this.handleACLDelUser(client, args.slice(1))
          break
          
        case 'GENPASS':
          await this.handleACLGenPass(client, args.slice(1))
          break
          
        case 'WHOAMI':
          await this.handleACLWhoAmI(client, args.slice(1))
          break
          
        default:
          this.sendError(client, `ERR Unknown subcommand or wrong number of arguments for '${subcommand}'. Try ACL HELP.`)
      }
    } catch (error) {
      this.logger.error('ACL command error', { error: error.message, subcommand, clientId: client.id })
      this.sendError(client, `ERR ${error.message}`)
    }
  }

  /**
   * Handle ACL LIST command
   */
  async handleACLList(client, args) {
    const users = this.acl.listUsers()
    const userStrings = users.map(user => {
      const parts = [`user ${user.username}`]
      
      if (user.active) {
        parts.push('on')
      } else {
        parts.push('off')
      }
      
      // Add roles as commands for simplicity
      user.roles.forEach(role => parts.push(`+@${role}`))
      
      return parts.join(' ')
    })
    
    this.sendArray(client, userStrings)
  }

  /**
   * Handle ACL USERS command
   */
  async handleACLUsers(client, args) {
    const users = this.acl.listUsers()
    const usernames = users.map(user => user.username)
    this.sendArray(client, usernames)
  }

  /**
   * Handle ACL GETUSER command
   */
  async handleACLGetUser(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'acl getuser\' command')
      return
    }

    const username = args[0]
    
    try {
      const permissions = this.acl.getUserPermissions(username)
      
      const response = [
        'flags', permissions.active ? ['on'] : ['off'],
        'passwords', ['*'], // Simplified
        'commands', permissions.rolePermissions.commands,
        'keys', permissions.rolePermissions.keys || ['*'],
        'channels', permissions.rolePermissions.channels || ['*']
      ]
      
      this.sendArray(client, response)
    } catch (error) {
      this.sendError(client, `ERR ${error.message}`)
    }
  }

  /**
   * Handle ACL SETUSER command
   */
  async handleACLSetUser(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'acl setuser\' command')
      return
    }

    const username = args[0]
    let password = null
    const roles = ['default']

    // Parse ACL rules (simplified)
    for (let i = 1; i < args.length; i++) {
      const rule = args[i]
      
      if (rule.startsWith('>')) {
        password = rule.substring(1)
      } else if (rule.startsWith('+')) {
        // Add command permission - we'll map this to roles for simplicity
        const command = rule.substring(1)
        if (command === 'get' || command === '@read') {
          roles.push('readonly')
        } else if (command === 'set' || command === '@write') {
          roles.push('writer')
        } else if (command === '*' || command === '@all') {
          roles.push('admin')
        }
      }
    }

    try {
      if (this.acl.userExists(username)) {
        // User exists, update roles
        const currentRoles = this.acl.getUserRoles(username)
        roles.forEach(role => {
          if (!currentRoles.includes(role)) {
            this.acl.addUserRole(username, role)
          }
        })
      } else {
        // Create new user
        await this.acl.createUser(username, password, roles)
      }
      
      this.sendSimpleString(client, 'OK')
    } catch (error) {
      this.sendError(client, `ERR ${error.message}`)
    }
  }

  /**
   * Handle ACL DELUSER command
   */
  async handleACLDelUser(client, args) {
    if (args.length === 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'acl deluser\' command')
      return
    }

    let deletedCount = 0
    
    for (const username of args) {
      try {
        if (username === 'default') {
          // Cannot delete default user
          continue
        }
        
        this.acl.deleteUser(username)
        deletedCount++
      } catch (error) {
        // User doesn't exist, ignore
      }
    }
    
    this.sendInteger(client, deletedCount)
  }

  /**
   * Handle ACL GENPASS command
   */
  async handleACLGenPass(client, args) {
    const length = args.length > 0 ? parseInt(args[0]) : 32
    
    if (length < 4 || length > 128) {
      this.sendError(client, 'ERR ACL GENPASS argument must be the number of characters for the password')
      return
    }
    
    const crypto = require('crypto')
    const password = crypto.randomBytes(Math.ceil(length / 2)).toString('hex').substring(0, length)
    
    this.sendBulkString(client, password)
  }

  /**
   * Handle ACL WHOAMI command
   */
  async handleACLWhoAmI(client, args) {
    const username = client.username || this.acl.options.defaultUser
    this.sendBulkString(client, username)
  }

  /**
   * Handle EVAL command
   */
  async handleEval(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'eval\' command')
      return
    }

    const script = args[0]
    const numKeys = parseInt(args[1])
    
    if (isNaN(numKeys) || numKeys < 0) {
      this.sendError(client, 'ERR value is not an integer or out of range')
      return
    }

    const keys = args.slice(2, 2 + numKeys)
    const argv = args.slice(2 + numKeys)

    try {
      // Register script with ScriptManager
      const sha1 = this.scriptManager.registerScript(script)
      
      // Execute script
      const result = await this.scriptManager.executeScript(sha1, keys, argv)
      
      if (result === null) {
        this.sendNull(client)
      } else if (typeof result === 'string') {
        this.sendBulkString(client, result)
      } else if (typeof result === 'number') {
        this.sendInteger(client, result)
      } else if (Array.isArray(result)) {
        this.sendArray(client, result)
      } else {
        this.sendBulkString(client, String(result))
      }
    } catch (error) {
      this.sendError(client, `ERR ${error.message}`)
    }
  }

  /**
   * Handle EVALSHA command
   */
  async handleEvalSha(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'evalsha\' command')
      return
    }

    const sha1 = args[0]
    const numKeys = parseInt(args[1])
    
    if (isNaN(numKeys) || numKeys < 0) {
      this.sendError(client, 'ERR value is not an integer or out of range')
      return
    }

    const keys = args.slice(2, 2 + numKeys)
    const argv = args.slice(2 + numKeys)

    try {
      if (!this.scriptManager.hasScript(sha1)) {
        this.sendError(client, 'NOSCRIPT No matching script. Please use EVAL.')
        return
      }
      
      // Execute script by SHA1
      const result = await this.scriptManager.executeScript(sha1, keys, argv)
      
      if (result === null) {
        this.sendNull(client)
      } else if (typeof result === 'string') {
        this.sendBulkString(client, result)
      } else if (typeof result === 'number') {
        this.sendInteger(client, result)
      } else if (Array.isArray(result)) {
        this.sendArray(client, result)
      } else {
        this.sendBulkString(client, String(result))
      }
    } catch (error) {
      this.sendError(client, `ERR ${error.message}`)
    }
  }

  /**
   * Handle SCRIPT command
   */
  handleScript(client, args) {
    if (args.length === 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'script\' command')
      return
    }

    const subCommand = args[0].toString().toUpperCase()

    switch (subCommand) {
      case 'LOAD':
        this.handleScriptLoad(client, args.slice(1))
        break
      case 'EXISTS':
        this.handleScriptExists(client, args.slice(1))
        break
      case 'FLUSH':
        this.handleScriptFlush(client, args.slice(1))
        break
      case 'KILL':
        this.handleScriptKill(client, args.slice(1))
        break
      case 'DEBUG':
        this.handleScriptDebug(client, args.slice(1))
        break
      default:
        this.sendError(client, `ERR unknown SCRIPT subcommand '${subCommand}'`)
    }
  }

  /**
   * Handle SCRIPT LOAD command
   */
  handleScriptLoad(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'script load\' command')
      return
    }

    const script = args[0]

    try {
      const sha1 = this.scriptManager.registerScript(script)
      this.sendBulkString(client, sha1)
    } catch (error) {
      this.sendError(client, `ERR ${error.message}`)
    }
  }

  /**
   * Handle SCRIPT EXISTS command
   */
  handleScriptExists(client, args) {
    if (args.length === 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'script exists\' command')
      return
    }

    const results = []
    for (const sha1 of args) {
      results.push(this.scriptManager.hasScript(sha1) ? 1 : 0)
    }

    this.sendArray(client, results)
  }

  /**
   * Handle SCRIPT FLUSH command
   */
  handleScriptFlush(client, args) {
    try {
      const count = this.scriptManager.clearCache()
      this.sendSimpleString(client, 'OK')
    } catch (error) {
      this.sendError(client, `ERR ${error.message}`)
    }
  }

  /**
   * Handle SCRIPT KILL command
   */
  handleScriptKill(client, args) {
    // For now, just return OK as we don't have long-running scripts to kill
    this.sendSimpleString(client, 'OK')
  }

  /**
   * Handle SCRIPT DEBUG command
   */
  handleScriptDebug(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'script debug\' command')
      return
    }

    const mode = args[0].toString().toUpperCase()
    if (!['YES', 'NO', 'SYNC'].includes(mode)) {
      this.sendError(client, 'ERR invalid debug mode')
      return
    }

    try {
      this.scriptManager.setDebugMode(mode === 'YES' || mode === 'SYNC')
      this.sendSimpleString(client, 'OK')
    } catch (error) {
      this.sendError(client, `ERR ${error.message}`)
    }
  }

  /**
   * Handle CLUSTER command
   */
  async handleCluster(client, args) {
    if (args.length === 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'cluster\' command')
      return
    }

    const subCommand = args[0].toString().toUpperCase()

    switch (subCommand) {
      case 'NODES':
        this.handleClusterNodes(client)
        break
      case 'INFO':
        this.handleClusterInfo(client)
        break
      case 'KEYSLOT':
        this.handleClusterKeyslot(client, args.slice(1))
        break
      case 'COUNTKEYSINSLOT':
        this.handleClusterCountKeysInSlot(client, args.slice(1))
        break
      case 'GETKEYSINSLOT':
        this.handleClusterGetKeysInSlot(client, args.slice(1))
        break
      case 'ADDSLOTS':
        this.handleClusterAddSlots(client, args.slice(1))
        break
      case 'DELSLOTS':
        this.handleClusterDelSlots(client, args.slice(1))
        break
      case 'SETSLOT':
        this.handleClusterSetSlot(client, args.slice(1))
        break
      case 'MEET':
        this.handleClusterMeet(client, args.slice(1))
        break
      case 'RESET':
        this.handleClusterReset(client, args.slice(1))
        break
      case 'FAILOVER':
        this.handleClusterFailover(client, args.slice(1))
        break
      default:
        this.sendError(client, `ERR unknown CLUSTER subcommand '${subCommand}'`)
    }
  }

  /**
   * Handle CLUSTER NODES command
   */
  handleClusterNodes(client) {
    if (!this.clusterManager.options.clusterEnabled) {
      this.sendError(client, 'ERR cluster support disabled')
      return
    }

    const clusterState = this.clusterManager.getClusterState()
    const nodesList = []

    for (const [nodeId, nodeInfo] of Object.entries(clusterState.nodes)) {
      const slots = nodeInfo.slotRanges ? nodeInfo.slotRanges.join(' ') : ''
      const flags = nodeInfo.flags ? nodeInfo.flags.join(',') : ''
      const line = `${nodeId} ${nodeInfo.host}:${nodeInfo.port}@${nodeInfo.busPort || nodeInfo.port + 10000} ${flags} - 0 0 0 connected ${slots}`
      nodesList.push(line)
    }

    this.sendBulkString(client, nodesList.join('\n'))
  }

  /**
   * Handle CLUSTER INFO command
   */
  handleClusterInfo(client) {
    if (!this.clusterManager.options.clusterEnabled) {
      this.sendError(client, 'ERR cluster support disabled')
      return
    }

    const clusterState = this.clusterManager.getClusterState()
    const topology = clusterState.topology
    
    const info = [
      `cluster_state:${clusterState.state}`,
      `cluster_slots_assigned:${topology.assignedSlots}`,
      `cluster_slots_ok:${topology.assignedSlots}`,
      `cluster_slots_pfail:0`,
      `cluster_slots_fail:0`,
      `cluster_known_nodes:${Object.keys(clusterState.nodes).length}`,
      `cluster_size:${Object.keys(topology.nodes).length}`,
      `cluster_current_epoch:${clusterState.epoch}`,
      `cluster_my_epoch:${clusterState.epoch}`,
      `cluster_stats_messages_ping_sent:${clusterState.stats.messagesSent}`,
      `cluster_stats_messages_pong_sent:${clusterState.stats.messagesSent}`,
      `cluster_stats_messages_sent:${clusterState.stats.messagesSent}`,
      `cluster_stats_messages_received:${clusterState.stats.messagesReceived}`,
      `cluster_stats_messages_ping_received:${clusterState.stats.messagesReceived}`,
      `cluster_stats_messages_pong_received:${clusterState.stats.messagesReceived}`
    ]

    this.sendBulkString(client, info.join('\r\n'))
  }

  /**
   * Handle CLUSTER KEYSLOT command
   */
  handleClusterKeyslot(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'cluster keyslot\' command')
      return
    }

    const key = args[0]
    const slot = this.clusterManager.hashSlots.calculateSlot(key)
    this.sendInteger(client, slot)
  }

  /**
   * Handle CLUSTER COUNTKEYSINSLOT command
   */
  handleClusterCountKeysInSlot(client, args) {
    if (args.length !== 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'cluster countkeysinslot\' command')
      return
    }

    const slot = parseInt(args[0])
    if (isNaN(slot) || slot < 0 || slot >= 16384) {
      this.sendError(client, 'ERR invalid slot')
      return
    }

    // For simplicity, just return a count based on current keys
    const allKeys = this.dataStore.keys('*')
    let count = 0
    for (const key of allKeys) {
      if (this.clusterManager.hashSlots.calculateSlot(key) === slot) {
        count++
      }
    }

    this.sendInteger(client, count)
  }

  /**
   * Handle CLUSTER GETKEYSINSLOT command
   */
  handleClusterGetKeysInSlot(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'cluster getkeysinslot\' command')
      return
    }

    const slot = parseInt(args[0])
    const count = parseInt(args[1])

    if (isNaN(slot) || slot < 0 || slot >= 16384) {
      this.sendError(client, 'ERR invalid slot')
      return
    }

    if (isNaN(count) || count < 0) {
      this.sendError(client, 'ERR invalid count')
      return
    }

    const allKeys = this.dataStore.keys('*')
    const slotKeys = []
    
    for (const key of allKeys) {
      if (this.clusterManager.hashSlots.calculateSlot(key) === slot) {
        slotKeys.push(key)
        if (slotKeys.length >= count) {
          break
        }
      }
    }

    this.sendArray(client, slotKeys)
  }

  /**
   * Handle CLUSTER ADDSLOTS command
   */
  async handleClusterAddSlots(client, args) {
    if (args.length === 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'cluster addslots\' command')
      return
    }

    const slots = []
    for (const arg of args) {
      const slot = parseInt(arg)
      if (isNaN(slot) || slot < 0 || slot >= 16384) {
        this.sendError(client, `ERR invalid slot ${arg}`)
        return
      }
      slots.push(slot)
    }

    try {
      this.clusterManager.assignSlots(this.clusterManager.myself.id, slots)
      this.sendSimpleString(client, 'OK')
    } catch (error) {
      this.sendError(client, `ERR ${error.message}`)
    }
  }

  /**
   * Handle CLUSTER DELSLOTS command
   */
  async handleClusterDelSlots(client, args) {
    if (args.length === 0) {
      this.sendError(client, 'ERR wrong number of arguments for \'cluster delslots\' command')
      return
    }

    const slots = []
    for (const arg of args) {
      const slot = parseInt(arg)
      if (isNaN(slot) || slot < 0 || slot >= 16384) {
        this.sendError(client, `ERR invalid slot ${arg}`)
        return
      }
      slots.push(slot)
    }

    try {
      this.clusterManager.hashSlots.removeSlots(this.clusterManager.myself.id, slots)
      this.sendSimpleString(client, 'OK')
    } catch (error) {
      this.sendError(client, `ERR ${error.message}`)
    }
  }

  /**
   * Handle CLUSTER SETSLOT command
   */
  async handleClusterSetSlot(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'cluster setslot\' command')
      return
    }

    const slot = parseInt(args[0])
    const action = args[1].toString().toUpperCase()

    if (isNaN(slot) || slot < 0 || slot >= 16384) {
      this.sendError(client, 'ERR invalid slot')
      return
    }

    try {
      switch (action) {
        case 'MIGRATING':
          if (args.length !== 3) {
            this.sendError(client, 'ERR wrong number of arguments')
            return
          }
          const targetNode = args[2]
          await this.clusterManager.startMigration(slot, this.clusterManager.myself.id, targetNode)
          break
        case 'IMPORTING':
          // Handle importing state
          break
        case 'STABLE':
          // Reset slot to stable state
          break
        case 'NODE':
          if (args.length !== 3) {
            this.sendError(client, 'ERR wrong number of arguments')
            return
          }
          const nodeId = args[2]
          this.clusterManager.assignSlots(nodeId, [slot])
          break
        default:
          this.sendError(client, `ERR invalid CLUSTER SETSLOT action: ${action}`)
          return
      }
      this.sendSimpleString(client, 'OK')
    } catch (error) {
      this.sendError(client, `ERR ${error.message}`)
    }
  }

  /**
   * Handle CLUSTER MEET command
   */
  async handleClusterMeet(client, args) {
    if (args.length !== 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'cluster meet\' command')
      return
    }

    const host = args[0]
    const port = parseInt(args[1])

    if (isNaN(port) || port <= 0 || port > 65535) {
      this.sendError(client, 'ERR invalid port')
      return
    }

    try {
      await this.clusterManager.meetNode(host, port)
      this.sendSimpleString(client, 'OK')
    } catch (error) {
      this.sendError(client, `ERR ${error.message}`)
    }
  }

  /**
   * Handle CLUSTER RESET command
   */
  async handleClusterReset(client, args) {
    const resetType = args.length > 0 ? args[0].toString().toUpperCase() : 'SOFT'
    
    if (!['SOFT', 'HARD'].includes(resetType)) {
      this.sendError(client, 'ERR invalid reset type')
      return
    }

    try {
      // Reset cluster state
      this.clusterManager.hashSlots.reset()
      
      if (resetType === 'HARD') {
        // Also clear all data
        this.dataStore.flushdb()
      }
      
      this.sendSimpleString(client, 'OK')
    } catch (error) {
      this.sendError(client, `ERR ${error.message}`)
    }
  }

  /**
   * Handle CLUSTER FAILOVER command
   */
  async handleClusterFailover(client, args) {
    const forceOption = args.length > 0 ? args[0].toString().toUpperCase() : null
    
    if (forceOption && forceOption !== 'FORCE') {
      this.sendError(client, 'ERR invalid failover option')
      return
    }

    try {
      // Initiate failover
      await this.clusterManager.handleFailover(this.clusterManager.myself.id)
      this.sendSimpleString(client, 'OK')
    } catch (error) {
      this.sendError(client, `ERR ${error.message}`)
    }
  }

  // Helper method to determine if a command modifies data and should be logged
  isWriteCommand(command) {
    const writeCommands = new Set([
      // String operations
      'SET', 'DEL', 'APPEND', 'INCR', 'DECR', 'INCRBY', 'DECRBY', 'SETRANGE',
      
      // Key operations
      'EXPIRE', 'EXPIREAT', 'PEXPIRE', 'PEXPIREAT', 'PERSIST',
      
      // List operations
      'LPUSH', 'RPUSH', 'LPOP', 'RPOP', 'LSET', 'LTRIM', 'LINSERT', 'LREM',
      
      // Set operations
      'SADD', 'SREM', 'SINTERSTORE', 'SUNIONSTORE', 'SDIFFSTORE',
      
      // Hash operations
      'HSET', 'HDEL', 'HINCRBY', 'HINCRBYFLOAT', 'HSETNX',
      
      // Sorted set operations
      'ZADD', 'ZREM', 'ZINCRBY', 'ZREMRANGEBYRANK', 'ZREMRANGEBYSCORE',
      
      // JSON operations
      'JSON.SET', 'JSON.DEL', 'JSON.ARRAPPEND', 'JSON.ARRPOP',
      
      // Stream operations
      'XADD', 'XGROUP',
      
      // Geospatial operations
      'GEOADD',
      
      // Bitmap operations
      'SETBIT', 'BITOP', 'BITFIELD',
      
      // HyperLogLog operations
      'PFADD', 'PFMERGE',
      
      // Bloom filter operations
      'BF.ADD', 'BF.MADD',
      
      // Time series operations
      'TS.CREATE', 'TS.ADD', 'TS.DEL',
      
      // Vector operations
      'VECTOR.ADD', 'VECTOR.DEL',
      
      // Document operations
      'DB.CREATE', 'DB.DROP', 'DB.INSERT', 'DB.UPDATE', 'DB.DELETE', 'DB.INDEX.CREATE',
      
      // Database operations
      'FLUSHDB', 'FLUSHALL', 'SELECT',
      
      // Scripting operations (potentially modify data)
      'EVAL', 'EVALSHA',
      
      // Security operations (for replication)
      'ACL', 'AUTH',
      
      // Clustering operations (modify cluster state)
      'CLUSTER'
    ])
    
    return writeCommands.has(command.toUpperCase())
  }

  // Helper method to send pub/sub messages to multiple clients
  sendPubSubMessages(clientIds, messageArray) {
    for (const clientId of clientIds) {
      const client = this.clients.get(clientId)
      if (client) {
        this.sendArray(client, messageArray)
      }
    }
  }

  // RESP response formatting methods
  sendSimpleString(client, str) {
    if (client.socket && !client.socket.destroyed) {
      client.socket.write(`+${str}\r\n`)
    }
  }

  sendError(client, error) {
    if (client.socket && !client.socket.destroyed) {
      client.socket.write(`-${error}\r\n`)
    }
  }

  sendInteger(client, num) {
    if (client.socket && !client.socket.destroyed) {
      client.socket.write(`:${num}\r\n`)
    }
  }

  sendBulkString(client, str) {
    if (client.socket && !client.socket.destroyed) {
      if (str === null || str === undefined) {
        client.socket.write('$-1\r\n')
      } else {
        const strValue = String(str)
        client.socket.write(`$${strValue.length}\r\n${strValue}\r\n`)
      }
    }
  }

  sendArray(client, arr) {
    if (client.socket && !client.socket.destroyed) {
      if (arr === null || arr === undefined) {
        client.socket.write('*-1\r\n')
      } else {
        client.socket.write(`*${arr.length}\r\n`)
        for (const item of arr) {
          if (typeof item === 'number') {
            this.sendInteger(client, item)
          } else if (Array.isArray(item)) {
            this.sendArray(client, item)
          } else {
            this.sendBulkString(client, item)
          }
        }
      }
    }
  }

  /**
   * Handle INFO command - Phase 16
   */
  handleInfo(client, args) {
    let section = 'all'
    
    if (args.length > 0) {
      section = args[0].toLowerCase()
    }
    
    try {
      const infoOutput = this.serverInfo.getInfo(section)
      this.sendBulkString(client, infoOutput)
    } catch (error) {
      this.logger.error('Error handling INFO command', error)
      this.sendError(client, 'ERR unable to generate server info')
    }
  }

  /**
   * Trigger keyspace notification for a key operation
   * @param {string} operation - Operation name (e.g., 'set', 'del')
   * @param {string} key - Key that was operated on
   * @param {number} database - Database number (default: client's current database)
   */
  notifyKeyspaceEvent(operation, key, database = null, client = null) {
    if (this.keyspaceNotifications && this.keyspaceNotifications.isEnabled()) {
      const db = database !== null ? database : (client ? client.database : 0)
      this.keyspaceNotifications.notify(operation, key, db)
    }
  }

  /**
   * Handle SLOWLOG command - Phase 16
   */
  handleSlowLog(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'slowlog\' command')
      return
    }
    
    const subcommand = args[0].toUpperCase()
    
    try {
      switch (subcommand) {
        case 'GET': {
          const count = args.length > 1 ? parseInt(args[1], 10) : null
          if (args.length > 1 && (isNaN(count) || count < 0)) {
            this.sendError(client, 'ERR value is not an integer or out of range')
            return
          }
          
          const entries = this.slowLog.getEntries(count)
          const result = entries.map(entry => [
            entry.id,
            entry.timestamp,
            entry.executionTime,
            [entry.command, ...entry.args],
            entry.clientAddress,
            entry.clientName || ''
          ])
          
          this.sendArray(client, result)
          break
        }
        
        case 'LEN':
          this.sendInteger(client, this.slowLog.getLength())
          break
        
        case 'RESET':
          const clearedCount = this.slowLog.reset()
          this.sendInteger(client, clearedCount)
          break
          
        default:
          this.sendError(client, `ERR Unknown SLOWLOG subcommand '${subcommand}'`)
          break
      }
    } catch (error) {
      this.logger.error('Error handling SLOWLOG command', { subcommand, error })
      this.sendError(client, 'ERR slowlog operation failed')
    }
  }

  /**
   * Handle CONFIG command - Phase 17
   */
  handleConfig(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'config\' command')
      return
    }

    const subcommand = args[0].toUpperCase()

    try {
      switch (subcommand) {
        case 'SET':
          this.handleConfigSet(client, args.slice(1))
          break

        case 'GET':
          this.handleConfigGet(client, args.slice(1))
          break

        case 'RESETSTAT':
          this.handleConfigResetStat(client)
          break

        default:
          this.sendError(client, `ERR Unknown CONFIG subcommand '${subcommand}'`)
          break
      }
    } catch (error) {
      this.logger.error('Error handling CONFIG command', { subcommand, error })
      this.sendError(client, 'ERR config operation failed')
    }
  }

  /**
   * Handle CONFIG SET subcommand
   */
  handleConfigSet(client, args) {
    if (args.length < 2) {
      this.sendError(client, 'ERR wrong number of arguments for \'config set\' command')
      return
    }

    const parameter = args[0].toLowerCase()
    const value = args[1]

    switch (parameter) {
      case 'notify-keyspace-events':
        // Configure keyspace notifications
        try {
          const validation = this.keyspaceNotifications.validateConfig(value)
          if (!validation.valid) {
            this.sendError(client, `ERR Invalid configuration: ${validation.errors.join(', ')}`)
            return
          }

          this.keyspaceNotifications.configure(value)
          this.sendSimpleString(client, 'OK')
          
          this.logger.info('Keyspace notifications configured via CONFIG SET', {
            value,
            clientId: client.id
          })
        } catch (error) {
          this.sendError(client, `ERR Failed to configure notifications: ${error.message}`)
        }
        break

      default:
        this.sendError(client, `ERR Unsupported CONFIG parameter '${parameter}'`)
        break
    }
  }

  /**
   * Handle CONFIG GET subcommand
   */
  handleConfigGet(client, args) {
    if (args.length < 1) {
      this.sendError(client, 'ERR wrong number of arguments for \'config get\' command')
      return
    }

    const pattern = args[0].toLowerCase()
    const results = []

    // Support wildcard matching
    const matchesPattern = (name) => {
      if (pattern === '*') return true
      if (pattern === name) return true
      // Simple wildcard support
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
      return regex.test(name)
    }

    // Check each supported configuration parameter
    if (matchesPattern('notify-keyspace-events')) {
      results.push('notify-keyspace-events')
      results.push(this.keyspaceNotifications.getConfig() || '')
    }

    this.logger.debug('CONFIG GET results', {
      pattern,
      results: results.length,
      values: results,
      component: 'RedisServer'
    })

    this.sendArray(client, results)
  }

  /**
   * Handle CONFIG RESETSTAT subcommand
   */
  handleConfigResetStat(client) {
    try {
      // Reset various statistics
      if (this.serverInfo) {
        this.serverInfo.resetStats()
      }
      if (this.slowLog) {
        this.slowLog.reset()
      }
      if (this.metrics) {
        this.metrics.reset()
      }
      if (this.notificationManager) {
        // Reset notification statistics but keep subscriptions
        const stats = this.notificationManager.getStats()
        this.logger.info('Notification statistics reset', { previousStats: stats })
      }

      this.sendSimpleString(client, 'OK')
      this.logger.info('Statistics reset via CONFIG RESETSTAT', { clientId: client.id })
    } catch (error) {
      this.logger.error('Error resetting statistics', error)
      this.sendError(client, 'ERR Failed to reset statistics')
    }
  }
}

module.exports = RedisServer
