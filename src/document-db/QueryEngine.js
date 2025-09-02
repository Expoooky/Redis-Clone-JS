/**
 * Query Engine for Document Database
 * Provides a simple query language for document operations and filtering
 * Supports MongoDB-like query syntax with optimization for indexed fields
 */

const logger = require('../utils/Logger')

class QueryPlan {
  constructor(query, collection, indexManager) {
    this.query = query
    this.collection = collection
    this.indexManager = indexManager
    this.steps = []
    this.estimatedCost = 0
    this.indexesUsed = []
  }

  addStep(type, description, cost = 1, index = null) {
    this.steps.push({
      type,
      description,
      cost,
      index: index ? index.name : null
    })
    this.estimatedCost += cost
    
    if (index) {
      this.indexesUsed.push(index.name)
    }
  }

  getExecutionPlan() {
    return {
      query: this.query,
      steps: this.steps,
      estimatedCost: this.estimatedCost,
      indexesUsed: this.indexesUsed,
      optimized: this.indexesUsed.length > 0
    }
  }
}

class QueryOptimizer {
  constructor(indexManager) {
    this.indexManager = indexManager
  }

  optimize(query, options = {}) {
    const plan = new QueryPlan(query, null, this.indexManager)
    
    // Analyze query structure
    const queryFields = this.extractQueryFields(query)
    const bestIndex = this.findBestIndex(queryFields, query)

    if (bestIndex) {
      plan.addStep('INDEX_SCAN', `Use index: ${bestIndex.name}`, 1, bestIndex)
      return this.createIndexedPlan(query, bestIndex, plan, options)
    } else {
      plan.addStep('COLLECTION_SCAN', 'Full collection scan', 100)
      return this.createCollectionScanPlan(query, plan, options)
    }
  }

  extractQueryFields(query, prefix = '') {
    const fields = []
    
    for (const [key, value] of Object.entries(query)) {
      const fieldPath = prefix ? `${prefix}.${key}` : key
      
      if (key.startsWith('$')) {
        // Skip query operators at root level
        continue
      }
      
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Check if it's a query operator object
        const hasOperators = Object.keys(value).some(k => k.startsWith('$'))
        
        if (hasOperators) {
          fields.push(fieldPath)
        } else {
          // Nested object, recurse
          fields.push(...this.extractQueryFields(value, fieldPath))
        }
      } else {
        fields.push(fieldPath)
      }
    }
    
    return fields
  }

  findBestIndex(queryFields, query) {
    let bestIndex = null
    let bestScore = 0

    for (const [indexName, index] of this.indexManager.indexes) {
      const score = this.calculateIndexScore(index, queryFields, query)
      
      if (score > bestScore) {
        bestIndex = { name: indexName, index, score }
        bestScore = score
      }
    }

    return bestIndex
  }

  calculateIndexScore(index, queryFields, query) {
    if (index.type === 'compound') {
      // For compound indexes, calculate prefix match score
      let score = 0
      for (let i = 0; i < index.fields.length; i++) {
        const field = index.fields[i]
        if (queryFields.includes(field)) {
          score += (index.fields.length - i) / index.fields.length
        } else {
          break // Compound indexes require prefix matching
        }
      }
      return score
    } else {
      // For single-field indexes
      if (queryFields.includes(index.field)) {
        // Check if the query can use this index effectively
        const fieldQuery = this.getFieldQuery(query, index.field)
        
        if (fieldQuery) {
          if (typeof fieldQuery === 'object' && fieldQuery !== null) {
            // Range queries benefit from B-tree indexes
            if (index.type === 'btree' && this.hasRangeOperators(fieldQuery)) {
              return 1.5
            }
            // Text searches benefit from text indexes
            if (index.type === 'text' && fieldQuery.$text) {
              return 1.5
            }
          }
          return 1
        }
      }
      
      return 0
    }
  }

  getFieldQuery(query, fieldPath) {
    const parts = fieldPath.split('.')
    let current = query

    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part]
      } else {
        return null
      }
    }

    return current
  }

  hasRangeOperators(query) {
    if (typeof query !== 'object' || query === null) {
      return false
    }

    const rangeOps = ['$gt', '$gte', '$lt', '$lte', '$in', '$nin']
    return Object.keys(query).some(key => rangeOps.includes(key))
  }

  createIndexedPlan(query, bestIndex, plan, options) {
    const { index } = bestIndex

    if (index.type === 'compound') {
      plan.addStep('COMPOUND_INDEX_LOOKUP', `Lookup using compound index on ${index.fields.join(', ')}`, 2)
    } else if (index.type === 'text') {
      plan.addStep('TEXT_INDEX_SEARCH', `Text search on ${index.field}`, 3)
    } else {
      const fieldQuery = this.getFieldQuery(query, index.field)
      
      if (fieldQuery && typeof fieldQuery === 'object' && this.hasRangeOperators(fieldQuery)) {
        plan.addStep('RANGE_INDEX_SCAN', `Range scan on ${index.field}`, 2)
      } else {
        plan.addStep('POINT_INDEX_LOOKUP', `Point lookup on ${index.field}`, 1)
      }
    }

    // Add filtering step if query has additional conditions
    const indexedFields = index.type === 'compound' ? index.fields : [index.field]
    const remainingQuery = this.removeIndexedFields(query, indexedFields)
    
    if (Object.keys(remainingQuery).length > 0) {
      plan.addStep('FILTER', 'Apply additional filters', 1)
    }

    if (options.sort && !this.canSortByIndex(options.sort, index)) {
      plan.addStep('SORT', 'Sort results', 5)
    }

    return plan
  }

  createCollectionScanPlan(query, plan, options) {
    plan.addStep('FILTER', 'Apply query filters', 10)
    
    if (options.sort) {
      plan.addStep('SORT', 'Sort results', 10)
    }

    return plan
  }

  removeIndexedFields(query, indexedFields) {
    const remaining = JSON.parse(JSON.stringify(query))
    
    for (const field of indexedFields) {
      this.deleteNestedField(remaining, field)
    }

    return remaining
  }

  deleteNestedField(obj, fieldPath) {
    const parts = fieldPath.split('.')
    let current = obj

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!(part in current) || typeof current[part] !== 'object') {
        return
      }
      current = current[part]
    }

    delete current[parts[parts.length - 1]]
  }

  canSortByIndex(sortSpec, index) {
    // Check if the index can provide sorted results
    if (index.type !== 'btree') {
      return false
    }

    const sortFields = Object.keys(sortSpec)
    
    if (index.type === 'compound') {
      // Check if sort matches index field order
      return sortFields.every((field, i) => index.fields[i] === field)
    } else {
      // Single field index
      return sortFields.length === 1 && sortFields[0] === index.field
    }
  }
}

class QueryExecutor {
  constructor(collection, indexManager) {
    this.collection = collection
    this.indexManager = indexManager
    this.optimizer = new QueryOptimizer(indexManager)
  }

  execute(query, options = {}) {
    try {
      const startTime = process.hrtime.bigint()
      
      // Optimize query
      const plan = this.optimizer.optimize(query, options)
      
      // Execute based on plan
      let candidateIds = this.executeIndexLookup(query, plan)
      
      if (candidateIds === null) {
        // Fall back to collection scan
        candidateIds = Array.from(this.collection.documents.keys())
      }

      // Filter documents
      const matchingDocuments = this.filterDocuments(candidateIds, query)
      
      // Apply sorting
      const sortedDocuments = this.applySorting(matchingDocuments, options.sort)
      
      // Apply pagination
      const paginatedDocuments = this.applyPagination(sortedDocuments, options)
      
      // Apply projection
      const projectedDocuments = this.applyProjection(paginatedDocuments, options.projection)
      
      const endTime = process.hrtime.bigint()
      const executionTime = Number(endTime - startTime) / 1000000 // Convert to milliseconds

      logger.debug('Query executed', {
        collection: this.collection.name,
        query,
        options,
        candidateCount: candidateIds.length,
        matchedCount: matchingDocuments.length,
        returnedCount: projectedDocuments.length,
        executionTime: `${executionTime.toFixed(2)}ms`,
        plan: plan.getExecutionPlan()
      })

      return {
        success: true,
        value: {
          documents: projectedDocuments,
          totalCount: matchingDocuments.length,
          executionTime,
          plan: plan.getExecutionPlan()
        }
      }
    } catch (error) {
      logger.error('Query execution failed', {
        collection: this.collection.name,
        query,
        error: error.message
      })
      
      return { success: false, error: error.message }
    }
  }

  executeIndexLookup(query, plan) {
    const indexStep = plan.steps.find(step => 
      step.type.includes('INDEX') && step.index
    )

    if (!indexStep) {
      return null
    }

    const index = this.indexManager.indexes.get(indexStep.index)
    if (!index) {
      return null
    }

    try {
      if (index.type === 'compound') {
        return this.executeCompoundIndexLookup(query, index)
      } else if (index.type === 'text') {
        return this.executeTextIndexLookup(query, index)
      } else {
        return this.executeSingleFieldIndexLookup(query, index)
      }
    } catch (error) {
      logger.warn('Index lookup failed, falling back to collection scan', {
        collection: this.collection.name,
        indexName: indexStep.index,
        error: error.message
      })
      return null
    }
  }

  executeSingleFieldIndexLookup(query, index) {
    const fieldQuery = this.getNestedFieldValue(query, index.field)
    
    if (fieldQuery === undefined) {
      return null
    }

    if (typeof fieldQuery === 'object' && fieldQuery !== null) {
      // Handle query operators
      return this.executeOperatorLookup(fieldQuery, index)
    } else {
      // Simple equality lookup
      return index.find(fieldQuery)
    }
  }

  executeOperatorLookup(fieldQuery, index) {
    const results = new Set()

    for (const [operator, operand] of Object.entries(fieldQuery)) {
      let operatorResults = []

      switch (operator) {
        case '$eq':
          operatorResults = index.find(operand)
          break

        case '$in':
          if (Array.isArray(operand)) {
            for (const value of operand) {
              operatorResults.push(...index.find(value))
            }
          }
          break

        case '$gt':
        case '$gte':
        case '$lt':
        case '$lte':
          if (index.type === 'btree' && typeof index.findRange === 'function') {
            operatorResults = this.executeRangeQuery(fieldQuery, index)
          }
          break

        case '$ne':
          // For $ne, we need to scan all values except the specified one
          // This is inefficient with indexes, better to use collection scan
          return null

        case '$exists':
          if (operand) {
            // Find all non-null values
            operatorResults = this.findExistingValues(index)
          }
          break

        default:
          logger.warn(`Unsupported index operator: ${operator}`)
          return null
      }

      if (results.size === 0) {
        results.forEach = operatorResults.forEach.bind(operatorResults)
        operatorResults.forEach(id => results.add(id))
      } else {
        // Intersection with previous results (AND logic)
        const intersection = new Set()
        for (const id of operatorResults) {
          if (results.has(id)) {
            intersection.add(id)
          }
        }
        results.clear()
        intersection.forEach(id => results.add(id))
      }
    }

    return Array.from(results)
  }

  executeRangeQuery(fieldQuery, index) {
    let min = undefined
    let max = undefined
    let includeMin = true
    let includeMax = true

    for (const [operator, operand] of Object.entries(fieldQuery)) {
      switch (operator) {
        case '$gt':
          min = operand
          includeMin = false
          break
        case '$gte':
          min = operand
          includeMin = true
          break
        case '$lt':
          max = operand
          includeMax = false
          break
        case '$lte':
          max = operand
          includeMax = true
          break
      }
    }

    return index.findRange(min, max, { includeMin, includeMax })
  }

  findExistingValues(index) {
    const results = []
    
    for (const entry of index.entries.values()) {
      if (entry.value !== null && entry.value !== undefined) {
        results.push(...entry.getDocumentIds())
      }
    }

    return results
  }

  executeCompoundIndexLookup(query, index) {
    // Extract values for compound key
    const queryValues = {}
    
    for (const field of index.fields) {
      const value = this.getNestedFieldValue(query, field)
      if (value !== undefined) {
        queryValues[field] = value
      } else {
        break // Stop at first missing field for prefix matching
      }
    }

    if (Object.keys(queryValues).length === index.fields.length) {
      // Full compound key match
      return index.find(queryValues)
    } else if (Object.keys(queryValues).length > 0) {
      // Prefix match
      return index.findPrefix(queryValues)
    }

    return null
  }

  executeTextIndexLookup(query, index) {
    const textQuery = this.getNestedFieldValue(query, index.field)
    
    if (typeof textQuery === 'object' && textQuery.$text) {
      return index.search(textQuery.$text.query, textQuery.$text.options || {})
    } else if (typeof textQuery === 'string') {
      return index.search(textQuery)
    }

    return null
  }

  filterDocuments(documentIds, query) {
    const matchingDocuments = []

    for (const documentId of documentIds) {
      const document = this.collection.documents.get(documentId)
      if (document && this.documentMatchesQuery(document, query)) {
        matchingDocuments.push(document)
      }
    }

    return matchingDocuments
  }

  documentMatchesQuery(document, query) {
    const docData = document.toJSON()
    return this.evaluateQuery(docData, query)
  }

  evaluateQuery(document, query) {
    for (const [key, condition] of Object.entries(query)) {
      if (key.startsWith('$')) {
        // Logical operators
        if (!this.evaluateLogicalOperator(document, key, condition)) {
          return false
        }
      } else {
        // Field conditions
        if (!this.evaluateFieldCondition(document, key, condition)) {
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
          this.evaluateQuery(document, subQuery)
        )

      case '$or':
        return Array.isArray(operand) && operand.some(subQuery => 
          this.evaluateQuery(document, subQuery)
        )

      case '$nor':
        return Array.isArray(operand) && !operand.some(subQuery => 
          this.evaluateQuery(document, subQuery)
        )

      case '$not':
        return !this.evaluateQuery(document, operand)

      default:
        logger.warn(`Unknown logical operator: ${operator}`)
        return false
    }
  }

  evaluateFieldCondition(document, fieldPath, condition) {
    const fieldValue = this.getNestedFieldValue(document, fieldPath)

    if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
      // Query operators
      for (const [operator, operand] of Object.entries(condition)) {
        if (!this.evaluateFieldOperator(fieldValue, operator, operand)) {
          return false
        }
      }
      return true
    } else {
      // Simple equality - handle arrays specially
      if (Array.isArray(fieldValue)) {
        // If field is an array and condition is a single value, check if array contains the value
        return fieldValue.some(item => this.deepEqual(item, condition))
      } else {
        return this.deepEqual(fieldValue, condition)
      }
    }
  }

  evaluateFieldOperator(fieldValue, operator, operand) {
    switch (operator) {
      case '$eq':
        return this.deepEqual(fieldValue, operand)

      case '$ne':
        return !this.deepEqual(fieldValue, operand)

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
            operand.some(opItem => this.deepEqual(fieldItem, opItem))
          )
        } else {
          // If field is not an array, check if field value is in the operand array
          return operand.some(val => this.deepEqual(fieldValue, val))
        }

      case '$nin':
        if (!Array.isArray(operand)) return true
        if (Array.isArray(fieldValue)) {
          // If field is an array, check that no field element is in the operand array
          return !fieldValue.some(fieldItem => 
            operand.some(opItem => this.deepEqual(fieldItem, opItem))
          )
        } else {
          // If field is not an array, check that field value is not in the operand array
          return !operand.some(val => this.deepEqual(fieldValue, val))
        }

      case '$exists':
        return operand ? fieldValue !== undefined : fieldValue === undefined

      case '$type':
        return this.getValueType(fieldValue) === operand

      case '$regex':
        if (typeof fieldValue === 'string') {
          const flags = operand.flags || ''
          const regex = new RegExp(operand.pattern || operand, flags)
          return regex.test(fieldValue)
        }
        return false

      case '$size':
        return Array.isArray(fieldValue) && fieldValue.length === operand

      case '$all':
        return Array.isArray(fieldValue) && Array.isArray(operand) &&
               operand.every(val => fieldValue.some(item => this.deepEqual(item, val)))

      case '$elemMatch':
        return Array.isArray(fieldValue) &&
               fieldValue.some(item => this.evaluateQuery(item, operand))

      default:
        logger.warn(`Unknown field operator: ${operator}`)
        return false
    }
  }

  applySorting(documents, sortSpec) {
    if (!sortSpec || Object.keys(sortSpec).length === 0) {
      return documents
    }

    return documents.sort((a, b) => {
      const aData = a.toJSON()
      const bData = b.toJSON()

      for (const [field, direction] of Object.entries(sortSpec)) {
        const aValue = this.getNestedFieldValue(aData, field)
        const bValue = this.getNestedFieldValue(bData, field)
        
        let comparison = this.compareValues(aValue, bValue)

        if (comparison !== 0) {
          return direction === -1 ? -comparison : comparison
        }
      }

      return 0
    })
  }

  applyPagination(documents, options) {
    const { skip = 0, limit = -1 } = options

    if (skip === 0 && limit === -1) {
      return documents
    }

    const startIndex = skip
    const endIndex = limit > 0 ? skip + limit : documents.length

    return documents.slice(startIndex, endIndex)
  }

  applyProjection(documents, projection) {
    if (!projection || Object.keys(projection).length === 0) {
      return documents.map(doc => doc.toJSON())
    }

    return documents.map(doc => {
      const docData = doc.toJSON()
      return this.projectDocument(docData, projection)
    })
  }

  projectDocument(document, projection) {
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

  deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b)
  }

  compareValues(a, b) {
    // Handle null/undefined
    if (a === null || a === undefined) {
      if (b === null || b === undefined) return 0
      return -1
    }
    if (b === null || b === undefined) return 1

    // Type coercion for comparison
    if (typeof a !== typeof b) {
      a = String(a)
      b = String(b)
    }

    if (a < b) return -1
    if (a > b) return 1
    return 0
  }

  getValueType(value) {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    return typeof value
  }
}

class QueryEngine {
  constructor(documentStore) {
    this.documentStore = documentStore
    logger.info('QueryEngine initialized')
  }

  find(collectionName, query = {}, options = {}) {
    const collectionResult = this.documentStore.getCollection(collectionName)
    if (!collectionResult.success) {
      return collectionResult
    }

    const collection = collectionResult.value
    const executor = new QueryExecutor(collection, collection.indexManager)
    
    return executor.execute(query, options)
  }

  findOne(collectionName, query = {}, options = {}) {
    const result = this.find(collectionName, query, { ...options, limit: 1 })
    
    if (!result.success) {
      return result
    }

    const documents = result.value.documents
    return {
      success: true,
      value: documents.length > 0 ? documents[0] : null
    }
  }

  count(collectionName, query = {}) {
    const result = this.find(collectionName, query, { projection: { _id: 1 } })
    
    if (!result.success) {
      return result
    }

    return {
      success: true,
      value: result.value.totalCount
    }
  }

  distinct(collectionName, field, query = {}) {
    const result = this.find(collectionName, query, { projection: { [field]: 1 } })
    
    if (!result.success) {
      return result
    }

    const distinctValues = new Set()
    
    for (const doc of result.value.documents) {
      const value = this.getNestedFieldValue(doc, field)
      if (value !== undefined) {
        distinctValues.add(JSON.stringify(value))
      }
    }

    const values = Array.from(distinctValues).map(v => JSON.parse(v))

    return {
      success: true,
      value: values
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

  explain(collectionName, query = {}, options = {}) {
    const collectionResult = this.documentStore.getCollection(collectionName)
    if (!collectionResult.success) {
      return collectionResult
    }

    const collection = collectionResult.value
    const executor = new QueryExecutor(collection, collection.indexManager)
    const optimizer = new QueryOptimizer(collection.indexManager)
    
    const plan = optimizer.optimize(query, options)

    return {
      success: true,
      value: {
        queryPlan: plan.getExecutionPlan(),
        indexStats: collection.indexManager.getStats(),
        collectionStats: collection.getStats()
      }
    }
  }
}

module.exports = { QueryEngine, QueryExecutor, QueryOptimizer, QueryPlan }
