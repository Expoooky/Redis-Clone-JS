/**
 * HashSlots.js - Hash slot-based data distribution for Redis clustering
 * 
 * This module implements Redis Cluster's hash slot mechanism for distributing
 * keys across multiple nodes in a cluster. It provides consistent hashing
 * and key migration capabilities.
 */

const crypto = require('crypto')
const logger = require('../utils/Logger')

/**
 * Redis Cluster uses 16384 hash slots
 */
const CLUSTER_SLOTS = 16384

/**
 * Hash slot manager for consistent data distribution
 */
class HashSlots {
  constructor() {
    this.slots = new Array(CLUSTER_SLOTS).fill(null)
    this.nodeSlots = new Map() // nodeId -> Set of slot numbers
    this.slotNodes = new Map() // slot -> nodeId
    this.migrationState = new Map() // slot -> { from, to, status }
  }

  /**
   * Calculate hash slot for a key using CRC16
   */
  calculateSlot(key) {
    // Handle hash tags (keys like {user:1000}.profile)
    const hashTag = this.extractHashTag(key)
    const keyToHash = hashTag || key

    // Calculate CRC16 and mod by CLUSTER_SLOTS
    const crc = this.crc16(keyToHash)
    return crc % CLUSTER_SLOTS
  }

  /**
   * Extract hash tag from key (Redis Cluster hash tag support)
   */
  extractHashTag(key) {
    const start = key.indexOf('{')
    if (start === -1) return null

    const end = key.indexOf('}', start + 1)
    if (end === -1 || end === start + 1) return null

    return key.substring(start + 1, end)
  }

  /**
   * CRC16 implementation for Redis Cluster compatibility
   */
  crc16(data) {
    const CRC16_TAB = [
      0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50a5, 0x60c6, 0x70e7,
      0x8108, 0x9129, 0xa14a, 0xb16b, 0xc18c, 0xd1ad, 0xe1ce, 0xf1ef,
      0x1231, 0x0210, 0x3273, 0x2252, 0x52b5, 0x4294, 0x72f7, 0x62d6,
      0x9339, 0x8318, 0xb37b, 0xa35a, 0xd3bd, 0xc39c, 0xf3ff, 0xe3de,
      0x2462, 0x3443, 0x0420, 0x1401, 0x64e6, 0x74c7, 0x44a4, 0x5485,
      0xa56a, 0xb54b, 0x8528, 0x9509, 0xe5ee, 0xf5cf, 0xc5ac, 0xd58d,
      0x3653, 0x2672, 0x1611, 0x0630, 0x76d7, 0x66f6, 0x5695, 0x46b4,
      0xb75b, 0xa77a, 0x9719, 0x8738, 0xf7df, 0xe7fe, 0xd79d, 0xc7bc,
      0x48c4, 0x58e5, 0x6886, 0x78a7, 0x0840, 0x1861, 0x2802, 0x3823,
      0xc9cc, 0xd9ed, 0xe98e, 0xf9af, 0x8948, 0x9969, 0xa90a, 0xb92b,
      0x5af5, 0x4ad4, 0x7ab7, 0x6a96, 0x1a71, 0x0a50, 0x3a33, 0x2a12,
      0xdbfd, 0xcbdc, 0xfbbf, 0xeb9e, 0x9b79, 0x8b58, 0xbb3b, 0xab1a,
      0x6ca6, 0x7c87, 0x4ce4, 0x5cc5, 0x2c22, 0x3c03, 0x0c60, 0x1c41,
      0xedae, 0xfd8f, 0xcdec, 0xddcd, 0xad2a, 0xbd0b, 0x8d68, 0x9d49,
      0x7e97, 0x6eb6, 0x5ed5, 0x4ef4, 0x3e13, 0x2e32, 0x1e51, 0x0e70,
      0xff9f, 0xefbe, 0xdfdd, 0xcffc, 0xbf1b, 0xaf3a, 0x9f59, 0x8f78,
      0x9188, 0x81a9, 0xb1ca, 0xa1eb, 0xd10c, 0xc12d, 0xf14e, 0xe16f,
      0x1080, 0x00a1, 0x30c2, 0x20e3, 0x5004, 0x4025, 0x7046, 0x6067,
      0x83b9, 0x9398, 0xa3fb, 0xb3da, 0xc33d, 0xd31c, 0xe37f, 0xf35e,
      0x02b1, 0x1290, 0x22f3, 0x32d2, 0x4235, 0x5214, 0x6277, 0x7256,
      0xb5ea, 0xa5cb, 0x95a8, 0x8589, 0xf56e, 0xe54f, 0xd52c, 0xc50d,
      0x34e2, 0x24c3, 0x14a0, 0x0481, 0x7466, 0x6447, 0x5424, 0x4405,
      0xa7db, 0xb7fa, 0x8799, 0x97b8, 0xe75f, 0xf77e, 0xc71d, 0xd73c,
      0x26d3, 0x36f2, 0x0691, 0x16b0, 0x6657, 0x7676, 0x4615, 0x5634,
      0xd94c, 0xc96d, 0xf90e, 0xe92f, 0x99c8, 0x89e9, 0xb98a, 0xa9ab,
      0x5844, 0x4865, 0x7806, 0x6827, 0x18c0, 0x08e1, 0x3882, 0x28a3,
      0xcb7d, 0xdb5c, 0xeb3f, 0xfb1e, 0x8bf9, 0x9bd8, 0xabbb, 0xbb9a,
      0x4a75, 0x5a54, 0x6a37, 0x7a16, 0x0af1, 0x1ad0, 0x2ab3, 0x3a92,
      0xfd2e, 0xed0f, 0xdd6c, 0xcd4d, 0xbdaa, 0xad8b, 0x9de8, 0x8dc9,
      0x7c26, 0x6c07, 0x5c64, 0x4c45, 0x3ca2, 0x2c83, 0x1ce0, 0x0cc1,
      0xef1f, 0xff3e, 0xcf5d, 0xdf7c, 0xaf9b, 0xbfba, 0x8fd9, 0x9ff8,
      0x6e17, 0x7e36, 0x4e55, 0x5e74, 0x2e93, 0x3eb2, 0x0ed1, 0x1ef0
    ]

    let crc = 0
    for (let i = 0; i < data.length; i++) {
      crc = ((crc << 8) ^ CRC16_TAB[((crc >> 8) ^ data.charCodeAt(i)) & 0xff]) & 0xffff
    }
    return crc
  }

  /**
   * Assign slot range to a node
   */
  assignSlots(nodeId, startSlot, endSlot) {
    if (startSlot < 0 || endSlot >= CLUSTER_SLOTS || startSlot > endSlot) {
      throw new Error(`Invalid slot range: ${startSlot}-${endSlot}`)
    }

    const assignedSlots = new Set()
    
    for (let slot = startSlot; slot <= endSlot; slot++) {
      if (this.slots[slot] && this.slots[slot] !== nodeId) {
        throw new Error(`Slot ${slot} is already assigned to node ${this.slots[slot]}`)
      }
      
      this.slots[slot] = nodeId
      this.slotNodes.set(slot, nodeId)
      assignedSlots.add(slot)
    }

    // Update node slots mapping
    if (!this.nodeSlots.has(nodeId)) {
      this.nodeSlots.set(nodeId, new Set())
    }
    
    for (const slot of assignedSlots) {
      this.nodeSlots.get(nodeId).add(slot)
    }

    logger.info('Slots assigned to node', {
      nodeId,
      slotRange: `${startSlot}-${endSlot}`,
      slotCount: endSlot - startSlot + 1,
      component: 'HashSlots'
    })

    return assignedSlots
  }

  /**
   * Assign individual slots to a node
   */
  assignSlotList(nodeId, slotList) {
    const assignedSlots = new Set()
    
    for (const slot of slotList) {
      if (slot < 0 || slot >= CLUSTER_SLOTS) {
        throw new Error(`Invalid slot number: ${slot}`)
      }
      
      if (this.slots[slot] && this.slots[slot] !== nodeId) {
        throw new Error(`Slot ${slot} is already assigned to node ${this.slots[slot]}`)
      }
      
      this.slots[slot] = nodeId
      this.slotNodes.set(slot, nodeId)
      assignedSlots.add(slot)
    }

    // Update node slots mapping
    if (!this.nodeSlots.has(nodeId)) {
      this.nodeSlots.set(nodeId, new Set())
    }
    
    for (const slot of assignedSlots) {
      this.nodeSlots.get(nodeId).add(slot)
    }

    logger.info('Individual slots assigned to node', {
      nodeId,
      slots: Array.from(slotList),
      slotCount: slotList.length,
      component: 'HashSlots'
    })

    return assignedSlots
  }

  /**
   * Remove slots from a node
   */
  removeSlots(nodeId, slotList) {
    const removedSlots = new Set()
    
    for (const slot of slotList) {
      if (this.slots[slot] === nodeId) {
        this.slots[slot] = null
        this.slotNodes.delete(slot)
        removedSlots.add(slot)
        
        if (this.nodeSlots.has(nodeId)) {
          this.nodeSlots.get(nodeId).delete(slot)
        }
      }
    }

    // Clean up empty node entry
    if (this.nodeSlots.has(nodeId) && this.nodeSlots.get(nodeId).size === 0) {
      this.nodeSlots.delete(nodeId)
    }

    logger.info('Slots removed from node', {
      nodeId,
      slots: Array.from(removedSlots),
      slotCount: removedSlots.size,
      component: 'HashSlots'
    })

    return removedSlots
  }

  /**
   * Get the node responsible for a key
   */
  getNodeForKey(key) {
    const slot = this.calculateSlot(key)
    return this.getNodeForSlot(slot)
  }

  /**
   * Get the node responsible for a slot
   */
  getNodeForSlot(slot) {
    if (slot < 0 || slot >= CLUSTER_SLOTS) {
      throw new Error(`Invalid slot number: ${slot}`)
    }

    // Check if slot is being migrated
    const migration = this.migrationState.get(slot)
    if (migration) {
      return {
        primary: migration.to,
        migration: migration.from,
        status: migration.status
      }
    }

    return {
      primary: this.slots[slot],
      migration: null,
      status: 'stable'
    }
  }

  /**
   * Get all slots assigned to a node
   */
  getSlotsForNode(nodeId) {
    return this.nodeSlots.get(nodeId) || new Set()
  }

  /**
   * Get slot distribution across all nodes
   */
  getSlotDistribution() {
    const distribution = new Map()
    
    for (const [nodeId, slots] of this.nodeSlots.entries()) {
      distribution.set(nodeId, {
        slotCount: slots.size,
        slots: Array.from(slots).sort((a, b) => a - b)
      })
    }

    return distribution
  }

  /**
   * Start migrating a slot from one node to another
   */
  startMigration(slot, fromNode, toNode) {
    if (slot < 0 || slot >= CLUSTER_SLOTS) {
      throw new Error(`Invalid slot number: ${slot}`)
    }

    if (this.slots[slot] !== fromNode) {
      throw new Error(`Slot ${slot} is not assigned to node ${fromNode}`)
    }

    if (this.migrationState.has(slot)) {
      throw new Error(`Slot ${slot} is already being migrated`)
    }

    this.migrationState.set(slot, {
      from: fromNode,
      to: toNode,
      status: 'migrating',
      startTime: Date.now(),
      keysRemaining: 0
    })

    logger.info('Slot migration started', {
      slot,
      fromNode,
      toNode,
      component: 'HashSlots'
    })

    return true
  }

  /**
   * Complete slot migration
   */
  completeMigration(slot) {
    const migration = this.migrationState.get(slot)
    if (!migration) {
      throw new Error(`No migration in progress for slot ${slot}`)
    }

    const { from, to } = migration
    
    // Transfer slot ownership
    this.slots[slot] = to
    this.slotNodes.set(slot, to)
    
    // Update node mappings
    if (this.nodeSlots.has(from)) {
      this.nodeSlots.get(from).delete(slot)
      if (this.nodeSlots.get(from).size === 0) {
        this.nodeSlots.delete(from)
      }
    }
    
    if (!this.nodeSlots.has(to)) {
      this.nodeSlots.set(to, new Set())
    }
    this.nodeSlots.get(to).add(slot)
    
    // Clear migration state
    this.migrationState.delete(slot)

    logger.info('Slot migration completed', {
      slot,
      fromNode: from,
      toNode: to,
      duration: Date.now() - migration.startTime,
      component: 'HashSlots'
    })

    return true
  }

  /**
   * Cancel slot migration
   */
  cancelMigration(slot) {
    const migration = this.migrationState.get(slot)
    if (!migration) {
      throw new Error(`No migration in progress for slot ${slot}`)
    }

    this.migrationState.delete(slot)

    logger.info('Slot migration cancelled', {
      slot,
      fromNode: migration.from,
      toNode: migration.to,
      component: 'HashSlots'
    })

    return true
  }

  /**
   * Get all active migrations
   */
  getActiveMigrations() {
    const migrations = []
    
    for (const [slot, migration] of this.migrationState.entries()) {
      migrations.push({
        slot,
        ...migration,
        duration: Date.now() - migration.startTime
      })
    }

    return migrations
  }

  /**
   * Check if all slots are assigned
   */
  isFullyCovered() {
    return this.getUnassignedSlots().length === 0
  }

  /**
   * Get list of unassigned slots
   */
  getUnassignedSlots() {
    const unassigned = []
    
    for (let slot = 0; slot < CLUSTER_SLOTS; slot++) {
      if (!this.slots[slot]) {
        unassigned.push(slot)
      }
    }

    return unassigned
  }

  /**
   * Get cluster topology information
   */
  getTopology() {
    const nodes = {}
    let totalAssigned = 0
    let migratingSlots = 0

    for (const [nodeId, slots] of this.nodeSlots.entries()) {
      nodes[nodeId] = {
        slotCount: slots.size,
        slotRanges: this.getSlotsAsRanges(slots)
      }
      totalAssigned += slots.size
    }

    migratingSlots = this.migrationState.size

    return {
      nodes,
      totalSlots: CLUSTER_SLOTS,
      assignedSlots: totalAssigned,
      unassignedSlots: CLUSTER_SLOTS - totalAssigned,
      migratingSlots,
      coverage: (totalAssigned / CLUSTER_SLOTS) * 100
    }
  }

  /**
   * Convert slot set to ranges for compact representation
   */
  getSlotsAsRanges(slotSet) {
    const slots = Array.from(slotSet).sort((a, b) => a - b)
    const ranges = []
    let start = slots[0]
    let end = slots[0]

    for (let i = 1; i < slots.length; i++) {
      if (slots[i] === end + 1) {
        end = slots[i]
      } else {
        ranges.push(start === end ? `${start}` : `${start}-${end}`)
        start = end = slots[i]
      }
    }

    if (start !== undefined) {
      ranges.push(start === end ? `${start}` : `${start}-${end}`)
    }

    return ranges
  }

  /**
   * Distribute slots evenly across nodes
   */
  distributeSlots(nodeIds) {
    if (!nodeIds || nodeIds.length === 0) {
      throw new Error('No nodes provided for slot distribution')
    }

    // Clear existing assignments
    this.slots.fill(null)
    this.nodeSlots.clear()
    this.slotNodes.clear()

    const slotsPerNode = Math.floor(CLUSTER_SLOTS / nodeIds.length)
    const remainingSlots = CLUSTER_SLOTS % nodeIds.length

    let currentSlot = 0

    for (let i = 0; i < nodeIds.length; i++) {
      const nodeId = nodeIds[i]
      const nodeSlotCount = slotsPerNode + (i < remainingSlots ? 1 : 0)
      const endSlot = currentSlot + nodeSlotCount - 1

      this.assignSlots(nodeId, currentSlot, endSlot)
      currentSlot += nodeSlotCount
    }

    logger.info('Slots distributed across cluster', {
      nodeCount: nodeIds.length,
      slotsPerNode,
      remainingSlots,
      component: 'HashSlots'
    })

    return this.getSlotDistribution()
  }

  /**
   * Reset all slot assignments
   */
  reset() {
    this.slots.fill(null)
    this.nodeSlots.clear()
    this.slotNodes.clear()
    this.migrationState.clear()

    logger.info('Hash slots reset', {
      component: 'HashSlots'
    })
  }
}

module.exports = { HashSlots, CLUSTER_SLOTS }
