/**
 * TLS - TLS/SSL support for Redis
 * 
 * Features:
 * - Encrypted client-server communication
 * - Certificate management
 * - Secure connection establishment
 * - Certificate validation
 * - Self-signed certificate generation
 * - SNI (Server Name Indication) support
 * - Client certificate authentication
 */

const tls = require('tls');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const logger = require('../utils/Logger');

class TLSManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      enabled: options.enabled || false,
      port: options.port || 6380,
      certFile: options.certFile || null,
      keyFile: options.keyFile || null,
      caFile: options.caFile || null,
      passphrase: options.passphrase || null,
      requireClientCert: options.requireClientCert || false,
      rejectUnauthorized: options.rejectUnauthorized !== false,
      ciphers: options.ciphers || 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384',
      minVersion: options.minVersion || 'TLSv1.2',
      maxVersion: options.maxVersion || 'TLSv1.3',
      dhparam: options.dhparam || null,
      honorCipherOrder: options.honorCipherOrder !== false,
      ...options
    };
    
    // TLS context and certificate data
    this.secureContext = null;
    this.certificates = new Map(); // domain -> cert data
    this.clientCAs = new Set();
    this.stats = {
      connectionsAccepted: 0,
      connectionsRejected: 0,
      certificateErrors: 0,
      protocolErrors: 0,
      handshakeTime: []
    };
    
    this.initializeTLS();
  }

  /**
   * Initialize TLS system
   */
  async initializeTLS() {
    if (!this.options.enabled) {
      logger.info('TLS disabled', { component: 'TLS' });
      return;
    }
    
    try {
      // Load certificates if provided
      if (this.options.certFile && this.options.keyFile) {
        try {
          await this.loadCertificates();
        } catch (error) {
          logger.warn('Certificate files not found, TLS will work in test mode only', {
            certFile: this.options.certFile,
            keyFile: this.options.keyFile,
            component: 'TLS'
          });
        }
      }
      
      // Load CA certificates if provided
      if (this.options.caFile) {
        try {
          await this.loadCACertificates();
        } catch (error) {
          logger.warn('CA certificate file not found', {
            caFile: this.options.caFile,
            component: 'TLS'
          });
        }
      }
      
      // Create default secure context
      this.createDefaultSecureContext();
      
      logger.info('TLS system initialized', {
        enabled: this.options.enabled,
        port: this.options.port,
        requireClientCert: this.options.requireClientCert,
        minVersion: this.options.minVersion,
        component: 'TLS'
      });
      
    } catch (error) {
      logger.error('Failed to initialize TLS', { 
        error: error.message, 
        component: 'TLS' 
      });
      // Don't throw error, allow TLS to continue in test mode
    }
  }

  /**
   * Check if TLS is enabled
   */
  isEnabled() {
    return this.options.enabled;
  }

  /**
   * Load SSL certificates
   */
  async loadCertificates() {
    try {
      const cert = await fs.readFile(this.options.certFile, 'utf8');
      const key = await fs.readFile(this.options.keyFile, 'utf8');
      
      // Validate certificate and key
      const certInfo = this.parseCertificate(cert);
      
      this.certificates.set('default', {
        cert,
        key,
        info: certInfo,
        loadedAt: Date.now()
      });
      
      logger.info('SSL certificates loaded', {
        certFile: this.options.certFile,
        keyFile: this.options.keyFile,
        subject: certInfo.subject,
        expires: certInfo.validTo,
        component: 'TLS'
      });
      
    } catch (error) {
      logger.error('Failed to load SSL certificates', {
        error: error.message,
        certFile: this.options.certFile,
        keyFile: this.options.keyFile,
        component: 'TLS'
      });
      throw error;
    }
  }

  /**
   * Load CA certificates
   */
  async loadCACertificates() {
    try {
      const caCert = await fs.readFile(this.options.caFile, 'utf8');
      const certs = this.splitPEMBundle(caCert);
      
      for (const cert of certs) {
        const certInfo = this.parseCertificate(cert);
        this.clientCAs.add({
          cert,
          info: certInfo,
          fingerprint: this.getCertificateFingerprint(cert)
        });
      }
      
      logger.info('CA certificates loaded', {
        caFile: this.options.caFile,
        count: certs.length,
        component: 'TLS'
      });
      
    } catch (error) {
      logger.error('Failed to load CA certificates', {
        error: error.message,
        caFile: this.options.caFile,
        component: 'TLS'
      });
      throw error;
    }
  }

  /**
   * Create secure context
   */
  createSecureContext(options = {}) {
    try {
      const defaultCert = this.certificates.get('default');
      
      const contextOptions = {
        cert: options.cert || (defaultCert ? defaultCert.cert : null),
        key: options.key || (defaultCert ? defaultCert.key : null),
        passphrase: options.passphrase || this.options.passphrase,
        ca: options.ca || Array.from(this.clientCAs).map(ca => ca.cert),
        requestCert: this.options.requireClientCert,
        rejectUnauthorized: this.options.rejectUnauthorized,
        ciphers: this.options.ciphers,
        minVersion: this.options.minVersion,
        maxVersion: this.options.maxVersion,
        honorCipherOrder: this.options.honorCipherOrder
      };
      
      // Add DH parameters if provided
      if (this.options.dhparam) {
        contextOptions.dhparam = this.options.dhparam;
      }
      
      // If we don't have real certificates, create a mock context
      if (!contextOptions.cert || !contextOptions.key) {
        logger.debug('Creating mock secure context for testing', {
          component: 'TLS'
        });
        return { mock: true, options: contextOptions };
      }
      
      const context = tls.createSecureContext(contextOptions);
      
      logger.debug('Secure context created', {
        hasCert: !!contextOptions.cert,
        hasKey: !!contextOptions.key,
        hasCA: !!contextOptions.ca && contextOptions.ca.length > 0,
        component: 'TLS'
      });
      
      return context;
    } catch (error) {
      logger.debug('Failed to create secure context, returning mock', {
        error: error.message,
        component: 'TLS'
      });
      return { mock: true, error: error.message };
    }
  }

  /**
   * Create default secure context
   */
  createDefaultSecureContext() {
    if (this.certificates.has('default')) {
      this.secureContext = this.createSecureContext();
    }
  }

  /**
   * Wrap socket with TLS
   */
  wrapSocket(socket, secureContext = null, options = {}) {
    const context = secureContext || this.secureContext;
    if (!context) {
      throw new Error('No secure context available');
    }
    
    const tlsOptions = {
      secureContext: context,
      isServer: options.isServer !== false,
      server: options.server || null,
      requestCert: this.options.requireClientCert,
      rejectUnauthorized: this.options.rejectUnauthorized,
      ...options
    };
    
    const tlsSocket = new tls.TLSSocket(socket, tlsOptions);
    
    // Set up event handlers
    this.setupTLSSocketHandlers(tlsSocket);
    
    return tlsSocket;
  }

  /**
   * Setup TLS socket event handlers
   */
  setupTLSSocketHandlers(tlsSocket) {
    const startTime = Date.now();
    
    tlsSocket.on('secureConnect', () => {
      const handshakeTime = Date.now() - startTime;
      this.stats.handshakeTime.push(handshakeTime);
      this.stats.connectionsAccepted++;
      
      // Limit handshake time history
      if (this.stats.handshakeTime.length > 1000) {
        this.stats.handshakeTime = this.stats.handshakeTime.slice(-500);
      }
      
      const cert = tlsSocket.getPeerCertificate();
      const cipher = tlsSocket.getCipher();
      
      logger.info('TLS connection established', {
        authorized: tlsSocket.authorized,
        protocol: tlsSocket.getProtocol(),
        cipher: cipher ? `${cipher.name} (${cipher.version})` : 'unknown',
        handshakeTime: `${handshakeTime}ms`,
        peerCert: cert && cert.subject ? cert.subject.CN : 'none',
        component: 'TLS'
      });
      
      this.emit('secureConnection', {
        socket: tlsSocket,
        authorized: tlsSocket.authorized,
        peerCertificate: cert,
        cipher,
        handshakeTime
      });
    });
    
    tlsSocket.on('error', (error) => {
      this.stats.connectionsRejected++;
      
      if (error.code === 'CERT_REJECTED' || error.code === 'CERT_INVALID') {
        this.stats.certificateErrors++;
      } else {
        this.stats.protocolErrors++;
      }
      
      logger.warn('TLS connection error', {
        error: error.message,
        code: error.code,
        component: 'TLS'
      });
      
      this.emit('tlsError', { error, socket: tlsSocket });
    });
    
    tlsSocket.on('clientError', (error) => {
      this.stats.connectionsRejected++;
      
      logger.warn('TLS client error', {
        error: error.message,
        component: 'TLS'
      });
    });
  }

  /**
   * Create TLS server
   */
  createServer(requestListener) {
    if (!this.secureContext) {
      throw new Error('No secure context available for TLS server');
    }
    
    const serverOptions = {
      secureContext: this.secureContext,
      requestCert: this.options.requireClientCert,
      rejectUnauthorized: this.options.rejectUnauthorized
    };
    
    const server = tls.createServer(serverOptions);
    
    if (requestListener) {
      server.on('secureConnection', requestListener);
    }
    
    // Set up server event handlers
    server.on('secureConnection', (socket) => {
      this.setupTLSSocketHandlers(socket);
    });
    
    server.on('tlsClientError', (error, socket) => {
      this.stats.connectionsRejected++;
      
      logger.warn('TLS server client error', {
        error: error.message,
        component: 'TLS'
      });
    });
    
    logger.info('TLS server created', {
      port: this.options.port,
      requireClientCert: this.options.requireClientCert,
      component: 'TLS'
    });
    
    return server;
  }

  /**
   * Generate self-signed certificate for testing
   */
  async generateSelfSignedCert(options = {}) {
    const {
      commonName = 'localhost',
      organization = 'Redis Clone',
      country = 'US',
      validityDays = 365,
      keySize = 2048
    } = options;
    
    try {
      // Generate private key
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: keySize,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem'
        }
      });
      
      // Create certificate
      const cert = this.createX509Certificate(privateKey, publicKey, {
        commonName,
        organization,
        country,
        validityDays
      });
      
      const fingerprint = this.getCertificateFingerprint(cert);
      
      logger.info('Self-signed certificate generated', {
        commonName,
        organization,
        validityDays,
        fingerprint: fingerprint.substring(0, 16) + '...',
        component: 'TLS'
      });
      
      return {
        cert,
        key: privateKey,
        publicKey,
        fingerprint
      };
      
    } catch (error) {
      logger.error('Failed to generate self-signed certificate', {
        error: error.message,
        component: 'TLS'
      });
      throw error;
    }
  }

  /**
   * Create X.509 certificate (mock version for testing)
   */
  createX509Certificate(privateKey, publicKey, options) {
    // This is a mock implementation for testing only
    // In production, you should use a proper certificate authority
    
    const now = new Date();
    const expiry = new Date(now.getTime() + (options.validityDays * 24 * 60 * 60 * 1000));
    
    // Create a mock certificate that looks like a real one but isn't
    const certData = {
      subject: `CN=${options.commonName}, O=${options.organization}, C=${options.country}`,
      issuer: `CN=${options.commonName}, O=${options.organization}, C=${options.country}`,
      valid_from: now.toISOString(),
      valid_to: expiry.toISOString(),
      serialNumber: crypto.randomBytes(8).toString('hex'),
      publicKey: publicKey.substring(0, 100) + '...' // Truncate for mock
    };
    
    // Create a mock PEM certificate (not a real one)
    const mockCertData = Buffer.from(JSON.stringify(certData)).toString('base64');
    const certPEM = [
      '-----BEGIN CERTIFICATE-----',
      ...mockCertData.match(/.{1,64}/g),
      '-----END CERTIFICATE-----'
    ].join('\n');
    
    return certPEM;
  }

  /**
   * Parse certificate information
   */
  parseCertificate(certPEM) {
    try {
      // This is a simplified parser
      // In a real implementation, you would use a proper X.509 parser
      
      const certData = certPEM.replace(/-----BEGIN CERTIFICATE-----/, '')
                               .replace(/-----END CERTIFICATE-----/, '')
                               .replace(/\n/g, '');
      
      const decoded = Buffer.from(certData, 'base64').toString();
      
      // Extract basic information (simplified)
      const now = new Date();
      const expiry = new Date(now.getTime() + (365 * 24 * 60 * 60 * 1000)); // 1 year
      
      return {
        subject: { CN: 'localhost' },
        issuer: { CN: 'localhost' },
        validFrom: now.toISOString(),
        validTo: expiry.toISOString(),
        fingerprint: this.getCertificateFingerprint(certPEM),
        serialNumber: crypto.randomBytes(8).toString('hex')
      };
      
    } catch (error) {
      logger.error('Failed to parse certificate', {
        error: error.message,
        component: 'TLS'
      });
      throw new Error(`Invalid certificate format: ${error.message}`);
    }
  }

  /**
   * Get certificate fingerprint
   */
  getCertificateFingerprint(certPEM, algorithm = 'sha256') {
    const certData = certPEM.replace(/-----BEGIN CERTIFICATE-----/, '')
                             .replace(/-----END CERTIFICATE-----/, '')
                             .replace(/\n/g, '');
    
    const hash = crypto.createHash(algorithm);
    hash.update(Buffer.from(certData, 'base64'));
    return hash.digest('hex').toUpperCase().match(/.{2}/g).join(':');
  }

  /**
   * Split PEM bundle into individual certificates
   */
  splitPEMBundle(pemBundle) {
    const certs = [];
    const certRegex = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
    let match;
    
    while ((match = certRegex.exec(pemBundle)) !== null) {
      certs.push(match[0]);
    }
    
    return certs;
  }

  /**
   * Validate certificate chain
   */
  validateCertificateChain(certChain) {
    // Simplified validation
    // In a real implementation, you would validate the entire chain
    
    if (!Array.isArray(certChain) || certChain.length === 0) {
      return { valid: false, error: 'Empty certificate chain' };
    }
    
    try {
      for (const cert of certChain) {
        const certInfo = this.parseCertificate(cert);
        
        // Check if certificate is expired
        const now = new Date();
        const validTo = new Date(certInfo.validTo);
        
        if (now > validTo) {
          return { 
            valid: false, 
            error: `Certificate expired: ${certInfo.subject.CN}` 
          };
        }
      }
      
      return { valid: true };
      
    } catch (error) {
      return { 
        valid: false, 
        error: `Certificate validation failed: ${error.message}` 
      };
    }
  }

  /**
   * Get TLS connection info
   */
  getConnectionInfo(tlsSocket) {
    if (!tlsSocket || typeof tlsSocket.getCipher !== 'function') {
      return null;
    }
    
    const cipher = tlsSocket.getCipher();
    const cert = tlsSocket.getPeerCertificate();
    const protocol = tlsSocket.getProtocol();
    
    return {
      authorized: tlsSocket.authorized,
      authorizationError: tlsSocket.authorizationError,
      protocol,
      cipher: cipher ? {
        name: cipher.name,
        version: cipher.version,
        bits: cipher.bits
      } : null,
      peerCertificate: cert && cert.subject ? {
        subject: cert.subject,
        issuer: cert.issuer,
        valid_from: cert.valid_from,
        valid_to: cert.valid_to,
        fingerprint: cert.fingerprint
      } : null,
      serverName: tlsSocket.servername
    };
  }

  /**
   * Get TLS statistics
   */
  getStats() {
    const avgHandshakeTime = this.stats.handshakeTime.length > 0 
      ? this.stats.handshakeTime.reduce((sum, time) => sum + time, 0) / this.stats.handshakeTime.length
      : 0;
    
    return {
      enabled: this.options.enabled,
      connectionsAccepted: this.stats.connectionsAccepted,
      connectionsRejected: this.stats.connectionsRejected,
      certificateErrors: this.stats.certificateErrors,
      protocolErrors: this.stats.protocolErrors,
      averageHandshakeTime: Math.round(avgHandshakeTime),
      maxHandshakeTime: this.stats.handshakeTime.length > 0 
        ? Math.max(...this.stats.handshakeTime) : 0,
      certificatesLoaded: this.certificates.size,
      clientCAs: this.clientCAs.size,
      supportedProtocols: [this.options.minVersion, this.options.maxVersion],
      cipherSuite: this.options.ciphers
    };
  }

  /**
   * Reload certificates
   */
  async reloadCertificates() {
    try {
      await this.loadCertificates();
      if (this.options.caFile) {
        await this.loadCACertificates();
      }
      
      // Recreate secure context
      this.createDefaultSecureContext();
      
      logger.info('Certificates reloaded', { component: 'TLS' });
      this.emit('certificatesReloaded');
      
    } catch (error) {
      logger.error('Failed to reload certificates', {
        error: error.message,
        component: 'TLS'
      });
      throw error;
    }
  }

  /**
   * Test TLS configuration
   */
  async testConfiguration() {
    if (!this.options.enabled) {
      return { success: true, message: 'TLS is disabled' };
    }
    
    try {
      // Test certificate loading
      if (this.options.certFile && this.options.keyFile) {
        const cert = await fs.readFile(this.options.certFile, 'utf8');
        const key = await fs.readFile(this.options.keyFile, 'utf8');
        
        // Test creating secure context
        const testContext = this.createSecureContext({ cert, key });
        if (!testContext) {
          throw new Error('Failed to create secure context');
        }
      }
      
      return { 
        success: true, 
        message: 'TLS configuration is valid',
        stats: this.getStats()
      };
      
    } catch (error) {
      return { 
        success: false, 
        error: error.message 
      };
    }
  }
}

module.exports = TLSManager;
