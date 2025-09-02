/**
 * LuaEngine.js - Lua scripting engine for Redis-Clone-JS
 * 
 * This module provides a JavaScript-based Lua interpreter that supports
 * Redis scripting functionality including redis.call() and redis.pcall().
 */

const crypto = require('crypto')
const logger = require('../utils/Logger')

/**
 * Simple Lua interpreter for Redis scripting
 */
class LuaInterpreter {
  constructor(redisAPI) {
    this.redisAPI = redisAPI
    this.globals = {
      // Lua standard functions
      print: (...args) => console.log(...args),
      type: (value) => typeof value,
      tostring: (value) => String(value),
      tonumber: (value) => {
        const num = Number(value)
        return isNaN(num) ? null : num
      },
      
      // Redis-specific functions
      redis: {
        call: async (...args) => await this.redisCall(args),
        pcall: async (...args) => await this.redisPCall(args)
      },
      
      // Lua table operations
      table: {
        insert: (table, value) => {
          if (Array.isArray(table)) {
            table.push(value)
          }
        },
        remove: (table, index) => {
          if (Array.isArray(table)) {
            return table.splice(index - 1, 1)[0] // Lua uses 1-based indexing
          }
        },
        sort: (table) => {
          if (Array.isArray(table)) {
            table.sort()
          }
        }
      },
      
      // Math functions
      math: {
        abs: Math.abs,
        ceil: Math.ceil,
        floor: Math.floor,
        max: Math.max,
        min: Math.min,
        random: Math.random,
        sqrt: Math.sqrt
      },
      
      // String functions
      string: {
        len: (str) => str.length,
        sub: (str, start, end) => str.substring(start - 1, end), // Lua uses 1-based indexing
        upper: (str) => str.toUpperCase(),
        lower: (str) => str.toLowerCase(),
        find: (str, pattern) => {
          const index = str.indexOf(pattern)
          return index === -1 ? null : index + 1 // Lua uses 1-based indexing
        }
      }
    }
  }

  /**
   * Execute redis.call() function
   */
  async redisCall(args) {
    if (!args || args.length === 0) {
      throw new Error('redis.call() requires at least one argument')
    }

    const command = args[0].toUpperCase()
    const commandArgs = args.slice(1)

    try {
      const result = await this.redisAPI.executeCommand(command, commandArgs)
      
      // Handle error objects from Redis commands
      if (result && typeof result === 'object' && result.error) {
        throw new Error(result.error)
      }
      
      return result
    } catch (error) {
      throw new Error(`Redis command failed: ${error.message}`)
    }
  }

  /**
   * Execute redis.pcall() function (protected call)
   */
  async redisPCall(args) {
    try {
      return await this.redisCall(args)
    } catch (error) {
      return { error: error.message }
    }
  }

  /**
   * Execute Lua script with given arguments
   */
  async execute(script, keys = [], argv = []) {
    try {
      // Create KEYS and ARGV with custom accessor for 1-based indexing
      const KEYS = new Proxy(keys, {
        get: (target, prop) => {
          if (typeof prop === 'string' && /^\d+$/.test(prop)) {
            const index = parseInt(prop, 10) - 1 // Convert 1-based to 0-based
            return index >= 0 && index < target.length ? target[index] : undefined
          }
          return target[prop]
        }
      })
      
      const ARGV = new Proxy(argv, {
        get: (target, prop) => {
          if (typeof prop === 'string' && /^\d+$/.test(prop)) {
            const index = parseInt(prop, 10) - 1 // Convert 1-based to 0-based
            return index >= 0 && index < target.length ? target[index] : undefined
          }
          return target[prop]
        }
      })
      
      // Add context to globals
      const context = {
        ...this.globals,
        KEYS,
        ARGV
      }

      // For simple return statements, wrap in a function
      let jsCode = script.trim()
      
      // Handle simple return statements
      if (jsCode.startsWith('return ') && !jsCode.includes('\n') && !jsCode.includes('if ')) {
        // Simple return statement - convert directly
        const returnValue = jsCode.substring(7) // Remove 'return '
        jsCode = this.convertLuaExpression(returnValue)
      } else {
        // Complex script - convert the whole thing
        jsCode = this.convertComplexLuaScript(jsCode)
      }

      // Create async function and execute in context with timeout
      const asyncFunc = new Function(...Object.keys(context), `
        return (async function() {
          ${jsCode}
        })();
      `)
      
      // Execute with timeout protection using Promise.race
      const timeout = 5000 // 5 second timeout for async operations
      
      const executeWithTimeout = () => {
        return Promise.race([
          asyncFunc(...Object.values(context)),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Script execution timeout')), timeout)
          )
        ])
      }
      
      const result = await executeWithTimeout()
      return result
    } catch (error) {
      throw new Error(`Script execution failed: ${error.message}`)
    }
  }

  /**
   * Convert a simple Lua expression to JavaScript
   */
  convertLuaExpression(expression) {
    // Handle simple literals
    if (expression.match(/^".*"$/)) {
      return `return ${expression}` // String literal
    }
    if (expression.match(/^\d+$/)) {
      return `return ${expression}` // Number literal
    }
    if (expression.match(/^\{.*\}$/)) {
      // Array literal - convert Lua table to JS array
      const arrayContent = expression.slice(1, -1) // Remove { }
      const elements = arrayContent.split(',').map(elem => elem.trim())
      return `return [${elements.join(', ')}]`
    }
    if (expression.includes('KEYS[') || expression.includes('ARGV[')) {
      // Handle KEYS/ARGV access
      const converted = expression.replace(/KEYS\[(\d+)\]/g, 'KEYS[$1]')
                                 .replace(/ARGV\[(\d+)\]/g, 'ARGV[$1]')
      return `return ${converted}`
    }
    
    // For other expressions, return as-is
    return `return ${expression}`
  }

  /**
   * Convert basic Lua syntax to JavaScript
   * This is a simplified converter for common Redis Lua patterns
   */
  convertLuaToJS(luaScript) {
    let jsScript = luaScript.trim()

    // Handle multi-line scripts
    const lines = jsScript.split('\n')
    const convertedLines = []
    
    for (let line of lines) {
      line = line.trim()
      if (!line || line.startsWith('--')) continue // Skip empty lines and comments
      
      // Convert Lua constructs line by line
      if (line.includes('local ')) {
        line = line.replace(/local\s+/g, 'let ')
      }
      if (line.includes('if ') && line.includes(' then')) {
        line = line.replace(/if\s+(.+?)\s+then/, 'if ($1) {')
      }
      if (line === 'else') {
        line = '} else {'
      }
      if (line === 'end') {
        line = '}'
      }
      if (line.includes('for ') && line.includes(' do')) {
        if (line.includes('=')) {
          line = line.replace(/for\s+(\w+)\s*=\s*(.+?)\s*,\s*(.+?)\s+do/, 'for (let $1 = $2; $1 <= $3; $1++) {')
        }
      }
      
      // Convert table literals to arrays
      if (line.includes('{') && line.includes('}')) {
        line = line.replace(/\{([^}]*)\}/g, (match, content) => {
          // Convert simple table literals to arrays
          const elements = content.split(',').map(el => el.trim()).filter(el => el)
          return `[${elements.join(', ')}]`
        })
      }
      
      // Handle table assignment and initialization
      if (line.includes('= {}')) {
        line = line.replace(/(\w+)\s*=\s*\{\}/, '$1 = []')
      }
      
      if (line.includes('result[') && line.includes('] = ')) {
        // Convert result[i] = value to result.push(value) or result[i-1] = value
        line = line.replace(/(\w+)\[(\w+)\]\s*=\s*(.+)/, (match, table, index, value) => {
          if (index === 'i') {
            return `${table}.push(${value})`
          }
          return `${table}[${index} - 1] = ${value}`
        })
      }
      
      // Convert redis.call statements to await (handle dots in redis.call)
      if (line.includes('redis.call(')) {
        line = line.replace(/redis\.call\(/g, 'await redis.call(')
      }
      
      // Handle string concatenation with .. operator
      if (line.includes('..') && !line.includes('redis.call')) {
        line = line.replace(/\.\./g, ' + ')
      }
      
      // Convert comparison operators
      line = line.replace(/\s==\s/g, ' === ')
      line = line.replace(/\s~=\s/g, ' !== ')
      
      // Convert KEYS and ARGV access
      line = line.replace(/KEYS\[(\d+)\]/g, 'KEYS[$1]')
      line = line.replace(/ARGV\[(\d+)\]/g, 'ARGV[$1]')
      
      // Convert length operator
      line = line.replace(/#(\w+)/g, '$1.length')
      
      // Convert nil
      line = line.replace(/\bnil\b/g, 'null')
      
      convertedLines.push(line)
    }
    
    // Join the converted lines
    jsScript = convertedLines.join('\n')
    
    // Ensure we have a return statement for complex scripts
    if (!jsScript.includes('return')) {
      // If it's a single expression, wrap it in return
      if (!jsScript.includes('{') && !jsScript.includes(';') && !jsScript.includes('\n')) {
        jsScript = `return (${jsScript})`
      } else {
        // For complex scripts, add proper return handling
        const lastLine = convertedLines[convertedLines.length - 1]
        if (lastLine && !lastLine.trim().startsWith('return') && !lastLine.includes('}')) {
          convertedLines[convertedLines.length - 1] = `return ${lastLine}`
          jsScript = convertedLines.join('\n')
        }
      }
    }

    return jsScript
  }

    /**
   * Convert complex Lua scripts with better handling
   */
  convertComplexLuaScript(luaScript) {
    let jsScript = luaScript.trim()

    // Handle multi-line return tables first
    jsScript = this.handleMultiLineReturnTables(jsScript)
    
    // Process line by line to avoid regex interference
    const lines = jsScript.split('\n')
    const convertedLines = []
    
    for (let line of lines) {
      line = line.trim()
      if (!line || line.startsWith('--')) continue // Skip empty lines and comments
      
      // Handle single-line redis.call() inside return tables
      if (line.includes('return {') && line.includes('}')) {
        line = line.replace(/return\s*\{([^{}]*)\}/g, (match, content) => {
          // Split content by commas, but respect function calls
          const parts = this.splitRespectingFunctions(content, ',')
          const convertedParts = parts.map(part => {
            let convertedPart = part.trim()
            // Ensure redis.call is awaited
            if (convertedPart.includes('redis.call(')) {
              convertedPart = convertedPart.replace(/redis\.call\(/g, 'await redis.call(')
            }
            return convertedPart
          }).filter(part => part)
          return `return [${convertedParts.join(', ')}]`
        })
      }

      // Convert basic constructs
      line = line.replace(/local\s+(\w+)\s*=\s*/g, 'let $1 = ')
      line = line.replace(/\bnil\b/g, 'null')
      
      // Convert table initialization  
      if (line.includes('= {}')) {
        line = line.replace(/\s*=\s*\{\}/g, ' = []')
      }
      
      // Convert KEYS and ARGV access
      line = line.replace(/KEYS\[(\d+)\]/g, 'KEYS[$1]')
      line = line.replace(/ARGV\[(\d+)\]/g, 'ARGV[$1]')
      
      // Convert length operator
      line = line.replace(/#(\w+)/g, '$1.length')
      
      // Convert comparison operators
      line = line.replace(/\s==\s/g, ' === ')
      line = line.replace(/\s~=\s/g, ' !== ')

      // Convert conditionals - handle redis.call in conditions
      if (line.includes('if ') && line.includes(' then')) {
        line = line.replace(/if\s+(.+?)\s+then/g, (match, condition) => {
          let convertedCondition = condition
          // Ensure redis.call is awaited in conditions
          if (convertedCondition.includes('redis.call(')) {
            convertedCondition = convertedCondition.replace(/redis\.call\(/g, 'await redis.call(')
          }
          return `if (${convertedCondition}) {`
        })
      } else if (line === 'else') {
        line = '} else {'
      } else if (line === 'end') {
        line = '}'
      }
      
      // Convert for loops
      if (line.includes('for ') && line.includes(' do')) {
        line = line.replace(/for\s+(\w+)\s*=\s*(.+?)\s*,\s*(.+?)\s+do/g, 'for (let $1 = $2; $1 <= $3; $1++) {')
      }
      
      // Convert table assignments to array pushes
      if (line.includes('[') && line.includes('] =')) {
        line = line.replace(/(\w+)\[(\w+)\]\s*=\s*(.+)/g, (match, table, index, value) => {
          if (index === 'i' || /^\d+$/.test(index)) {
            return `${table}.push(${value})`
          }
          return match
        })
      }
      
      // Convert redis.call statements to await
      if (line.includes('redis.call(') && !line.includes('await redis.call(')) {
        line = line.replace(/redis\.call\(/g, 'await redis.call(')
      }
      
      // Convert string concatenation AFTER other conversions
      if (line.includes('..') && !line.includes('...')) {
        line = line.replace(/\.\./g, ' + ')
      }

      convertedLines.push(line)
    }

    return convertedLines.join('\n')
  }

  /**
   * Handle multi-line return tables
   */
  handleMultiLineReturnTables(script) {
    // Find return { ... } blocks that span multiple lines
    const returnTableRegex = /return\s*\{([\s\S]*?)\}/g
    
    return script.replace(returnTableRegex, (match, content) => {
      // Split content by commas, but respect nested function calls
      const parts = this.splitRespectingFunctions(content, ',')
      const convertedParts = parts.map(part => {
        let convertedPart = part.trim()
        // Ensure redis.call is awaited in return arrays
        if (convertedPart.includes('redis.call(')) {
          convertedPart = convertedPart.replace(/redis\.call\(/g, 'await redis.call(')
        }
        return convertedPart
      }).filter(part => part)
      return `return [${convertedParts.join(', ')}]`
    })
  }

  /**
   * Split string by delimiter while respecting function calls
   */
  splitRespectingFunctions(str, delimiter) {
    const parts = []
    let current = ''
    let depth = 0
    let inQuotes = false
    
    for (let i = 0; i < str.length; i++) {
      const char = str[i]
      
      if (char === '"' && (i === 0 || str[i-1] !== '\\')) {
        inQuotes = !inQuotes
      }
      
      if (!inQuotes) {
        if (char === '(') depth++
        if (char === ')') depth--
      }
      
      if (char === delimiter && depth === 0 && !inQuotes) {
        parts.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    
    if (current.trim()) {
      parts.push(current.trim())
    }
    
    return parts
  }
}

/**
 * Lua scripting engine for Redis
 */
class LuaEngine {
  constructor(server) {
    this.server = server
    this.scriptCache = new Map() // SHA1 -> script content
    this.interpreter = new LuaInterpreter({
      executeCommand: async (command, args) => await this.executeRedisCommand(command, args)
    })
    
    logger.info('LuaEngine initialized', {
      component: 'LuaEngine'
    })
  }

  /**
   * Execute Redis command from Lua script
   */
  async executeRedisCommand(command, args) {
    try {
      // Select the current database
      this.server.dataStore.select(this.server.dataStore.currentDb)
      
      // Execute the command directly through the server
      const result = await this.server.executeCommand(command, args, this.server.dataStore.currentDb)
      
      // Handle error objects from Redis commands
      if (result && typeof result === 'object' && result.error) {
        throw new Error(result.error)
      }
      
      return result
    } catch (error) {
      throw new Error(`Command ${command} failed: ${error.message}`)
    }
  }

  /**
   * Execute Lua script directly (EVAL command)
   */
  async eval(script, numKeys, ...args) {
    try {
      // Parse keys and arguments
      const keys = args.slice(0, numKeys)
      const argv = args.slice(numKeys)

      logger.debug('Executing Lua script', {
        component: 'LuaEngine',
        scriptLength: script.length,
        numKeys,
        keysCount: keys.length,
        argvCount: argv.length
      })

      // Execute the script
      const result = await this.interpreter.execute(script, keys, argv)
      
      // Cache the script
      const sha = this.calculateSHA1(script)
      this.scriptCache.set(sha, script)

      return result
    } catch (error) {
      logger.error('Lua script execution failed', error, {
        component: 'LuaEngine'
      })
      throw error
    }
  }

  /**
   * Execute cached script by SHA1 (EVALSHA command)
   */
  async evalSha(sha, numKeys, ...args) {
    const script = this.scriptCache.get(sha)
    if (!script) {
      throw new Error(`NOSCRIPT No matching script. Please use EVAL`)
    }

    return await this.eval(script, numKeys, ...args)
  }

  /**
   * Load script into cache (SCRIPT LOAD command)
   */
  scriptLoad(script) {
    const sha = this.calculateSHA1(script)
    this.scriptCache.set(sha, script)
    
    logger.debug('Script loaded into cache', {
      component: 'LuaEngine',
      sha,
      scriptLength: script.length
    })

    return sha
  }

  /**
   * Check if scripts exist in cache (SCRIPT EXISTS command)
   */
  scriptExists(shas) {
    return shas.map(sha => this.scriptCache.has(sha) ? 1 : 0)
  }

  /**
   * Flush all cached scripts (SCRIPT FLUSH command)
   */
  scriptFlush() {
    const count = this.scriptCache.size
    this.scriptCache.clear()
    
    logger.info('Script cache flushed', {
      component: 'LuaEngine',
      clearedScripts: count
    })

    return 'OK'
  }

  /**
   * Kill running script (SCRIPT KILL command)
   * Note: In this implementation, scripts run atomically so this is mainly for compatibility
   */
  scriptKill() {
    logger.debug('Script kill requested', {
      component: 'LuaEngine'
    })
    
    // In a real implementation, this would interrupt running scripts
    // For now, we'll just return OK since our scripts execute atomically
    return 'OK'
  }

  /**
   * Calculate SHA1 hash of script
   */
  calculateSHA1(script) {
    return crypto.createHash('sha1').update(script).digest('hex')
  }

  /**
   * Get engine statistics
   */
  getStats() {
    return {
      cachedScripts: this.scriptCache.size,
      cacheKeys: Array.from(this.scriptCache.keys())
    }
  }

  /**
   * Clear all state
   */
  clear() {
    this.scriptCache.clear()
  }
}

module.exports = { LuaEngine, LuaInterpreter }
