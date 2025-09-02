/**
 * Vector Operations Module
 * Implements Redis-like vector database commands for storing and searching high-dimensional vectors
 * Combines VectorStore and HNSW index for efficient similarity search
 */

const { VectorStore, Vector, VectorMath } = require('./VectorStore')
const { HNSWIndex } = require('./SimilaritySearch')
const logger = require('../utils/Logger')

/**
 * Vector Database class combining storage and indexing
 */
class VectorDatabase {
  constructor(options = {}) {
    this.store = new VectorStore(options)
    this.index = new HNSWIndex(options)
    this.indexed = options.indexed !== false // Default to indexed
    this.metadata = options.metadata || {}
    
    logger.debug('VectorDatabase created', {
      indexed: this.indexed,
      dimensions: this.store.dimensions,
      distanceMetric: this.store.distanceMetric
    })
  }

  /**
   * Add vector to database
   * @param {string} id - Vector ID
   * @param {Array|Float32Array} data - Vector data
   * @param {Object} metadata - Vector metadata
   * @returns {Object} Result with success status
   */
  addVector(id, data, metadata = {}) {
    // Add to store
    const storeResult = this.store.addVector(id, data, metadata)
    if (!storeResult.success) {
      return storeResult
    }

    // Add to index if indexing is enabled
    if (this.indexed) {
      const vector = this.store.getVector(id)
      const indexResult = this.index.addVector(id, vector)
      if (!indexResult.success) {
        // Remove from store if index addition failed
        this.store.removeVector(id)
        return indexResult
      }
    }

    return storeResult
  }

  /**
   * Get vector by ID
   * @param {string} id - Vector ID
   * @returns {Vector|null} Vector or null if not found
   */
  getVector(id) {
    return this.store.getVector(id)
  }

  /**
   * Remove vector from database
   * @param {string} id - Vector ID
   * @returns {boolean} True if removed
   */
  removeVector(id) {
    const storeRemoved = this.store.removeVector(id)
    
    if (this.indexed && storeRemoved) {
      this.index.removeVector(id)
    }
    
    return storeRemoved
  }

  /**
   * Search for similar vectors
   * @param {Array|Float32Array} queryVector - Query vector
   * @param {number} k - Number of results
   * @param {Object} options - Search options
   * @returns {Array} Search results
   */
  search(queryVector, k = 10, options = {}) {
    if (this.indexed) {
      // Use HNSW index for fast search
      return this.index.search(queryVector, k, options.searchListSize)
    } else {
      // Use brute force search from store
      return this.store.findKNearestNeighbors(queryVector, k, options.metric)
    }
  }

  /**
   * Get database statistics
   * @returns {Object} Database statistics
   */
  getStats() {
    const storeStats = this.store.getStats()
    const indexStats = this.indexed ? this.index.getStats() : null
    
    return {
      ...storeStats,
      indexed: this.indexed,
      index: indexStats
    }
  }

  /**
   * Clear the database
   */
  clear() {
    this.store.clear()
    if (this.indexed) {
      this.index.clear()
    }
  }
}

/**
 * Vector Operations for Redis-like commands
 */
class VectorOps {
  constructor(dataStore) {
    this.dataStore = dataStore
    logger.info('VectorOps module initialized')
  }

  /**
   * Ensure key holds a vector database
   * @param {string} key - Key to check/create
   * @param {Object} options - Creation options
   * @returns {Object} Result with vector database or error
   */
  ensureVectorDatabase(key, options = {}) {
    const result = this.dataStore.get(key)
    
    if (!result.success) {
      return result
    }

    if (result.value === null) {
      // Key doesn't exist, will be created on first operation
      return { 
        success: true, 
        value: new VectorDatabase(options), 
        exists: false 
      }
    }

    if (!(result.value instanceof VectorDatabase)) {
      return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
    }

    return { success: true, value: result.value, exists: true }
  }

  /**
   * VECTOR.ADD command - Add vector to database
   * @param {string} key - Vector database key
   * @param {string} vectorId - Vector ID
   * @param {Array} vectorData - Vector data
   * @param {Object} options - Add options
   * @returns {Object} Result with success status
   */
  vectorAdd(key, vectorId, vectorData, options = {}) {
    if (!Array.isArray(vectorData) || vectorData.length === 0) {
      return { success: false, error: 'ERR invalid vector data' }
    }

    const dbResult = this.ensureVectorDatabase(key, options)
    if (!dbResult.success) {
      return dbResult
    }

    const vectorDb = dbResult.value
    const addResult = vectorDb.addVector(vectorId, vectorData, options.metadata || {})
    
    if (!addResult.success) {
      return addResult
    }

    // Save the vector database
    const setResult = this.dataStore.set(key, vectorDb)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('VECTOR.ADD executed', { 
      key, 
      vectorId, 
      dimensions: vectorData.length 
    })

    return { success: true, value: vectorId }
  }

  /**
   * VECTOR.GET command - Get vector by ID
   * @param {string} key - Vector database key
   * @param {string} vectorId - Vector ID
   * @param {Object} options - Get options
   * @returns {Object} Result with vector data
   */
  vectorGet(key, vectorId, options = {}) {
    const dbResult = this.ensureVectorDatabase(key)
    if (!dbResult.success) {
      return dbResult
    }

    if (!dbResult.exists) {
      return { success: true, value: null }
    }

    const vector = dbResult.value.getVector(vectorId)
    if (!vector) {
      return { success: true, value: null }
    }

    let result = {
      id: vector.id,
      data: vector.toArray()
    }

    if (options.withMetadata) {
      result.metadata = vector.metadata
    }

    logger.debug('VECTOR.GET executed', { key, vectorId })
    return { success: true, value: result }
  }

  /**
   * VECTOR.DEL command - Delete vector from database
   * @param {string} key - Vector database key
   * @param {Array} vectorIds - Vector IDs to delete
   * @returns {Object} Result with number of deleted vectors
   */
  vectorDel(key, vectorIds) {
    if (!Array.isArray(vectorIds) || vectorIds.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments' }
    }

    const dbResult = this.ensureVectorDatabase(key)
    if (!dbResult.success) {
      return dbResult
    }

    if (!dbResult.exists) {
      return { success: true, value: 0 }
    }

    const vectorDb = dbResult.value
    let deletedCount = 0

    for (const vectorId of vectorIds) {
      if (vectorDb.removeVector(vectorId)) {
        deletedCount++
      }
    }

    // Save the vector database
    const setResult = this.dataStore.set(key, vectorDb)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('VECTOR.DEL executed', { 
      key, 
      requestedCount: vectorIds.length, 
      deletedCount 
    })

    return { success: true, value: deletedCount }
  }

  /**
   * VECTOR.SEARCH command - Search for similar vectors
   * @param {string} key - Vector database key
   * @param {Array} queryVector - Query vector
   * @param {number} k - Number of results
   * @param {Object} options - Search options
   * @returns {Object} Result with search results
   */
  vectorSearch(key, queryVector, k = 10, options = {}) {
    if (!Array.isArray(queryVector) || queryVector.length === 0) {
      return { success: false, error: 'ERR invalid query vector' }
    }

    if (k <= 0) {
      return { success: false, error: 'ERR k must be positive' }
    }

    const dbResult = this.ensureVectorDatabase(key)
    if (!dbResult.success) {
      return dbResult
    }

    if (!dbResult.exists) {
      return { success: true, value: [] }
    }

    const vectorDb = dbResult.value
    
    try {
      const results = vectorDb.search(queryVector, k, options)
      
      // Format results based on options
      const formattedResults = results.map(result => {
        const output = [result.id, result.distance.toString()]
        
        if (options.withVectors) {
          const vector = vectorDb.getVector(result.id)
          if (vector) {
            output.push(vector.toArray())
          }
        }
        
        if (options.withMetadata && result.metadata) {
          output.push(result.metadata)
        }
        
        return output
      })

      logger.debug('VECTOR.SEARCH executed', { 
        key, 
        queryDimensions: queryVector.length, 
        k, 
        resultCount: formattedResults.length 
      })

      return { success: true, value: formattedResults }
    } catch (error) {
      return { success: false, error: `ERR ${error.message}` }
    }
  }

  /**
   * VECTOR.RANGE command - Find vectors within distance range
   * @param {string} key - Vector database key
   * @param {Array} queryVector - Query vector
   * @param {number} maxDistance - Maximum distance
   * @param {Object} options - Search options
   * @returns {Object} Result with vectors in range
   */
  vectorRange(key, queryVector, maxDistance, options = {}) {
    if (!Array.isArray(queryVector) || queryVector.length === 0) {
      return { success: false, error: 'ERR invalid query vector' }
    }

    if (maxDistance <= 0) {
      return { success: false, error: 'ERR maxDistance must be positive' }
    }

    const dbResult = this.ensureVectorDatabase(key)
    if (!dbResult.success) {
      return dbResult
    }

    if (!dbResult.exists) {
      return { success: true, value: [] }
    }

    const vectorDb = dbResult.value
    
    try {
      const results = vectorDb.store.findWithinDistance(queryVector, maxDistance, options.metric)
      
      // Format results
      const formattedResults = results.map(result => [result.id, result.distance.toString()])

      logger.debug('VECTOR.RANGE executed', { 
        key, 
        maxDistance, 
        resultCount: formattedResults.length 
      })

      return { success: true, value: formattedResults }
    } catch (error) {
      return { success: false, error: `ERR ${error.message}` }
    }
  }

  /**
   * VECTOR.INFO command - Get vector database information
   * @param {string} key - Vector database key
   * @returns {Object} Result with database information
   */
  vectorInfo(key) {
    const dbResult = this.ensureVectorDatabase(key)
    if (!dbResult.success) {
      return dbResult
    }

    if (!dbResult.exists) {
      return { success: false, error: 'ERR key does not exist' }
    }

    const stats = dbResult.value.getStats()
    
    // Format as array for Redis compatibility
    const result = [
      'vectorCount', stats.vectorCount,
      'dimensions', stats.dimensions,
      'distanceMetric', stats.distanceMetric,
      'normalized', stats.normalized,
      'indexed', stats.indexed,
      'estimatedMemoryBytes', stats.estimatedMemoryBytes
    ]

    if (stats.indexed && stats.index) {
      result.push(
        'indexStats', [
          'nodeCount', stats.index.nodeCount,
          'maxLevel', stats.index.maxLevel,
          'avgConnections', stats.index.avgConnections.toFixed(2),
          'entryPoint', stats.index.entryPoint
        ]
      )
    }

    logger.debug('VECTOR.INFO executed', { key })
    return { success: true, value: result }
  }

  /**
   * VECTOR.DISTANCE command - Calculate distance between two vectors
   * @param {string} key - Vector database key
   * @param {string} vectorId1 - First vector ID
   * @param {string} vectorId2 - Second vector ID
   * @param {string} metric - Distance metric (optional)
   * @returns {Object} Result with distance
   */
  vectorDistance(key, vectorId1, vectorId2, metric = null) {
    const dbResult = this.ensureVectorDatabase(key)
    if (!dbResult.success) {
      return dbResult
    }

    if (!dbResult.exists) {
      return { success: false, error: 'ERR key does not exist' }
    }

    const distance = dbResult.value.store.calculateDistance(vectorId1, vectorId2, metric)
    if (distance === null) {
      return { success: false, error: 'ERR one or both vectors not found' }
    }

    logger.debug('VECTOR.DISTANCE executed', { 
      key, 
      vectorId1, 
      vectorId2, 
      metric, 
      distance 
    })

    return { success: true, value: distance.toString() }
  }

  /**
   * VECTOR.MATH command - Perform vector math operations
   * @param {string} operation - Math operation (add, subtract, multiply, dot)
   * @param {Array} operands - Operation operands
   * @returns {Object} Result with computed value
   */
  vectorMath(operation, operands) {
    if (!Array.isArray(operands) || operands.length < 2) {
      return { success: false, error: 'ERR insufficient operands' }
    }

    try {
      let result

      switch (operation.toLowerCase()) {
        case 'add':
          if (operands.length !== 2) {
            return { success: false, error: 'ERR add requires exactly 2 vectors' }
          }
          result = VectorMath.add(operands[0], operands[1])
          break

        case 'subtract':
          if (operands.length !== 2) {
            return { success: false, error: 'ERR subtract requires exactly 2 vectors' }
          }
          result = VectorMath.subtract(operands[0], operands[1])
          break

        case 'multiply':
          if (operands.length !== 2) {
            return { success: false, error: 'ERR multiply requires vector and scalar' }
          }
          const scalar = Number(operands[1])
          if (!Number.isFinite(scalar)) {
            return { success: false, error: 'ERR invalid scalar value' }
          }
          result = VectorMath.multiplyScalar(operands[0], scalar)
          break

        case 'dot':
          if (operands.length !== 2) {
            return { success: false, error: 'ERR dot product requires exactly 2 vectors' }
          }
          result = VectorMath.dotProduct(operands[0], operands[1])
          break

        default:
          return { success: false, error: `ERR unknown operation: ${operation}` }
      }

      // Convert result to regular array if it's a vector (including Float32Array), keep as number if scalar
      let formattedResult
      if (Array.isArray(result) || result instanceof Float32Array || result instanceof Int32Array) {
        formattedResult = Array.from(result)
      } else {
        formattedResult = result
      }

      logger.debug('VECTOR.MATH executed', { operation, operandCount: operands.length })
      return { success: true, value: formattedResult }
    } catch (error) {
      return { success: false, error: `ERR ${error.message}` }
    }
  }

  /**
   * Helper method to validate if a value is a valid vector database
   * @param {*} value - Value to validate
   * @returns {boolean} True if valid vector database
   */
  isValidVectorDatabase(value) {
    return value instanceof VectorDatabase
  }
}

module.exports = { VectorOps, VectorDatabase }
