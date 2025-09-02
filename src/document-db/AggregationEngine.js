/**
 * Aggregation Engine for Document Database
 * Provides MongoDB-like aggregation framework with support for
 * count, sum, average, group by, and other aggregation operations
 */

const logger = require('../utils/Logger')

class AggregationStage {
  constructor(type, options = {}) {
    this.type = type
    this.options = options
  }

  execute(documents) {
    throw new Error('execute method must be implemented by subclasses')
  }

  getStats() {
    return {
      type: this.type,
      options: this.options
    }
  }
}

class MatchStage extends AggregationStage {
  constructor(query) {
    super('$match', { query })
    this.query = query
  }

  execute(documents) {
    return documents.filter(doc => this.documentMatches(doc, this.query))
  }

  documentMatches(document, query) {
    for (const [key, condition] of Object.entries(query)) {
      if (key.startsWith('$')) {
        if (!this.evaluateLogicalOperator(document, key, condition)) {
          return false
        }
      } else {
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
          this.documentMatches(document, subQuery)
        )
      case '$or':
        return Array.isArray(operand) && operand.some(subQuery => 
          this.documentMatches(document, subQuery)
        )
      case '$nor':
        return Array.isArray(operand) && !operand.some(subQuery => 
          this.documentMatches(document, subQuery)
        )
      case '$not':
        return !this.documentMatches(document, operand)
      default:
        return false
    }
  }

  evaluateFieldCondition(document, fieldPath, condition) {
    const fieldValue = this.getNestedFieldValue(document, fieldPath)

    if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
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
      case '$eq': return this.deepEqual(fieldValue, operand)
      case '$ne': return !this.deepEqual(fieldValue, operand)
      case '$gt': return fieldValue > operand
      case '$gte': return fieldValue >= operand
      case '$lt': return fieldValue < operand
      case '$lte': return fieldValue <= operand
      case '$in': 
        if (!Array.isArray(operand)) return false
        if (Array.isArray(fieldValue)) {
          return fieldValue.some(fieldItem => 
            operand.some(opItem => this.deepEqual(fieldItem, opItem))
          )
        } else {
          return operand.some(val => this.deepEqual(fieldValue, val))
        }
      case '$nin': 
        if (!Array.isArray(operand)) return true
        if (Array.isArray(fieldValue)) {
          return !fieldValue.some(fieldItem => 
            operand.some(opItem => this.deepEqual(fieldItem, opItem))
          )
        } else {
          return !operand.some(val => this.deepEqual(fieldValue, val))
        }
      case '$exists': return operand ? fieldValue !== undefined : fieldValue === undefined
      case '$regex':
        if (typeof fieldValue === 'string') {
          const regex = new RegExp(operand)
          return regex.test(fieldValue)
        }
        return false
      default: return false
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

  deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b)
  }
}

class ProjectStage extends AggregationStage {
  constructor(projection) {
    super('$project', { projection })
    this.projection = projection
  }

  execute(documents) {
    return documents.map(doc => this.projectDocument(doc, this.projection))
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
        } else if (typeof value === 'object' && value !== null) {
          // Computed field
          const computedValue = this.computeExpression(value, document)
          this.setNestedFieldValue(result, field, computedValue)
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

  computeExpression(expression, document) {
    if (typeof expression === 'string' && expression.startsWith('$')) {
      // Field reference
      return this.getNestedFieldValue(document, expression.substring(1))
    }

    if (typeof expression === 'object' && expression !== null) {
      for (const [operator, operand] of Object.entries(expression)) {
        return this.evaluateExpression(operator, operand, document)
      }
    }

    return expression
  }

  evaluateExpression(operator, operand, document) {
    switch (operator) {
      case '$add':
        return Array.isArray(operand) ? 
          operand.reduce((sum, val) => sum + this.computeExpression(val, document), 0) : 0

      case '$subtract':
        if (Array.isArray(operand) && operand.length === 2) {
          const left = this.computeExpression(operand[0], document)
          const right = this.computeExpression(operand[1], document)
          return left - right
        }
        return 0

      case '$multiply':
        return Array.isArray(operand) ? 
          operand.reduce((product, val) => product * this.computeExpression(val, document), 1) : 0

      case '$divide':
        if (Array.isArray(operand) && operand.length === 2) {
          const dividend = this.computeExpression(operand[0], document)
          const divisor = this.computeExpression(operand[1], document)
          return divisor !== 0 ? dividend / divisor : null
        }
        return null

      case '$concat':
        return Array.isArray(operand) ? 
          operand.map(val => String(this.computeExpression(val, document))).join('') : ''

      case '$substr':
        if (Array.isArray(operand) && operand.length >= 2) {
          const str = String(this.computeExpression(operand[0], document))
          const start = this.computeExpression(operand[1], document)
          const length = operand.length > 2 ? this.computeExpression(operand[2], document) : undefined
          return length !== undefined ? str.substr(start, length) : str.substr(start)
        }
        return ''

      case '$size':
        const arr = this.computeExpression(operand, document)
        return Array.isArray(arr) ? arr.length : 0

      case '$type':
        const value = this.computeExpression(operand, document)
        return this.getValueType(value)

      case '$cond':
        if (typeof operand === 'object' && operand.if && operand.then && operand.else) {
          const condition = this.computeExpression(operand.if, document)
          return condition ? 
            this.computeExpression(operand.then, document) : 
            this.computeExpression(operand.else, document)
        }
        return null

      default:
        return operand
    }
  }

  getValueType(value) {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    if (value instanceof Date) return 'date'
    return typeof value
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
}

class GroupStage extends AggregationStage {
  constructor(groupSpec) {
    super('$group', { groupSpec })
    this.groupSpec = groupSpec
  }

  execute(documents) {
    const groups = new Map()

    // Group documents
    for (const doc of documents) {
      const groupKey = this.computeGroupKey(doc, this.groupSpec._id)
      const keyString = JSON.stringify(groupKey)

      if (!groups.has(keyString)) {
        groups.set(keyString, {
          _id: groupKey,
          documents: [],
          accumulators: {}
        })
      }

      groups.get(keyString).documents.push(doc)
    }

    // Apply accumulators
    const results = []
    for (const group of groups.values()) {
      const result = { _id: group._id }

      for (const [field, accumulator] of Object.entries(this.groupSpec)) {
        if (field !== '_id') {
          result[field] = this.applyAccumulator(accumulator, group.documents)
        }
      }

      results.push(result)
    }

    return results
  }

  computeGroupKey(document, keyExpression) {
    if (keyExpression === null) {
      return null
    }

    if (typeof keyExpression === 'string' && keyExpression.startsWith('$')) {
      // Field reference
      return this.getNestedFieldValue(document, keyExpression.substring(1))
    }

    if (typeof keyExpression === 'object' && keyExpression !== null) {
      const result = {}
      for (const [key, expr] of Object.entries(keyExpression)) {
        result[key] = this.computeGroupKey(document, expr)
      }
      return result
    }

    return keyExpression
  }

  applyAccumulator(accumulator, documents) {
    if (typeof accumulator !== 'object' || accumulator === null) {
      return accumulator
    }

    for (const [operator, operand] of Object.entries(accumulator)) {
      return this.evaluateAccumulator(operator, operand, documents)
    }

    return null
  }

  evaluateAccumulator(operator, operand, documents) {
    switch (operator) {
      case '$sum':
        if (operand === 1) {
          return documents.length
        }
        return documents.reduce((sum, doc) => {
          const value = this.getFieldValue(doc, operand)
          return sum + (typeof value === 'number' ? value : 0)
        }, 0)

      case '$avg':
        const values = documents.map(doc => this.getFieldValue(doc, operand))
          .filter(val => typeof val === 'number')
        return values.length > 0 ? values.reduce((sum, val) => sum + val, 0) / values.length : 0

      case '$min':
        const minValues = documents.map(doc => this.getFieldValue(doc, operand))
          .filter(val => val !== undefined && val !== null)
        return minValues.length > 0 ? Math.min(...minValues) : null

      case '$max':
        const maxValues = documents.map(doc => this.getFieldValue(doc, operand))
          .filter(val => val !== undefined && val !== null)
        return maxValues.length > 0 ? Math.max(...maxValues) : null

      case '$first':
        return documents.length > 0 ? this.getFieldValue(documents[0], operand) : null

      case '$last':
        return documents.length > 0 ? this.getFieldValue(documents[documents.length - 1], operand) : null

      case '$push':
        return documents.map(doc => this.getFieldValue(doc, operand))

      case '$addToSet':
        const uniqueValues = new Set()
        for (const doc of documents) {
          const value = this.getFieldValue(doc, operand)
          if (value !== undefined) {
            uniqueValues.add(JSON.stringify(value))
          }
        }
        return Array.from(uniqueValues).map(val => JSON.parse(val))

      case '$count':
        return documents.length

      default:
        return null
    }
  }

  getFieldValue(document, fieldExpression) {
    if (typeof fieldExpression === 'string' && fieldExpression.startsWith('$')) {
      return this.getNestedFieldValue(document, fieldExpression.substring(1))
    }
    return fieldExpression
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
}

class SortStage extends AggregationStage {
  constructor(sortSpec) {
    super('$sort', { sortSpec })
    this.sortSpec = sortSpec
  }

  execute(documents) {
    return documents.sort((a, b) => {
      for (const [field, direction] of Object.entries(this.sortSpec)) {
        const aValue = this.getNestedFieldValue(a, field)
        const bValue = this.getNestedFieldValue(b, field)
        
        let comparison = this.compareValues(aValue, bValue)

        if (comparison !== 0) {
          return direction === -1 ? -comparison : comparison
        }
      }

      return 0
    })
  }

  compareValues(a, b) {
    if (a === null || a === undefined) {
      if (b === null || b === undefined) return 0
      return -1
    }
    if (b === null || b === undefined) return 1

    if (typeof a !== typeof b) {
      a = String(a)
      b = String(b)
    }

    if (a < b) return -1
    if (a > b) return 1
    return 0
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
}

class LimitStage extends AggregationStage {
  constructor(limit) {
    super('$limit', { limit })
    this.limit = limit
  }

  execute(documents) {
    return documents.slice(0, this.limit)
  }
}

class SkipStage extends AggregationStage {
  constructor(skip) {
    super('$skip', { skip })
    this.skip = skip
  }

  execute(documents) {
    return documents.slice(this.skip)
  }
}

class UnwindStage extends AggregationStage {
  constructor(field, options = {}) {
    super('$unwind', { field, options })
    this.field = field.startsWith('$') ? field.substring(1) : field
    this.preserveNullAndEmptyArrays = options.preserveNullAndEmptyArrays || false
  }

  execute(documents) {
    const results = []

    for (const doc of documents) {
      const arrayValue = this.getNestedFieldValue(doc, this.field)

      if (Array.isArray(arrayValue) && arrayValue.length > 0) {
        // Unwind array
        for (const item of arrayValue) {
          const newDoc = JSON.parse(JSON.stringify(doc))
          this.setNestedFieldValue(newDoc, this.field, item)
          results.push(newDoc)
        }
      } else if (this.preserveNullAndEmptyArrays) {
        // Preserve document with null/empty array
        const newDoc = JSON.parse(JSON.stringify(doc))
        this.setNestedFieldValue(newDoc, this.field, null)
        results.push(newDoc)
      }
      // Otherwise skip the document
    }

    return results
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
}

class AggregationPipeline {
  constructor(stages) {
    this.stages = this.parseStages(stages)
    this.stats = {
      stageCount: this.stages.length,
      created: new Date().toISOString()
    }
  }

  parseStages(stages) {
    return stages.map(stageSpec => {
      for (const [stageType, stageOptions] of Object.entries(stageSpec)) {
        return this.createStage(stageType, stageOptions)
      }
    }).filter(stage => stage !== null)
  }

  createStage(stageType, stageOptions) {
    switch (stageType) {
      case '$match':
        return new MatchStage(stageOptions)
      case '$project':
        return new ProjectStage(stageOptions)
      case '$group':
        return new GroupStage(stageOptions)
      case '$sort':
        return new SortStage(stageOptions)
      case '$limit':
        return new LimitStage(stageOptions)
      case '$skip':
        return new SkipStage(stageOptions)
      case '$unwind':
        return new UnwindStage(stageOptions.path || stageOptions, stageOptions)
      default:
        logger.warn(`Unknown aggregation stage: ${stageType}`)
        return null
    }
  }

  execute(documents) {
    let currentDocuments = [...documents] // Copy to avoid mutation
    const stageResults = []

    for (let i = 0; i < this.stages.length; i++) {
      const stage = this.stages[i]
      const startTime = process.hrtime.bigint()
      
      try {
        currentDocuments = stage.execute(currentDocuments)
        
        const endTime = process.hrtime.bigint()
        const executionTime = Number(endTime - startTime) / 1000000 // Convert to milliseconds

        stageResults.push({
          stage: stage.getStats(),
          inputCount: stageResults[i - 1]?.outputCount || documents.length,
          outputCount: currentDocuments.length,
          executionTime: `${executionTime.toFixed(2)}ms`
        })

        logger.debug(`Aggregation stage ${stage.type} completed`, {
          inputCount: stageResults[i].inputCount,
          outputCount: currentDocuments.length,
          executionTime: stageResults[i].executionTime
        })
      } catch (error) {
        throw new Error(`Stage ${stage.type} failed: ${error.message}`)
      }
    }

    return {
      documents: currentDocuments,
      stages: stageResults,
      totalStages: this.stages.length
    }
  }

  getStats() {
    return {
      ...this.stats,
      stages: this.stages.map(stage => stage.getStats())
    }
  }
}

class AggregationEngine {
  constructor(documentStore) {
    this.documentStore = documentStore
    logger.info('AggregationEngine initialized')
  }

  aggregate(collectionName, pipeline, options = {}) {
    const collectionResult = this.documentStore.getCollection(collectionName)
    if (!collectionResult.success) {
      return collectionResult
    }

    const collection = collectionResult.value

    try {
      const startTime = process.hrtime.bigint()
      
      // Get all documents
      const documents = Array.from(collection.documents.values()).map(doc => doc.toJSON())
      
      // Create and execute pipeline
      const aggregationPipeline = new AggregationPipeline(pipeline)
      const result = aggregationPipeline.execute(documents)
      
      const endTime = process.hrtime.bigint()
      const totalExecutionTime = Number(endTime - startTime) / 1000000

      logger.info('Aggregation completed', {
        collection: collectionName,
        inputDocuments: documents.length,
        outputDocuments: result.documents.length,
        stages: result.totalStages,
        executionTime: `${totalExecutionTime.toFixed(2)}ms`
      })

      return {
        success: true,
        value: {
          documents: result.documents,
          stats: {
            inputDocuments: documents.length,
            outputDocuments: result.documents.length,
            totalExecutionTime: `${totalExecutionTime.toFixed(2)}ms`,
            stages: result.stages
          }
        }
      }
    } catch (error) {
      logger.error('Aggregation failed', {
        collection: collectionName,
        pipeline,
        error: error.message
      })

      return { success: false, error: error.message }
    }
  }

  count(collectionName, query = {}) {
    const pipeline = []
    
    if (Object.keys(query).length > 0) {
      pipeline.push({ $match: query })
    }
    
    pipeline.push({ $group: { _id: null, count: { $sum: 1 } } })

    const result = this.aggregate(collectionName, pipeline)
    
    if (!result.success) {
      return result
    }

    const count = result.value.documents.length > 0 ? result.value.documents[0].count : 0
    
    return {
      success: true,
      value: count
    }
  }

  distinct(collectionName, field, query = {}) {
    const pipeline = []
    
    if (Object.keys(query).length > 0) {
      pipeline.push({ $match: query })
    }
    
    pipeline.push(
      { $group: { _id: `$${field}` } },
      { $sort: { _id: 1 } }
    )

    const result = this.aggregate(collectionName, pipeline)
    
    if (!result.success) {
      return result
    }

    const distinctValues = result.value.documents.map(doc => doc._id)
    
    return {
      success: true,
      value: distinctValues
    }
  }

  getStats(collectionName) {
    const collectionResult = this.documentStore.getCollection(collectionName)
    if (!collectionResult.success) {
      return collectionResult
    }

    const collection = collectionResult.value
    const collectionStats = collection.getStats()

    // Calculate field statistics
    const documents = Array.from(collection.documents.values()).map(doc => doc.toJSON())
    const fieldStats = this.calculateFieldStatistics(documents)

    return {
      success: true,
      value: {
        collection: collectionStats,
        fields: fieldStats,
        capabilities: {
          aggregationStages: ['$match', '$project', '$group', '$sort', '$limit', '$skip', '$unwind'],
          groupOperators: ['$sum', '$avg', '$min', '$max', '$first', '$last', '$push', '$addToSet', '$count'],
          projectOperators: ['$add', '$subtract', '$multiply', '$divide', '$concat', '$substr', '$size', '$type', '$cond']
        }
      }
    }
  }

  calculateFieldStatistics(documents) {
    const fieldStats = {}
    
    for (const doc of documents) {
      this.analyzeDocumentFields(doc, fieldStats)
    }

    // Calculate percentages and finalize stats
    const totalDocs = documents.length
    for (const [field, stats] of Object.entries(fieldStats)) {
      stats.coverage = totalDocs > 0 ? (stats.count / totalDocs) * 100 : 0
      
      if (stats.numericValues.length > 0) {
        stats.numeric = {
          count: stats.numericValues.length,
          min: Math.min(...stats.numericValues),
          max: Math.max(...stats.numericValues),
          avg: stats.numericValues.reduce((sum, val) => sum + val, 0) / stats.numericValues.length
        }
      }
      
      delete stats.numericValues // Remove temporary array
    }

    return fieldStats
  }

  analyzeDocumentFields(obj, fieldStats, prefix = '') {
    for (const [key, value] of Object.entries(obj)) {
      const fieldPath = prefix ? `${prefix}.${key}` : key
      
      if (!fieldStats[fieldPath]) {
        fieldStats[fieldPath] = {
          count: 0,
          types: {},
          numericValues: []
        }
      }

      const stats = fieldStats[fieldPath]
      stats.count++

      const valueType = this.getValueType(value)
      stats.types[valueType] = (stats.types[valueType] || 0) + 1

      if (typeof value === 'number') {
        stats.numericValues.push(value)
      }

      // Recurse into nested objects
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        this.analyzeDocumentFields(value, fieldStats, fieldPath)
      }
    }
  }

  getValueType(value) {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    if (value instanceof Date) return 'date'
    return typeof value
  }
}

module.exports = { 
  AggregationEngine, 
  AggregationPipeline,
  MatchStage,
  ProjectStage,
  GroupStage,
  SortStage,
  LimitStage,
  SkipStage,
  UnwindStage
}
