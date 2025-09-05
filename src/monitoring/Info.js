/**
 * Info.js - Server information and statistics module
 * 
 * This module provides comprehensive server statistics and information
 * that can be accessed via the INFO command, similar to Redis INFO.
 */

const os = require('os')
const logger = require('../utils/Logger')

/**
 * Server information and statistics collector
 */
class ServerInfo {
  constructor(server) {
    this.server = server
    this.startTime = Date.now()
    this.version = '1.0.0'
    this.mode = 'standalone' // standalone, cluster, sentinel
    
    // Statistics counters
    this.stats = {
      totalConnections: 0,
      totalCommands: 0,
      totalKeys: 0,
      instantaneousOpsPerSec: 0,
      instantaneousInputKbps: 0,
      instantaneousOutputKbps: 0,
      totalNetInputBytes: 0,
      totalNetOutputBytes: 0,
      rejectedConnections: 0,
      syncFull: 0,
      syncPartialOk: 0,
      syncPartialErr: 0,
      expiredKeys: 0,
      evictedKeys: 0,
      keyspaceHits: 0,
      keyspaceMisses: 0,
      pubsubChannels: 0,
      pubsubPatterns: 0,
      latestForkUsec: 0,
      migrateCachedSockets: 0,
      slaveExpiresTrackedKeys: 0,
      activeDefragHits: 0,
      activeDefragMisses: 0,
      activeDefragKeyHits: 0,
      activeDefragKeyMisses: 0
    }
    
    // Performance tracking
    this.lastStatsUpdate = Date.now()
    this.commandHistory = []
    this.maxHistorySize = 100
    
    logger.info('Server info module initialized', {
      component: 'ServerInfo'
    })
  }

  /**
   * Update statistics counters
   */
  updateStats(command, executionTime, inputBytes = 0, outputBytes = 0) {
    const now = Date.now()
    
    // Update basic counters
    this.stats.totalCommands++
    this.stats.totalNetInputBytes += inputBytes
    this.stats.totalNetOutputBytes += outputBytes
    
    // Track command history for rate calculations
    this.commandHistory.push({
      timestamp: now,
      command,
      executionTime,
      inputBytes,
      outputBytes
    })
    
    // Keep history size manageable
    if (this.commandHistory.length > this.maxHistorySize) {
      this.commandHistory.shift()
    }
    
    // Update instantaneous rates every second
    if (now - this.lastStatsUpdate > 1000) {
      this.calculateInstantaneousStats()
      this.lastStatsUpdate = now
    }
    
    // Update key statistics
    this.updateKeyStats()
  }

  /**
   * Calculate instantaneous statistics (ops/sec, bandwidth)
   */
  calculateInstantaneousStats() {
    const now = Date.now()
    const oneSecondAgo = now - 1000
    
    // Filter commands from last second
    const recentCommands = this.commandHistory.filter(cmd => cmd.timestamp > oneSecondAgo)
    
    // Calculate ops per second
    this.stats.instantaneousOpsPerSec = recentCommands.length
    
    // Calculate bandwidth
    const inputBytes = recentCommands.reduce((sum, cmd) => sum + cmd.inputBytes, 0)
    const outputBytes = recentCommands.reduce((sum, cmd) => sum + cmd.outputBytes, 0)
    
    this.stats.instantaneousInputKbps = Math.round(inputBytes / 1024)
    this.stats.instantaneousOutputKbps = Math.round(outputBytes / 1024)
  }

  /**
   * Update key-related statistics
   */
  updateKeyStats() {
    if (this.server.dataStore) {
      try {
        const allKeys = this.server.dataStore.keys('*')
        this.stats.totalKeys = allKeys.length
      } catch (error) {
        // Silently handle errors to avoid disrupting stats collection
      }
    }
  }

  /**
   * Record connection statistics
   */
  recordConnection(type = 'connect') {
    switch (type) {
      case 'connect':
        this.stats.totalConnections++
        break
      case 'reject':
        this.stats.rejectedConnections++
        break
    }
  }

  /**
   * Record cache hit/miss statistics
   */
  recordCacheAccess(hit = true) {
    if (hit) {
      this.stats.keyspaceHits++
    } else {
      this.stats.keyspaceMisses++
    }
  }

  /**
   * Record key expiration
   */
  recordKeyExpiration() {
    this.stats.expiredKeys++
  }

  /**
   * Record key eviction
   */
  recordKeyEviction() {
    this.stats.evictedKeys++
  }

  /**
   * Get server information in sections (like Redis INFO command)
   */
  getInfo(section = 'all') {
    try {
      const sections = {
        server: this.getServerSection(),
        clients: this.getClientsSection(),
        memory: this.getMemorySection(),
        persistence: this.getPersistenceSection(),
        stats: this.getStatsSection(),
        replication: this.getReplicationSection(),
        cpu: this.getCpuSection(),
        cluster: this.getClusterSection(),
        keyspace: this.getKeyspaceSection(),
        modules: this.getModulesSection()
      }

      if (section === 'all') {
        return Object.keys(sections)
          .map(name => `# ${name.charAt(0).toUpperCase() + name.slice(1)}\r\n${sections[name]}`)
          .join('\r\n\r\n')
      } else if (sections[section.toLowerCase()]) {
        return `# ${section.charAt(0).toUpperCase() + section.slice(1)}\r\n${sections[section.toLowerCase()]}`
      } else {
        return ''
      }
    } catch (error) {
      logger.error('Error generating info', error, { section, component: 'ServerInfo' })
      return `Error generating info: ${error.message}`
    }
  }

  /**
   * Get server section information
   */
  getServerSection() {
    try {
      const uptime = Math.floor((Date.now() - this.startTime) / 1000)
      const config = this.server.config || {}
      
      const result = [
        `redis_version:${this.version}`,
        `redis_git_sha1:00000000`,
        `redis_git_dirty:0`,
        `redis_build_id:${this.generateBuildId()}`,
        `redis_mode:${this.mode}`,
        `os:${os.type()} ${os.release()} ${os.arch()}`,
        `arch_bits:${os.arch().includes('64') ? '64' : '32'}`,
        `multiplexing_api:epoll`,
        `atomicvar_api:atomic-builtin`,
        `gcc_version:0.0.0`,
        `process_id:${process.pid}`,
        `run_id:${this.generateRunId()}`,
        `tcp_port:${config.port || 6379}`,
        `uptime_in_seconds:${uptime}`,
        `uptime_in_days:${Math.floor(uptime / 86400)}`,
        `hz:10`,
        `configured_hz:10`,
        `lru_clock:${this.getLruClock()}`,
        `executable:${process.execPath}`,
        `config_file:`
      ].join('\r\n')
      
      return result
    } catch (error) {
      logger.error('Error generating server section', error, { component: 'ServerInfo' })
      return 'Error generating server info'
    }
  }

  /**
   * Get clients section information
   */
  getClientsSection() {
    const clients = this.server.clients || new Map()
    
    return [
      `connected_clients:${clients.size}`,
      `client_recent_max_input_buffer:0`,
      `client_recent_max_output_buffer:0`,
      `blocked_clients:0`,
      `tracking_clients:0`,
      `clients_in_timeout_table:0`
    ].join('\r\n')
  }

  /**
   * Get memory section information
   */
  getMemorySection() {
    const memUsage = process.memoryUsage()
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    
    return [
      `used_memory:${memUsage.rss}`,
      `used_memory_human:${this.formatBytes(memUsage.rss)}`,
      `used_memory_rss:${memUsage.rss}`,
      `used_memory_rss_human:${this.formatBytes(memUsage.rss)}`,
      `used_memory_peak:${memUsage.rss}`,
      `used_memory_peak_human:${this.formatBytes(memUsage.rss)}`,
      `used_memory_peak_perc:100.00%`,
      `used_memory_overhead:${memUsage.external}`,
      `used_memory_startup:${memUsage.heapUsed}`,
      `used_memory_dataset:${memUsage.heapTotal - memUsage.heapUsed}`,
      `used_memory_dataset_perc:${((memUsage.heapTotal - memUsage.heapUsed) / memUsage.heapTotal * 100).toFixed(2)}%`,
      `allocator:system`,
      `total_system_memory:${totalMem}`,
      `total_system_memory_human:${this.formatBytes(totalMem)}`,
      `used_memory_lua:0`,
      `used_memory_lua_human:0B`,
      `used_memory_scripts:0`,
      `used_memory_scripts_human:0B`,
      `number_of_cached_scripts:${this.getCachedScriptsCount()}`,
      `maxmemory:0`,
      `maxmemory_human:0B`,
      `maxmemory_policy:noeviction`,
      `allocator_allocated:${memUsage.heapTotal}`,
      `allocator_active:${memUsage.heapUsed}`,
      `allocator_resident:${memUsage.rss}`,
      `allocator_frag_ratio:${(memUsage.rss / memUsage.heapTotal).toFixed(2)}`,
      `allocator_frag_bytes:${memUsage.rss - memUsage.heapTotal}`,
      `rss_overhead_ratio:1.00`,
      `rss_overhead_bytes:0`,
      `mem_fragmentation_ratio:${(memUsage.rss / memUsage.heapUsed).toFixed(2)}`,
      `mem_fragmentation_bytes:${memUsage.rss - memUsage.heapUsed}`,
      `mem_not_counted_for_evict:0`,
      `mem_replication_backlog:0`,
      `mem_clients_slaves:0`,
      `mem_clients_normal:0`,
      `mem_aof_buffer:0`,
      `mem_allocator:system`,
      `active_defrag_running:0`,
      `lazyfree_pending_objects:0`
    ].join('\r\n')
  }

  /**
   * Get persistence section information
   */
  getPersistenceSection() {
    return [
      `loading:0`,
      `rdb_changes_since_last_save:${this.stats.totalCommands}`,
      `rdb_bgsave_in_progress:0`,
      `rdb_last_save_time:${Math.floor(this.startTime / 1000)}`,
      `rdb_last_bgsave_status:ok`,
      `rdb_last_bgsave_time_sec:0`,
      `rdb_current_bgsave_time_sec:-1`,
      `rdb_last_cow_size:0`,
      `aof_enabled:${this.server.persistenceManager ? '1' : '0'}`,
      `aof_rewrite_in_progress:0`,
      `aof_rewrite_scheduled:0`,
      `aof_last_rewrite_time_sec:0`,
      `aof_current_rewrite_time_sec:-1`,
      `aof_last_bgrewrite_status:ok`,
      `aof_last_write_status:ok`,
      `aof_last_cow_size:0`,
      `module_fork_in_progress:0`,
      `module_fork_last_cow_size:0`
    ].join('\r\n')
  }

  /**
   * Get statistics section information
   */
  getStatsSection() {
    return [
      `total_connections_received:${this.stats.totalConnections}`,
      `total_commands_processed:${this.stats.totalCommands}`,
      `instantaneous_ops_per_sec:${this.stats.instantaneousOpsPerSec}`,
      `total_net_input_bytes:${this.stats.totalNetInputBytes}`,
      `total_net_output_bytes:${this.stats.totalNetOutputBytes}`,
      `instantaneous_input_kbps:${this.stats.instantaneousInputKbps}`,
      `instantaneous_output_kbps:${this.stats.instantaneousOutputKbps}`,
      `rejected_connections:${this.stats.rejectedConnections}`,
      `sync_full:${this.stats.syncFull}`,
      `sync_partial_ok:${this.stats.syncPartialOk}`,
      `sync_partial_err:${this.stats.syncPartialErr}`,
      `expired_keys:${this.stats.expiredKeys}`,
      `expired_stale_perc:0.00`,
      `expired_time_cap_reached_count:0`,
      `evicted_keys:${this.stats.evictedKeys}`,
      `keyspace_hits:${this.stats.keyspaceHits}`,
      `keyspace_misses:${this.stats.keyspaceMisses}`,
      `pubsub_channels:${this.stats.pubsubChannels}`,
      `pubsub_patterns:${this.stats.pubsubPatterns}`,
      `latest_fork_usec:${this.stats.latestForkUsec}`,
      `migrate_cached_sockets:${this.stats.migrateCachedSockets}`,
      `slave_expires_tracked_keys:${this.stats.slaveExpiresTrackedKeys}`,
      `active_defrag_hits:${this.stats.activeDefragHits}`,
      `active_defrag_misses:${this.stats.activeDefragMisses}`,
      `active_defrag_key_hits:${this.stats.activeDefragKeyHits}`,
      `active_defrag_key_misses:${this.stats.activeDefragKeyMisses}`,
      `tracking_total_keys:0`,
      `tracking_total_items:0`,
      `tracking_total_prefixes:0`,
      `unexpected_error_replies:0`,
      `total_reads_processed:${this.stats.totalCommands}`,
      `total_writes_processed:${this.stats.totalCommands}`,
      `io_threaded_reads_processed:0`,
      `io_threaded_writes_processed:0`
    ].join('\r\n')
  }

  /**
   * Get replication section information
   */
  getReplicationSection() {
    const replication = this.server.replicationManager
    
    if (!replication) {
      return [
        `role:master`,
        `connected_slaves:0`,
        `master_failover_state:no-failover`,
        `master_replid:${this.generateReplId()}`,
        `master_replid2:0000000000000000000000000000000000000000`,
        `master_repl_offset:0`,
        `second_repl_offset:-1`,
        `repl_backlog_active:0`,
        `repl_backlog_size:1048576`,
        `repl_backlog_first_byte_offset:0`,
        `repl_backlog_histlen:0`
      ].join('\r\n')
    }

    const replInfo = replication.getReplicationInfo ? replication.getReplicationInfo() : {}
    
    return [
      `role:${replInfo.role || 'master'}`,
      `connected_slaves:${replInfo.connectedSlaves || 0}`,
      `master_failover_state:no-failover`,
      `master_replid:${this.generateReplId()}`,
      `master_replid2:0000000000000000000000000000000000000000`,
      `master_repl_offset:${replInfo.offset || 0}`,
      `second_repl_offset:-1`,
      `repl_backlog_active:${replInfo.backlogActive ? '1' : '0'}`,
      `repl_backlog_size:1048576`,
      `repl_backlog_first_byte_offset:${replInfo.backlogFirstByteOffset || 0}`,
      `repl_backlog_histlen:${replInfo.backlogHistlen || 0}`
    ].join('\r\n')
  }

  /**
   * Get CPU section information
   */
  getCpuSection() {
    const cpus = os.cpus()
    const loadavg = os.loadavg()
    
    return [
      `used_cpu_sys:${process.cpuUsage().system / 1000000}`,
      `used_cpu_user:${process.cpuUsage().user / 1000000}`,
      `used_cpu_sys_children:0.00`,
      `used_cpu_user_children:0.00`,
      `used_cpu_sys_main_thread:${process.cpuUsage().system / 1000000}`,
      `used_cpu_user_main_thread:${process.cpuUsage().user / 1000000}`,
      `server_load_average_1min:${loadavg[0].toFixed(2)}`,
      `server_load_average_5min:${loadavg[1].toFixed(2)}`,
      `server_load_average_15min:${loadavg[2].toFixed(2)}`,
      `cpu_count:${cpus.length}`
    ].join('\r\n')
  }

  /**
   * Get cluster section information
   */
  getClusterSection() {
    const cluster = this.server.clusterManager
    
    if (!cluster || !cluster.options.clusterEnabled) {
      return `cluster_enabled:0`
    }
    
    const clusterState = cluster.getClusterState ? cluster.getClusterState() : {}
    
    return [
      `cluster_enabled:1`,
      `cluster_state:${clusterState.state || 'ok'}`,
      `cluster_slots_assigned:${clusterState.topology?.assignedSlots || 0}`,
      `cluster_slots_ok:${clusterState.topology?.assignedSlots || 0}`,
      `cluster_slots_pfail:0`,
      `cluster_slots_fail:0`,
      `cluster_known_nodes:${Object.keys(clusterState.nodes || {}).length}`,
      `cluster_size:${Object.keys(clusterState.topology?.nodes || {}).length}`,
      `cluster_current_epoch:${clusterState.epoch || 0}`,
      `cluster_my_epoch:${clusterState.epoch || 0}`,
      `cluster_stats_messages_ping_sent:${clusterState.stats?.messagesSent || 0}`,
      `cluster_stats_messages_pong_sent:${clusterState.stats?.messagesSent || 0}`,
      `cluster_stats_messages_sent:${clusterState.stats?.messagesSent || 0}`,
      `cluster_stats_messages_received:${clusterState.stats?.messagesReceived || 0}`
    ].join('\r\n')
  }

  /**
   * Get keyspace section information
   */
  getKeyspaceSection() {
    if (!this.server.dataStore) {
      return ''
    }

    const keyspaceInfo = []
    
    try {
      // For simplicity, we'll report on database 0
      // In a full implementation, you'd iterate through all databases
      const allKeys = this.server.dataStore.keys('*')
      const expiredKeys = this.stats.expiredKeys
      
      if (allKeys.length > 0) {
        keyspaceInfo.push(`db0:keys=${allKeys.length},expires=${expiredKeys},avg_ttl=0`)
      }
    } catch (error) {
      // Silently handle errors
    }
    
    return keyspaceInfo.join('\r\n')
  }

  /**
   * Get modules section information
   */
  getModulesSection() {
    return '# Modules (none loaded)'
  }

  /**
   * Utility functions
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0B'
    const k = 1024
    const sizes = ['B', 'K', 'M', 'G', 'T']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i]
  }

  generateBuildId() {
    return Date.now().toString(36).toUpperCase()
  }

  generateRunId() {
    return Math.random().toString(36).substring(2, 42).padEnd(40, '0')
  }

  generateReplId() {
    return Math.random().toString(36).substring(2).padEnd(40, '0')
  }

  getLruClock() {
    return Math.floor(Date.now() / 1000) & 0xFFFFFF
  }

  getCachedScriptsCount() {
    if (this.server.scriptManager && this.server.scriptManager.scripts) {
      return this.server.scriptManager.scripts.size
    }
    if (this.server.luaEngine && this.server.luaEngine.scriptCache) {
      return this.server.luaEngine.scriptCache.size
    }
    return 0
  }

  /**
   * Get performance metrics for monitoring
   */
  getPerformanceMetrics() {
    return {
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      totalCommands: this.stats.totalCommands,
      instantaneousOpsPerSec: this.stats.instantaneousOpsPerSec,
      totalKeys: this.stats.totalKeys,
      memoryUsage: process.memoryUsage(),
      connectedClients: this.server.clients ? this.server.clients.size : 0,
      keyspaceHits: this.stats.keyspaceHits,
      keyspaceMisses: this.stats.keyspaceMisses,
      hitRate: this.stats.keyspaceHits + this.stats.keyspaceMisses > 0 
        ? (this.stats.keyspaceHits / (this.stats.keyspaceHits + this.stats.keyspaceMisses) * 100).toFixed(2) 
        : 0
    }
  }

  /**
   * Reset statistics (for testing or administrative purposes)
   */
  resetStats() {
    const preserveStart = this.startTime
    this.stats = {
      totalConnections: 0,
      totalCommands: 0,
      totalKeys: 0,
      instantaneousOpsPerSec: 0,
      instantaneousInputKbps: 0,
      instantaneousOutputKbps: 0,
      totalNetInputBytes: 0,
      totalNetOutputBytes: 0,
      rejectedConnections: 0,
      syncFull: 0,
      syncPartialOk: 0,
      syncPartialErr: 0,
      expiredKeys: 0,
      evictedKeys: 0,
      keyspaceHits: 0,
      keyspaceMisses: 0,
      pubsubChannels: 0,
      pubsubPatterns: 0,
      latestForkUsec: 0,
      migrateCachedSockets: 0,
      slaveExpiresTrackedKeys: 0,
      activeDefragHits: 0,
      activeDefragMisses: 0,
      activeDefragKeyHits: 0,
      activeDefragKeyMisses: 0
    }
    this.startTime = preserveStart
    this.commandHistory = []
  }
}

module.exports = ServerInfo
