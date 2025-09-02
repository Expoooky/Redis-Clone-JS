/**
 * Vector Store Implementation
 * Provides efficient storage and manipulation of high-dimensional vectors
 * Supports various distance metrics and vector operations
 */

const logger = require('../utils/Logger')

/**
 * Vector class for storing vector data with metadata
 */
class Vector {
  constructor(id, data, metadata = {}) {
    this.id = id
    this.data = this.validateAndNormalize(data)
    this.metadata = metadata
    this.magnitude = null // Cached magnitude for cosine similarity
  }

  /**
   * Validate and normalize vector data
   * @param {Array|Float32Array} data - Vector data
   * @returns {Float32Array} Normalized vector data
   */
  validateAndNormalize(data) {
    if (!Array.isArray(data) && !(data instanceof Float32Array)) {
      throw new Error('Vector data must be an array or Float32Array')
    }

    if (data.length === 0) {
      throw new Error('Vector cannot be empty')
    }

    // Convert to Float32Array for consistent representation and performance
    const floatArray = new Float32Array(data.length)
    for (let i = 0; i < data.length; i++) {
      const value = Number(data[i])
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid vector component at index ${i}: ${data[i]}`)
      }
      floatArray[i] = value
    }

    return floatArray
  }

  /**
   * Get vector dimensions
   * @returns {number} Number of dimensions
   */
  getDimensions() {
    return this.data.length
  }

  /**
   * Calculate and cache magnitude for cosine similarity
   * @returns {number} Vector magnitude
   */
  getMagnitude() {
    if (this.magnitude === null) {
      let sum = 0
      for (let i = 0; i < this.data.length; i++) {
        sum += this.data[i] * this.data[i]
      }
      this.magnitude = Math.sqrt(sum)
    }
    return this.magnitude
  }

  /**
   * Normalize vector to unit length
   * @returns {Vector} New normalized vector
   */
  normalize() {
    const magnitude = this.getMagnitude()
    if (magnitude === 0) {
      throw new Error('Cannot normalize zero vector')
    }

    const normalizedData = new Float32Array(this.data.length)
    for (let i = 0; i < this.data.length; i++) {
      normalizedData[i] = this.data[i] / magnitude
    }

    return new Vector(this.id, normalizedData, { ...this.metadata })
  }

  /**
   * Convert vector to array
   * @returns {Array} Vector as regular array
   */
  toArray() {
    return Array.from(this.data)
  }

  /**
   * Create a copy of the vector
   * @returns {Vector} Cloned vector
   */
  clone() {
    return new Vector(this.id, new Float32Array(this.data), { ...this.metadata })
  }
}

/**
 * Vector mathematics utilities
 */
class VectorMath {
  /**
   * Calculate Euclidean distance between two vectors
   * @param {Vector|Float32Array} v1 - First vector
   * @param {Vector|Float32Array} v2 - Second vector
   * @returns {number} Euclidean distance
   */
  static euclideanDistance(v1, v2) {
    const data1 = v1 instanceof Vector ? v1.data : v1
    const data2 = v2 instanceof Vector ? v2.data : v2

    if (data1.length !== data2.length) {
      throw new Error('Vectors must have same dimensions')
    }

    let sum = 0
    for (let i = 0; i < data1.length; i++) {
      const diff = data1[i] - data2[i]
      sum += diff * diff
    }

    return Math.sqrt(sum)
  }

  /**
   * Calculate cosine similarity between two vectors
   * @param {Vector|Float32Array} v1 - First vector
   * @param {Vector|Float32Array} v2 - Second vector
   * @returns {number} Cosine similarity (-1 to 1)
   */
  static cosineSimilarity(v1, v2) {
    const data1 = v1 instanceof Vector ? v1.data : v1
    const data2 = v2 instanceof Vector ? v2.data : v2

    if (data1.length !== data2.length) {
      throw new Error('Vectors must have same dimensions')
    }

    let dotProduct = 0
    let magnitude1 = 0
    let magnitude2 = 0

    for (let i = 0; i < data1.length; i++) {
      dotProduct += data1[i] * data2[i]
      magnitude1 += data1[i] * data1[i]
      magnitude2 += data2[i] * data2[i]
    }

    magnitude1 = Math.sqrt(magnitude1)
    magnitude2 = Math.sqrt(magnitude2)

    if (magnitude1 === 0 || magnitude2 === 0) {
      return 0
    }

    return dotProduct / (magnitude1 * magnitude2)
  }

  /**
   * Calculate cosine distance (1 - cosine similarity)
   * @param {Vector|Float32Array} v1 - First vector
   * @param {Vector|Float32Array} v2 - Second vector
   * @returns {number} Cosine distance (0 to 2)
   */
  static cosineDistance(v1, v2) {
    return 1 - this.cosineSimilarity(v1, v2)
  }

  /**
   * Calculate Manhattan distance between two vectors
   * @param {Vector|Float32Array} v1 - First vector
   * @param {Vector|Float32Array} v2 - Second vector
   * @returns {number} Manhattan distance
   */
  static manhattanDistance(v1, v2) {
    const data1 = v1 instanceof Vector ? v1.data : v1
    const data2 = v2 instanceof Vector ? v2.data : v2

    if (data1.length !== data2.length) {
      throw new Error('Vectors must have same dimensions')
    }

    let sum = 0
    for (let i = 0; i < data1.length; i++) {
      sum += Math.abs(data1[i] - data2[i])
    }

    return sum
  }

  /**
   * Calculate dot product of two vectors
   * @param {Vector|Float32Array} v1 - First vector
   * @param {Vector|Float32Array} v2 - Second vector
   * @returns {number} Dot product
   */
  static dotProduct(v1, v2) {
    const data1 = v1 instanceof Vector ? v1.data : v1
    const data2 = v2 instanceof Vector ? v2.data : v2

    if (data1.length !== data2.length) {
      throw new Error('Vectors must have same dimensions')
    }

    let sum = 0
    for (let i = 0; i < data1.length; i++) {
      sum += data1[i] * data2[i]
    }

    return sum
  }

  /**
   * Add two vectors
   * @param {Vector|Float32Array} v1 - First vector
   * @param {Vector|Float32Array} v2 - Second vector
   * @returns {Float32Array} Result vector
   */
  static add(v1, v2) {
    const data1 = v1 instanceof Vector ? v1.data : v1
    const data2 = v2 instanceof Vector ? v2.data : v2

    if (data1.length !== data2.length) {
      throw new Error('Vectors must have same dimensions')
    }

    const result = new Float32Array(data1.length)
    for (let i = 0; i < data1.length; i++) {
      result[i] = data1[i] + data2[i]
    }

    return result
  }

  /**
   * Subtract two vectors
   * @param {Vector|Float32Array} v1 - First vector
   * @param {Vector|Float32Array} v2 - Second vector
   * @returns {Float32Array} Result vector
   */
  static subtract(v1, v2) {
    const data1 = v1 instanceof Vector ? v1.data : v1
    const data2 = v2 instanceof Vector ? v2.data : v2

    if (data1.length !== data2.length) {
      throw new Error('Vectors must have same dimensions')
    }

    const result = new Float32Array(data1.length)
    for (let i = 0; i < data1.length; i++) {
      result[i] = data1[i] - data2[i]
    }

    return result
  }

  /**
   * Multiply vector by scalar
   * @param {Vector|Float32Array} v - Vector
   * @param {number} scalar - Scalar value
   * @returns {Float32Array} Result vector
   */
  static multiplyScalar(v, scalar) {
    const data = v instanceof Vector ? v.data : v
    const result = new Float32Array(data.length)
    
    for (let i = 0; i < data.length; i++) {
      result[i] = data[i] * scalar
    }

    return result
  }
}

/**
 * Vector Store implementation
 */
class VectorStore {
  constructor(options = {}) {
    this.vectors = new Map() // id -> Vector
    this.dimensions = options.dimensions || null // Fixed dimensions (null = auto-detect)
    this.distanceMetric = options.distanceMetric || 'euclidean' // euclidean, cosine, manhattan
    this.normalized = options.normalized || false // Whether vectors should be normalized
    this.metadata = options.metadata || {} // Store-level metadata
    
    logger.debug('VectorStore created', {
      dimensions: this.dimensions,
      distanceMetric: this.distanceMetric,
      normalized: this.normalized
    })
  }

  /**
   * Add a vector to the store
   * @param {string} id - Vector ID
   * @param {Array|Float32Array} data - Vector data
   * @param {Object} metadata - Vector metadata
   * @returns {Object} Result with success status
   */
  addVector(id, data, metadata = {}) {
    try {
      let vector = new Vector(id, data, metadata)

      // Validate dimensions
      if (this.dimensions === null) {
        this.dimensions = vector.getDimensions()
      } else if (vector.getDimensions() !== this.dimensions) {
        return { 
          success: false, 
          error: `ERR Vector dimension mismatch. Expected ${this.dimensions}, got ${vector.getDimensions()}` 
        }
      }

      // Normalize if required
      if (this.normalized) {
        vector = vector.normalize()
      }

      this.vectors.set(id, vector)

      logger.debug('Vector added to store', {
        id,
        dimensions: vector.getDimensions(),
        magnitude: vector.getMagnitude()
      })

      return { success: true, value: id }
    } catch (error) {
      return { success: false, error: `ERR ${error.message}` }
    }
  }

  /**
   * Get a vector by ID
   * @param {string} id - Vector ID
   * @returns {Vector|null} Vector or null if not found
   */
  getVector(id) {
    return this.vectors.get(id) || null
  }

  /**
   * Remove a vector by ID
   * @param {string} id - Vector ID
   * @returns {boolean} True if removed, false if not found
   */
  removeVector(id) {
    return this.vectors.delete(id)
  }

  /**
   * Check if vector exists
   * @param {string} id - Vector ID
   * @returns {boolean} True if exists
   */
  hasVector(id) {
    return this.vectors.has(id)
  }

  /**
   * Get all vector IDs
   * @returns {Array} Array of vector IDs
   */
  getVectorIds() {
    return Array.from(this.vectors.keys())
  }

  /**
   * Get number of vectors in store
   * @returns {number} Vector count
   */
  getVectorCount() {
    return this.vectors.size
  }

  /**
   * Calculate distance between two vectors
   * @param {string} id1 - First vector ID
   * @param {string} id2 - Second vector ID
   * @param {string} metric - Distance metric (optional, uses store default)
   * @returns {number|null} Distance or null if vectors not found
   */
  calculateDistance(id1, id2, metric = null) {
    const v1 = this.getVector(id1)
    const v2 = this.getVector(id2)

    if (!v1 || !v2) {
      return null
    }

    const distanceMetric = metric || this.distanceMetric

    switch (distanceMetric.toLowerCase()) {
      case 'euclidean':
        return VectorMath.euclideanDistance(v1, v2)
      case 'cosine':
        return VectorMath.cosineDistance(v1, v2)
      case 'manhattan':
        return VectorMath.manhattanDistance(v1, v2)
      default:
        throw new Error(`Unknown distance metric: ${distanceMetric}`)
    }
  }

  /**
   * Find k nearest neighbors to a query vector
   * @param {Array|Float32Array} queryVector - Query vector
   * @param {number} k - Number of neighbors to find
   * @param {string} metric - Distance metric (optional)
   * @returns {Array} Array of {id, distance} objects sorted by distance
   */
  findKNearestNeighbors(queryVector, k = 10, metric = null) {
    if (this.vectors.size === 0) {
      return []
    }

    const query = new Vector('query', queryVector)
    if (this.normalized) {
      query = query.normalize()
    }

    const distanceMetric = metric || this.distanceMetric
    const distances = []

    for (const [id, vector] of this.vectors) {
      let distance
      
      switch (distanceMetric.toLowerCase()) {
        case 'euclidean':
          distance = VectorMath.euclideanDistance(query, vector)
          break
        case 'cosine':
          distance = VectorMath.cosineDistance(query, vector)
          break
        case 'manhattan':
          distance = VectorMath.manhattanDistance(query, vector)
          break
        default:
          throw new Error(`Unknown distance metric: ${distanceMetric}`)
      }

      distances.push({ id, distance, vector })
    }

    // Sort by distance and return top k
    distances.sort((a, b) => a.distance - b.distance)
    return distances.slice(0, k).map(item => ({
      id: item.id,
      distance: item.distance,
      metadata: item.vector.metadata
    }))
  }

  /**
   * Find vectors within a certain distance of query vector
   * @param {Array|Float32Array} queryVector - Query vector
   * @param {number} maxDistance - Maximum distance threshold
   * @param {string} metric - Distance metric (optional)
   * @returns {Array} Array of {id, distance} objects
   */
  findWithinDistance(queryVector, maxDistance, metric = null) {
    const allNeighbors = this.findKNearestNeighbors(queryVector, this.vectors.size, metric)
    return allNeighbors.filter(neighbor => neighbor.distance <= maxDistance)
  }

  /**
   * Perform vector arithmetic operation
   * @param {string} operation - Operation type ('add', 'subtract', 'multiply')
   * @param {string} id1 - First vector ID
   * @param {string|number} id2OrScalar - Second vector ID or scalar value
   * @returns {Float32Array|null} Result vector or null if error
   */
  vectorOperation(operation, id1, id2OrScalar) {
    const v1 = this.getVector(id1)
    if (!v1) {
      return null
    }

    switch (operation.toLowerCase()) {
      case 'add':
        const v2Add = this.getVector(id2OrScalar)
        if (!v2Add) return null
        return VectorMath.add(v1, v2Add)
        
      case 'subtract':
        const v2Sub = this.getVector(id2OrScalar)
        if (!v2Sub) return null
        return VectorMath.subtract(v1, v2Sub)
        
      case 'multiply':
        const scalar = Number(id2OrScalar)
        if (!Number.isFinite(scalar)) return null
        return VectorMath.multiplyScalar(v1, scalar)
        
      default:
        return null
    }
  }

  /**
   * Get store statistics
   * @returns {Object} Store statistics
   */
  getStats() {
    const vectorCount = this.getVectorCount()
    let totalMemory = 0
    
    for (const vector of this.vectors.values()) {
      // Estimate memory: Float32Array + metadata + overhead
      totalMemory += vector.data.byteLength + 128 // 128 bytes overhead estimate
    }

    return {
      vectorCount,
      dimensions: this.dimensions,
      distanceMetric: this.distanceMetric,
      normalized: this.normalized,
      estimatedMemoryBytes: totalMemory,
      metadata: this.metadata
    }
  }

  /**
   * Clear all vectors
   */
  clear() {
    this.vectors.clear()
    this.dimensions = null
    logger.debug('VectorStore cleared')
  }

  /**
   * Export vectors to JSON
   * @returns {Object} Serialized store data
   */
  toJSON() {
    const vectorData = {}
    for (const [id, vector] of this.vectors) {
      vectorData[id] = {
        data: Array.from(vector.data),
        metadata: vector.metadata
      }
    }

    return {
      vectors: vectorData,
      dimensions: this.dimensions,
      distanceMetric: this.distanceMetric,
      normalized: this.normalized,
      metadata: this.metadata
    }
  }

  /**
   * Import vectors from JSON
   * @param {Object} data - Serialized store data
   * @returns {Object} Result with success status
   */
  fromJSON(data) {
    try {
      this.clear()
      this.dimensions = data.dimensions
      this.distanceMetric = data.distanceMetric || 'euclidean'
      this.normalized = data.normalized || false
      this.metadata = data.metadata || {}

      for (const [id, vectorData] of Object.entries(data.vectors)) {
        const result = this.addVector(id, vectorData.data, vectorData.metadata)
        if (!result.success) {
          return result
        }
      }

      return { success: true, vectorCount: this.getVectorCount() }
    } catch (error) {
      return { success: false, error: `ERR ${error.message}` }
    }
  }
}

module.exports = { VectorStore, Vector, VectorMath }
