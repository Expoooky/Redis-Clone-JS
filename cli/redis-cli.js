#!/usr/bin/env node

/**
 * Redis Clone CLI - Main Entry Point
 * 
 * A comprehensive command-line interface for Redis Clone JS
 * Features:
 * - Interactive shell mode
 * - Batch command execution
 * - Multiple output formats
 * - Robust connection management
 * - Command auto-completion
 * - Help system
 */

const { program } = require('commander')
const path = require('path')
const fs = require('fs')
const InteractiveShell = require('./interactive-shell')
const net = require('net')

class RedisCLI {
  constructor() {
    this.client = null
    this.connected = false
    this.options = {
      host: '127.0.0.1',
      port: 6379,
      format: 'pretty',
      verbose: false
    }
  }

  /**
   * Initialize the CLI with command line arguments
   */
  async initialize() {
    program
      .name('redis-cli')
      .description('redis-cli 7.2.0 (Redis Clone JS)')
      .version('7.2.0')
      .option('-h, --hostname <hostname>', 'Server hostname (default: 127.0.0.1)', '127.0.0.1')
      .option('-p, --port <port>', 'Server port (default: 6379)', '6379')
      .option('-a, --auth <password>', 'Password to use when connecting to the server')
      .option('-u, --uri <uri>', 'Server URI')
      .option('-r, --repeat <times>', 'Execute specified command N times', '1')
      .option('-i, --interval <seconds>', 'When -r is used, wait <interval> seconds per command')
      .option('-n, --db <database>', 'Database number', '0')
      .option('-3, --protocols <version>', 'Specify RESP3 protocol')
      .option('-x, --stdin', 'Read last argument from STDIN')
      .option('-d, --delimiter <delimiter>', 'Multi-bulk delimiter in for raw output')
      .option('-c, --cluster', 'Enable cluster mode')
      .option('--raw', 'Use raw formatting for replies (default when STDOUT is not a tty)')
      .option('--no-raw', 'Force formatted output even when STDOUT is not a tty')  
      .option('--csv', 'Output in CSV format')
      .option('--json', 'Output in JSON format (default RESP3, use -2 if needed)')
      .option('--quoted-json', 'Same as --json, but produce ASCII-safe quoted strings')
      .option('--show-pushes <yn>', 'Whether to print RESP3 PUSH messages')
      .option('--stat', 'Print rolling stats about server: mem, clients, ...')
      .option('--latency', 'Enter a special mode continuously sampling latency')
      .option('--latency-history', 'Like --latency but tracking latency changes over time')
      .option('--latency-dist', 'Shows latency as a spectrum, requires xterm 256 colors')
      .option('--lru-test <keys>', 'Simulate a cache workload with an 80-20 distribution')
      .option('--replica', 'Simulate a replica showing commands received from the master')  
      .option('--rdb <filename>', 'Transfer an RDB dump from remote server to local file')
      .option('--pipe', 'Transfer raw Redis protocol from stdin to server')
      .option('--pipe-timeout <n>', 'In --pipe mode, abort with error if after sending all data')
      .option('--bigkeys', 'Sample Redis keys looking for keys with many elements (complexity)')
      .option('--memkeys', 'Sample Redis keys looking for keys consuming a lot of memory')
      .option('--memkeys-samples <n>', 'Sample Redis keys looking for keys consuming a lot of memory')
      .option('--hotkeys', 'Sample Redis keys looking for hot keys')
      .option('--scan', 'List all keys using the SCAN command')
      .option('--pattern <pattern>', 'Keys pattern when using the --scan, --bigkeys or --hotkeys')
      .option('--intrinsic-latency <sec>', 'Run a test to measure intrinsic system latency')
      .option('--eval <file>', 'Send an EVAL command using the Lua script at <file>')
      .option('--ldb', 'Used with --eval enable the Redis Lua debugger')
      .option('--ldb-sync-mode', 'Like --ldb but uses the synchronous Lua debugger')
      .option('--cluster-yes', 'Automatic yes to cluster manager commands prompts')
      .option('--verbose', 'Verbose mode')
      .option('--no-auth-warning', 'Don\'t show warning message when using password on command line')
      .argument('[cmd...]', 'Redis command to execute')

    // Handle help manually before parsing
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      this.showHelp()
      process.exit(0)
    }

    program.parse()
    
    const opts = program.opts()
    const args = program.args
    
    // Handle hostname vs host option (Redis CLI uses -h for hostname)
    if (opts.hostname) opts.host = opts.hostname
    
    this.options = {
      ...this.options,
      ...opts,
      port: parseInt(opts.port || '6379'),
      db: parseInt(opts.db || '0'),
      repeat: parseInt(opts.repeat || '1'),
      interval: opts.interval ? parseFloat(opts.interval) : null,
      // Determine output format based on options
      format: this.determineFormat(opts),
      isInteractive: process.stdout.isTTY && !opts.raw && args.length === 0
    }

    // Handle URI parsing if provided
    if (opts.uri) {
      this.parseRedisUri(opts.uri)
    }

    // Handle special modes
    if (opts.latency) return await this.runLatencyMode()
    if (opts.latencyHistory) return await this.runLatencyHistoryMode()
    if (opts.latencyDist) return await this.runLatencyDistMode()
    if (opts.stat) return await this.runStatMode()
    if (opts.bigkeys) return await this.runBigkeysMode(opts.pattern)
    if (opts.memkeys) return await this.runMemkeysMode(opts.pattern)
    if (opts.hotkeys) return await this.runHotkeysMode(opts.pattern)
    if (opts.scan) return await this.runScanMode(opts.pattern)
    if (opts.pipe) return await this.runPipeMode()
    if (opts.replica) return await this.runReplicaMode()
    if (opts.eval) return await this.runEvalMode(opts.eval)

    // Handle direct command execution
    if (args.length > 0) {
      return await this.executeDirectCommand(args)
    }

    // Start interactive mode
    return await this.startInteractiveMode()
  }

  /**
   * Determine output format based on CLI options
   */
  determineFormat(opts) {
    if (opts.raw) return 'raw'
    if (opts.csv) return 'csv'
    if (opts.json) return 'json'
    if (opts.quotedJson) return 'quoted-json'
    // For non-interactive mode, use pretty format unless specifically requesting raw
    // This matches Redis CLI behavior better
    if (!process.stdout.isTTY && opts.noRaw === false) return 'raw'
    return 'pretty'
  }

  /**
   * Parse Redis URI (redis://[username:password@]host[:port][/database])
   */
  parseRedisUri(uri) {
    try {
      const url = new URL(uri)
      if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
        throw new Error('Invalid Redis URI protocol')
      }
      
      this.options.host = url.hostname || '127.0.0.1'
      this.options.port = parseInt(url.port) || 6379
      
      if (url.username) {
        this.options.username = url.username
      }
      if (url.password) {
        this.options.auth = url.password
      }
      if (url.pathname && url.pathname !== '/') {
        this.options.db = parseInt(url.pathname.slice(1)) || 0
      }
    } catch (error) {
      console.error(`Invalid Redis URI: ${error.message}`)
      process.exit(1)
    }
  }

  /**
   * Execute command directly (non-interactive mode)
   */
  async executeDirectCommand(args) {
    await this.connect()
    
    try {
      // Select database if specified
      if (this.options.db !== 0) {
        await this.sendCommand(['SELECT', this.options.db.toString()])
      }

      // Authenticate if needed
      if (this.options.auth) {
        const authCmd = this.options.username ? 
          ['AUTH', this.options.username, this.options.auth] : 
          ['AUTH', this.options.auth]
        await this.sendCommand(authCmd)
      }

      // Execute command with repeat and interval
      for (let i = 0; i < this.options.repeat; i++) {
        if (i > 0 && this.options.interval) {
          await new Promise(resolve => setTimeout(resolve, this.options.interval * 1000))
        }
        
        const result = await this.sendCommand(args)
        console.log(this.formatDirectOutput(result))
      }
    } catch (error) {
      console.error(`(error) ${error.message}`)
      process.exit(1)
    } finally {
      this.disconnect()
    }
  }

  /**
   * Format output for direct command execution
   */
  formatDirectOutput(result) {
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
        return this.formatPrettyDirect(result)
    }
  }

  /**
   * Format pretty output for direct commands (matches Redis CLI exactly)
   */
  formatPrettyDirect(result) {
    if (result === null) {
      return '(nil)'
    } else if (Array.isArray(result)) {
      if (result.length === 0) {
        return '(empty array)'
      } else {
        let output = ''
        result.forEach((item, index) => {
          output += `${index + 1}) ${item === null ? '(nil)' : `"${item}"`}\n`
        })
        return output.trim()
      }
    } else if (typeof result === 'number') {
      return `(integer) ${result}`
    } else if (typeof result === 'string' && result === 'OK') {
      return 'OK'
    } else if (typeof result === 'string') {
      return `"${result}"`
    } else {
      return String(result)
    }
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
      })
      this.connected = true
      
      if (this.options.verbose) {
        console.log(`✅ Connected to Redis server at ${this.options.host}:${this.options.port}`)
      }
    } catch (error) {
      console.error(`❌ Failed to connect to Redis server: ${error.message}`)
      process.exit(1)
    }
  }

  /**
   * Disconnect from Redis server
   */
  async disconnect() {
    if (this.client && this.connected) {
      this.client.end()
      this.connected = false
      
      if (this.options.verbose) {
        console.log('✅ Disconnected from Redis server')
      }
    }
  }

  /**
   * Execute a single Redis command
   */
  async executeCommand(command) {
    if (!this.connected) {
      await this.connect()
    }

    try {
      const startTime = process.hrtime.bigint()
      const result = await this.sendRedisCommand(command.trim())
      const endTime = process.hrtime.bigint()
      const executionTime = Number(endTime - startTime) / 1000000 // Convert to milliseconds

      return {
        success: true,
        result,
        executionTime,
        command: command.trim()
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        command: command.trim()
      }
    }
  }

  /**
   * Send Redis command using RESP protocol
   */
  async sendRedisCommand(command) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('Client is not connected'))
        return
      }

      const args = this.parseCommand(command)
      const resp = this.buildRESP(args)
      
      let response = ''
      const onData = (data) => {
        response += data.toString()
        
        // Check if we have a complete RESP response (with timeout for incomplete responses)
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
  parseCommand(command) {
    const args = []
    let current = ''
    let inQuotes = false
    let i = 0
    
    while (i < command.length) {
      const char = command[i]
      
      if (char === '"' && !inQuotes) {
        inQuotes = true
      } else if (char === '"' && inQuotes) {
        inQuotes = false
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
      let lineIndex = 1
      
      for (let i = 0; i < count; i++) {
        if (lines[lineIndex] && lines[lineIndex].startsWith('$')) {
          const length = parseInt(lines[lineIndex].substring(1))
          result.push(length === -1 ? null : lines[lineIndex + 1])
          lineIndex += 2
        } else if (lines[lineIndex] && lines[lineIndex].startsWith(':')) {
          result.push(parseInt(lines[lineIndex].substring(1)))
          lineIndex += 1
        } else if (lines[lineIndex]) {
          result.push(lines[lineIndex].substring(1))
          lineIndex += 1
        }
      }
      
      return result
    }
    
    return response.trim()
  }

  /**
   * Format command output based on selected format
   */
  formatOutput(response) {
    const { success, result, error, executionTime, command } = response

    if (!success) {
      return this.formatError(error, command)
    }

    switch (this.options.format) {
      case 'json':
        return JSON.stringify({ result, executionTime, command }, null, 2)
      
      case 'raw':
        return this.formatRaw(result)
      
      case 'table':
        return this.formatTable(result, command)
      
      case 'pretty':
      default:
        return this.formatPretty(result, executionTime, command)
    }
  }

  /**
   * Format error output
   */
  formatError(error, command) {
    switch (this.options.format) {
      case 'json':
        return JSON.stringify({ error, command }, null, 2)
      default:
        return `❌ (error) ${error}`
    }
  }

  /**
   * Format raw output (matches Redis CLI --raw behavior)
   */
  formatRaw(result) {
    if (result === null) return ''
    if (Array.isArray(result)) {
      return result.map(item => item === null ? '' : String(item)).join(this.options.delimiter || '\n')
    }
    return String(result)
  }

  /**
   * Format CSV output (matches Redis CLI --csv behavior)
   */
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

  /**
   * Format table output
   */
  formatTable(result, command) {
    if (Array.isArray(result)) {
      if (result.length === 0) return '(empty array)'
      
      const table = result.map((item, index) => ({
        Index: index + 1,
        Value: item === null ? '(nil)' : String(item)
      }))
      
      return this.createTable(table)
    }
    
    return this.formatPretty(result)
  }

  /**
   * Format pretty output
   */
  formatPretty(result, executionTime, command) {
    let output = ''
    
    if (result === null) {
      output = '(nil)'
    } else if (Array.isArray(result)) {
      if (result.length === 0) {
        output = '(empty array)'
      } else {
        result.forEach((item, index) => {
          output += `${index + 1}) ${item === null ? '(nil)' : item}\n`
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
      output += `\n⏱️  Execution time: ${executionTime.toFixed(2)}ms`
    }

    return output
  }

  /**
   * Send command to Redis server and get response
   */
  async sendCommand(args) {
    return new Promise((resolve, reject) => {
      const command = args.join(' ')
      const respCommand = `*${args.length}\r\n` + 
        args.map(arg => {
          const str = String(arg)
          return `$${str.length}\r\n${str}\r\n`
        }).join('')

      let responseBuffer = ''
      let timeoutHandle = null
      let resolved = false

      const cleanup = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle)
        if (this.client) this.client.removeListener('data', handleData)
      }

      const handleData = (data) => {
        if (resolved) return
        
        responseBuffer += data.toString()
        const response = this.parseRESP(responseBuffer)
        if (response !== undefined) {
          resolved = true
          cleanup()
          resolve(response)
        }
      }

      this.client.on('data', handleData)
      this.client.write(respCommand)

      // Timeout after 10 seconds
      timeoutHandle = setTimeout(() => {
        if (resolved) return
        resolved = true
        cleanup()
        reject(new Error(`Command timeout: ${command}`))
      }, 10000)
    })
  }

  /**
   * Parse RESP protocol response
   */
  parseRESP(buffer) {
    if (buffer.length === 0) return undefined
    
    const lineEnd = buffer.indexOf('\r\n')
    if (lineEnd === -1) return undefined
    
    const firstLine = buffer.substring(0, lineEnd)
    const type = firstLine[0]
    
    switch (type) {
      case '+': // Simple string
        return firstLine.substring(1)
      case '-': // Error
        throw new Error(firstLine.substring(1))
      case ':': // Integer
        return parseInt(firstLine.substring(1), 10)
      case '$': // Bulk string
        const length = parseInt(firstLine.substring(1))
        if (length === -1) return null
        const totalLength = lineEnd + 2 + length + 2
        if (buffer.length < totalLength) return undefined
        return buffer.substring(lineEnd + 2, lineEnd + 2 + length)
      case '*': // Array
        const count = parseInt(firstLine.substring(1))
        if (count === -1) return null
        // Simple array parsing - for complex arrays, use the InteractiveShell parser
        const result = []
        let index = lineEnd + 2
        for (let i = 0; i < count; i++) {
          const itemEnd = buffer.indexOf('\r\n', index)
          if (itemEnd === -1) return undefined
          const itemHeader = buffer.substring(index, itemEnd)
          if (itemHeader.startsWith('$')) {
            const itemLength = parseInt(itemHeader.substring(1))
            if (itemLength === -1) {
              result.push(null)
              index = itemEnd + 2
            } else {
              const dataStart = itemEnd + 2
              if (buffer.length < dataStart + itemLength + 2) return undefined
              result.push(buffer.substring(dataStart, dataStart + itemLength))
              index = dataStart + itemLength + 2
            }
          }
        }
        return result
    }
    
    return undefined
  }

  /**
   * Disconnect from Redis server
   */
  disconnect() {
    if (this.client) {
      this.client.destroy()
      this.client = null
      this.connected = false
    }
  }

  // Special mode implementations (stubs for now - can be expanded)
  async runLatencyMode() {
    console.log('Latency monitoring mode not implemented yet')
    process.exit(1)
  }

  async runLatencyHistoryMode() {
    console.log('Latency history mode not implemented yet')
    process.exit(1)
  }

  async runLatencyDistMode() {
    console.log('Latency distribution mode not implemented yet')  
    process.exit(1)
  }

  async runStatMode() {
    console.log('Statistics mode not implemented yet')
    process.exit(1)
  }

  async runBigkeysMode(pattern) {
    console.log('Bigkeys mode not implemented yet')
    process.exit(1)
  }

  async runMemkeysMode(pattern) {
    console.log('Memkeys mode not implemented yet')
    process.exit(1)
  }

  async runHotkeysMode(pattern) {
    console.log('Hotkeys mode not implemented yet')
    process.exit(1)
  }

  async runScanMode(pattern) {
    console.log('Scan mode not implemented yet')
    process.exit(1)
  }

  async runPipeMode() {
    console.log('Pipe mode not implemented yet')
    process.exit(1)
  }

  async runReplicaMode() {
    console.log('Replica mode not implemented yet')
    process.exit(1)
  }

  async runEvalMode(file) {
    console.log('Eval mode not implemented yet')
    process.exit(1)
  }

  /**
   * Create ASCII table
   */
  createTable(data) {
    if (!Array.isArray(data) || data.length === 0) return '(empty table)'
    
    const headers = Object.keys(data[0])
    const columnWidths = headers.map(header => 
      Math.max(header.length, ...data.map(row => String(row[header]).length))
    )
    
    // Create header row
    let table = '┌─' + columnWidths.map(w => '─'.repeat(w)).join('─┬─') + '─┐\n'
    table += '│ ' + headers.map((h, i) => h.padEnd(columnWidths[i])).join(' │ ') + ' │\n'
    table += '├─' + columnWidths.map(w => '─'.repeat(w)).join('─┼─') + '─┤\n'
    
    // Create data rows
    data.forEach(row => {
      table += '│ ' + headers.map((h, i) => String(row[h]).padEnd(columnWidths[i])).join(' │ ') + ' │\n'
    })
    
    table += '└─' + columnWidths.map(w => '─'.repeat(w)).join('─┴─') + '─┘'
    
    return table
  }

  /**
   * Execute multiple commands in batch
   */
  async executeBatch(commands) {
    await this.connect()
    
    const results = []
    
    for (const command of commands) {
      if (command.trim()) {
        const response = await this.executeCommand(command)
        const formatted = this.formatOutput(response)
        console.log(formatted)
        results.push(response)
      }
    }
    
    await this.disconnect()
    return results
  }

  /**
   * Execute commands from a file
   */
  async executeBatchFile(filename) {
    try {
      const filePath = path.resolve(filename)
      const content = fs.readFileSync(filePath, 'utf8')
      const commands = content.split('\n').filter(line => line.trim() && !line.startsWith('#'))
      
      console.log(`📄 Executing ${commands.length} commands from ${filename}`)
      return await this.executeBatch(commands)
    } catch (error) {
      console.error(`❌ Failed to read batch file: ${error.message}`)
      process.exit(1)
    }
  }

  /**
   * Start interactive shell mode
   */
  async startInteractiveMode() {
    // Show startup message like Redis CLI
    const options = {
      host: this.options.host || '127.0.0.1',
      port: this.options.port || 6379,
      format: this.options.format,
      verbose: this.options.verbose
    }

    const shell = new InteractiveShell(options)
    await shell.start()
  }

  /**
   * Handle graceful shutdown
   */
  async shutdown() {
    await this.disconnect()
    process.exit(0)
  }

  /**
   * Show help message that matches Redis CLI format
   */
  showHelp() {
    console.log(`redis-cli 7.2.0 (Redis Clone JS)

Usage: redis-cli [OPTIONS] [cmd [arg [arg ...]]]
  -h <hostname>      Server hostname (default: 127.0.0.1).
  -p <port>          Server port (default: 6379).
  -a <password>      Password to use when connecting to the server.
  -u <uri>           Server URI.
  -r <repeat>        Execute specified command N times.
  -i <interval>      When -r is used, waits <interval> seconds per command.
  -n <db>            Database number.
  -x                 Read last argument from STDIN.
  -d <delimiter>     Multi-bulk delimiter in for raw output (default: \\n).
  -c                 Enable cluster mode (follow -ASK and -MOVED redirections).
  --raw              Use raw formatting for replies.
  --no-raw           Force formatted output even when STDOUT is not a tty.
  --csv              Output in CSV format.
  --json             Output in JSON format.
  --quoted-json      Same as --json, but produce ASCII-safe quoted strings.
  --stat             Print rolling stats about server: mem, clients, ...
  --latency          Enter a special mode continuously sampling latency.
  --bigkeys          Sample Redis keys looking for keys with many elements.
  --memkeys          Sample Redis keys looking for keys consuming a lot of memory.
  --hotkeys          Sample Redis keys looking for hot keys.
  --scan             List all keys using the SCAN command.
  --pattern <pat>    Keys pattern when using the --scan, --bigkeys or --hotkeys
                     options (default: *).
  --eval <file>      Send an EVAL command using the Lua script at <file>.
  --pipe             Transfer raw Redis protocol from stdin to server.
  --verbose          Verbose mode.
  --help             Output this help and exit.
  --version          Output version and exit.

Examples:
  redis-cli get mykey
  redis-cli -r 100 lpush mylist x
  redis-cli --scan --pattern '*:12345*'

When no command is given, redis-cli starts in interactive mode.
Type "help" in interactive mode for information on available commands.`)
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n👋 Goodbye!')
  process.exit(0)
})

process.on('SIGTERM', async () => {
  process.exit(0)
})

// Main execution
if (require.main === module) {
  const cli = new RedisCLI()
  cli.initialize().catch(error => {
    console.error(`❌ CLI Error: ${error.message}`)
    process.exit(1)
  })
}

module.exports = RedisCLI
