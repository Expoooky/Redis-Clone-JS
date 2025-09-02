/**
 * Index Manager for Document Database
 * Provides sophisticated secondary indexing for efficient document retrieval
 * Supports various index types including B-tree, hash, text, and compound indexes
 */

const logger = require('../utils/Logger')

class IndexEntry {
  constructor(value, documentIds = []) {
    this.value = value
    this.documentIds = new Set(documentIds)
    this.count = this.documentIds.size
  }

  addDocument(documentId) {
    this.documentIds.add(documentId)
    this.count = this.documentIds.size
  }

  removeDocument(documentId) {
    this.documentIds.delete(documentId)
    this.count = this.documentIds.size
    return this.count === 0
  }

  getDocumentIds() {
    return Array.from(this.documentIds)
  }
}

class HashIndex {
  constructor(field, options = {}) {
    this.field = field
    this.type = 'hash'
    this.unique = options.unique || false
    this.sparse = options.sparse || false
    this.entries = new Map() // value -> IndexEntry
    this.stats = {
      totalEntries: 0,
      uniqueValues: 0,
      created: new Date().toISOString()
    }
  }

  add(value, documentId) {
    if (value === undefined || value === null) {
      if (!this.sparse) {
        value = null // Index null values unless sparse
      } else {
        return { success: true } // Skip sparse values
      }
    }

    const key = this.getKey(value)
    
    if (this.unique && this.entries.has(key)) {
      return { success: false, error: 'Duplicate key violation for unique index' }
    }

    if (!this.entries.has(key)) {
      this.entries.set(key, new IndexEntry(value))
      this.stats.uniqueValues++
    }

    this.entries.get(key).addDocument(documentId)
    this.stats.totalEntries++

    return { success: true }
  }

  remove(value, documentId) {
    if (value === undefined || value === null) {
      if (this.sparse) {
        return { success: true }
      }
      value = null
    }

    const key = this.getKey(value)
    
    if (this.entries.has(key)) {
      const entry = this.entries.get(key)
      const isEmpty = entry.removeDocument(documentId)
      this.stats.totalEntries--

      if (isEmpty) {
        this.entries.delete(key)
        this.stats.uniqueValues--
      }
    }

    return { success: true }
  }

  find(value) {
    const key = this.getKey(value)
    const entry = this.entries.get(key)
    return entry ? entry.getDocumentIds() : []
  }

  findRange(min, max) {
    // Hash indexes don't support range queries efficiently
    throw new Error('Range queries not supported on hash indexes')
  }

  getKey(value) {
    if (value === null || value === undefined) {
      return '__null__'
    }
    
    if (typeof value === 'object') {
      return JSON.stringify(value)
    }
    
    return String(value)
  }

  getStats() {
    return {
      field: this.field,
      type: this.type,
      unique: this.unique,
      sparse: this.sparse,
      ...this.stats,
      memoryUsage: this.estimateMemoryUsage()
    }
  }

  estimateMemoryUsage() {
    let size = 0
    for (const [key, entry] of this.entries) {
      size += key.length * 2 // String key
      size += entry.documentIds.size * 24 // Set overhead + document IDs
      size += 32 // Entry object overhead
    }
    return size
  }

  clear() {
    this.entries.clear()
    this.stats.totalEntries = 0
    this.stats.uniqueValues = 0
  }
}

class BTreeIndex {
  constructor(field, options = {}) {
    this.field = field
    this.type = 'btree'
    this.unique = options.unique || false
    this.sparse = options.sparse || false
    this.entries = new Map() // Sorted map for range queries
    this.sortedKeys = [] // Maintain sorted order
    this.stats = {
      totalEntries: 0,
      uniqueValues: 0,
      created: new Date().toISOString()
    }
  }

  add(value, documentId) {
    if (value === undefined || value === null) {
      if (!this.sparse) {
        value = null
      } else {
        return { success: true }
      }
    }

    const key = this.getKey(value)
    
    if (this.unique && this.entries.has(key)) {
      return { success: false, error: 'Duplicate key violation for unique index' }
    }

    if (!this.entries.has(key)) {
      this.entries.set(key, new IndexEntry(value))
      this.insertSorted(key)
      this.stats.uniqueValues++
    }

    this.entries.get(key).addDocument(documentId)
    this.stats.totalEntries++

    return { success: true }
  }

  remove(value, documentId) {
    if (value === undefined || value === null) {
      if (this.sparse) {
        return { success: true }
      }
      value = null
    }

    const key = this.getKey(value)
    
    if (this.entries.has(key)) {
      const entry = this.entries.get(key)
      const isEmpty = entry.removeDocument(documentId)
      this.stats.totalEntries--

      if (isEmpty) {
        this.entries.delete(key)
        this.removeSorted(key)
        this.stats.uniqueValues--
      }
    }

    return { success: true }
  }

  find(value) {
    const key = this.getKey(value)
    const entry = this.entries.get(key)
    return entry ? entry.getDocumentIds() : []
  }

  findRange(min, max, options = {}) {
    const { 
      includeMin = true, 
      includeMax = true,
      limit = -1 
    } = options

    const minKey = min !== undefined ? this.getKey(min) : null
    const maxKey = max !== undefined ? this.getKey(max) : null

    const results = []
    let count = 0

    for (const key of this.sortedKeys) {
      // Check minimum bound
      if (minKey !== null) {
        const comparison = this.compareKeys(key, minKey)
        if (comparison < 0 || (!includeMin && comparison === 0)) {
          continue
        }
      }

      // Check maximum bound
      if (maxKey !== null) {
        const comparison = this.compareKeys(key, maxKey)
        if (comparison > 0 || (!includeMax && comparison === 0)) {
          break
        }
      }

      const entry = this.entries.get(key)
      if (entry) {
        results.push(...entry.getDocumentIds())
        count++
        
        if (limit > 0 && count >= limit) {
          break
        }
      }
    }

    return results
  }

  insertSorted(key) {
    // Binary search insertion to maintain sorted order
    let left = 0
    let right = this.sortedKeys.length

    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      if (this.compareKeys(this.sortedKeys[mid], key) < 0) {
        left = mid + 1
      } else {
        right = mid
      }
    }

    this.sortedKeys.splice(left, 0, key)
  }

  removeSorted(key) {
    const index = this.sortedKeys.indexOf(key)
    if (index >= 0) {
      this.sortedKeys.splice(index, 1)
    }
  }

  compareKeys(key1, key2) {
    // Handle null values
    if (key1 === '__null__' && key2 === '__null__') return 0
    if (key1 === '__null__') return -1
    if (key2 === '__null__') return 1

    // String comparison for sorting
    if (key1 < key2) return -1
    if (key1 > key2) return 1
    return 0
  }

  getKey(value) {
    if (value === null || value === undefined) {
      return '__null__'
    }
    
    if (typeof value === 'object') {
      return JSON.stringify(value)
    }
    
    return String(value)
  }

  getStats() {
    return {
      field: this.field,
      type: this.type,
      unique: this.unique,
      sparse: this.sparse,
      ...this.stats,
      memoryUsage: this.estimateMemoryUsage()
    }
  }

  estimateMemoryUsage() {
    let size = 0
    for (const [key, entry] of this.entries) {
      size += key.length * 2
      size += entry.documentIds.size * 24
      size += 32
    }
    size += this.sortedKeys.length * 8 // Array overhead
    return size
  }

  clear() {
    this.entries.clear()
    this.sortedKeys = []
    this.stats.totalEntries = 0
    this.stats.uniqueValues = 0
  }
}

class TextIndex {
  constructor(field, options = {}) {
    this.field = field
    this.type = 'text'
    this.language = options.language || 'english'
    this.caseSensitive = options.caseSensitive || false
    this.terms = new Map() // term -> IndexEntry
    this.stopWords = new Set(this.getStopWords())
    this.stats = {
      totalTerms: 0,
      uniqueTerms: 0,
      created: new Date().toISOString()
    }
  }

  add(value, documentId) {
    if (typeof value !== 'string') {
      return { success: true } // Skip non-string values
    }

    const terms = this.tokenize(value)
    
    for (const term of terms) {
      if (!this.terms.has(term)) {
        this.terms.set(term, new IndexEntry(term))
        this.stats.uniqueTerms++
      }

      this.terms.get(term).addDocument(documentId)
      this.stats.totalTerms++
    }

    return { success: true }
  }

  remove(value, documentId) {
    if (typeof value !== 'string') {
      return { success: true }
    }

    const terms = this.tokenize(value)
    
    for (const term of terms) {
      if (this.terms.has(term)) {
        const entry = this.terms.get(term)
        const isEmpty = entry.removeDocument(documentId)
        this.stats.totalTerms--

        if (isEmpty) {
          this.terms.delete(term)
          this.stats.uniqueTerms--
        }
      }
    }

    return { success: true }
  }

  search(query, options = {}) {
    const { 
      operator = 'AND',
      fuzzy = false,
      limit = -1 
    } = options

    const terms = this.tokenize(query)
    if (terms.length === 0) {
      return []
    }

    let resultSets = terms.map(term => {
      const entry = this.terms.get(term)
      return entry ? new Set(entry.getDocumentIds()) : new Set()
    })

    let finalResults
    if (operator === 'AND') {
      // Intersection of all result sets
      finalResults = resultSets.reduce((acc, set) => {
        return new Set([...acc].filter(id => set.has(id)))
      })
    } else if (operator === 'OR') {
      // Union of all result sets
      finalResults = resultSets.reduce((acc, set) => {
        return new Set([...acc, ...set])
      }, new Set())
    }

    const results = Array.from(finalResults)
    return limit > 0 ? results.slice(0, limit) : results
  }

  tokenize(text) {
    if (!this.caseSensitive) {
      text = text.toLowerCase()
    }

    // Simple tokenization - split on non-alphanumeric characters
    const tokens = text.split(/[^\w]+/).filter(token => 
      token.length > 0 && !this.stopWords.has(token)
    )

    return tokens
  }

  getStopWords() {
    // Basic English stop words
    return [
      'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
      'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
      'to', 'was', 'were', 'will', 'with', 'would'
    ]
  }

  getStats() {
    return {
      field: this.field,
      type: this.type,
      language: this.language,
      caseSensitive: this.caseSensitive,
      ...this.stats,
      memoryUsage: this.estimateMemoryUsage()
    }
  }

  estimateMemoryUsage() {
    let size = 0
    for (const [term, entry] of this.terms) {
      size += term.length * 2
      size += entry.documentIds.size * 24
      size += 32
    }
    return size
  }

  clear() {
    this.terms.clear()
    this.stats.totalTerms = 0
    this.stats.uniqueTerms = 0
  }
}

class CompoundIndex {
  constructor(fields, options = {}) {
    this.fields = fields
    this.type = 'compound'
    this.unique = options.unique || false
    this.sparse = options.sparse || false
    this.entries = new Map() // compound key -> IndexEntry
    this.stats = {
      totalEntries: 0,
      uniqueValues: 0,
      created: new Date().toISOString()
    }
  }

  add(document, documentId) {
    const values = this.extractValues(document)
    
    if (this.sparse && values.some(v => v === undefined || v === null)) {
      return { success: true } // Skip documents with missing values in sparse index
    }

    const key = this.getCompoundKey(values)
    
    if (this.unique && this.entries.has(key)) {
      return { success: false, error: 'Duplicate key violation for unique compound index' }
    }

    if (!this.entries.has(key)) {
      this.entries.set(key, new IndexEntry(values))
      this.stats.uniqueValues++
    }

    this.entries.get(key).addDocument(documentId)
    this.stats.totalEntries++

    return { success: true }
  }

  remove(document, documentId) {
    const values = this.extractValues(document)
    
    if (this.sparse && values.some(v => v === undefined || v === null)) {
      return { success: true }
    }

    const key = this.getCompoundKey(values)
    
    if (this.entries.has(key)) {
      const entry = this.entries.get(key)
      const isEmpty = entry.removeDocument(documentId)
      this.stats.totalEntries--

      if (isEmpty) {
        this.entries.delete(key)
        this.stats.uniqueValues--
      }
    }

    return { success: true }
  }

  find(query) {
    // Extract values for the compound key from query
    const values = this.fields.map(field => query[field])
    const key = this.getCompoundKey(values)
    
    const entry = this.entries.get(key)
    return entry ? entry.getDocumentIds() : []
  }

  findPrefix(prefixQuery) {
    // Find documents matching a prefix of the compound key
    const prefixValues = []
    
    for (const field of this.fields) {
      if (prefixQuery.hasOwnProperty(field)) {
        prefixValues.push(prefixQuery[field])
      } else {
        break // Stop at first missing field
      }
    }

    if (prefixValues.length === 0) {
      return []
    }

    const prefixKey = this.getCompoundKey(prefixValues)
    const results = []

    for (const [key, entry] of this.entries) {
      if (key.startsWith(prefixKey)) {
        results.push(...entry.getDocumentIds())
      }
    }

    return results
  }

  extractValues(document) {
    return this.fields.map(field => this.getNestedValue(document, field))
  }

  getNestedValue(obj, fieldPath) {
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

  getCompoundKey(values) {
    return values.map(value => {
      if (value === null || value === undefined) {
        return '__null__'
      }
      if (typeof value === 'object') {
        return JSON.stringify(value)
      }
      return String(value)
    }).join('|')
  }

  getStats() {
    return {
      fields: this.fields,
      type: this.type,
      unique: this.unique,
      sparse: this.sparse,
      ...this.stats,
      memoryUsage: this.estimateMemoryUsage()
    }
  }

  estimateMemoryUsage() {
    let size = 0
    for (const [key, entry] of this.entries) {
      size += key.length * 2
      size += entry.documentIds.size * 24
      size += 32
    }
    return size
  }

  clear() {
    this.entries.clear()
    this.stats.totalEntries = 0
    this.stats.uniqueValues = 0
  }
}

class IndexManager {
  constructor(collection) {
    this.collection = collection
    this.indexes = new Map() // indexName -> Index
    this.defaultIndexes = new Set(['_id']) // Always index _id
    
    // Create default _id index
    this.createIndex('_id', { type: 'hash', unique: true })
    
    logger.debug('IndexManager initialized', { collection: collection.name })
  }

  createIndex(field, options = {}) {
    const indexName = this.getIndexName(field, options)
    
    if (this.indexes.has(indexName)) {
      return { success: false, error: 'Index already exists' }
    }

    try {
      let index
      
      switch (options.type || 'btree') {
        case 'hash':
          index = new HashIndex(field, options)
          break
        case 'btree':
          index = new BTreeIndex(field, options)
          break
        case 'text':
          index = new TextIndex(field, options)
          break
        case 'compound':
          if (!Array.isArray(field)) {
            return { success: false, error: 'Compound indexes require an array of fields' }
          }
          index = new CompoundIndex(field, options)
          break
        default:
          return { success: false, error: `Unknown index type: ${options.type}` }
      }

      // Build index for existing documents
      for (const doc of this.collection.documents.values()) {
        const docData = doc.toJSON()
        
        if (options.type === 'compound') {
          index.add(docData, doc._id)
        } else {
          const fieldValue = this.getNestedValue(docData, field)
          index.add(fieldValue, doc._id)
        }
      }

      this.indexes.set(indexName, index)

      logger.info('Index created', {
        collection: this.collection.name,
        indexName,
        field,
        type: options.type || 'btree',
        stats: index.getStats()
      })

      return { success: true, value: { indexName, stats: index.getStats() } }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  dropIndex(indexName) {
    if (this.defaultIndexes.has(indexName)) {
      return { success: false, error: 'Cannot drop default index' }
    }

    if (!this.indexes.has(indexName)) {
      return { success: false, error: 'Index does not exist' }
    }

    this.indexes.delete(indexName)

    logger.info('Index dropped', {
      collection: this.collection.name,
      indexName
    })

    return { success: true, value: { indexName, dropped: true } }
  }

  updateIndexes(document, operation) {
    const docData = document.toJSON()

    for (const [indexName, index] of this.indexes) {
      try {
        if (index.type === 'compound') {
          if (operation === 'insert') {
            index.add(docData, document._id)
          } else if (operation === 'remove') {
            index.remove(docData, document._id)
          }
        } else {
          const fieldValue = this.getNestedValue(docData, index.field)
          
          if (operation === 'insert') {
            index.add(fieldValue, document._id)
          } else if (operation === 'remove') {
            index.remove(fieldValue, document._id)
          }
        }
      } catch (error) {
        logger.warn('Index update failed', {
          collection: this.collection.name,
          indexName,
          operation,
          documentId: document._id,
          error: error.message
        })
      }
    }
  }

  findByIndex(field, value, options = {}) {
    const indexName = this.getIndexName(field, options)
    const index = this.indexes.get(indexName)
    
    if (!index) {
      return { success: false, error: 'No suitable index found' }
    }

    try {
      const documentIds = index.find(value)
      return { success: true, value: documentIds }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  findByRange(field, min, max, options = {}) {
    const indexName = this.getIndexName(field, options)
    const index = this.indexes.get(indexName)
    
    if (!index || index.type === 'hash') {
      return { success: false, error: 'No suitable index for range query' }
    }

    try {
      const documentIds = index.findRange(min, max, options)
      return { success: true, value: documentIds }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  textSearch(field, query, options = {}) {
    const index = this.findTextIndex(field)
    
    if (!index) {
      return { success: false, error: 'No text index found for field' }
    }

    try {
      const documentIds = index.search(query, options)
      return { success: true, value: documentIds }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  getOptimalIndex(query) {
    // Find the best index for a given query
    const queryFields = Object.keys(query)
    let bestIndex = null
    let bestScore = 0

    for (const [indexName, index] of this.indexes) {
      const score = this.calculateIndexScore(index, queryFields)
      if (score > bestScore) {
        bestIndex = { name: indexName, index, score }
        bestScore = score
      }
    }

    return bestIndex
  }

  calculateIndexScore(index, queryFields) {
    if (index.type === 'compound') {
      // Score compound indexes based on field overlap
      const matchingFields = index.fields.filter(field => queryFields.includes(field))
      return matchingFields.length / index.fields.length
    } else {
      // Score single-field indexes
      return queryFields.includes(index.field) ? 1 : 0
    }
  }

  findTextIndex(field) {
    for (const index of this.indexes.values()) {
      if (index.type === 'text' && index.field === field) {
        return index
      }
    }
    return null
  }

  getIndexName(field, options = {}) {
    if (Array.isArray(field)) {
      return `compound_${field.join('_')}`
    }
    
    const type = options.type || 'btree'
    const unique = options.unique ? '_unique' : ''
    const sparse = options.sparse ? '_sparse' : ''
    
    return `${field}_${type}${unique}${sparse}`
  }

  getNestedValue(obj, fieldPath) {
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

  listIndexes() {
    const indexes = []
    
    for (const [name, index] of this.indexes) {
      indexes.push({
        name,
        ...index.getStats()
      })
    }

    return { success: true, value: indexes }
  }

  getStats() {
    const indexStats = Array.from(this.indexes.values()).map(index => index.getStats())
    
    return {
      totalIndexes: this.indexes.size,
      totalMemoryUsage: indexStats.reduce((sum, stats) => sum + (stats.memoryUsage || 0), 0),
      indexTypes: this.getIndexTypeDistribution(),
      indexes: indexStats
    }
  }

  getIndexTypeDistribution() {
    const distribution = {}
    
    for (const index of this.indexes.values()) {
      distribution[index.type] = (distribution[index.type] || 0) + 1
    }

    return distribution
  }

  clear() {
    // Clear all indexes except defaults
    for (const [indexName, index] of this.indexes) {
      if (!this.defaultIndexes.has(indexName)) {
        index.clear()
      }
    }

    // Keep only default indexes
    const defaultIndexes = new Map()
    for (const defaultName of this.defaultIndexes) {
      if (this.indexes.has(defaultName)) {
        defaultIndexes.set(defaultName, this.indexes.get(defaultName))
      }
    }
    
    this.indexes = defaultIndexes

    logger.debug('IndexManager cleared', { collection: this.collection.name })
  }
}

module.exports = { 
  IndexManager, 
  HashIndex, 
  BTreeIndex, 
  TextIndex, 
  CompoundIndex,
  IndexEntry 
}
