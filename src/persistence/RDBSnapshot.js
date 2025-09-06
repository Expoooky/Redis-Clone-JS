/**
 * RDB Snapshot Implementation
 * Provides Redis-compatible binary snapshot functionality for point-in-time data persistence
 */

const fs = require('fs').promises
const path = require('path')
const crypto = require('crypto')
const logger = require('../utils/Logger')

/**
 * RDB file format constants
 */
const RDB_VERSION = 9
const RDB_MAGIC = 'REDIS'
const RDB_TYPE_STRING = 0
const RDB_TYPE_LIST = 1
const RDB_TYPE_SET = 2
const RDB_TYPE_ZSET = 3
const RDB_TYPE_HASH = 4
const RDB_TYPE_ZSET_2 = 5
const RDB_TYPE_MODULE = 6
const RDB_TYPE_MODULE_2 = 7
const RDB_TYPE_HASH_ZIPMAP = 9
const RDB_TYPE_LIST_ZIPLIST = 10
const RDB_TYPE_SET_INTSET = 11
const RDB_TYPE_ZSET_ZIPLIST = 12
const RDB_TYPE_HASH_ZIPLIST = 13
const RDB_TYPE_LIST_QUICKLIST = 14
const RDB_TYPE_STREAM_LISTPACKS = 15

const RDB_OPCODE_AUX = 250
const RDB_OPCODE_RESIZEDB = 251
const RDB_OPCODE_EXPIRETIME_MS = 252
const RDB_OPCODE_EXPIRETIME = 253
const RDB_OPCODE_SELECTDB = 254
const RDB_OPCODE_EOF = 255

class RDBEncoder {
  constructor() {
    this.buffer = Buffer.alloc(0)
  }

  writeByte(value) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from([value])])
  }

  writeBytes(bytes) {
    this.buffer = Buffer.concat([this.buffer, bytes])
  }

  writeString(str) {
    const strBuffer = Buffer.from(str, 'utf8')
    this.writeLength(strBuffer.length)
    this.writeBytes(strBuffer)
  }

  writeLength(length) {
    if (length < 64) {
      // 6-bit length
      this.writeByte(length)
    } else if (length < 16384) {
      // 14-bit length
      this.writeByte(0x40 | (length >> 8))
      this.writeByte(length & 0xFF)
    } else {
      // 32-bit length
      this.writeByte(0x80)
      this.writeByte((length >> 24) & 0xFF)
      this.writeByte((length >> 16) & 0xFF)
      this.writeByte((length >> 8) & 0xFF)
      this.writeByte(length & 0xFF)
    }
  }

  writeInteger(value) {
    if (value >= -128 && value <= 127) {
      this.writeByte(0xC0)
      this.writeByte(value & 0xFF)
    } else if (value >= -32768 && value <= 32767) {
      this.writeByte(0xC1)
      this.writeByte(value & 0xFF)
      this.writeByte((value >> 8) & 0xFF)
    } else {
      this.writeByte(0xC2)
      this.writeByte(value & 0xFF)
      this.writeByte((value >> 8) & 0xFF)
      this.writeByte((value >> 16) & 0xFF)
      this.writeByte((value >> 24) & 0xFF)
    }
  }

  writeFloat(value) {
    this.writeString(value.toString())
  }

  writeTimestamp(timestamp) {
    this.writeByte((timestamp >> 24) & 0xFF)
    this.writeByte((timestamp >> 16) & 0xFF)
    this.writeByte((timestamp >> 8) & 0xFF)
    this.writeByte(timestamp & 0xFF)
  }

  writeTimestampMs(timestamp) {
    const buffer = Buffer.allocUnsafe(8)
    buffer.writeBigUInt64LE(BigInt(timestamp))
    this.writeBytes(buffer)
  }

  getBuffer() {
    return this.buffer
  }
}

class RDBDecoder {
  constructor(buffer) {
    this.buffer = buffer
    this.offset = 0
  }

  readByte() {
    if (this.offset >= this.buffer.length) {
      throw new Error('Unexpected end of RDB file')
    }
    return this.buffer[this.offset++]
  }

  readBytes(length) {
    if (this.offset + length > this.buffer.length) {
      throw new Error('Unexpected end of RDB file')
    }
    const result = this.buffer.slice(this.offset, this.offset + length)
    this.offset += length
    return result
  }

  readString() {
    const length = this.readLength()
    if (length === null) return null
    return this.readBytes(length).toString('utf8')
  }

  readLength() {
    const firstByte = this.readByte()
    const type = (firstByte & 0xC0) >> 6

    switch (type) {
      case 0: // 6-bit length
        return firstByte & 0x3F
      case 1: // 14-bit length
        const secondByte = this.readByte()
        return ((firstByte & 0x3F) << 8) | secondByte
      case 2: // 32-bit length
        return (this.readByte() << 24) | (this.readByte() << 16) | (this.readByte() << 8) | this.readByte()
      case 3: // Special format
        const format = firstByte & 0x3F
        if (format === 0) return this.readByte() // 8-bit integer
        if (format === 1) return (this.readByte() << 8) | this.readByte() // 16-bit integer
        if (format === 2) return (this.readByte() << 24) | (this.readByte() << 16) | (this.readByte() << 8) | this.readByte() // 32-bit integer
        throw new Error(`Unknown special format: ${format}`)
    }
  }

  readTimestamp() {
    return (this.readByte() << 24) | (this.readByte() << 16) | (this.readByte() << 8) | this.readByte()
  }

  readTimestampMs() {
    const buffer = this.readBytes(8)
    return Number(buffer.readBigUInt64LE())
  }

  hasMoreData() {
    return this.offset < this.buffer.length
  }
}

class RDBSnapshot {
  constructor(dataStore, options = {}) {
    this.dataStore = dataStore
    this.options = {
      filename: options.filename || 'dump.rdb',
      directory: options.directory || './data',
      compression: options.compression || false,
      checksum: options.checksum !== false, // Default true
      ...options
    }
    this.lastSaveTime = 0
    this.dirty = false
    this.savingInProgress = false
  }

  /**
   * Create an RDB snapshot
   */
  async save(background = false) {
    if (this.savingInProgress) {
      throw new Error('Background save already in progress')
    }

    const startTime = Date.now()
    this.savingInProgress = true

    try {
      logger.info('Starting RDB snapshot', {
        component: 'RDBSnapshot',
        background,
        filename: this.options.filename
      })

      const encoder = new RDBEncoder()
      
      // Write RDB header
      this.writeHeader(encoder)
      
      // Write auxiliary fields
      this.writeAuxiliaryFields(encoder)
      
      // Serialize all databases
      await this.serializeDatabases(encoder)
      
      // Write EOF and checksum
      this.writeFooter(encoder)
      
      // Write to file
      const buffer = encoder.getBuffer()
      await this.writeToFile(buffer)
      
      this.lastSaveTime = Math.floor(Date.now() / 1000)
      this.dirty = false
      
      const duration = Date.now() - startTime
      logger.info('RDB snapshot completed', {
        component: 'RDBSnapshot',
        duration: `${duration}ms`,
        size: buffer.length,
        keys: this.getTotalKeys()
      })

      return {
        success: true,
        duration,
        size: buffer.length,
        keys: this.getTotalKeys(),
        lastSave: this.lastSaveTime
      }

    } catch (error) {
      logger.error('RDB snapshot failed', error, {
        component: 'RDBSnapshot'
      })
      throw error
    } finally {
      this.savingInProgress = false
    }
  }

  /**
   * Load an RDB snapshot
   */
  async load() {
    try {
      const filePath = path.join(this.options.directory, this.options.filename)
      const buffer = await fs.readFile(filePath)
      
      logger.info('Loading RDB snapshot', {
        component: 'RDBSnapshot',
        filename: this.options.filename,
        size: buffer.length
      })

      const decoder = new RDBDecoder(buffer)
      
      // Read and verify header
      this.readHeader(decoder)
      
      // Read databases
      await this.deserializeDatabases(decoder)
      
      logger.info('RDB snapshot loaded successfully', {
        component: 'RDBSnapshot',
        keys: this.getTotalKeys()
      })

      return {
        success: true,
        size: buffer.length,
        keys: this.getTotalKeys()
      }

    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info('No RDB file found, starting with empty database', {
          component: 'RDBSnapshot'
        })
        return { success: true, keys: 0 }
      }
      
      logger.error('Failed to load RDB snapshot', error, {
        component: 'RDBSnapshot'
      })
      throw error
    }
  }

  writeHeader(encoder) {
    // Magic string
    encoder.writeBytes(Buffer.from(RDB_MAGIC))
    
    // Version
    encoder.writeBytes(Buffer.from(RDB_VERSION.toString().padStart(4, '0')))
  }

  writeAuxiliaryFields(encoder) {
    // Redis version
    encoder.writeByte(RDB_OPCODE_AUX)
    encoder.writeString('redis-ver')
    encoder.writeString('7.0.0')
    
    // RDB version
    encoder.writeByte(RDB_OPCODE_AUX)
    encoder.writeString('rdb-ver')
    encoder.writeString(RDB_VERSION.toString())
    
    // Creation time
    encoder.writeByte(RDB_OPCODE_AUX)
    encoder.writeString('ctime')
    encoder.writeString(Math.floor(Date.now() / 1000).toString())
    
    // Used memory
    encoder.writeByte(RDB_OPCODE_AUX)
    encoder.writeString('used-mem')
    encoder.writeString(process.memoryUsage().heapUsed.toString())
  }

  async serializeDatabases(encoder) {
    const stats = this.dataStore.getStats()
    
    for (let dbIndex = 0; dbIndex < stats.maxDatabases; dbIndex++) {
      const db = this.dataStore.databases.get(dbIndex)
      if (!db || !db.data || db.data.size === 0) continue
      
      // Select database
      encoder.writeByte(RDB_OPCODE_SELECTDB)
      encoder.writeLength(dbIndex)
      
      // Database size info
      const keyCount = db.data.size
      const expiresCount = db.expires ? db.expires.size : 0
      encoder.writeByte(RDB_OPCODE_RESIZEDB)
      encoder.writeLength(keyCount)
      encoder.writeLength(expiresCount)
      
      // Serialize all keys in this database
      for (const [key, value] of db.data.entries()) {
        await this.serializeKey(encoder, key, value, dbIndex)
      }
    }
  }

  async serializeKey(encoder, key, value, dbIndex) {
    // Check for expiration
    const db = this.dataStore.databases.get(dbIndex)
    const expireTime = db.expires?.get(key)
    if (expireTime) {
      if (expireTime > 1000000000000) { // Milliseconds
        encoder.writeByte(RDB_OPCODE_EXPIRETIME_MS)
        encoder.writeTimestampMs(expireTime)
      } else { // Seconds
        encoder.writeByte(RDB_OPCODE_EXPIRETIME)
        encoder.writeTimestamp(expireTime)
      }
    }
    
    // Determine value type and serialize
    const valueType = this.getValueType(value)
    encoder.writeByte(valueType)
    encoder.writeString(key)
    
    switch (valueType) {
      case RDB_TYPE_STRING:
        this.serializeString(encoder, value)
        break
      case RDB_TYPE_LIST:
        this.serializeList(encoder, value)
        break
      case RDB_TYPE_SET:
        this.serializeSet(encoder, value)
        break
      case RDB_TYPE_ZSET:
        this.serializeSortedSet(encoder, value)
        break
      case RDB_TYPE_HASH:
        this.serializeHash(encoder, value)
        break
      default:
        // For complex objects, serialize as JSON string
        this.serializeString(encoder, JSON.stringify(value))
    }
  }

  getValueType(value) {
    if (typeof value === 'string' || typeof value === 'number') {
      return RDB_TYPE_STRING
    }
    if (Array.isArray(value)) {
      return RDB_TYPE_LIST
    }
    if (value instanceof Set) {
      return RDB_TYPE_SET
    }
    if (value instanceof Map) {
      return RDB_TYPE_HASH
    }
    if (value && typeof value === 'object') {
      if (value.constructor && value.constructor.name === 'SortedSet') {
        return RDB_TYPE_ZSET
      }
      if (value.type === 'hash') {
        return RDB_TYPE_HASH
      }
    }
    return RDB_TYPE_STRING // Default to string
  }

  serializeString(encoder, value) {
    encoder.writeString(value.toString())
  }

  serializeList(encoder, list) {
    encoder.writeLength(list.length)
    for (const item of list) {
      encoder.writeString(item.toString())
    }
  }

  serializeSet(encoder, set) {
    encoder.writeLength(set.size)
    for (const item of set) {
      encoder.writeString(item.toString())
    }
  }

  serializeSortedSet(encoder, zset) {
    const elements = zset.getAll ? zset.getAll() : []
    encoder.writeLength(elements.length)
    for (const [element, score] of elements) {
      encoder.writeString(element.toString())
      encoder.writeFloat(score)
    }
  }

  serializeHash(encoder, hash) {
    if (hash instanceof Map) {
      encoder.writeLength(hash.size)
      for (const [field, value] of hash) {
        encoder.writeString(field.toString())
        encoder.writeString(value.toString())
      }
    } else if (typeof hash === 'object') {
      const entries = Object.entries(hash)
      encoder.writeLength(entries.length)
      for (const [field, value] of entries) {
        encoder.writeString(field.toString())
        encoder.writeString(value.toString())
      }
    }
  }

  writeFooter(encoder) {
    encoder.writeByte(RDB_OPCODE_EOF)
    
    if (this.options.checksum) {
      // Calculate CRC64 checksum
      const checksum = this.calculateChecksum(encoder.getBuffer())
      encoder.writeBytes(checksum)
    }
  }

  calculateChecksum(buffer) {
    // Simplified checksum using crypto hash
    return crypto.createHash('sha256').update(buffer).digest().slice(0, 8)
  }

  readHeader(decoder) {
    // Verify magic
    const magic = decoder.readBytes(5).toString()
    if (magic !== RDB_MAGIC) {
      throw new Error(`Invalid RDB magic: ${magic}`)
    }
    
    // Read version
    const version = parseInt(decoder.readBytes(4).toString())
    if (version > RDB_VERSION) {
      throw new Error(`Unsupported RDB version: ${version}`)
    }
  }

  async deserializeDatabases(decoder) {
    let currentDb = 0
    
    while (decoder.hasMoreData()) {
      const opcode = decoder.readByte()
      
      switch (opcode) {
        case RDB_OPCODE_AUX:
          // Skip auxiliary fields
          decoder.readString() // key
          decoder.readString() // value
          break
          
        case RDB_OPCODE_SELECTDB:
          currentDb = decoder.readLength()
          this.dataStore.select(currentDb)
          break
          
        case RDB_OPCODE_RESIZEDB:
          decoder.readLength() // db size
          decoder.readLength() // expires size
          break
          
        case RDB_OPCODE_EXPIRETIME:
          const expireTime = decoder.readTimestamp()
          await this.deserializeKeyWithExpiry(decoder, currentDb, expireTime * 1000)
          break
          
        case RDB_OPCODE_EXPIRETIME_MS:
          const expireTimeMs = decoder.readTimestampMs()
          await this.deserializeKeyWithExpiry(decoder, currentDb, expireTimeMs)
          break
          
        case RDB_OPCODE_EOF:
          if (this.options.checksum) {
            // Verify checksum
            decoder.readBytes(8) // Skip checksum verification for now
          }
          return
          
        default:
          // Regular key-value pair
          decoder.offset-- // Step back to read type again
          await this.deserializeKey(decoder, currentDb)
      }
    }
  }

  async deserializeKeyWithExpiry(decoder, dbIndex, expireTime) {
    await this.deserializeKey(decoder, dbIndex, expireTime)
  }

  async deserializeKey(decoder, dbIndex, expireTime = null) {
    const valueType = decoder.readByte()
    const key = decoder.readString()
    
    let value
    switch (valueType) {
      case RDB_TYPE_STRING:
        value = decoder.readString()
        break
      case RDB_TYPE_LIST:
        value = this.deserializeList(decoder)
        break
      case RDB_TYPE_SET:
        value = this.deserializeSet(decoder)
        break
      case RDB_TYPE_ZSET:
        value = this.deserializeSortedSet(decoder)
        break
      case RDB_TYPE_HASH:
        value = this.deserializeHash(decoder)
        break
      default:
        // Unknown type, try to read as string
        value = decoder.readString()
    }
    
    // Store the key-value pair
    const oldDb = this.dataStore.currentDb
    this.dataStore.select(dbIndex)
    this.dataStore.set(key, value)
    
    // Set expiration if provided
    if (expireTime && expireTime > Date.now()) {
      this.dataStore.setExpiration(key, expireTime)
    }
    
    this.dataStore.select(oldDb)
  }

  deserializeList(decoder) {
    const length = decoder.readLength()
    const list = []
    for (let i = 0; i < length; i++) {
      list.push(decoder.readString())
    }
    return list
  }

  deserializeSet(decoder) {
    const length = decoder.readLength()
    const set = new Set()
    for (let i = 0; i < length; i++) {
      set.add(decoder.readString())
    }
    return set
  }

  deserializeSortedSet(decoder) {
    const length = decoder.readLength()
    const elements = []
    for (let i = 0; i < length; i++) {
      const element = decoder.readString()
      const score = parseFloat(decoder.readString())
      elements.push([element, score])
    }
    return { type: 'zset', elements }
  }

  deserializeHash(decoder) {
    const length = decoder.readLength()
    const hash = new Map()
    for (let i = 0; i < length; i++) {
      const field = decoder.readString()
      const value = decoder.readString()
      hash.set(field, value)
    }
    return hash
  }

  async writeToFile(buffer) {
    // Ensure directory exists
    await fs.mkdir(this.options.directory, { recursive: true })
    
    const filePath = path.join(this.options.directory, this.options.filename)
    const tempPath = `${filePath}.tmp`
    
    // Write to temporary file first
    await fs.writeFile(tempPath, buffer)
    
    // Atomic rename
    await fs.rename(tempPath, filePath)
  }

  getTotalKeys() {
    let total = 0
    for (let i = 0; i < this.dataStore.maxDatabases; i++) {
      const db = this.dataStore.databases.get(i)
      if (db && db.data) {
        total += db.data.size
      }
    }
    return total
  }

  markDirty() {
    this.dirty = true
  }

  isDirty() {
    return this.dirty
  }

  getLastSaveTime() {
    return this.lastSaveTime
  }

  isSavingInProgress() {
    return this.savingInProgress
  }

  getStats() {
    return {
      lastSave: this.lastSaveTime,
      dirty: this.dirty,
      savingInProgress: this.savingInProgress,
      filename: this.options.filename,
      directory: this.options.directory
    }
  }
}

module.exports = { RDBSnapshot, RDBEncoder, RDBDecoder }
