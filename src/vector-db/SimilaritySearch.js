/**
 * Similarity Search Implementation
 * Hierarchical Navigable Small World (HNSW) algorithm for efficient vector similarity search
 * Provides fast approximate nearest neighbor search for high-dimensional vectors
 */

const { VectorMath } = require('./VectorStore')
const logger = require('../utils/Logger')

/**
 * HNSW Node representing a vector in the graph
 */
class HNSWNode {
  constructor(id, vector, level = 0) {
    this.id = id
    this.vector = vector
    this.level = level
    this.connections = new Map() // level -> Set of connected node IDs
    
    // Initialize connections for each level
    for (let i = 0; i <= level; i++) {
      this.connections.set(i, new Set())
    }
  }

  /**
   * Add connection to another node at specific level
   * @param {string} nodeId - Target node ID
   * @param {number} level - Connection level
   */
  addConnection(nodeId, level) {
    if (level <= this.level && this.connections.has(level)) {
      this.connections.get(level).add(nodeId)
    }
  }

  /**
   * Remove connection to another node at specific level
   * @param {string} nodeId - Target node ID
   * @param {number} level - Connection level
   */
  removeConnection(nodeId, level) {
    if (this.connections.has(level)) {
      this.connections.get(level).delete(nodeId)
    }
  }

  /**
   * Get connections at specific level
   * @param {number} level - Level to get connections for
   * @returns {Set} Set of connected node IDs
   */
  getConnections(level) {
    return this.connections.get(level) || new Set()
  }

  /**
   * Get all connections across all levels
   * @returns {Set} Set of all connected node IDs
   */
  getAllConnections() {
    const allConnections = new Set()
    for (const connections of this.connections.values()) {
      for (const nodeId of connections) {
        allConnections.add(nodeId)
      }
    }
    return allConnections
  }
}

/**
 * Priority queue for maintaining candidate nodes during search
 */
class PriorityQueue {
  constructor(maxSize = Infinity, compareFunc = null) {
    this.items = []
    this.maxSize = maxSize
    this.compare = compareFunc || ((a, b) => a.distance - b.distance)
  }

  /**
   * Add item to queue
   * @param {Object} item - Item with {id, distance, ...}
   */
  enqueue(item) {
    this.items.push(item)
    this.items.sort(this.compare)
    
    // Maintain max size
    if (this.items.length > this.maxSize) {
      this.items.pop()
    }
  }

  /**
   * Remove and return item with highest priority
   * @returns {Object} Highest priority item
   */
  dequeue() {
    return this.items.shift()
  }

  /**
   * Check if queue is empty
   * @returns {boolean} True if empty
   */
  isEmpty() {
    return this.items.length === 0
  }

  /**
   * Get current size
   * @returns {number} Queue size
   */
  size() {
    return this.items.length
  }

  /**
   * Get all items as array
   * @returns {Array} All items sorted by priority
   */
  toArray() {
    return [...this.items]
  }

  /**
   * Clear the queue
   */
  clear() {
    this.items = []
  }
}

/**
 * HNSW Index for efficient similarity search
 */
class HNSWIndex {
  constructor(options = {}) {
    this.nodes = new Map() // id -> HNSWNode
    this.entryPoint = null // Entry point for search
    
    // HNSW parameters
    this.maxConnections = options.maxConnections || 16 // M parameter
    this.maxConnectionsLevel0 = options.maxConnectionsLevel0 || 32 // M_L parameter
    this.levelGenerationFactor = options.levelGenerationFactor || 1 / Math.log(2.0) // mL parameter
    this.searchListSize = options.searchListSize || 200 // ef parameter for construction
    this.distanceMetric = options.distanceMetric || 'euclidean'
    
    logger.debug('HNSW Index created', {
      maxConnections: this.maxConnections,
      maxConnectionsLevel0: this.maxConnectionsLevel0,
      levelGenerationFactor: this.levelGenerationFactor,
      distanceMetric: this.distanceMetric
    })
  }

  /**
   * Generate random level for new node
   * @returns {number} Level (0 to n)
   */
  generateRandomLevel() {
    let level = 0
    while (Math.random() < 1.0 / this.levelGenerationFactor && level < 16) {
      level++
    }
    return level
  }

  /**
   * Calculate distance between two vectors
   * @param {Object} vector1 - First vector
   * @param {Object} vector2 - Second vector
   * @returns {number} Distance
   */
  calculateDistance(vector1, vector2) {
    switch (this.distanceMetric.toLowerCase()) {
      case 'euclidean':
        return VectorMath.euclideanDistance(vector1, vector2)
      case 'cosine':
        return VectorMath.cosineDistance(vector1, vector2)
      case 'manhattan':
        return VectorMath.manhattanDistance(vector1, vector2)
      default:
        return VectorMath.euclideanDistance(vector1, vector2)
    }
  }

  /**
   * Add vector to the index
   * @param {string} id - Vector ID
   * @param {Object} vector - Vector object
   * @returns {Object} Result with success status
   */
  addVector(id, vector) {
    try {
      // Generate level for new node
      const level = this.generateRandomLevel()
      const newNode = new HNSWNode(id, vector, level)
      
      // If this is the first node, make it the entry point
      if (this.nodes.size === 0) {
        this.entryPoint = id
        this.nodes.set(id, newNode)
        
        logger.debug('First node added as entry point', { id, level })
        return { success: true, level }
      }

      // Search for entry points at each level from top to target level + 1
      let currentNearest = [{ id: this.entryPoint, distance: 0 }]
      const entryNode = this.nodes.get(this.entryPoint)
      
      // Start from entry point level down to level + 1
      for (let currentLevel = entryNode.level; currentLevel > level; currentLevel--) {
        currentNearest = this.searchLayer(vector, currentNearest, 1, currentLevel)
      }

      // Search and connect at each level from level down to 0
      for (let currentLevel = Math.min(level, entryNode.level); currentLevel >= 0; currentLevel--) {
        const candidates = this.searchLayer(vector, currentNearest, this.searchListSize, currentLevel)
        
        // Select neighbors for the new node
        const maxConnections = currentLevel === 0 ? this.maxConnectionsLevel0 : this.maxConnections
        const selectedNeighbors = this.selectNeighbors(candidates, maxConnections)
        
        // Add bidirectional connections
        for (const neighbor of selectedNeighbors) {
          newNode.addConnection(neighbor.id, currentLevel)
          const neighborNode = this.nodes.get(neighbor.id)
          if (neighborNode) {
            neighborNode.addConnection(id, currentLevel)
            
            // Prune connections if necessary
            this.pruneConnections(neighborNode, currentLevel)
          }
        }

        currentNearest = candidates
      }

      // Update entry point if new node has higher level
      if (level > entryNode.level) {
        this.entryPoint = id
      }

      this.nodes.set(id, newNode)
      
      logger.debug('Vector added to HNSW index', {
        id,
        level,
        totalNodes: this.nodes.size
      })

      return { success: true, level }
    } catch (error) {
      return { success: false, error: `ERR ${error.message}` }
    }
  }

  /**
   * Search for nearest neighbors
   * @param {Object} queryVector - Query vector
   * @param {number} k - Number of neighbors to find
   * @param {number} searchListSize - Size of dynamic search list
   * @returns {Array} Array of nearest neighbors
   */
  search(queryVector, k = 10, searchListSize = null) {
    if (this.nodes.size === 0 || !this.entryPoint) {
      return []
    }

    const ef = searchListSize || Math.max(this.searchListSize, k)
    const entryNode = this.nodes.get(this.entryPoint)
    
    // Start from entry point
    let currentNearest = [{
      id: this.entryPoint,
      distance: this.calculateDistance(queryVector, entryNode.vector)
    }]

    // Search from top level down to level 1
    for (let level = entryNode.level; level > 0; level--) {
      currentNearest = this.searchLayer(queryVector, currentNearest, 1, level)
    }

    // Search at level 0 with larger candidate list
    const finalCandidates = this.searchLayer(queryVector, currentNearest, ef, 0)
    
    // Return top k results
    return finalCandidates.slice(0, k)
  }

  /**
   * Search a single layer for nearest neighbors
   * @param {Object} queryVector - Query vector
   * @param {Array} entryPoints - Entry points for this layer
   * @param {number} numClosest - Number of closest points to return
   * @param {number} level - Layer level
   * @returns {Array} Nearest neighbors at this layer
   */
  searchLayer(queryVector, entryPoints, numClosest, level) {
    const visited = new Set()
    const candidates = new PriorityQueue(Infinity) // Min heap
    const dynamicList = new PriorityQueue(numClosest, (a, b) => b.distance - a.distance) // Max heap

    // Initialize with entry points
    for (const ep of entryPoints) {
      const distance = this.calculateDistance(queryVector, this.nodes.get(ep.id).vector)
      candidates.enqueue({ id: ep.id, distance })
      dynamicList.enqueue({ id: ep.id, distance })
      visited.add(ep.id)
    }

    while (!candidates.isEmpty()) {
      const current = candidates.dequeue()
      
      // If current is farther than worst in dynamic list, stop
      if (dynamicList.size() >= numClosest && current.distance > dynamicList.items[0].distance) {
        break
      }

      const currentNode = this.nodes.get(current.id)
      const connections = currentNode.getConnections(level)

      for (const neighborId of connections) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId)
          
          const neighborNode = this.nodes.get(neighborId)
          if (neighborNode) {
            const distance = this.calculateDistance(queryVector, neighborNode.vector)
            
            if (dynamicList.size() < numClosest || distance < dynamicList.items[0].distance) {
              candidates.enqueue({ id: neighborId, distance })
              dynamicList.enqueue({ id: neighborId, distance })
            }
          }
        }
      }
    }

    return dynamicList.toArray().sort((a, b) => a.distance - b.distance)
  }

  /**
   * Select neighbors using simple heuristic
   * @param {Array} candidates - Candidate neighbors
   * @param {number} maxConnections - Maximum number of connections
   * @returns {Array} Selected neighbors
   */
  selectNeighbors(candidates, maxConnections) {
    // Simple strategy: select closest candidates
    return candidates.slice(0, maxConnections)
  }

  /**
   * Prune connections if node has too many
   * @param {HNSWNode} node - Node to prune
   * @param {number} level - Level to prune at
   */
  pruneConnections(node, level) {
    const maxConnections = level === 0 ? this.maxConnectionsLevel0 : this.maxConnections
    const connections = node.getConnections(level)
    
    if (connections.size <= maxConnections) {
      return
    }

    // Calculate distances to all connected neighbors
    const neighborDistances = []
    for (const neighborId of connections) {
      const neighborNode = this.nodes.get(neighborId)
      if (neighborNode) {
        const distance = this.calculateDistance(node.vector, neighborNode.vector)
        neighborDistances.push({ id: neighborId, distance })
      }
    }

    // Sort by distance and keep only the closest
    neighborDistances.sort((a, b) => a.distance - b.distance)
    const toKeep = new Set(neighborDistances.slice(0, maxConnections).map(n => n.id))
    
    // Remove excess connections
    for (const neighborId of connections) {
      if (!toKeep.has(neighborId)) {
        node.removeConnection(neighborId, level)
        
        // Remove bidirectional connection
        const neighborNode = this.nodes.get(neighborId)
        if (neighborNode) {
          neighborNode.removeConnection(node.id, level)
        }
      }
    }
  }

  /**
   * Remove vector from index
   * @param {string} id - Vector ID to remove
   * @returns {boolean} True if removed
   */
  removeVector(id) {
    const node = this.nodes.get(id)
    if (!node) {
      return false
    }

    // Remove all bidirectional connections
    const allConnections = node.getAllConnections()
    for (const neighborId of allConnections) {
      const neighborNode = this.nodes.get(neighborId)
      if (neighborNode) {
        for (let level = 0; level <= neighborNode.level; level++) {
          neighborNode.removeConnection(id, level)
        }
      }
    }

    // Update entry point if necessary
    if (this.entryPoint === id) {
      // Find new entry point (node with highest level)
      let newEntryPoint = null
      let maxLevel = -1
      
      for (const [nodeId, node] of this.nodes) {
        if (nodeId !== id && node.level > maxLevel) {
          maxLevel = node.level
          newEntryPoint = nodeId
        }
      }
      
      this.entryPoint = newEntryPoint
    }

    this.nodes.delete(id)
    
    logger.debug('Vector removed from HNSW index', {
      id,
      remainingNodes: this.nodes.size
    })

    return true
  }

  /**
   * Get index statistics
   * @returns {Object} Index statistics
   */
  getStats() {
    if (this.nodes.size === 0) {
      return {
        nodeCount: 0,
        maxLevel: 0,
        avgConnections: 0,
        entryPoint: null
      }
    }

    let maxLevel = 0
    let totalConnections = 0
    const levelDistribution = new Map()

    for (const node of this.nodes.values()) {
      maxLevel = Math.max(maxLevel, node.level)
      
      // Count level distribution
      for (let level = 0; level <= node.level; level++) {
        levelDistribution.set(level, (levelDistribution.get(level) || 0) + 1)
        totalConnections += node.getConnections(level).size
      }
    }

    return {
      nodeCount: this.nodes.size,
      maxLevel,
      avgConnections: totalConnections / this.nodes.size,
      entryPoint: this.entryPoint,
      levelDistribution: Object.fromEntries(levelDistribution),
      parameters: {
        maxConnections: this.maxConnections,
        maxConnectionsLevel0: this.maxConnectionsLevel0,
        levelGenerationFactor: this.levelGenerationFactor,
        searchListSize: this.searchListSize,
        distanceMetric: this.distanceMetric
      }
    }
  }

  /**
   * Clear the index
   */
  clear() {
    this.nodes.clear()
    this.entryPoint = null
    logger.debug('HNSW index cleared')
  }
}

module.exports = { HNSWIndex, HNSWNode, PriorityQueue }
