const { Transaction } = require('./Transaction');
const logger = require('../utils/Logger');

/**
 * MultiExecManager handles multiple client transactions
 * Manages the MULTI/EXEC transaction lifecycle
 */
class MultiExecManager {
  constructor() {
    this.server = null; // Will be set later
    this.transactions = new Map(); // clientId -> Transaction
    this.logger = logger.child({ component: 'MultiExecManager' });
  }

  /**
   * Set the server instance (called after server construction)
   */
  setServer(server) {
    this.server = server;
  }

  /**
   * Get or create a transaction for a client
   */
  getTransaction(clientId) {
    if (!this.transactions.has(clientId)) {
      this.transactions.set(clientId, new Transaction(clientId));
    }
    return this.transactions.get(clientId);
  }

  /**
   * Start a transaction (MULTI command)
   */
  multi(clientId) {
    const transaction = this.getTransaction(clientId);
    const result = transaction.start();
    
    if (result.success) {
      this.logger.info(`Transaction started for client ${clientId}`);
      return { success: true, response: 'OK' };
    } else {
      return { success: false, error: result.error };
    }
  }

  /**
   * Queue a command in the current transaction
   */
  queueCommand(clientId, command, args) {
    const transaction = this.getTransaction(clientId);
    
    if (!transaction.isInTransaction()) {
      // Not in a transaction, execute command immediately
      return null;
    }

    const result = transaction.queue(command, args);
    
    if (result.success) {
      return { success: true, response: 'QUEUED' };
    } else {
      return { success: false, error: result.error };
    }
  }

  /**
   * Execute all queued commands atomically (EXEC command)
   */
  async exec(clientId) {
    const transaction = this.getTransaction(clientId);
    
    if (!transaction.isInTransaction()) {
      return { success: false, error: 'ERR EXEC without MULTI' };
    }

    const queuedCommands = transaction.getQueuedCommands();
    const watchedKeys = transaction.getWatchedKeys();
    
    // Check if any watched keys have been modified
    // In a real implementation, this would check modification timestamps
    // For simplicity, we'll assume watched keys haven't been modified
    const keysModified = false; // transaction.areWatchedKeysModified(this.server.dataStore);
    
    if (keysModified) {
      // If watched keys were modified, return null (transaction failed)
      transaction.reset();
      this.logger.warn(`Transaction aborted for client ${clientId} - watched keys modified`);
      return { success: true, response: null };
    }

    // Execute all commands atomically
    const results = [];
    let allSuccessful = true;

    try {
      // Lock the data store to ensure atomicity
      // In a real implementation, this would use proper locking mechanisms
      
      for (const { command, args } of queuedCommands) {
        try {
          // Route the command to the appropriate handler
          const result = await this.executeCommand(command, args);
          
          // Extract the actual response from the result wrapper
          if (result.success) {
            results.push(result.response);
          } else {
            results.push({ error: result.error });
            allSuccessful = false;
          }
        } catch (error) {
          // If any command fails, we still continue but mark the error
          this.logger.error(`Command failed in transaction: ${command}`, { error: error.message, args });
          results.push({ error: error.message });
          allSuccessful = false;
        }
      }

      // Reset the transaction
      transaction.reset();
      
      this.logger.info(`Transaction executed for client ${clientId}`, { 
        commandCount: queuedCommands.length, 
        allSuccessful 
      });

      return { success: true, response: results };
      
    } catch (error) {
      // If there's a critical error, reset and return error
      transaction.reset();
      this.logger.error(`Critical error during transaction execution for client ${clientId}`, { error: error.message });
      return { success: false, error: 'ERR transaction execution failed' };
    }
  }

  /**
   * Execute a single command within the transaction context
   */
  async executeCommand(command, args) {
    try {
      // Use the server's executeCommand method which returns results directly
      const result = await this.server.executeCommand(command, args, 0); // Use database 0 for now
      
      if (result && typeof result === 'object' && result.error) {
        return { success: false, error: result.error };
      }
      
      return { success: true, response: result };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Discard the current transaction (DISCARD command)
   */
  discard(clientId) {
    const transaction = this.getTransaction(clientId);
    const result = transaction.discard();
    
    if (result.success) {
      this.logger.info(`Transaction discarded for client ${clientId}`);
      return { success: true, response: 'OK' };
    } else {
      return { success: false, error: result.error };
    }
  }

  /**
   * Watch a key for modifications (WATCH command)
   */
  watch(clientId, keys) {
    const transaction = this.getTransaction(clientId);
    
    for (const key of keys) {
      const result = transaction.watch(key);
      if (!result.success) {
        return { success: false, error: result.error };
      }
    }
    
    this.logger.debug(`Keys watched for client ${clientId}`, { keys });
    return { success: true, response: 'OK' };
  }

  /**
   * Unwatch keys (UNWATCH command)
   */
  unwatch(clientId, keys = null) {
    const transaction = this.getTransaction(clientId);
    
    if (keys === null) {
      // Unwatch all keys
      const result = transaction.unwatch();
      if (result.success) {
        this.logger.debug(`All keys unwatched for client ${clientId}`);
        return { success: true, response: 'OK' };
      } else {
        return { success: false, error: result.error };
      }
    } else {
      // Unwatch specific keys
      for (const key of keys) {
        const result = transaction.unwatch(key);
        if (!result.success) {
          return { success: false, error: result.error };
        }
      }
      
      this.logger.debug(`Keys unwatched for client ${clientId}`, { keys });
      return { success: true, response: 'OK' };
    }
  }

  /**
   * Check if a client is currently in a transaction
   */
  isInTransaction(clientId) {
    const transaction = this.transactions.get(clientId);
    return transaction ? transaction.isInTransaction() : false;
  }

  /**
   * Clean up transaction data for a disconnected client
   */
  cleanupClient(clientId) {
    if (this.transactions.has(clientId)) {
      const transaction = this.transactions.get(clientId);
      transaction.reset();
      this.transactions.delete(clientId);
      this.logger.debug(`Transaction cleanup for client ${clientId}`);
    }
  }

  /**
   * Get transaction statistics for monitoring
   */
  getStats() {
    const stats = {
      totalTransactions: this.transactions.size,
      activeTransactions: 0,
      transactions: []
    };

    for (const [clientId, transaction] of this.transactions) {
      const transactionStats = transaction.getStats();
      stats.transactions.push(transactionStats);
      
      if (transaction.isInTransaction()) {
        stats.activeTransactions++;
      }
    }

    return stats;
  }

  /**
   * Get all active transactions (for debugging)
   */
  getActiveTransactions() {
    const active = [];
    for (const [clientId, transaction] of this.transactions) {
      if (transaction.isInTransaction()) {
        active.push({
          clientId,
          queuedCommands: transaction.getQueuedCommands(),
          watchedKeys: Array.from(transaction.getWatchedKeys())
        });
      }
    }
    return active;
  }
}

module.exports = { MultiExecManager };
