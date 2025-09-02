/**
 * RESP (Redis Serialization Protocol) Parser
 * Implements the Redis protocol for client-server communication
 * Supports RESP2 format with all data types
 */

const logger = require('../utils/Logger')

class RESPParser {
  constructor() {
    this.buffer = Buffer.alloc(0)
    this.logger = logger.child({ component: 'RESPParser' })
  }

  /**
   * Parse incoming data and extract complete RESP messages
   * @param {Buffer} data - Incoming data buffer
   * @returns {Array} Array of parsed commands
   */
  parse(data) {
    // Append new data to existing buffer
    this.buffer = Buffer.concat([this.buffer, data])
    
    const commands = []
    let offset = 0

    while (offset < this.buffer.length) {
      const result = this.parseMessage(this.buffer, offset)
      
      if (!result.complete) {
        // Incomplete message, wait for more data
        break
      }

      commands.push(result.value)
      offset = result.offset
    }

    // Remove processed data from buffer
    if (offset > 0) {
      this.buffer = this.buffer.slice(offset)
    }

    return commands
  }

  /**
   * Parse a single RESP message from buffer
   * @param {Buffer} buffer - Data buffer
   * @param {number} offset - Starting offset
   * @returns {Object} Parse result with value, offset, and complete flag
   */
  parseMessage(buffer, offset) {
    if (offset >= buffer.length) {
      return { complete: false }
    }

    const type = String.fromCharCode(buffer[offset])
    
    switch (type) {
      case '+': // Simple String
        return this.parseSimpleString(buffer, offset)
      case '-': // Error
        return this.parseError(buffer, offset)
      case ':': // Integer
        return this.parseInteger(buffer, offset)
      case '$': // Bulk String
        return this.parseBulkString(buffer, offset)
      case '*': // Array
        return this.parseArray(buffer, offset)
      default:
        // Try to parse as inline command (for telnet compatibility)
        return this.parseInlineCommand(buffer, offset)
    }
  }

  /**
   * Parse Simple String (+OK\r\n)
   * @param {Buffer} buffer - Data buffer
   * @param {number} offset - Starting offset
   * @returns {Object} Parse result
   */
  parseSimpleString(buffer, offset) {
    const crlfIndex = buffer.indexOf('\r\n', offset + 1)
    
    if (crlfIndex === -1) {
      return { complete: false }
    }

    const value = buffer.toString('utf8', offset + 1, crlfIndex)
    
    return {
      complete: true,
      value,
      offset: crlfIndex + 2
    }
  }

  /**
   * Parse Error (-ERR message\r\n)
   * @param {Buffer} buffer - Data buffer
   * @param {number} offset - Starting offset
   * @returns {Object} Parse result
   */
  parseError(buffer, offset) {
    const crlfIndex = buffer.indexOf('\r\n', offset + 1)
    
    if (crlfIndex === -1) {
      return { complete: false }
    }

    const value = new Error(buffer.toString('utf8', offset + 1, crlfIndex))
    value.isRESPError = true
    
    return {
      complete: true,
      value,
      offset: crlfIndex + 2
    }
  }

  /**
   * Parse Integer (:123\r\n)
   * @param {Buffer} buffer - Data buffer
   * @param {number} offset - Starting offset
   * @returns {Object} Parse result
   */
  parseInteger(buffer, offset) {
    const crlfIndex = buffer.indexOf('\r\n', offset + 1)
    
    if (crlfIndex === -1) {
      return { complete: false }
    }

    const integerStr = buffer.toString('utf8', offset + 1, crlfIndex)
    const value = parseInt(integerStr, 10)
    
    if (isNaN(value)) {
      throw new Error(`Invalid integer: ${integerStr}`)
    }
    
    return {
      complete: true,
      value,
      offset: crlfIndex + 2
    }
  }

  /**
   * Parse Bulk String ($6\r\nfoobar\r\n or $-1\r\n for null)
   * @param {Buffer} buffer - Data buffer
   * @param {number} offset - Starting offset
   * @returns {Object} Parse result
   */
  parseBulkString(buffer, offset) {
    // Find length line
    const lengthCrlfIndex = buffer.indexOf('\r\n', offset + 1)
    
    if (lengthCrlfIndex === -1) {
      return { complete: false }
    }

    const lengthStr = buffer.toString('utf8', offset + 1, lengthCrlfIndex)
    const length = parseInt(lengthStr, 10)
    
    if (isNaN(length)) {
      throw new Error(`Invalid bulk string length: ${lengthStr}`)
    }

    // Handle null bulk string
    if (length === -1) {
      return {
        complete: true,
        value: null,
        offset: lengthCrlfIndex + 2
      }
    }

    // Check if we have enough data for the string + CRLF
    const dataStart = lengthCrlfIndex + 2
    const dataEnd = dataStart + length
    const stringCrlfEnd = dataEnd + 2

    if (stringCrlfEnd > buffer.length) {
      return { complete: false }
    }

    // Verify CRLF after string data
    if (buffer[dataEnd] !== 0x0D || buffer[dataEnd + 1] !== 0x0A) {
      throw new Error('Invalid bulk string format: missing CRLF')
    }

    const value = buffer.toString('utf8', dataStart, dataEnd)
    
    return {
      complete: true,
      value,
      offset: stringCrlfEnd
    }
  }

  /**
   * Parse Array (*2\r\n$3\r\nGET\r\n$3\r\nkey\r\n)
   * @param {Buffer} buffer - Data buffer
   * @param {number} offset - Starting offset
   * @returns {Object} Parse result
   */
  parseArray(buffer, offset) {
    // Find array length
    const lengthCrlfIndex = buffer.indexOf('\r\n', offset + 1)
    
    if (lengthCrlfIndex === -1) {
      return { complete: false }
    }

    const lengthStr = buffer.toString('utf8', offset + 1, lengthCrlfIndex)
    const length = parseInt(lengthStr, 10)
    
    if (isNaN(length)) {
      throw new Error(`Invalid array length: ${lengthStr}`)
    }

    // Handle null array
    if (length === -1) {
      return {
        complete: true,
        value: null,
        offset: lengthCrlfIndex + 2
      }
    }

    // Handle empty array
    if (length === 0) {
      return {
        complete: true,
        value: [],
        offset: lengthCrlfIndex + 2
      }
    }

    // Parse array elements
    const elements = []
    let currentOffset = lengthCrlfIndex + 2

    for (let i = 0; i < length; i++) {
      const elementResult = this.parseMessage(buffer, currentOffset)
      
      if (!elementResult.complete) {
        return { complete: false }
      }

      elements.push(elementResult.value)
      currentOffset = elementResult.offset
    }

    return {
      complete: true,
      value: elements,
      offset: currentOffset
    }
  }

  /**
   * Parse inline command (for telnet compatibility)
   * @param {Buffer} buffer - Data buffer
   * @param {number} offset - Starting offset
   * @returns {Object} Parse result
   */
  parseInlineCommand(buffer, offset) {
    const crlfIndex = buffer.indexOf('\r\n', offset)
    
    if (crlfIndex === -1) {
      // Also check for just \n (some telnet clients)
      const lfIndex = buffer.indexOf('\n', offset)
      if (lfIndex === -1) {
        return { complete: false }
      }
      
      const command = buffer.toString('utf8', offset, lfIndex).trim()
      const parts = this.parseInlineCommandParts(command)
      
      return {
        complete: true,
        value: parts,
        offset: lfIndex + 1
      }
    }

    const command = buffer.toString('utf8', offset, crlfIndex).trim()
    const parts = this.parseInlineCommandParts(command)
    
    return {
      complete: true,
      value: parts,
      offset: crlfIndex + 2
    }
  }

  /**
   * Parse inline command parts, handling quoted strings
   * @param {string} command - Command string
   * @returns {Array} Array of command parts
   */
  parseInlineCommandParts(command) {
    if (!command) {
      return []
    }

    const parts = []
    let current = ''
    let inQuotes = false
    let quoteChar = null
    let escaped = false

    for (let i = 0; i < command.length; i++) {
      const char = command[i]

      if (escaped) {
        current += char
        escaped = false
        continue
      }

      if (char === '\\' && inQuotes) {
        escaped = true
        continue
      }

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true
        quoteChar = char
        continue
      }

      if (char === quoteChar && inQuotes) {
        inQuotes = false
        quoteChar = null
        continue
      }

      if (char === ' ' && !inQuotes) {
        if (current) {
          parts.push(current)
          current = ''
        }
        continue
      }

      current += char
    }

    if (current) {
      parts.push(current)
    }

    return parts
  }

  /**
   * Serialize a value to RESP format
   * @param {*} value - Value to serialize
   * @returns {Buffer} RESP formatted buffer
   */
  serialize(value) {
    if (value === null || value === undefined) {
      return Buffer.from('$-1\r\n')
    }

    if (typeof value === 'string') {
      return this.serializeBulkString(value)
    }

    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        return Buffer.from(`:${value}\r\n`)
      } else {
        // Serialize float as bulk string
        return this.serializeBulkString(value.toString())
      }
    }

    if (typeof value === 'boolean') {
      return Buffer.from(`:${value ? 1 : 0}\r\n`)
    }

    if (value instanceof Error || (value && value.isRESPError)) {
      return Buffer.from(`-${value.message}\r\n`)
    }

    if (Array.isArray(value)) {
      return this.serializeArray(value)
    }

    // For other objects, serialize as bulk string
    return this.serializeBulkString(JSON.stringify(value))
  }

  /**
   * Serialize bulk string
   * @param {string} str - String to serialize
   * @returns {Buffer} RESP formatted buffer
   */
  serializeBulkString(str) {
    const strBuffer = Buffer.from(str, 'utf8')
    const lengthBuffer = Buffer.from(`$${strBuffer.length}\r\n`)
    const crlfBuffer = Buffer.from('\r\n')
    
    return Buffer.concat([lengthBuffer, strBuffer, crlfBuffer])
  }

  /**
   * Serialize array
   * @param {Array} arr - Array to serialize
   * @returns {Buffer} RESP formatted buffer
   */
  serializeArray(arr) {
    const buffers = [Buffer.from(`*${arr.length}\r\n`)]
    
    for (const element of arr) {
      buffers.push(this.serialize(element))
    }
    
    return Buffer.concat(buffers)
  }

  /**
   * Serialize simple string (for responses like +OK)
   * @param {string} str - String to serialize
   * @returns {Buffer} RESP formatted buffer
   */
  serializeSimpleString(str) {
    return Buffer.from(`+${str}\r\n`)
  }

  /**
   * Serialize error
   * @param {string} errorMessage - Error message
   * @returns {Buffer} RESP formatted buffer
   */
  serializeError(errorMessage) {
    return Buffer.from(`-${errorMessage}\r\n`)
  }

  /**
   * Clear the internal buffer
   */
  clear() {
    this.buffer = Buffer.alloc(0)
  }

  /**
   * Get buffer status
   * @returns {Object} Buffer information
   */
  getBufferStatus() {
    return {
      size: this.buffer.length,
      hasData: this.buffer.length > 0
    }
  }
}

module.exports = RESPParser
