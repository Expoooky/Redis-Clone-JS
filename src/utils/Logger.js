/**
 * Logger utility using Winston for structured logging
 * Provides different log levels and configurable outputs
 */

const winston = require('winston')
const path = require('path')

class Logger {
  constructor() {
    this.logger = null
    this.init()
  }

  /**
   * Initialize the Winston logger with appropriate transports and formatting
   */
  init() {
    // Create logs directory if it doesn't exist
    const logDir = 'logs'
    const fs = require('fs')
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true })
    }

    // Define log format
    const logFormat = winston.format.combine(
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss.SSS'
      }),
      winston.format.errors({ stack: true }),
      winston.format.json()
    )

    // Console format for development
    const consoleFormat = winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({
        format: 'HH:mm:ss.SSS'
      }),
      winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
        const serviceStr = service ? `[${service}]` : ''
        return `${timestamp} ${level} ${serviceStr}: ${message} ${metaStr}`
      })
    )

    // Create transports array
    const transports = []
    // Enable console transport unless explicitly disabled
    if (process.env.LOG_CONSOLE !== 'false') {
      transports.push(
        new winston.transports.Console({
          format: consoleFormat,
          level: process.env.LOG_LEVEL || 'info'
        })
      )
    }

    // Add file transports if not in test environment
    if (process.env.NODE_ENV !== 'test') {
      transports.push(
        // All logs file
        new winston.transports.File({
          filename: path.join(logDir, 'redis-clone.log'),
          format: logFormat,
          level: 'info',
          maxsize: 5242880, // 5MB
          maxFiles: 5
        }),
        // Error logs file
        new winston.transports.File({
          filename: path.join(logDir, 'error.log'),
          format: logFormat,
          level: 'error',
          maxsize: 5242880, // 5MB
          maxFiles: 5
        })
      )
    }

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: logFormat,
      defaultMeta: {
        service: 'redis-clone'
      },
      transports,
      // Don't exit on handled exceptions
      exitOnError: false
    })

    // Handle uncaught exceptions and unhandled promise rejections
    this.logger.exceptions.handle(
      new winston.transports.File({
        filename: path.join(logDir, 'exceptions.log'),
        format: logFormat
      })
    )

    this.logger.rejections.handle(
      new winston.transports.File({
        filename: path.join(logDir, 'rejections.log'),
        format: logFormat
      })
    )
  }

  /**
   * Create a child logger with additional context
   * @param {Object} meta - Additional metadata for all logs from this child
   * @returns {Object} Child logger instance
   */
  child(meta = {}) {
    return this.logger.child(meta)
  }

  /**
   * Log debug message
   * @param {string} message - Log message
   * @param {Object} meta - Additional metadata
   */
  debug(message, meta = {}) {
    this.logger.debug(message, meta)
  }

  /**
   * Log info message
   * @param {string} message - Log message
   * @param {Object} meta - Additional metadata
   */
  info(message, meta = {}) {
    this.logger.info(message, meta)
  }

  /**
   * Log warning message
   * @param {string} message - Log message
   * @param {Object} meta - Additional metadata
   */
  warn(message, meta = {}) {
    this.logger.warn(message, meta)
  }

  /**
   * Log error message
   * @param {string} message - Log message
   * @param {Error|Object} error - Error object or additional metadata
   */
  error(message, error = {}) {
    if (error instanceof Error) {
      this.logger.error(message, {
        error: error.message,
        stack: error.stack,
        ...error
      })
    } else {
      this.logger.error(message, error)
    }
  }

  /**
   * Set log level dynamically
   * @param {string} level - New log level (error, warn, info, debug)
   */
  setLevel(level) {
    this.logger.level = level
    this.logger.transports.forEach(transport => {
      transport.level = level
    })
  }

  /**
   * Get current log level
   * @returns {string} Current log level
   */
  getLevel() {
    return this.logger.level
  }
}

// Create singleton instance
const logger = new Logger()

module.exports = logger
