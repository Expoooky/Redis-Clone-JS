const logger = require('../utils/Logger');

/**
 * Transaction class represents a single client transaction
 * Handles command queuing, watched keys, and execution state
 */
class Transaction {
  constructor(clientId) {
    this.clientId = clientId;
    this.commands = []; // Array of queued commands
    this.watchedKeys = new Set(); // Set of keys being watched
    this.isActive = false; // Whether MULTI has been called
    this.logger = logger.child({ component: 'Transaction', clientId });
  }

  /**
   * Start a transaction (MULTI command)
   */
  start() {
    if (this.isActive) {
      return { success: false, error: 'ERR MULTI calls can not be nested' };
    }
    
    this.isActive = true;
    this.commands = [];
    this.logger.debug('Transaction started');
    return { success: true };
  }

  /**
   * Queue a command for execution (commands after MULTI)
   */
  queue(command, args) {
    if (!this.isActive) {
      return { success: false, error: 'ERR command not in transaction context' };
    }

    // Commands that cannot be queued in transactions
    const disallowedCommands = new Set([
      'MULTI', 'EXEC', 'DISCARD', 'WATCH', 'UNWATCH',
      'SUBSCRIBE', 'UNSUBSCRIBE', 'PSUBSCRIBE', 'PUNSUBSCRIBE'
    ]);

    if (disallowedCommands.has(command.toUpperCase())) {
      return { success: false, error: `ERR ${command.toUpperCase()} inside MULTI is not allowed` };
    }

    this.commands.push({ command: command.toLowerCase(), args: args || [] });
    this.logger.debug(`Command queued: ${command}`, { args });
    return { success: true };
  }

  /**
   * Add a key to watch list (WATCH command)
   */
  watch(key) {
    if (this.isActive) {
      return { success: false, error: 'ERR WATCH inside MULTI is not allowed' };
    }
    
    this.watchedKeys.add(key);
    this.logger.debug(`Key watched: ${key}`);
    return { success: true };
  }

  /**
   * Remove a key from watch list or clear all watched keys (UNWATCH command)
   */
  unwatch(key = null) {
    if (this.isActive) {
      return { success: false, error: 'ERR UNWATCH inside MULTI is not allowed' };
    }

    if (key === null) {
      this.watchedKeys.clear();
      this.logger.debug('All keys unwatched');
    } else {
      this.watchedKeys.delete(key);
      this.logger.debug(`Key unwatched: ${key}`);
    }
    
    return { success: true };
  }

  /**
   * Check if any watched keys have been modified
   */
  areWatchedKeysModified(dataStore) {
    for (const key of this.watchedKeys) {
      // Check if key has been modified since it was watched
      // This is a simplified version - in a real implementation,
      // we would need to track modification timestamps
      if (dataStore.hasBeenModified && dataStore.hasBeenModified(key)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get the list of queued commands
   */
  getQueuedCommands() {
    return [...this.commands];
  }

  /**
   * Get the set of watched keys
   */
  getWatchedKeys() {
    return new Set(this.watchedKeys);
  }

  /**
   * Discard the transaction (DISCARD command)
   */
  discard() {
    if (!this.isActive) {
      return { success: false, error: 'ERR DISCARD without MULTI' };
    }

    this.commands = [];
    this.isActive = false;
    this.logger.debug('Transaction discarded');
    return { success: true, response: 'OK' };
  }

  /**
   * Reset transaction state (called after EXEC or on client disconnect)
   */
  reset() {
    this.commands = [];
    this.watchedKeys.clear();
    this.isActive = false;
    this.logger.debug('Transaction reset');
  }

  /**
   * Check if transaction is currently active
   */
  isInTransaction() {
    return this.isActive;
  }

  /**
   * Get transaction statistics
   */
  getStats() {
    return {
      clientId: this.clientId,
      isActive: this.isActive,
      queuedCommands: this.commands.length,
      watchedKeys: this.watchedKeys.size
    };
  }
}

module.exports = { Transaction };
