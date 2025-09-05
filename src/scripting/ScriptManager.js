/**
 * ScriptManager.js - Advanced Lua script management for Redis-Clone-JS
 * 
 * This module provides advanced script management features including:
 * - Script caching and optimization
 * - Script debugging capabilities
 * - Performance monitoring for scripts
 * - Script lifecycle management
 */

const crypto = require('crypto')
const logger = require('../utils/Logger')

/**
 * Advanced script manager for Lua scripts
 */
class ScriptManager {
  constructor(luaEngine) {
    this.luaEngine = luaEngine
    this.scripts = new Map() // sha1 -> script info
    this.scriptStats = new Map() // sha1 -> execution stats
    this.debugMode = false
    this.maxCacheSize = 1000
    this.maxScriptSize = 512 * 1024 // 512KB max script size
    this.executionTimeLimit = 5000 // 5 seconds max execution time
  }

  /**
   * Register a new script
   */
  registerScript(script, options = {}) {
    if (typeof script !== 'string') {
      throw new Error('Script must be a string')
    }

    if (script.length > this.maxScriptSize) {
      throw new Error(`Script too large (${script.length} bytes, max ${this.maxScriptSize})`)
    }

    const sha1 = this.generateScriptHash(script)
    const now = Date.now()

    const scriptInfo = {
      sha1,
      script,
      createdAt: now,
      lastUsed: now,
      useCount: 0,
      totalExecutionTime: 0,
      averageExecutionTime: 0,
      errors: 0,
      lastError: null,
      debugInfo: this.debugMode ? this.extractDebugInfo(script) : null,
      metadata: {
        size: script.length,
        complexity: this.calculateComplexity(script),
        ...options
      }
    }

    // Evict old scripts if cache is full
    if (this.scripts.size >= this.maxCacheSize) {
      this.evictOldestScript()
    }

    this.scripts.set(sha1, scriptInfo)
    this.scriptStats.set(sha1, {
      executionTimes: [],
      errors: [],
      lastExecutions: []
    })

    logger.info('Script registered', {
      sha1: sha1.substring(0, 8),
      size: script.length,
      complexity: scriptInfo.metadata.complexity,
      component: 'ScriptManager'
    })

    return sha1
  }

  /**
   * Execute script by SHA1 hash
   */
  async executeScript(sha1, keys = [], args = [], options = {}) {
    const scriptInfo = this.scripts.get(sha1)
    if (!scriptInfo) {
      throw new Error(`Script not found: ${sha1}`)
    }

    const startTime = Date.now()
    let result = null
    let error = null

    try {
      // Update usage statistics
      scriptInfo.lastUsed = startTime
      scriptInfo.useCount++

      // Execute with timeout
      result = await this.executeWithTimeout(
        scriptInfo.script,
        keys,
        args,
        options.timeout || this.executionTimeLimit
      )

      const executionTime = Date.now() - startTime
      this.updateExecutionStats(sha1, executionTime, null)

      logger.debug('Script executed successfully', {
        sha1: sha1.substring(0, 8),
        executionTime,
        keys: keys.length,
        args: args.length,
        component: 'ScriptManager'
      })

    } catch (err) {
      error = err
      const executionTime = Date.now() - startTime
      this.updateExecutionStats(sha1, executionTime, err)

      logger.warn('Script execution failed', {
        sha1: sha1.substring(0, 8),
        error: err.message,
        executionTime,
        component: 'ScriptManager'
      })

      throw err
    }

    return result
  }

  /**
   * Execute script with timeout protection
   */
  async executeWithTimeout(script, keys, args, timeout) {
    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Script execution timeout (${timeout}ms)`))
      }, timeout)

      try {
        const result = await this.luaEngine.execute(script, keys, args)
        clearTimeout(timeoutId)
        resolve(result)
      } catch (error) {
        clearTimeout(timeoutId)
        reject(error)
      }
    })
  }

  /**
   * Get script information
   */
  getScriptInfo(sha1) {
    const scriptInfo = this.scripts.get(sha1)
    if (!scriptInfo) {
      return null
    }

    const stats = this.scriptStats.get(sha1)
    return {
      ...scriptInfo,
      stats: {
        totalExecutions: scriptInfo.useCount,
        totalTime: scriptInfo.totalExecutionTime,
        averageTime: scriptInfo.averageExecutionTime,
        errorRate: scriptInfo.errors / Math.max(scriptInfo.useCount, 1),
        recentExecutions: stats.lastExecutions.slice(-10)
      }
    }
  }

  /**
   * List all cached scripts
   */
  listScripts() {
    return Array.from(this.scripts.keys())
  }

  /**
   * Remove script from cache
   */
  removeScript(sha1) {
    const existed = this.scripts.delete(sha1)
    this.scriptStats.delete(sha1)
    
    if (existed) {
      logger.info('Script removed from cache', {
        sha1: sha1.substring(0, 8),
        component: 'ScriptManager'
      })
    }
    
    return existed
  }

  /**
   * Clear all cached scripts
   */
  clearCache() {
    const count = this.scripts.size
    this.scripts.clear()
    this.scriptStats.clear()
    
    logger.info('Script cache cleared', {
      scriptsRemoved: count,
      component: 'ScriptManager'
    })
    
    return count
  }

  /**
   * Check if script exists in cache
   */
  hasScript(sha1) {
    return this.scripts.has(sha1)
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    let totalSize = 0
    let totalExecutions = 0
    let totalErrors = 0
    let totalExecutionTime = 0

    for (const scriptInfo of this.scripts.values()) {
      totalSize += scriptInfo.metadata.size
      totalExecutions += scriptInfo.useCount
      totalErrors += scriptInfo.errors
      totalExecutionTime += scriptInfo.totalExecutionTime
    }

    return {
      cacheSize: this.scripts.size,
      maxCacheSize: this.maxCacheSize,
      totalScriptSize: totalSize,
      totalExecutions,
      totalErrors,
      totalExecutionTime,
      averageExecutionTime: totalExecutions > 0 ? totalExecutionTime / totalExecutions : 0,
      errorRate: totalExecutions > 0 ? totalErrors / totalExecutions : 0,
      cacheUtilization: this.scripts.size / this.maxCacheSize
    }
  }

  /**
   * Enable or disable debug mode
   */
  setDebugMode(enabled) {
    this.debugMode = enabled
    logger.info('Script debug mode changed', {
      enabled,
      component: 'ScriptManager'
    })
  }

  /**
   * Get debug information for a script
   */
  getDebugInfo(sha1) {
    const scriptInfo = this.scripts.get(sha1)
    if (!scriptInfo || !scriptInfo.debugInfo) {
      return null
    }

    return {
      sha1,
      debugInfo: scriptInfo.debugInfo,
      recentErrors: this.scriptStats.get(sha1)?.errors?.slice(-5) || []
    }
  }

  /**
   * Generate SHA1 hash for script
   */
  generateScriptHash(script) {
    return crypto.createHash('sha1').update(script).digest('hex')
  }

  /**
   * Update execution statistics
   */
  updateExecutionStats(sha1, executionTime, error) {
    const scriptInfo = this.scripts.get(sha1)
    const stats = this.scriptStats.get(sha1)
    
    if (!scriptInfo || !stats) return

    // Update script info
    scriptInfo.totalExecutionTime += executionTime
    scriptInfo.averageExecutionTime = scriptInfo.totalExecutionTime / scriptInfo.useCount

    if (error) {
      scriptInfo.errors++
      scriptInfo.lastError = {
        message: error.message,
        timestamp: Date.now()
      }
      stats.errors.push({
        error: error.message,
        timestamp: Date.now(),
        executionTime
      })
    }

    // Update detailed stats
    stats.executionTimes.push(executionTime)
    stats.lastExecutions.push({
      timestamp: Date.now(),
      executionTime,
      success: !error
    })

    // Keep only recent data
    if (stats.executionTimes.length > 100) {
      stats.executionTimes = stats.executionTimes.slice(-50)
    }
    if (stats.lastExecutions.length > 50) {
      stats.lastExecutions = stats.lastExecutions.slice(-25)
    }
    if (stats.errors.length > 20) {
      stats.errors = stats.errors.slice(-10)
    }
  }

  /**
   * Evict the oldest/least used script
   */
  evictOldestScript() {
    let oldestScript = null
    let oldestTime = Date.now()

    for (const [sha1, scriptInfo] of this.scripts.entries()) {
      const score = scriptInfo.lastUsed - (scriptInfo.useCount * 1000) // Favor frequently used scripts
      if (score < oldestTime) {
        oldestTime = score
        oldestScript = sha1
      }
    }

    if (oldestScript) {
      this.removeScript(oldestScript)
    }
  }

  /**
   * Calculate script complexity (simple heuristic)
   */
  calculateComplexity(script) {
    const lines = script.split('\n').length
    const redisCallCount = (script.match(/redis\.(?:call|pcall)/g) || []).length
    const loopCount = (script.match(/\b(?:for|while)\b/g) || []).length
    const conditionCount = (script.match(/\b(?:if|elseif)\b/g) || []).length
    
    return {
      lines,
      redisCallCount,
      loopCount,
      conditionCount,
      score: lines + (redisCallCount * 2) + (loopCount * 3) + (conditionCount * 1.5)
    }
  }

  /**
   * Extract debug information from script
   */
  extractDebugInfo(script) {
    const lines = script.split('\n')
    const functions = []
    const variables = new Set()
    const redisCalls = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      
      // Extract function definitions
      const funcMatch = line.match(/function\s+(\w+)\s*\(/)
      if (funcMatch) {
        functions.push({ name: funcMatch[1], line: i + 1 })
      }

      // Extract variable assignments
      const varMatch = line.match(/(?:local\s+)?(\w+)\s*=/)
      if (varMatch) {
        variables.add(varMatch[1])
      }

      // Extract redis calls
      const redisMatch = line.match(/redis\.(p?call)\s*\(\s*['"](\w+)['"]/)
      if (redisMatch) {
        redisCalls.push({
          type: redisMatch[1],
          command: redisMatch[2],
          line: i + 1
        })
      }
    }

    return {
      lineCount: lines.length,
      functions,
      variables: Array.from(variables),
      redisCalls,
      hasLoops: /\b(?:for|while)\b/.test(script),
      hasConditionals: /\b(?:if|elseif|else)\b/.test(script),
      estimatedComplexity: this.calculateComplexity(script).score
    }
  }

  /**
   * Validate script syntax (basic check)
   */
  validateScript(script) {
    const errors = []

    // Check for basic syntax issues
    const openBraces = (script.match(/\{/g) || []).length
    const closeBraces = (script.match(/\}/g) || []).length
    if (openBraces !== closeBraces) {
      errors.push('Mismatched braces')
    }

    const openParens = (script.match(/\(/g) || []).length
    const closeParens = (script.match(/\)/g) || []).length
    if (openParens !== closeParens) {
      errors.push('Mismatched parentheses')
    }

    // Check for potentially dangerous patterns
    if (script.includes('while true')) {
      errors.push('Potential infinite loop detected')
    }

    if (script.match(/redis\.call\s*\(\s*['"](?:EVAL|EVALSHA)['"]/)) {
      errors.push('Nested script execution not allowed')
    }

    return {
      valid: errors.length === 0,
      errors
    }
  }
}

module.exports = ScriptManager
