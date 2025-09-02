/**
 * JSON Operations Module
 * Implements JSON document operations similar to RedisJSON
 * Supports JSONPath-like queries for nested data manipulation
 */

const logger = require('../utils/Logger')

class JsonOps {
  constructor(dataStore) {
    this.dataStore = dataStore
    logger.info('JsonOps module initialized')
  }

  /**
   * Ensure key holds a JSON document, create if needed
   * @param {string} key - Key to check/create
   * @returns {Object} Result with JSON object or error
   */
  ensureJsonDocument(key) {
    const result = this.dataStore.get(key)
    
    if (!result.success) {
      return result
    }

    if (result.value === null) {
      // Key doesn't exist, will be created on first operation
      return { success: true, value: null, exists: false }
    }

    // Check if the value is a valid JSON document (stored as object)
    if (typeof result.value !== 'object' || result.value instanceof Set || result.value instanceof Map || Array.isArray(result.value)) {
      return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
    }

    return { success: true, value: result.value, exists: true }
  }

  /**
   * Parse JSONPath expression
   * @param {string} path - JSONPath expression
   * @returns {Array} Array of path segments
   */
  parseJsonPath(path = '$') {
    if (path === '$' || path === '.') {
      return []
    }

    // Remove leading $ or .
    const cleanPath = path.replace(/^\$\.?/, '').replace(/^\./, '')
    
    if (!cleanPath) {
      return []
    }

    // Split by dots, handling array indices like [0]
    const segments = []
    const parts = cleanPath.split('.')
    
    for (const part of parts) {
      if (part.includes('[')) {
        // Handle array access like "items[0]" or just "[0]"
        const match = part.match(/^([^[]*)\[(\d+)\]$/)
        if (match) {
          if (match[1]) {
            segments.push(match[1]) // property name
          }
          segments.push(parseInt(match[2], 10)) // array index
        } else {
          segments.push(part) // fallback
        }
      } else {
        segments.push(part)
      }
    }
    
    return segments.filter(seg => seg !== '')
  }

  /**
   * Get value at JSONPath
   * @param {Object} document - JSON document
   * @param {Array} pathSegments - Path segments
   * @returns {*} Value at path or undefined
   */
  getValueAtPath(document, pathSegments) {
    let current = document
    
    for (const segment of pathSegments) {
      if (current === null || current === undefined) {
        return undefined
      }
      
      if (typeof segment === 'number') {
        // Array index
        if (!Array.isArray(current)) {
          return undefined
        }
        current = current[segment]
      } else {
        // Object property
        if (typeof current !== 'object' || Array.isArray(current)) {
          return undefined
        }
        current = current[segment]
      }
    }
    
    return current
  }

  /**
   * Set value at JSONPath
   * @param {Object} document - JSON document
   * @param {Array} pathSegments - Path segments
   * @param {*} value - Value to set
   * @param {boolean} createPath - Whether to create missing path segments
   * @returns {Object} Modified document or null if path invalid
   */
  setValueAtPath(document, pathSegments, value, createPath = true) {
    if (pathSegments.length === 0) {
      return value
    }

    // Deep clone to avoid mutation
    const result = JSON.parse(JSON.stringify(document || {}))
    let current = result
    
    for (let i = 0; i < pathSegments.length - 1; i++) {
      const segment = pathSegments[i]
      const nextSegment = pathSegments[i + 1]
      
      if (typeof segment === 'number') {
        // Array index
        if (!Array.isArray(current)) {
          if (!createPath) return null
          return null // Can't create array in non-array
        }
        
        // Extend array if needed
        while (current.length <= segment) {
          current.push(null)
        }
        
        if (current[segment] === null || current[segment] === undefined) {
          if (!createPath) return null
          // Create object or array based on next segment
          current[segment] = typeof nextSegment === 'number' ? [] : {}
        }
        
        current = current[segment]
      } else {
        // Object property
        if (typeof current !== 'object' || Array.isArray(current)) {
          if (!createPath) return null
          return null // Can't create property in non-object
        }
        
        if (!current.hasOwnProperty(segment)) {
          if (!createPath) return null
          // Create object or array based on next segment
          current[segment] = typeof nextSegment === 'number' ? [] : {}
        }
        
        current = current[segment]
      }
    }
    
    // Set final value
    const lastSegment = pathSegments[pathSegments.length - 1]
    
    if (typeof lastSegment === 'number') {
      if (!Array.isArray(current)) {
        if (!createPath) return null
        return null // Can't set array index in non-array
      }
      
      // Extend array if needed
      while (current.length <= lastSegment) {
        current.push(null)
      }
      
      current[lastSegment] = value
    } else {
      if (typeof current !== 'object' || Array.isArray(current)) {
        if (!createPath) return null
        return null // Can't set property in non-object
      }
      
      current[lastSegment] = value
    }
    
    return result
  }

  /**
   * Delete value at JSONPath
   * @param {Object} document - JSON document
   * @param {Array} pathSegments - Path segments
   * @returns {Object} Modified document and deletion count
   */
  deleteValueAtPath(document, pathSegments) {
    if (!document || pathSegments.length === 0) {
      return { document: null, deletedCount: document ? 1 : 0 }
    }

    // Deep clone to avoid mutation
    const result = JSON.parse(JSON.stringify(document))
    let current = result
    
    // Navigate to parent
    for (let i = 0; i < pathSegments.length - 1; i++) {
      const segment = pathSegments[i]
      
      if (typeof segment === 'number') {
        if (!Array.isArray(current) || segment >= current.length) {
          return { document, deletedCount: 0 }
        }
        current = current[segment]
      } else {
        if (typeof current !== 'object' || Array.isArray(current) || !current.hasOwnProperty(segment)) {
          return { document, deletedCount: 0 }
        }
        current = current[segment]
      }
      
      if (current === null || current === undefined) {
        return { document, deletedCount: 0 }
      }
    }
    
    // Delete final segment
    const lastSegment = pathSegments[pathSegments.length - 1]
    
    if (typeof lastSegment === 'number') {
      if (!Array.isArray(current) || lastSegment >= current.length) {
        return { document, deletedCount: 0 }
      }
      current.splice(lastSegment, 1)
    } else {
      if (typeof current !== 'object' || Array.isArray(current) || !current.hasOwnProperty(lastSegment)) {
        return { document, deletedCount: 0 }
      }
      delete current[lastSegment]
    }
    
    return { document: result, deletedCount: 1 }
  }

  /**
   * JSON.SET command - Set JSON value at path
   * @param {string} key - Key to set
   * @param {string} path - JSONPath expression
   * @param {string} jsonValue - JSON value as string
   * @param {Object} options - Options (NX, XX)
   * @returns {Object} Result
   */
  jsonSet(key, path = '$', jsonValue, options = {}) {
    try {
      const value = JSON.parse(jsonValue)
      const pathSegments = this.parseJsonPath(path)
      
      const docResult = this.ensureJsonDocument(key)
      if (!docResult.success) {
        return docResult
      }

      // Handle NX and XX options
      if (options.nx && docResult.exists) {
        return { success: true, value: null }
      }
      
      if (options.xx && !docResult.exists) {
        return { success: true, value: null }
      }

      const newDocument = this.setValueAtPath(docResult.value, pathSegments, value)
      
      if (newDocument === null) {
        return { success: false, error: 'ERR path does not exist' }
      }

      const setResult = this.dataStore.set(key, newDocument)
      if (!setResult.success) {
        return setResult
      }

      logger.debug('JSON.SET executed', { key, path, valueType: typeof value })

      return { success: true, value: 'OK' }
    } catch (error) {
      return { success: false, error: `ERR invalid JSON: ${error.message}` }
    }
  }

  /**
   * JSON.GET command - Get JSON value at path
   * @param {string} key - Key to get from
   * @param {Array} paths - Array of JSONPath expressions
   * @returns {Object} Result with JSON value
   */
  jsonGet(key, paths = ['$']) {
    const docResult = this.ensureJsonDocument(key)
    if (!docResult.success) {
      return docResult
    }

    if (!docResult.exists) {
      return { success: true, value: null }
    }

    const document = docResult.value
    
    if (paths.length === 1) {
      // Single path
      const pathSegments = this.parseJsonPath(paths[0])
      const value = this.getValueAtPath(document, pathSegments)
      
      if (value === undefined) {
        return { success: true, value: null }
      }
      
      return { success: true, value: JSON.stringify(value) }
    } else {
      // Multiple paths - return object with path -> value mapping
      const result = {}
      
      for (const path of paths) {
        const pathSegments = this.parseJsonPath(path)
        const value = this.getValueAtPath(document, pathSegments)
        result[path] = value === undefined ? null : value
      }
      
      return { success: true, value: JSON.stringify(result) }
    }
  }

  /**
   * JSON.DEL command - Delete JSON value at path
   * @param {string} key - Key to delete from
   * @param {string} path - JSONPath expression
   * @returns {Object} Result with deletion count
   */
  jsonDel(key, path = '$') {
    const docResult = this.ensureJsonDocument(key)
    if (!docResult.success) {
      return docResult
    }

    if (!docResult.exists) {
      return { success: true, value: 0 }
    }

    const pathSegments = this.parseJsonPath(path)
    const deleteResult = this.deleteValueAtPath(docResult.value, pathSegments)
    
    if (deleteResult.deletedCount === 0) {
      return { success: true, value: 0 }
    }

    if (deleteResult.document === null || (typeof deleteResult.document === 'object' && Object.keys(deleteResult.document).length === 0)) {
      // Delete the entire key if document becomes empty
      this.dataStore.del(key)
    } else {
      this.dataStore.set(key, deleteResult.document)
    }

    logger.debug('JSON.DEL executed', { key, path, deletedCount: deleteResult.deletedCount })

    return { success: true, value: deleteResult.deletedCount }
  }

  /**
   * JSON.ARRAPPEND command - Append values to JSON array
   * @param {string} key - Key to append to
   * @param {string} path - JSONPath expression
   * @param {Array} jsonValues - Array of JSON values as strings
   * @returns {Object} Result with new array length
   */
  jsonArrAppend(key, path = '$', jsonValues) {
    if (!Array.isArray(jsonValues) || jsonValues.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments' }
    }

    try {
      const values = jsonValues.map(v => JSON.parse(v))
      
      const docResult = this.ensureJsonDocument(key)
      if (!docResult.success) {
        return docResult
      }

      if (!docResult.exists) {
        return { success: false, error: 'ERR key does not exist' }
      }

      const pathSegments = this.parseJsonPath(path)
      const targetArray = this.getValueAtPath(docResult.value, pathSegments)
      
      if (!Array.isArray(targetArray)) {
        return { success: false, error: 'ERR path is not an array' }
      }

      const newArray = [...targetArray, ...values]
      const newDocument = this.setValueAtPath(docResult.value, pathSegments, newArray, false)
      
      if (newDocument === null) {
        return { success: false, error: 'ERR failed to update array' }
      }

      this.dataStore.set(key, newDocument)

      logger.debug('JSON.ARRAPPEND executed', { key, path, appendCount: values.length, newLength: newArray.length })

      return { success: true, value: newArray.length }
    } catch (error) {
      return { success: false, error: `ERR invalid JSON: ${error.message}` }
    }
  }

  /**
   * JSON.ARRLEN command - Get length of JSON array
   * @param {string} key - Key to check
   * @param {string} path - JSONPath expression
   * @returns {Object} Result with array length
   */
  jsonArrLen(key, path = '$') {
    const docResult = this.ensureJsonDocument(key)
    if (!docResult.success) {
      return docResult
    }

    if (!docResult.exists) {
      return { success: true, value: null }
    }

    const pathSegments = this.parseJsonPath(path)
    const targetArray = this.getValueAtPath(docResult.value, pathSegments)
    
    if (targetArray === undefined) {
      return { success: true, value: null }
    }
    
    if (!Array.isArray(targetArray)) {
      return { success: false, error: 'ERR path is not an array' }
    }

    return { success: true, value: targetArray.length }
  }

  /**
   * JSON.ARRPOP command - Pop element from JSON array
   * @param {string} key - Key to pop from
   * @param {string} path - JSONPath expression
   * @param {number} index - Index to pop (default -1 for last element)
   * @returns {Object} Result with popped element
   */
  jsonArrPop(key, path = '$', index = -1) {
    const docResult = this.ensureJsonDocument(key)
    if (!docResult.success) {
      return docResult
    }

    if (!docResult.exists) {
      return { success: true, value: null }
    }

    const pathSegments = this.parseJsonPath(path)
    const targetArray = this.getValueAtPath(docResult.value, pathSegments)
    
    if (targetArray === undefined) {
      return { success: true, value: null }
    }
    
    if (!Array.isArray(targetArray)) {
      return { success: false, error: 'ERR path is not an array' }
    }

    if (targetArray.length === 0) {
      return { success: true, value: null }
    }

    // Normalize index
    const normalizedIndex = index < 0 ? targetArray.length + index : index
    
    if (normalizedIndex < 0 || normalizedIndex >= targetArray.length) {
      return { success: false, error: 'ERR index out of range' }
    }

    const poppedElement = targetArray[normalizedIndex]
    const newArray = [...targetArray]
    newArray.splice(normalizedIndex, 1)
    
    const newDocument = this.setValueAtPath(docResult.value, pathSegments, newArray, false)
    
    if (newDocument === null) {
      return { success: false, error: 'ERR failed to update array' }
    }

    this.dataStore.set(key, newDocument)

    logger.debug('JSON.ARRPOP executed', { key, path, index: normalizedIndex, newLength: newArray.length })

    return { success: true, value: JSON.stringify(poppedElement) }
  }

  /**
   * JSON.OBJKEYS command - Get keys of JSON object
   * @param {string} key - Key to get keys from
   * @param {string} path - JSONPath expression
   * @returns {Object} Result with object keys
   */
  jsonObjKeys(key, path = '$') {
    const docResult = this.ensureJsonDocument(key)
    if (!docResult.success) {
      return docResult
    }

    if (!docResult.exists) {
      return { success: true, value: null }
    }

    const pathSegments = this.parseJsonPath(path)
    const targetObject = this.getValueAtPath(docResult.value, pathSegments)
    
    if (targetObject === undefined || targetObject === null) {
      return { success: true, value: null }
    }
    
    if (typeof targetObject !== 'object' || Array.isArray(targetObject)) {
      return { success: false, error: 'ERR path is not an object' }
    }

    const keys = Object.keys(targetObject)

    return { success: true, value: keys }
  }

  /**
   * JSON.OBJLEN command - Get length of JSON object
   * @param {string} key - Key to check
   * @param {string} path - JSONPath expression
   * @returns {Object} Result with object length
   */
  jsonObjLen(key, path = '$') {
    const docResult = this.ensureJsonDocument(key)
    if (!docResult.success) {
      return docResult
    }

    if (!docResult.exists) {
      return { success: true, value: null }
    }

    const pathSegments = this.parseJsonPath(path)
    const targetObject = this.getValueAtPath(docResult.value, pathSegments)
    
    if (targetObject === undefined || targetObject === null) {
      return { success: true, value: null }
    }
    
    if (typeof targetObject !== 'object' || Array.isArray(targetObject)) {
      return { success: false, error: 'ERR path is not an object' }
    }

    return { success: true, value: Object.keys(targetObject).length }
  }

  /**
   * JSON.TYPE command - Get type of JSON value at path
   * @param {string} key - Key to check
   * @param {string} path - JSONPath expression
   * @returns {Object} Result with value type
   */
  jsonType(key, path = '$') {
    const docResult = this.ensureJsonDocument(key)
    if (!docResult.success) {
      return docResult
    }

    if (!docResult.exists) {
      return { success: true, value: null }
    }

    const pathSegments = this.parseJsonPath(path)
    const value = this.getValueAtPath(docResult.value, pathSegments)
    
    if (value === undefined) {
      return { success: true, value: null }
    }

    let type
    if (value === null) {
      type = 'null'
    } else if (typeof value === 'boolean') {
      type = 'boolean'
    } else if (typeof value === 'number') {
      type = 'number'
    } else if (typeof value === 'string') {
      type = 'string'
    } else if (Array.isArray(value)) {
      type = 'array'
    } else if (typeof value === 'object') {
      type = 'object'
    } else {
      type = 'unknown'
    }

    return { success: true, value: type }
  }

  /**
   * Helper method to validate if a value is a valid JSON document
   * @param {*} value - Value to validate
   * @returns {boolean} True if valid JSON document
   */
  isValidJsonDocument(value) {
    return typeof value === 'object' && value !== null && 
           !(value instanceof Set) && !(value instanceof Map) && 
           !Array.isArray(value)
  }
}

module.exports = JsonOps
