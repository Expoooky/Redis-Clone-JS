/**
 * Geospatial Operations Module
 * Implements Redis geospatial commands using geohash algorithm and spatial indexing
 * Supports location-based queries with efficient distance calculations
 */

const logger = require('../utils/Logger')

/**
 * Geospatial utilities and algorithms
 */
class GeospatialUtils {
  constructor() {
    // Earth radius in meters (used for distance calculations)
    this.EARTH_RADIUS = 6372797.560856
    
    // Geohash base32 alphabet
    this.GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'
    
    // Geohash precision levels (bits)
    this.GEOHASH_PRECISION = 52 // Redis uses 52-bit precision
  }

  /**
   * Encode coordinates to geohash
   * @param {number} latitude - Latitude (-90 to 90)
   * @param {number} longitude - Longitude (-180 to 180)
   * @param {number} precision - Number of bits for precision
   * @returns {string} Geohash string
   */
  encodeGeohash(latitude, longitude, precision = this.GEOHASH_PRECISION) {
    // Validate coordinates
    if (latitude < -90 || latitude > 90) {
      throw new Error('Latitude must be between -90 and 90')
    }
    if (longitude < -180 || longitude > 180) {
      throw new Error('Longitude must be between -180 and 180')
    }

    let latMin = -90.0, latMax = 90.0
    let lngMin = -180.0, lngMax = 180.0
    
    let hash = 0
    let bit = 0
    let bitCount = 0
    let isEven = true // Start with longitude

    while (bitCount < precision) {
      if (isEven) {
        // Longitude
        const mid = (lngMin + lngMax) / 2
        if (longitude >= mid) {
          hash |= (1 << (precision - 1 - bitCount))
          lngMin = mid
        } else {
          lngMax = mid
        }
      } else {
        // Latitude
        const mid = (latMin + latMax) / 2
        if (latitude >= mid) {
          hash |= (1 << (precision - 1 - bitCount))
          latMin = mid
        } else {
          latMax = mid
        }
      }
      
      isEven = !isEven
      bitCount++
    }

    return hash.toString()
  }

  /**
   * Decode geohash to coordinates
   * @param {string} geohash - Geohash string
   * @param {number} precision - Number of bits for precision
   * @returns {Object} Object with latitude and longitude
   */
  decodeGeohash(geohash, precision = this.GEOHASH_PRECISION) {
    const hash = parseInt(geohash, 10)
    
    let latMin = -90.0, latMax = 90.0
    let lngMin = -180.0, lngMax = 180.0
    
    let isEven = true // Start with longitude
    
    for (let i = 0; i < precision; i++) {
      const bit = (hash >> (precision - 1 - i)) & 1
      
      if (isEven) {
        // Longitude
        const mid = (lngMin + lngMax) / 2
        if (bit === 1) {
          lngMin = mid
        } else {
          lngMax = mid
        }
      } else {
        // Latitude
        const mid = (latMin + latMax) / 2
        if (bit === 1) {
          latMin = mid
        } else {
          latMax = mid
        }
      }
      
      isEven = !isEven
    }

    return {
      latitude: (latMin + latMax) / 2,
      longitude: (lngMin + lngMax) / 2
    }
  }

  /**
   * Convert geohash to base32 string representation
   * @param {string} geohash - Geohash number string
   * @param {number} length - Desired base32 string length
   * @returns {string} Base32 geohash string
   */
  geohashToBase32(geohash, length = 11) {
    const hash = parseInt(geohash, 10)
    let result = ''
    let temp = hash
    
    for (let i = 0; i < length; i++) {
      const index = temp & 0x1f // Get last 5 bits
      result = this.GEOHASH_BASE32[index] + result
      temp = Math.floor(temp / 32)
    }
    
    return result.padStart(length, '0')
  }

  /**
   * Calculate distance between two coordinates using Haversine formula
   * @param {number} lat1 - Latitude of first point
   * @param {number} lng1 - Longitude of first point
   * @param {number} lat2 - Latitude of second point
   * @param {number} lng2 - Longitude of second point
   * @param {string} unit - Distance unit ('m', 'km', 'mi', 'ft')
   * @returns {number} Distance in specified unit
   */
  calculateDistance(lat1, lng1, lat2, lng2, unit = 'm') {
    // Convert to radians
    const φ1 = lat1 * Math.PI / 180
    const φ2 = lat2 * Math.PI / 180
    const Δφ = (lat2 - lat1) * Math.PI / 180
    const Δλ = (lng2 - lng1) * Math.PI / 180

    // Haversine formula
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    // Distance in meters
    let distance = this.EARTH_RADIUS * c

    // Convert to requested unit
    switch (unit.toLowerCase()) {
      case 'km':
        distance /= 1000
        break
      case 'mi':
        distance /= 1609.344
        break
      case 'ft':
        distance /= 0.3048
        break
      case 'm':
      default:
        // Already in meters
        break
    }

    return distance
  }

  /**
   * Validate coordinates
   * @param {number} latitude - Latitude
   * @param {number} longitude - Longitude
   * @returns {boolean} True if valid
   */
  isValidCoordinates(latitude, longitude) {
    return latitude >= -90 && latitude <= 90 && 
           longitude >= -180 && longitude <= 180
  }

  /**
   * Parse unit string and validate
   * @param {string} unit - Unit string
   * @returns {string} Normalized unit
   */
  parseUnit(unit) {
    const normalizedUnit = unit.toLowerCase()
    if (!['m', 'km', 'mi', 'ft'].includes(normalizedUnit)) {
      throw new Error('Invalid unit. Must be one of: m, km, mi, ft')
    }
    return normalizedUnit
  }
}

/**
 * Geospatial Operations implementation
 */
class GeospatialOps {
  constructor(dataStore) {
    this.dataStore = dataStore
    this.geoUtils = new GeospatialUtils()
    logger.info('GeospatialOps module initialized')
  }

  /**
   * Ensure key holds a geospatial index (sorted set), create if needed
   * @param {string} key - Key to check/create
   * @returns {Object} Result with sorted set or error
   */
  ensureGeoIndex(key) {
    const result = this.dataStore.get(key)
    
    if (!result.success) {
      return result
    }

    if (result.value === null) {
      // Key doesn't exist, will be created on first operation
      return { success: true, value: new Map(), exists: false }
    }

    // Geo data is stored as a sorted set (Map for score->member lookup)
    // But we also need member->coordinates mapping
    if (!(result.value instanceof Map)) {
      return { success: false, error: 'WRONGTYPE Operation against a key holding the wrong kind of value' }
    }

    return { success: true, value: result.value, exists: true }
  }

  /**
   * GEOADD command - Add geospatial items
   * @param {string} key - Geo index key
   * @param {Array} coordinates - Array of [lng, lat, member] triplets
   * @returns {Object} Result with number of added elements
   */
  geoadd(key, coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length === 0 || coordinates.length % 3 !== 0) {
      return { success: false, error: 'ERR wrong number of arguments for \'geoadd\' command' }
    }

    const geoResult = this.ensureGeoIndex(key)
    if (!geoResult.success) {
      return geoResult
    }

    // Structure: Map of member -> {longitude, latitude, geohash}
    const geoIndex = geoResult.exists ? new Map(geoResult.value) : new Map()
    let addedCount = 0

    // Process coordinate triplets
    for (let i = 0; i < coordinates.length; i += 3) {
      const longitude = parseFloat(coordinates[i])
      const latitude = parseFloat(coordinates[i + 1])
      const member = coordinates[i + 2].toString()

      // Validate coordinates
      if (isNaN(longitude) || isNaN(latitude)) {
        return { success: false, error: 'ERR invalid longitude,latitude pair' }
      }

      if (!this.geoUtils.isValidCoordinates(latitude, longitude)) {
        return { success: false, error: 'ERR invalid longitude,latitude pair' }
      }

      // Generate geohash for indexing
      const geohash = this.geoUtils.encodeGeohash(latitude, longitude)
      
      // Check if member is new
      const isNew = !geoIndex.has(member)
      
      // Store geospatial data
      geoIndex.set(member, {
        longitude,
        latitude,
        geohash
      })

      if (isNew) {
        addedCount++
      }
    }

    const setResult = this.dataStore.set(key, geoIndex)
    if (!setResult.success) {
      return setResult
    }

    logger.debug('GEOADD executed', {
      key,
      itemsProvided: coordinates.length / 3,
      addedCount,
      totalItems: geoIndex.size
    })

    return { success: true, value: addedCount }
  }

  /**
   * GEODIST command - Calculate distance between two members
   * @param {string} key - Geo index key
   * @param {string} member1 - First member
   * @param {string} member2 - Second member
   * @param {string} unit - Distance unit (m, km, mi, ft)
   * @returns {Object} Result with distance
   */
  geodist(key, member1, member2, unit = 'm') {
    try {
      const normalizedUnit = this.geoUtils.parseUnit(unit)
      
      const geoResult = this.ensureGeoIndex(key)
      if (!geoResult.success) {
        return geoResult
      }

      if (!geoResult.exists) {
        return { success: true, value: null }
      }

      const geoIndex = geoResult.value
      const item1 = geoIndex.get(member1.toString())
      const item2 = geoIndex.get(member2.toString())

      if (!item1 || !item2) {
        return { success: true, value: null }
      }

      const distance = this.geoUtils.calculateDistance(
        item1.latitude, item1.longitude,
        item2.latitude, item2.longitude,
        normalizedUnit
      )

      logger.debug('GEODIST executed', {
        key,
        member1,
        member2,
        unit: normalizedUnit,
        distance
      })

      return { success: true, value: distance.toFixed(4) }
    } catch (error) {
      return { success: false, error: `ERR ${error.message}` }
    }
  }

  /**
   * GEOHASH command - Get geohash strings for members
   * @param {string} key - Geo index key
   * @param {Array} members - Array of member names
   * @returns {Object} Result with array of geohash strings
   */
  geohash(key, members) {
    if (!Array.isArray(members) || members.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments for \'geohash\' command' }
    }

    const geoResult = this.ensureGeoIndex(key)
    if (!geoResult.success) {
      return geoResult
    }

    if (!geoResult.exists) {
      return { success: true, value: members.map(() => null) }
    }

    const geoIndex = geoResult.value
    const geohashes = []

    for (const member of members) {
      const item = geoIndex.get(member.toString())
      if (item) {
        const base32Hash = this.geoUtils.geohashToBase32(item.geohash)
        geohashes.push(base32Hash)
      } else {
        geohashes.push(null)
      }
    }

    logger.debug('GEOHASH executed', {
      key,
      memberCount: members.length,
      foundCount: geohashes.filter(h => h !== null).length
    })

    return { success: true, value: geohashes }
  }

  /**
   * GEOPOS command - Get coordinates for members
   * @param {string} key - Geo index key
   * @param {Array} members - Array of member names
   * @returns {Object} Result with array of [longitude, latitude] pairs
   */
  geopos(key, members) {
    if (!Array.isArray(members) || members.length === 0) {
      return { success: false, error: 'ERR wrong number of arguments for \'geopos\' command' }
    }

    const geoResult = this.ensureGeoIndex(key)
    if (!geoResult.success) {
      return geoResult
    }

    if (!geoResult.exists) {
      return { success: true, value: members.map(() => null) }
    }

    const geoIndex = geoResult.value
    const positions = []

    for (const member of members) {
      const item = geoIndex.get(member.toString())
      if (item) {
        positions.push([item.longitude.toString(), item.latitude.toString()])
      } else {
        positions.push(null)
      }
    }

    logger.debug('GEOPOS executed', {
      key,
      memberCount: members.length,
      foundCount: positions.filter(p => p !== null).length
    })

    return { success: true, value: positions }
  }

  /**
   * GEORADIUS command - Query by radius from coordinates
   * @param {string} key - Geo index key
   * @param {number} longitude - Center longitude
   * @param {number} latitude - Center latitude
   * @param {number} radius - Search radius
   * @param {string} unit - Distance unit
   * @param {Object} options - Query options (WITHCOORD, WITHDIST, COUNT, etc.)
   * @returns {Object} Result with array of members within radius
   */
  georadius(key, longitude, latitude, radius, unit, options = {}) {
    try {
      const normalizedUnit = this.geoUtils.parseUnit(unit)
      
      // Validate coordinates
      if (!this.geoUtils.isValidCoordinates(latitude, longitude)) {
        return { success: false, error: 'ERR invalid longitude,latitude pair' }
      }

      if (radius <= 0) {
        return { success: false, error: 'ERR radius must be positive' }
      }

      const geoResult = this.ensureGeoIndex(key)
      if (!geoResult.success) {
        return geoResult
      }

      if (!geoResult.exists) {
        return { success: true, value: [] }
      }

      const geoIndex = geoResult.value
      const results = []

      // Check each member for distance
      for (const [member, item] of geoIndex) {
        const distance = this.geoUtils.calculateDistance(
          latitude, longitude,
          item.latitude, item.longitude,
          normalizedUnit
        )

        if (distance <= radius) {
          const result = { member, distance }
          
          if (options.withcoord) {
            result.coordinates = [item.longitude, item.latitude]
          }
          
          if (options.withdist) {
            result.distanceStr = distance.toFixed(4)
          }
          
          results.push(result)
        }
      }

      // Sort by distance
      results.sort((a, b) => a.distance - b.distance)

      // Apply count limit
      if (options.count && options.count > 0) {
        results.splice(options.count)
      }

      // Format output based on options
      const output = this.formatGeoResults(results, options)

      logger.debug('GEORADIUS executed', {
        key,
        longitude,
        latitude,
        radius,
        unit: normalizedUnit,
        resultCount: results.length
      })

      return { success: true, value: output }
    } catch (error) {
      return { success: false, error: `ERR ${error.message}` }
    }
  }

  /**
   * GEORADIUSBYMEMBER command - Query by radius from existing member
   * @param {string} key - Geo index key
   * @param {string} member - Center member
   * @param {number} radius - Search radius
   * @param {string} unit - Distance unit
   * @param {Object} options - Query options
   * @returns {Object} Result with array of members within radius
   */
  georadiusbymember(key, member, radius, unit, options = {}) {
    const geoResult = this.ensureGeoIndex(key)
    if (!geoResult.success) {
      return geoResult
    }

    if (!geoResult.exists) {
      return { success: true, value: [] }
    }

    const geoIndex = geoResult.value
    const centerItem = geoIndex.get(member.toString())

    if (!centerItem) {
      return { success: false, error: 'ERR could not decode requested zset member' }
    }

    // Use GEORADIUS with member's coordinates
    return this.georadius(key, centerItem.longitude, centerItem.latitude, radius, unit, options)
  }

  /**
   * Format geo query results based on options
   * @param {Array} results - Raw results with member, distance, coordinates
   * @param {Object} options - Formatting options
   * @returns {Array} Formatted results
   */
  formatGeoResults(results, options) {
    return results.map(result => {
      if (!options.withcoord && !options.withdist) {
        // Just member names
        return result.member
      }

      // Build array with member and optional data
      const output = [result.member]
      
      if (options.withdist) {
        output.push(result.distanceStr)
      }
      
      if (options.withcoord) {
        output.push(result.coordinates)
      }
      
      return output
    })
  }

  /**
   * Helper method to validate if a value is a valid geo index
   * @param {*} value - Value to validate
   * @returns {boolean} True if valid geo index
   */
  isValidGeoIndex(value) {
    return value instanceof Map
  }
}

module.exports = GeospatialOps
