const logger = require('../utils/Logger');

/**
 * PubSubManager handles the Publish/Subscribe messaging system
 * Manages channels, subscriptions, and message routing
 */
class PubSubManager {
  constructor() {
    this.channels = new Map(); // channel -> Set of clientIds
    this.patterns = new Map(); // pattern -> Set of clientIds
    this.clientChannels = new Map(); // clientId -> Set of channels
    this.clientPatterns = new Map(); // clientId -> Set of patterns
    this.logger = logger.child({ component: 'PubSubManager' });
  }

  /**
   * Subscribe a client to one or more channels (SUBSCRIBE command)
   */
  subscribe(clientId, channelNames) {
    const results = [];
    
    for (const channel of channelNames) {
      // Add client to channel subscribers
      if (!this.channels.has(channel)) {
        this.channels.set(channel, new Set());
      }
      this.channels.get(channel).add(clientId);
      
      // Track channels for this client
      if (!this.clientChannels.has(clientId)) {
        this.clientChannels.set(clientId, new Set());
      }
      this.clientChannels.get(clientId).add(channel);
      
      // Return subscription confirmation
      const subscriberCount = this.getChannelSubscriberCount(channel);
      results.push(['subscribe', channel, subscriberCount]);
      
      this.logger.debug(`Client ${clientId} subscribed to channel ${channel}`);
    }
    
    return { success: true, subscriptions: results };
  }

  /**
   * Unsubscribe a client from one or more channels (UNSUBSCRIBE command)
   */
  unsubscribe(clientId, channelNames = null) {
    const results = [];
    
    if (channelNames === null) {
      // Unsubscribe from all channels
      const clientChannelSet = this.clientChannels.get(clientId);
      if (clientChannelSet) {
        channelNames = Array.from(clientChannelSet);
      } else {
        channelNames = [];
      }
    }
    
    for (const channel of channelNames) {
      // Remove client from channel subscribers
      if (this.channels.has(channel)) {
        this.channels.get(channel).delete(clientId);
        
        // Clean up empty channels
        if (this.channels.get(channel).size === 0) {
          this.channels.delete(channel);
        }
      }
      
      // Remove channel from client's subscription list
      if (this.clientChannels.has(clientId)) {
        this.clientChannels.get(clientId).delete(channel);
        
        // Clean up empty client entries
        if (this.clientChannels.get(clientId).size === 0) {
          this.clientChannels.delete(clientId);
        }
      }
      
      // Return unsubscription confirmation
      const subscriberCount = this.getChannelSubscriberCount(channel);
      results.push(['unsubscribe', channel, subscriberCount]);
      
      this.logger.debug(`Client ${clientId} unsubscribed from channel ${channel}`);
    }
    
    return { success: true, subscriptions: results };
  }

  /**
   * Subscribe a client to one or more patterns (PSUBSCRIBE command)
   */
  psubscribe(clientId, patternNames) {
    const results = [];
    
    for (const pattern of patternNames) {
      // Add client to pattern subscribers
      if (!this.patterns.has(pattern)) {
        this.patterns.set(pattern, new Set());
      }
      this.patterns.get(pattern).add(clientId);
      
      // Track patterns for this client
      if (!this.clientPatterns.has(clientId)) {
        this.clientPatterns.set(clientId, new Set());
      }
      this.clientPatterns.get(clientId).add(pattern);
      
      // Return subscription confirmation
      const subscriberCount = this.getPatternSubscriberCount(pattern);
      results.push(['psubscribe', pattern, subscriberCount]);
      
      this.logger.debug(`Client ${clientId} subscribed to pattern ${pattern}`);
    }
    
    return { success: true, subscriptions: results };
  }

  /**
   * Unsubscribe a client from one or more patterns (PUNSUBSCRIBE command)
   */
  punsubscribe(clientId, patternNames = null) {
    const results = [];
    
    if (patternNames === null) {
      // Unsubscribe from all patterns
      const clientPatternSet = this.clientPatterns.get(clientId);
      if (clientPatternSet) {
        patternNames = Array.from(clientPatternSet);
      } else {
        patternNames = [];
      }
    }
    
    for (const pattern of patternNames) {
      // Remove client from pattern subscribers
      if (this.patterns.has(pattern)) {
        this.patterns.get(pattern).delete(clientId);
        
        // Clean up empty patterns
        if (this.patterns.get(pattern).size === 0) {
          this.patterns.delete(pattern);
        }
      }
      
      // Remove pattern from client's subscription list
      if (this.clientPatterns.has(clientId)) {
        this.clientPatterns.get(clientId).delete(pattern);
        
        // Clean up empty client entries
        if (this.clientPatterns.get(clientId).size === 0) {
          this.clientPatterns.delete(clientId);
        }
      }
      
      // Return unsubscription confirmation
      const subscriberCount = this.getPatternSubscriberCount(pattern);
      results.push(['punsubscribe', pattern, subscriberCount]);
      
      this.logger.debug(`Client ${clientId} unsubscribed from pattern ${pattern}`);
    }
    
    return { success: true, subscriptions: results };
  }

  /**
   * Publish a message to a channel (PUBLISH command)
   */
  publish(channel, message) {
    let totalReceivers = 0;
    const messageData = ['message', channel, message];
    const patternMessageData = ['pmessage'];
    
    // Send to direct channel subscribers
    if (this.channels.has(channel)) {
      const subscribers = this.channels.get(channel);
      totalReceivers += subscribers.size;
      
      this.logger.debug(`Publishing to channel ${channel}`, { 
        message, 
        subscriberCount: subscribers.size 
      });
    }
    
    // Send to pattern subscribers
    for (const [pattern, subscribers] of this.patterns) {
      if (this.matchPattern(pattern, channel)) {
        totalReceivers += subscribers.size;
        
        this.logger.debug(`Publishing to pattern ${pattern} for channel ${channel}`, { 
          message, 
          subscriberCount: subscribers.size 
        });
      }
    }
    
    this.logger.info(`Message published to channel ${channel}`, { 
      message, 
      totalReceivers 
    });
    
    return { 
      success: true, 
      receivers: totalReceivers,
      channel,
      message,
      directSubscribers: this.channels.get(channel) || new Set(),
      patternSubscribers: this.getPatternSubscribers(channel)
    };
  }

  /**
   * Get subscribers for a channel based on patterns
   */
  getPatternSubscribers(channel) {
    const patternSubscribers = new Map(); // pattern -> Set of clientIds
    
    for (const [pattern, subscribers] of this.patterns) {
      if (this.matchPattern(pattern, channel)) {
        patternSubscribers.set(pattern, subscribers);
      }
    }
    
    return patternSubscribers;
  }

  /**
   * Match a pattern against a channel name
   * Supports Redis-style glob patterns: * and ?
   */
  matchPattern(pattern, channel) {
    // Convert Redis pattern to JavaScript regex
    const regexPattern = pattern
      .replace(/\*/g, '.*')  // * matches any sequence of characters
      .replace(/\?/g, '.')   // ? matches any single character
      .replace(/\[([^\]]+)\]/g, '[$1]'); // Character classes
    
    const regex = new RegExp('^' + regexPattern + '$');
    return regex.test(channel);
  }

  /**
   * Get the number of subscribers for a channel
   */
  getChannelSubscriberCount(channel) {
    return this.channels.has(channel) ? this.channels.get(channel).size : 0;
  }

  /**
   * Get the number of subscribers for a pattern
   */
  getPatternSubscriberCount(pattern) {
    return this.patterns.has(pattern) ? this.patterns.get(pattern).size : 0;
  }

  /**
   * Check if a client has any subscriptions
   */
  hasSubscriptions(clientId) {
    const hasChannels = this.clientChannels.has(clientId) && 
                       this.clientChannels.get(clientId).size > 0;
    const hasPatterns = this.clientPatterns.has(clientId) && 
                       this.clientPatterns.get(clientId).size > 0;
    return hasChannels || hasPatterns;
  }

  /**
   * Get all subscriptions for a client
   */
  getClientSubscriptions(clientId) {
    return {
      channels: this.clientChannels.get(clientId) ? 
                Array.from(this.clientChannels.get(clientId)) : [],
      patterns: this.clientPatterns.get(clientId) ? 
                Array.from(this.clientPatterns.get(clientId)) : []
    };
  }

  /**
   * Clean up subscriptions for a disconnected client
   */
  cleanupClient(clientId) {
    // Unsubscribe from all channels
    if (this.clientChannels.has(clientId)) {
      const channels = Array.from(this.clientChannels.get(clientId));
      this.unsubscribe(clientId, channels);
    }
    
    // Unsubscribe from all patterns
    if (this.clientPatterns.has(clientId)) {
      const patterns = Array.from(this.clientPatterns.get(clientId));
      this.punsubscribe(clientId, patterns);
    }
    
    this.logger.debug(`Cleaned up subscriptions for client ${clientId}`);
  }

  /**
   * Get statistics for monitoring
   */
  getStats() {
    return {
      totalChannels: this.channels.size,
      totalPatterns: this.patterns.size,
      totalSubscribers: this.clientChannels.size,
      channels: Array.from(this.channels.keys()).map(channel => ({
        name: channel,
        subscribers: this.getChannelSubscriberCount(channel)
      })),
      patterns: Array.from(this.patterns.keys()).map(pattern => ({
        name: pattern,
        subscribers: this.getPatternSubscriberCount(pattern)
      }))
    };
  }

  /**
   * Get all active channels
   */
  getActiveChannels() {
    return Array.from(this.channels.keys());
  }

  /**
   * Get all active patterns
   */
  getActivePatterns() {
    return Array.from(this.patterns.keys());
  }

  /**
   * List all subscribers for a channel (for debugging)
   */
  getChannelSubscribers(channel) {
    return this.channels.has(channel) ? 
           Array.from(this.channels.get(channel)) : [];
  }

  /**
   * List all subscribers for a pattern (for debugging)
   */
  getPatternSubscribersForPattern(pattern) {
    return this.patterns.has(pattern) ? 
           Array.from(this.patterns.get(pattern)) : [];
  }
}

module.exports = { PubSubManager };
