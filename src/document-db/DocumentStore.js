/**
 * Document Storage Engine
 * Implements flexible JSON document storage with secondary indexing
 * Provides MongoDB-like collection operations and document management
 */

const logger = require('../utils/Logger')

class Document {
  constructor(data, options = {}) {
    this._id = options._id || this.generateId()
    this._version = options._version || 1
    this._created = options._created || new Date().toISOString()
    this._updated = options._updated || new Date().toISOString()
    this._metadata = options._metadata || {}
    
    // Store the actual document data
    this.data = this.validateAndClone(data)
  }

  generateId() {
    // Generate a MongoDB-like ObjectId string
    const timestamp = Math.floor(Date.now() / 1000).toString(16)
    const random = Math.random().toString(16).substr(2, 16)
    return timestamp + random.padEnd(16, '0')
  }

  validateAndClone(data) {
    if (data === null || data === undefined) {
      throw new Error('Document data cannot be null or undefined')
    }

    if (typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Document data must be an object')
    }

    // Deep clone to prevent external mutations
    return JSON.parse(JSON.stringify(data))
  }

  update(updateData, options = {}) {
    if (typeof updateData !== 'object' || Array.isArray(updateData)) {
      throw new Error('Update data must be an object')
    }

    // Create new version
    const newVersion = this._version + 1
    const updatedData = this.applyUpdate(this.data, updateData, options)

    return new Document(updatedData, {
      _id: this._id,
      _version: newVersion,
      _created: this._created,
      _updated: new Date().toISOString(),
      _metadata: { ...this._metadata, ...options.metadata }
    })
  }

  applyUpdate(target, update, options = {}) {
    const result = JSON.parse(JSON.stringify(target))

    for (const [key, value] of Object.entries(update)) {
      if (key.startsWith('$')) {
        // Handle update operators
        this.applyUpdateOperator(result, key, value, options)
      } else {
        // Simple field update
        this.setNestedField(result, key, value)
      }
    }

    return result
  }

  applyUpdateOperator(target, operator, operand, options) {
    switch (operator) {
      case '$set':
        for (const [field, value] of Object.entries(operand)) {
          this.setNestedField(target, field, value)
        }
        break

      case '$unset':
        for (const field of Object.keys(operand)) {
          this.unsetNestedField(target, field)
        }
        break

      case '$inc':
        for (const [field, increment] of Object.entries(operand)) {
          const current = this.getNestedField(target, field) || 0
          if (typeof current !== 'number' || typeof increment !== 'number') {
            throw new Error('$inc requires numeric values')
          }
          this.setNestedField(target, field, current + increment)
        }
        break

      case '$push':
        for (const [field, value] of Object.entries(operand)) {
          const current = this.getNestedField(target, field)
          if (current === undefined) {
            this.setNestedField(target, field, [value])
          } else if (Array.isArray(current)) {
            current.push(value)
          } else {
            throw new Error('$push can only be applied to arrays')
          }
        }
        break

      case '$pull':
        for (const [field, condition] of Object.entries(operand)) {
          const current = this.getNestedField(target, field)
          if (Array.isArray(current)) {
            const filtered = current.filter(item => !this.matchesCondition(item, condition))
            this.setNestedField(target, field, filtered)
          }
        }
        break

      case '$addToSet':
        for (const [field, value] of Object.entries(operand)) {
          const current = this.getNestedField(target, field)
          if (current === undefined) {
            this.setNestedField(target, field, [value])
          } else if (Array.isArray(current)) {
            if (!current.some(item => JSON.stringify(item) === JSON.stringify(value))) {
              current.push(value)
            }
          } else {
            throw new Error('$addToSet can only be applied to arrays')
          }
        }
        break

      default:
        throw new Error(`Unknown update operator: ${operator}`)
    }
  }

  setNestedField(target, fieldPath, value) {
    const parts = fieldPath.split('.')
    let current = target

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!(part in current) || typeof current[part] !== 'object' || Array.isArray(current[part])) {
        current[part] = {}
      }
      current = current[part]
    }

    current[parts[parts.length - 1]] = value
  }

  getNestedField(target, fieldPath) {
    const parts = fieldPath.split('.')
    let current = target

    for (const part of parts) {
      if (current === null || current === undefined || !(part in current)) {
        return undefined
      }
      current = current[part]
    }

    return current
  }

  unsetNestedField(target, fieldPath) {
    const parts = fieldPath.split('.')
    let current = target

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!(part in current) || typeof current[part] !== 'object') {
        return // Field doesn't exist
      }
      current = current[part]
    }

    delete current[parts[parts.length - 1]]
  }

  matchesCondition(item, condition) {
    if (typeof condition !== 'object') {
      return JSON.stringify(item) === JSON.stringify(condition)
    }

    // Simple equality match for objects
    return Object.entries(condition).every(([key, value]) => 
      item && typeof item === 'object' && item[key] === value
    )
  }

  toJSON() {
    return {
      _id: this._id,
      _version: this._version,
      _created: this._created,
      _updated: this._updated,
      _metadata: this._metadata,
      ...this.data
    }
  }

  getSize() {
    return JSON.stringify(this.toJSON()).length * 2 // Approximate UTF-16 size
  }
}

class Collection {
  constructor(name, options = {}) {
    this.name = name
    this.documents = new Map() // _id -> Document
    this.indexes = new Map() // field -> Map(value -> Set(_id))
    this.options = {
      maxDocuments: options.maxDocuments || 1000000,
      maxSize: options.maxSize || 100 * 1024 * 1024, // 100MB
      schemaValidation: options.schemaValidation || false,
      schema: options.schema || null,
      ...options
    }
    this.stats = {
      documentCount: 0,
      totalSize: 0,
      indexCount: 0,
      createdAt: new Date().toISOString()
    }

    // Initialize IndexManager
    const { IndexManager } = require('./IndexManager')
    this.indexManager = new IndexManager(this)

    logger.debug('Collection created', { name, options: this.options })
  }

  insert(data, options = {}) {
    if (this.stats.documentCount >= this.options.maxDocuments) {
      return { success: false, error: 'Collection document limit exceeded' }
    }

    try {
      // Validate against schema if enabled
      if (this.options.schemaValidation && this.options.schema) {
        this.validateSchema(data)
      }

      const document = new Document(data, options)
      
      // Check size limit
      const documentSize = document.getSize()
      if (this.stats.totalSize + documentSize > this.options.maxSize) {
        return { success: false, error: 'Collection size limit exceeded' }
      }

      // Check for duplicate _id
      if (this.documents.has(document._id)) {
        return { success: false, error: 'Document with this _id already exists' }
      }

      // Store document
      this.documents.set(document._id, document)
      this.stats.documentCount++
      this.stats.totalSize += documentSize

      // Update indexes
      this.updateIndexesForDocument(document, 'insert')
      this.indexManager.updateIndexes(document, 'insert')

      logger.debug('Document inserted', { 
        collection: this.name, 
        documentId: document._id,
        size: documentSize 
      })

      return { success: true, value: document._id }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  findById(id) {
    const document = this.documents.get(id)
    if (!document) {
      return { success: true, value: null }
    }

    return { success: true, value: document.toJSON() }
  }

  find(query = {}, options = {}) {
    try {
      const {
        limit = 100,
        skip = 0,
        sort = null,
        projection = null
      } = options

      let matchingDocs = []

      if (Object.keys(query).length === 0) {
        // Return all documents
        matchingDocs = Array.from(this.documents.values())
      } else {
        // Filter documents based on query
        matchingDocs = this.executeQuery(query)
      }

      // Apply sorting
      if (sort) {
        matchingDocs = this.sortDocuments(matchingDocs, sort)
      }

      // Apply pagination
      const paginatedDocs = matchingDocs.slice(skip, skip + limit)

      // Apply projection
      const results = paginatedDocs.map(doc => {
        const jsonDoc = doc.toJSON()
        return projection ? this.applyProjection(jsonDoc, projection) : jsonDoc
      })

      return {
        success: true,
        value: {
          documents: results,
          totalCount: matchingDocs.length,
          hasMore: skip + limit < matchingDocs.length
        }
      }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  findOne(query = {}, options = {}) {
    const result = this.find(query, { ...options, limit: 1 })
    if (!result.success) {
      return result
    }

    const documents = result.value.documents
    return {
      success: true,
      value: documents.length > 0 ? documents[0] : null
    }
  }

  update(query, updateData, options = {}) {
    try {
      const {
        multi = false,
        upsert = false
      } = options

      const matchingDocs = this.executeQuery(query)
      
      if (matchingDocs.length === 0 && upsert) {
        // Insert new document
        const insertData = { ...query, ...updateData }
        return this.insert(insertData)
      }

      if (matchingDocs.length === 0) {
        return { success: true, value: { matchedCount: 0, modifiedCount: 0 } }
      }

      const docsToUpdate = multi ? matchingDocs : [matchingDocs[0]]
      let modifiedCount = 0

      for (const doc of docsToUpdate) {
        const oldSize = doc.getSize()
        const updatedDoc = doc.update(updateData, options)
        const newSize = updatedDoc.getSize()

        // Check size limit
        if (this.stats.totalSize - oldSize + newSize > this.options.maxSize) {
          continue // Skip this update
        }

        // Update indexes
        this.updateIndexesForDocument(doc, 'remove')
        this.updateIndexesForDocument(updatedDoc, 'insert')
        this.indexManager.updateIndexes(doc, 'remove')
        this.indexManager.updateIndexes(updatedDoc, 'insert')

        // Replace document
        this.documents.set(doc._id, updatedDoc)
        this.stats.totalSize = this.stats.totalSize - oldSize + newSize
        modifiedCount++
      }

      logger.debug('Documents updated', {
        collection: this.name,
        matchedCount: docsToUpdate.length,
        modifiedCount
      })

      return {
        success: true,
        value: {
          matchedCount: docsToUpdate.length,
          modifiedCount
        }
      }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  delete(query, options = {}) {
    try {
      const { multi = false } = options

      const matchingDocs = this.executeQuery(query)
      
      if (matchingDocs.length === 0) {
        return { success: true, value: { deletedCount: 0 } }
      }

      const docsToDelete = multi ? matchingDocs : [matchingDocs[0]]
      let deletedCount = 0

      for (const doc of docsToDelete) {
        // Remove from indexes
        this.updateIndexesForDocument(doc, 'remove')
        this.indexManager.updateIndexes(doc, 'remove')

        // Remove document
        this.documents.delete(doc._id)
        this.stats.documentCount--
        this.stats.totalSize -= doc.getSize()
        deletedCount++
      }

      logger.debug('Documents deleted', {
        collection: this.name,
        deletedCount
      })

      return { success: true, value: { deletedCount } }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  executeQuery(query) {
    // Simple query execution - for complex queries, QueryEngine will be used
    const results = []

    for (const doc of this.documents.values()) {
      if (this.documentMatchesQuery(doc, query)) {
        results.push(doc)
      }
    }

    return results
  }

  documentMatchesQuery(document, query) {
    const docData = document.toJSON()

    for (const [field, condition] of Object.entries(query)) {
      if (field.startsWith('$')) {
        // Handle logical operators
        if (!this.evaluateLogicalOperator(docData, field, condition)) {
          return false
        }
      } else {
        if (!this.fieldMatchesCondition(docData, field, condition)) {
          return false
        }
      }
    }

    return true
  }

  evaluateLogicalOperator(document, operator, operand) {
    switch (operator) {
      case '$and':
        return Array.isArray(operand) && operand.every(subQuery => 
          this.documentMatchesQuery({ toJSON: () => document }, subQuery)
        )
      case '$or':
        return Array.isArray(operand) && operand.some(subQuery => 
          this.documentMatchesQuery({ toJSON: () => document }, subQuery)
        )
      case '$nor':
        return Array.isArray(operand) && !operand.some(subQuery => 
          this.documentMatchesQuery({ toJSON: () => document }, subQuery)
        )
      case '$not':
        return !this.documentMatchesQuery({ toJSON: () => document }, operand)
      default:
        return false
    }
  }

  fieldMatchesCondition(docData, field, condition) {
    const fieldValue = this.getNestedFieldValue(docData, field)

    if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
      // Handle query operators
      for (const [operator, operand] of Object.entries(condition)) {
        if (!this.evaluateQueryOperator(fieldValue, operator, operand)) {
          return false
        }
      }
      return true
    } else {
      // Simple equality - handle arrays specially
      if (Array.isArray(fieldValue)) {
        // If field is an array and condition is a single value, check if array contains the value
        return fieldValue.some(item => JSON.stringify(item) === JSON.stringify(condition))
      } else {
        return JSON.stringify(fieldValue) === JSON.stringify(condition)
      }
    }
  }

  evaluateQueryOperator(fieldValue, operator, operand) {
    switch (operator) {
      case '$eq':
        return JSON.stringify(fieldValue) === JSON.stringify(operand)
      case '$ne':
        return JSON.stringify(fieldValue) !== JSON.stringify(operand)
      case '$gt':
        return fieldValue > operand
      case '$gte':
        return fieldValue >= operand
      case '$lt':
        return fieldValue < operand
      case '$lte':
        return fieldValue <= operand
      case '$in':
        if (!Array.isArray(operand)) return false
        if (Array.isArray(fieldValue)) {
          // If field is an array, check if any field element is in the operand array
          return fieldValue.some(fieldItem => 
            operand.some(opItem => JSON.stringify(fieldItem) === JSON.stringify(opItem))
          )
        } else {
          // If field is not an array, check if field value is in the operand array
          return operand.some(val => JSON.stringify(fieldValue) === JSON.stringify(val))
        }
      case '$nin':
        if (!Array.isArray(operand)) return true
        if (Array.isArray(fieldValue)) {
          // If field is an array, check that no field element is in the operand array
          return !fieldValue.some(fieldItem => 
            operand.some(opItem => JSON.stringify(fieldItem) === JSON.stringify(opItem))
          )
        } else {
          // If field is not an array, check that field value is not in the operand array
          return !operand.some(val => JSON.stringify(fieldValue) === JSON.stringify(val))
        }
      case '$exists':
        return operand ? fieldValue !== undefined : fieldValue === undefined
      case '$regex':
        if (typeof fieldValue === 'string') {
          const regex = new RegExp(operand)
          return regex.test(fieldValue)
        }
        return false
      default:
        throw new Error(`Unknown query operator: ${operator}`)
    }
  }

  getNestedFieldValue(obj, fieldPath) {
    const parts = fieldPath.split('.')
    let current = obj

    for (const part of parts) {
      if (current === null || current === undefined || !(part in current)) {
        return undefined
      }
      current = current[part]
    }

    return current
  }

  sortDocuments(documents, sortSpec) {
    return documents.sort((a, b) => {
      const aData = a.toJSON()
      const bData = b.toJSON()

      for (const [field, direction] of Object.entries(sortSpec)) {
        const aValue = this.getNestedFieldValue(aData, field)
        const bValue = this.getNestedFieldValue(bData, field)
        
        let comparison = 0
        if (aValue < bValue) comparison = -1
        else if (aValue > bValue) comparison = 1

        if (comparison !== 0) {
          return direction === -1 ? -comparison : comparison
        }
      }

      return 0
    })
  }

  applyProjection(document, projection) {
    const result = {}
    const include = Object.values(projection).some(val => val === 1)

    if (include) {
      // Include specified fields
      for (const [field, value] of Object.entries(projection)) {
        if (value === 1) {
          const fieldValue = this.getNestedFieldValue(document, field)
          if (fieldValue !== undefined) {
            this.setNestedFieldValue(result, field, fieldValue)
          }
        }
      }
      // Always include _id unless explicitly excluded
      if (!projection.hasOwnProperty('_id') || projection._id !== 0) {
        result._id = document._id
      }
    } else {
      // Exclude specified fields
      Object.assign(result, document)
      for (const [field, value] of Object.entries(projection)) {
        if (value === 0) {
          this.deleteNestedFieldValue(result, field)
        }
      }
    }

    return result
  }

  setNestedFieldValue(obj, fieldPath, value) {
    const parts = fieldPath.split('.')
    let current = obj

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!(part in current)) {
        current[part] = {}
      }
      current = current[part]
    }

    current[parts[parts.length - 1]] = value
  }

  deleteNestedFieldValue(obj, fieldPath) {
    const parts = fieldPath.split('.')
    let current = obj

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!(part in current)) {
        return
      }
      current = current[part]
    }

    delete current[parts[parts.length - 1]]
  }

  updateIndexesForDocument(document, operation) {
    // Basic indexing - IndexManager will provide more sophisticated indexing
    const docData = document.toJSON()
    
    for (const [field, index] of this.indexes) {
      const fieldValue = this.getNestedFieldValue(docData, field)
      
      if (fieldValue !== undefined) {
        const key = this.getIndexKey(fieldValue)
        
        if (operation === 'insert') {
          if (!index.has(key)) {
            index.set(key, new Set())
          }
          index.get(key).add(document._id)
        } else if (operation === 'remove') {
          if (index.has(key)) {
            index.get(key).delete(document._id)
            if (index.get(key).size === 0) {
              index.delete(key)
            }
          }
        }
      }
    }
  }

  getIndexKey(value) {
    if (typeof value === 'object') {
      return JSON.stringify(value)
    }
    return String(value)
  }

  createIndex(field, options = {}) {
    if (this.indexes.has(field)) {
      return { success: false, error: 'Index already exists for this field' }
    }

    const index = new Map()
    
    // Build index for existing documents
    for (const doc of this.documents.values()) {
      const docData = doc.toJSON()
      const fieldValue = this.getNestedFieldValue(docData, field)
      
      if (fieldValue !== undefined) {
        const key = this.getIndexKey(fieldValue)
        if (!index.has(key)) {
          index.set(key, new Set())
        }
        index.get(key).add(doc._id)
      }
    }

    this.indexes.set(field, index)
    this.stats.indexCount++

    logger.debug('Index created', {
      collection: this.name,
      field,
      documentCount: this.documents.size,
      uniqueValues: index.size
    })

    return { success: true, value: { field, uniqueValues: index.size } }
  }

  dropIndex(field) {
    if (!this.indexes.has(field)) {
      return { success: false, error: 'Index does not exist for this field' }
    }

    this.indexes.delete(field)
    this.stats.indexCount--

    logger.debug('Index dropped', { collection: this.name, field })
    return { success: true, value: { field } }
  }

  validateSchema(data) {
    if (!this.options.schema) {
      return true
    }

    // Simple schema validation - can be extended
    const schema = this.options.schema
    
    for (const [field, rules] of Object.entries(schema)) {
      const value = this.getNestedFieldValue(data, field)
      
      if (rules.required && value === undefined) {
        throw new Error(`Required field '${field}' is missing`)
      }
      
      if (value !== undefined && rules.type && typeof value !== rules.type) {
        throw new Error(`Field '${field}' must be of type ${rules.type}`)
      }
    }

    return true
  }

  getStats() {
    return {
      ...this.stats,
      averageDocumentSize: this.stats.documentCount > 0 ? 
        Math.round(this.stats.totalSize / this.stats.documentCount) : 0,
      indexedFields: Array.from(this.indexes.keys())
    }
  }

  clear() {
    this.documents.clear()
    this.indexes.clear()
    this.stats = {
      documentCount: 0,
      totalSize: 0,
      indexCount: 0,
      createdAt: this.stats.createdAt
    }

    logger.debug('Collection cleared', { collection: this.name })
    return { success: true, value: 'OK' }
  }
}

class DocumentStore {
  constructor(dataStore) {
    this.dataStore = dataStore
    this.collections = new Map() // collectionName -> Collection
    
    logger.info('DocumentStore initialized')
  }

  createCollection(name, options = {}) {
    if (this.collections.has(name)) {
      return { success: false, error: 'Collection already exists' }
    }

    const collection = new Collection(name, options)
    this.collections.set(name, collection)

    logger.info('Collection created', { name, options })
    return { success: true, value: { name, created: true } }
  }

  getCollection(name) {
    const collection = this.collections.get(name)
    if (!collection) {
      return { success: false, error: 'Collection does not exist' }
    }

    return { success: true, value: collection }
  }

  dropCollection(name) {
    if (!this.collections.has(name)) {
      return { success: false, error: 'Collection does not exist' }
    }

    this.collections.delete(name)
    
    logger.info('Collection dropped', { name })
    return { success: true, value: { name, dropped: true } }
  }

  listCollections() {
    const collections = Array.from(this.collections.keys()).map(name => {
      const collection = this.collections.get(name)
      return {
        name,
        stats: collection.getStats()
      }
    })

    return { success: true, value: collections }
  }

  getStats() {
    const collectionsStats = Array.from(this.collections.values()).map(c => c.getStats())
    
    return {
      totalCollections: this.collections.size,
      totalDocuments: collectionsStats.reduce((sum, stats) => sum + stats.documentCount, 0),
      totalSize: collectionsStats.reduce((sum, stats) => sum + stats.totalSize, 0),
      totalIndexes: collectionsStats.reduce((sum, stats) => sum + stats.indexCount, 0),
      collections: collectionsStats
    }
  }

  flushall() {
    // Clear all collections
    this.collections.clear()
    
    logger.info('All collections cleared')
    return { success: true, value: 'OK' }
  }
}

module.exports = { DocumentStore, Collection, Document }
