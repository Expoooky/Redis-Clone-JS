/**
 * Interactive Redis Shell
 * 
 * Provides an interactive command-line interface with:
 * - Command auto-completion
 * - Command history
 * - Multi-line input support
 * - Real-time connection status
 * - Advanced formatting
 */

const readline = require('readline')
const fs = require('fs')
const path = require('path')
const os = require('os')
const net = require('net')

class InteractiveShell {
  constructor(options = {}) {
    this.client = null
    this.connected = false
    this.options = {
      host: '127.0.0.1',
      port: 6379,
      format: 'pretty',
      verbose: false,
      ...options
    }
    
    this.rl = null
    this.historyFile = path.join(os.homedir(), '.redis-cli-history')
    this.history = []
    this.multiLineBuffer = []
    this.inMultiLineMode = false
    
    // Redis command list for auto-completion
    this.redisCommands = [
      // String commands
      'GET', 'SET', 'DEL', 'EXISTS', 'EXPIRE', 'TTL', 'INCR', 'DECR', 'INCRBY', 'DECRBY',
      'APPEND', 'STRLEN', 'SETRANGE', 'GETRANGE', 'MGET', 'MSET', 'SETNX', 'SETEX', 'PSETEX',
      
      // List commands
      'LPUSH', 'RPUSH', 'LPOP', 'RPOP', 'LLEN', 'LRANGE', 'LINDEX', 'LSET', 'LREM', 'LTRIM',
      'BLPOP', 'BRPOP', 'RPOPLPUSH', 'BRPOPLPUSH',
      
      // Set commands
      'SADD', 'SREM', 'SMEMBERS', 'SCARD', 'SISMEMBER', 'SPOP', 'SRANDMEMBER', 'SMOVE',
      'SINTER', 'SUNION', 'SDIFF', 'SINTERSTORE', 'SUNIONSTORE', 'SDIFFSTORE',
      
      // Hash commands
      'HGET', 'HSET', 'HDEL', 'HEXISTS', 'HLEN', 'HKEYS', 'HVALS', 'HGETALL', 'HINCRBY',
      'HINCRBYFLOAT', 'HMGET', 'HMSET', 'HSETNX', 'HSTRLEN',
      
      // Sorted Set commands
      'ZADD', 'ZREM', 'ZRANGE', 'ZREVRANGE', 'ZRANK', 'ZREVRANK', 'ZSCORE', 'ZCARD',
      'ZCOUNT', 'ZREMRANGEBYRANK', 'ZREMRANGEBYSCORE', 'ZINCRBY', 'ZUNIONSTORE', 'ZINTERSTORE',
      
      // Pub/Sub commands
      'PUBLISH', 'SUBSCRIBE', 'UNSUBSCRIBE', 'PSUBSCRIBE', 'PUNSUBSCRIBE', 'PUBSUB',
      
      // Transaction commands
      'MULTI', 'EXEC', 'DISCARD', 'WATCH', 'UNWATCH',
      
      // Server commands
      'PING', 'ECHO', 'INFO', 'CONFIG', 'FLUSHDB', 'FLUSHALL', 'SAVE', 'BGSAVE', 'LASTSAVE',
      'SHUTDOWN', 'DEBUG', 'MEMORY', 'LATENCY', 'CLIENT', 'TIME', 'DBSIZE', 'RANDOMKEY',
      
      // Connection commands
      'AUTH', 'SELECT', 'QUIT', 'RESET',
      
      // Key commands
      'KEYS', 'SCAN', 'TYPE', 'DUMP', 'RESTORE', 'MIGRATE', 'OBJECT', 'SORT', 'RENAME',
      'RENAMENX', 'PERSIST', 'PEXPIRE', 'PTTL', 'EXPIREAT', 'PEXPIREAT',
      
      // Script commands
      'EVAL', 'EVALSHA', 'SCRIPT',
      
      // Cluster commands (if applicable)
      'CLUSTER', 'READONLY', 'READWRITE',
      
      // CLI specific commands
      'HELP', 'CLEAR', 'EXIT', 'QUIT'
    ]
  }

  /**
   * Connect to Redis server
   */
  async connect() {
    if (this.connected) return

    try {
      this.client = new net.Socket()
      await new Promise((resolve, reject) => {
        this.client.connect(this.options.port, this.options.host, resolve)
        this.client.on('error', reject)
        setTimeout(() => reject(new Error('Connection timeout')), 5000)
      })
      this.connected = true
    } catch (error) {
      console.error(`Could not connect to Redis at ${this.options.host}:${this.options.port}: ${error.message}`)
      process.exit(1)
    }
  }

  /**
   * Start the interactive shell
   */
  async start() {
    await this.connect()
    
    console.log('🚀 Redis Clone JS Interactive Shell')
    console.log(`📡 Connected to ${this.options.host}:${this.options.port}`)
    console.log('💡 Type "help" for commands, "exit" or Ctrl+C to quit')
    console.log('🔄 Multi-line mode: end commands with "\\" for continuation')
    console.log('')

    await this.loadHistory()
    this.setupReadline()
    this.displayPrompt()

    return new Promise((resolve) => {
      this.rl.on('close', () => {
        this.saveHistory()
        if (this.client) {
          this.client.destroy()
        }
        console.log('\n👋 Goodbye!')
        resolve()
      })
    })
  }

  /**
   * Setup readline interface with auto-completion
   */
  setupReadline() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer: this.completer.bind(this),
      history: this.history,
      historySize: 1000
    })

    this.rl.on('line', this.handleLine.bind(this))
    this.rl.on('SIGINT', () => {
      if (this.inMultiLineMode) {
        console.log('\n📝 Cancelled multi-line input')
        this.multiLineBuffer = []
        this.inMultiLineMode = false
        this.displayPrompt()
      } else {
        this.rl.close()
      }
    })
  }

  /**
   * Handle user input line
   */
  async handleLine(line) {
    const trimmedLine = line.trim()

    // Handle empty lines
    if (!trimmedLine) {
      this.displayPrompt()
      return
    }

    // Handle multi-line continuation
    if (trimmedLine.endsWith('\\')) {
      this.multiLineBuffer.push(trimmedLine.slice(0, -1))
      this.inMultiLineMode = true
      this.rl.setPrompt('... ')
      this.rl.prompt()
      return
    }

    // Complete multi-line command
    if (this.inMultiLineMode) {
      this.multiLineBuffer.push(trimmedLine)
      const fullCommand = this.multiLineBuffer.join(' ')
      this.multiLineBuffer = []
      this.inMultiLineMode = false
      await this.executeCommand(fullCommand)
    } else {
      await this.executeCommand(trimmedLine)
    }

    this.displayPrompt()
  }

  /**
   * Execute a command
   */
  async executeCommand(command) {
    const cmd = command.trim().toUpperCase()

    // Handle CLI-specific commands
    switch (cmd) {
      case 'EXIT':
      case 'QUIT':
        this.rl.close()
        return

      case 'CLEAR':
        console.clear()
        return

      case 'HELP':
        this.showHelp()
        return

      case 'HISTORY':
        this.showHistory()
        return

      case 'STATUS':
        this.showStatus()
        return
    }

    // Execute Redis command
    try {
      const startTime = process.hrtime.bigint()
      const result = await this.sendRedisCommand(command)
      const endTime = process.hrtime.bigint()
      const executionTime = Number(endTime - startTime) / 1000000

      const response = {
        success: true,
        result,
        executionTime,
        command
      }

      const formatted = this.formatOutput(response)
      console.log(formatted)

      // Add to history
      this.addToHistory(command)

    } catch (error) {
      const response = {
        success: false,
        error: error.message,
        command
      }

      const formatted = this.formatOutput(response)
      console.log(formatted)
    }
  }

  /**
   * Send Redis command using RESP protocol
   */
  async sendRedisCommand(command) {
    return new Promise((resolve, reject) => {
      const args = this.parseCommandArgs(command)
      const resp = this.buildRESP(args)
      
      let response = ''
      const onData = (data) => {
        response += data.toString()
        
        // Check if we have a complete RESP response
        if (this.isCompleteRESPResponse(response)) {
          this.client.removeListener('data', onData)
          try {
            const result = this.parseResponse(response)
            resolve(result)
          } catch (error) {
            reject(error)
          }
        }
      }
      
      this.client.on('data', onData)
      this.client.write(resp)
      
      setTimeout(() => {
        this.client.removeListener('data', onData)
        reject(new Error('Command timeout'))
      }, 5000)
    })
  }

  /**
   * Parse command string handling quoted arguments
   */
  parseCommandArgs(command) {
    const args = []
    let current = ''
    let inQuotes = false
    let quoteChar = null
    let i = 0
    
    while (i < command.length) {
      const char = command[i]
      
      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true
        quoteChar = char
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false
        quoteChar = null
      } else if (char === ' ' && !inQuotes) {
        if (current.trim()) {
          args.push(current.trim())
          current = ''
        }
      } else {
        current += char
      }
      i++
    }
    
    if (current.trim()) {
      args.push(current.trim())
    }
    
    return args
  }

  /**
   * Check if we have a complete RESP response
   */
  isCompleteRESPResponse(response) {
    if (!response.includes('\r\n')) return false
    
    const lines = response.split('\r\n')
    const firstLine = lines[0]
    
    // Simple string, error, or integer - complete if we have first \r\n
    if (firstLine.startsWith('+') || firstLine.startsWith('-') || firstLine.startsWith(':')) {
      return true
    }
    
    // Bulk string - need to check if we have the full string
    if (firstLine.startsWith('$')) {
      const length = parseInt(firstLine.substring(1))
      if (length === -1) return true // null value
      
      const lengthLineEnd = response.indexOf('\r\n')
      const dataStart = lengthLineEnd + 2
      const dataEnd = dataStart + length
      const terminatorEnd = dataEnd + 2 // \r\n after data
      
      return response.length >= terminatorEnd
    }
    
    // Array - need to check if we have all elements
    if (firstLine.startsWith('*')) {
      const count = parseInt(firstLine.substring(1))
      if (count === -1) return true // null array
      if (count === 0) return lines.length >= 1 // empty array
      
      try {
        let lineIndex = 1
        let elementsFound = 0
        
        while (elementsFound < count && lineIndex < lines.length) {
          const elementLine = lines[lineIndex]
          
          if (elementLine === undefined) return false
          
          if (elementLine.startsWith('$')) {
            const length = parseInt(elementLine.substring(1))
            if (length === -1) {
              // null element
              lineIndex += 1
            } else {
              // need data line
              if (lineIndex + 1 >= lines.length) return false
              lineIndex += 2
            }
          } else if (elementLine.startsWith(':')) {
            lineIndex += 1
          } else if (elementLine.startsWith('+') || elementLine.startsWith('-')) {
            lineIndex += 1
          } else {
            return false
          }
          
          elementsFound++
        }
        
        return elementsFound === count && lineIndex <= lines.length
      } catch (error) {
        return false
      }
    }
    
    return true
  }

  /**
   * Build RESP protocol message
   */
  buildRESP(args) {
    let resp = `*${args.length}\r\n`
    for (const arg of args) {
      const argStr = String(arg)
      resp += `$${argStr.length}\r\n${argStr}\r\n`
    }
    return resp
  }

  /**
   * Parse RESP protocol response
   */
  parseResponse(response) {
    const lines = response.split('\r\n')
    const firstLine = lines[0]
    
    if (firstLine.startsWith('+')) {
      return firstLine.substring(1)
    } else if (firstLine.startsWith('-')) {
      throw new Error(firstLine.substring(1))
    } else if (firstLine.startsWith(':')) {
      return parseInt(firstLine.substring(1))
    } else if (firstLine.startsWith('$')) {
      const length = parseInt(firstLine.substring(1))
      if (length === -1) return null
      
      const lengthLineEnd = response.indexOf('\r\n')
      const dataStart = lengthLineEnd + 2
      const data = response.substring(dataStart, dataStart + length)
      return data
    } else if (firstLine.startsWith('*')) {
      const count = parseInt(firstLine.substring(1))
      if (count === -1) return null
      
      const result = []
      let responseIndex = response.indexOf('\r\n') + 2 // Skip first line
      
      for (let i = 0; i < count; i++) {
        const itemStart = responseIndex
        const itemLineEnd = response.indexOf('\r\n', itemStart)
        const itemHeader = response.substring(itemStart, itemLineEnd)
        
        if (itemHeader.startsWith('$')) {
          const length = parseInt(itemHeader.substring(1))
          if (length === -1) {
            result.push(null)
            responseIndex = itemLineEnd + 2
          } else {
            const dataStart = itemLineEnd + 2
            const data = response.substring(dataStart, dataStart + length)
            result.push(data)
            responseIndex = dataStart + length + 2 // Skip the \r\n after data
          }
        } else if (itemHeader.startsWith(':')) {
          result.push(parseInt(itemHeader.substring(1)))
          responseIndex = itemLineEnd + 2
        } else if (itemHeader.startsWith('+')) {
          result.push(itemHeader.substring(1))
          responseIndex = itemLineEnd + 2
        }
      }
      
      return result
    }
    
    return response.trim()
  }

  /**
   * Auto-completion function
   */
  completer(line) {
    const trimmedLine = line.trim().toUpperCase()
    
    // If no space, complete command names
    if (!trimmedLine.includes(' ')) {
      const hits = this.redisCommands.filter(cmd => cmd.startsWith(trimmedLine))
      return [hits, trimmedLine]
    }

    // For commands with arguments, provide contextual completions
    const parts = trimmedLine.split(' ')
    const command = parts[0]
    
    switch (command) {
      case 'CONFIG':
        if (parts.length === 2) {
          const configCommands = ['GET', 'SET', 'RESETSTAT', 'REWRITE']
          const hits = configCommands.filter(cmd => cmd.startsWith(parts[1]))
          return [hits, parts[1]]
        }
        break
        
      case 'INFO':
        if (parts.length === 2) {
          const infoSections = ['SERVER', 'CLIENTS', 'MEMORY', 'PERSISTENCE', 'STATS', 'REPLICATION', 'CPU', 'CLUSTER', 'KEYSPACE']
          const hits = infoSections.filter(section => section.startsWith(parts[1]))
          return [hits, parts[1]]
        }
        break
        
      case 'CLIENT':
        if (parts.length === 2) {
          const clientCommands = ['LIST', 'INFO', 'GETNAME', 'SETNAME', 'KILL', 'PAUSE', 'UNPAUSE']
          const hits = clientCommands.filter(cmd => cmd.startsWith(parts[1]))
          return [hits, parts[1]]
        }
        break
    }

    return [[], line]
  }

  /**
   * Format command output
   */
  formatOutput(response) {
    const { success, result, error, executionTime, command } = response

    if (!success) {
      switch (this.options.format) {
        case 'json':
          return JSON.stringify({ error, command }, null, 2)
        default:
          return `(error) ${error}`
      }
    }

    // Format based on CLI format option
    switch (this.options.format) {
      case 'raw':
        return this.formatRaw(result)
      case 'csv':
        return this.formatCSV(result)  
      case 'json':
        return JSON.stringify(result)
      case 'quoted-json':
        return JSON.stringify(result, null, 0)
      case 'pretty':
      default:
        return this.formatPretty(result, executionTime)
    }
  }

  formatRaw(result) {
    if (result === null) return ''
    if (Array.isArray(result)) {
      return result.map(item => item === null ? '' : String(item)).join('\n')
    }
    return String(result)
  }

  formatCSV(result) {
    const escapeCSV = (val) => {
      if (val === null) return ''
      const str = String(val)
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }

    if (Array.isArray(result)) {
      return result.map(escapeCSV).join(',')
    }
    return escapeCSV(result)
  }

  formatPretty(result, executionTime) {
    let output = ''
    
    if (result === null) {
      output = '(nil)'
    } else if (Array.isArray(result)) {
      if (result.length === 0) {
        output = '(empty array)'
      } else {
        result.forEach((item, index) => {
          output += `${index + 1}) ${item === null ? '(nil)' : `"${item}"`}\n`
        })
        output = output.trim()
      }
    } else if (typeof result === 'number') {
      output = `(integer) ${result}`
    } else if (typeof result === 'string' && result === 'OK') {
      output = 'OK'
    } else {
      output = `"${result}"`
    }

    if (this.options.verbose && executionTime) {
      output += `\n⏱️  ${executionTime.toFixed(2)}ms`
    }

    return output
  }

  /**
   * Display command prompt
   */
  displayPrompt() {
    const promptSymbol = this.inMultiLineMode ? '... ' : `${this.options.host}:${this.options.port}> `
    this.rl.setPrompt(promptSymbol)
    this.rl.prompt()
  }

  /**
   * Show help information
   */
  showHelp() {
    console.log(`
📚 Redis Clone JS CLI Help

🔤 Available Commands:
  • All Redis commands are supported (GET, SET, LPUSH, etc.)
  • Use TAB for auto-completion
  • Commands are case-insensitive

🛠️  CLI Commands:
  • help          - Show this help message
  • exit/quit     - Exit the CLI
  • clear         - Clear the screen
  • history       - Show command history
  • status        - Show connection status

⚡ Features:
  • Multi-line input: End lines with \\ to continue
  • Command history: Use ↑/↓ arrows to navigate
  • Auto-completion: Press TAB for command suggestions

📖 Examples:
  > SET mykey "Hello World"
  > GET mykey
  > LPUSH mylist item1 item2 \\
  ... item3 item4
  > LRANGE mylist 0 -1

💡 Tip: Type any Redis command to get started!
`)
  }

  /**
   * Show command history
   */
  showHistory() {
    console.log('\n📜 Command History:')
    if (this.history.length === 0) {
      console.log('  (no commands in history)')
    } else {
      this.history.slice(-10).forEach((cmd, index) => {
        const historyIndex = this.history.length - 10 + index + 1
        console.log(`  ${historyIndex.toString().padStart(3)}: ${cmd}`)
      })
      if (this.history.length > 10) {
        console.log(`  ... and ${this.history.length - 10} more commands`)
      }
    }
    console.log('')
  }

  /**
   * Show connection status
   */
  showStatus() {
    console.log(`
📊 Connection Status:
  • Host: ${this.options.host}
  • Port: ${this.options.port}
  • Connected: ✅ Yes
  • Format: ${this.options.format}
  • Verbose: ${this.options.verbose ? 'Yes' : 'No'}
`)
  }

  /**
   * Add command to history
   */
  addToHistory(command) {
    if (command && command.trim() && this.history[this.history.length - 1] !== command) {
      this.history.push(command)
      if (this.history.length > 1000) {
        this.history = this.history.slice(-1000)
      }
    }
  }

  /**
   * Load command history from file
   */
  async loadHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        const content = fs.readFileSync(this.historyFile, 'utf8')
        this.history = content.split('\n').filter(line => line.trim())
      }
    } catch (error) {
      // Ignore history loading errors
    }
  }

  /**
   * Save command history to file
   */
  saveHistory() {
    try {
      const content = this.history.slice(-1000).join('\n')
      fs.writeFileSync(this.historyFile, content, 'utf8')
    } catch (error) {
      // Ignore history saving errors
    }
  }
}

module.exports = InteractiveShell
