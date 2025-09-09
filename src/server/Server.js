"use strict";

const net = require("net");
const tls = require("tls");
const fs = require("fs");
const crypto = require("crypto");
const { CommandParser, arrayNodeToStringArray, encodeError, encodeBulkString, encodeArrayOfBulkStrings } = require("../core/protocol");
const { DataStore } = require("../core/datastore");
const { AppendOnlyFile } = require("./aof");
const { SnapshotManager, serializeStore, loadFromObject } = require("./snapshot");
const { AclManager } = require("./acl");
const { createMonitoringServer } = require("./monitor");

// Minimal .env loader (no external deps)
function loadDotEnv() {
  try {
    const path = require("path");
    const envPath = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, "utf8");
    const lines = content.split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {}
}

loadDotEnv();

const DEFAULT_PORT = process.env.REDISJS_PORT ? parseInt(process.env.REDISJS_PORT, 10) : (process.env.PORT ? parseInt(process.env.PORT, 10) : 6379);

class RedisLikeServer {
  constructor(options = {}) {
    this.port = (options.port ?? DEFAULT_PORT);
    // TLS configuration
    // TLS support similar to Redis (separate tls-port)
    this.tlsPort = options.tlsPort ?? (process.env.REDISJS_TLS_PORT ? parseInt(process.env.REDISJS_TLS_PORT, 10) : undefined);
    this.tlsOptions = null;
    this.tlsServer = null;
    if (this.tlsPort) {
      const pfxPath = options.tlsPfxPath || process.env.REDISJS_TLS_PFX_FILE;
      const pfxPass = options.tlsPfxPass || process.env.REDISJS_TLS_PFX_PASSPHRASE;
      const keyPath = options.tlsKeyPath || process.env.REDISJS_TLS_KEY_FILE || process.env.REDISJS_TLS_KEY;
      const certPath = options.tlsCertPath || process.env.REDISJS_TLS_CERT_FILE || process.env.REDISJS_TLS_CERT;
      const caPath = options.tlsCaPath || process.env.REDISJS_TLS_CA_CERT_FILE || process.env.REDISJS_TLS_CA;
      const authClients = ((options.tlsAuthClients ?? process.env.REDISJS_TLS_AUTH_CLIENTS) || 'no').toString().toLowerCase() === 'yes';
      const minVersion = options.tlsMinVersion || process.env.REDISJS_TLS_MIN_VERSION; // e.g., 'TLSv1.2'
      const maxVersion = options.tlsMaxVersion || process.env.REDISJS_TLS_MAX_VERSION; // e.g., 'TLSv1.3'
      const ciphers = options.tlsCiphers || process.env.REDISJS_TLS_CIPHERS;

      if (!pfxPath && (!keyPath || !certPath)) {
        throw new Error("TLS configured but no credentials provided. Set REDISJS_TLS_PFX_FILE or REDISJS_TLS_KEY_FILE and REDISJS_TLS_CERT_FILE.");
      }
      const tlsOpts = {};
      if (pfxPath) {
        tlsOpts.pfx = fs.readFileSync(pfxPath);
        if (pfxPass) tlsOpts.passphrase = String(pfxPass);
      } else {
        tlsOpts.key = fs.readFileSync(keyPath);
        tlsOpts.cert = fs.readFileSync(certPath);
      }
      if (caPath) tlsOpts.ca = [fs.readFileSync(caPath)];
      if (minVersion) tlsOpts.minVersion = minVersion;
      if (maxVersion) tlsOpts.maxVersion = maxVersion;
      if (ciphers) tlsOpts.ciphers = ciphers;
      tlsOpts.requestCert = authClients;
      tlsOpts.rejectUnauthorized = authClients && !!caPath;

      this.tlsOptions = tlsOpts;
    }
    this.server = net.createServer(this._handleConnection.bind(this));
    this.clients = new Set();
    this.authPassword = options.password || process.env.REDISJS_PASSWORD;
    this.acl = new AclManager({ defaultPassword: this.authPassword });
    // Client-side caching tracking
    this.trackingKeyToClients = new Map(); // storedKey -> Set<socket>
    this.trackingBcastClients = new Set(); // sockets with bcast tracking
    this.store = new DataStore({
      onKeyEvent: (event, key) => {
        // Expire notifications via keyevent channel when enabled
        if (event === 'expired') {
          const info = this._extractDbAndKeyFromStoredKey(String(key));
          const db = info ? info.db : 0;
          const dispKey = info ? info.key : String(key);
          this._maybePublishKeyspace('expired', 'x', db, dispKey);
        }
      }
    });
    const aofEnv = process.env.REDISJS_AOF;
    this.enableAOF = options.enableAOF !== false && !(aofEnv && (aofEnv === '0' || aofEnv.toLowerCase?.() === 'false'));
    this.aof = this.enableAOF ? new AppendOnlyFile(options.aofPath || process.env.REDISJS_AOF_FILE) : null;
    this.snapshot = new SnapshotManager(options.snapshotPath || process.env.REDISJS_SNAPSHOT_FILE);
    this._aofWrite = Promise.resolve();
    this._writeCommands = new Set([
      // core
      "SET", "SETNX", "DEL", "MSET", "MSETNX",
      // strings
      "APPEND", "INCR", "DECR", "INCRBY", "DECRBY", "INCRBYFLOAT", "SETRANGE", "GETSET", "SETEX",
      // lists
      "LPUSH", "RPUSH", "LPOP", "RPOP", "LSET",
      // hashes
      "HSET", "HMSET", "HDEL",
      // sets
      "SADD", "SREM", "SPOP",
      // zsets
      "ZADD", "ZREM",
      // vectors
      "VEC.ADD", "VEC.CREATEINDEX", "VEC.REBUILD", "VEC.ADDVEC", "VEC.SUBVEC", "VEC.EMBEDADD",
      // geo
      "GEOADD", "GEOPOS", "GEOSEARCHSTORE", "GEORADIUS", "GEORADIUSBYMEMBER",
      // bitmaps/bitfields
      "SETBIT", "BITOP", "BITFIELD",
      // hyperloglog
      "PFADD", "PFMERGE",
      // time series
      "TS.CREATE", "TS.ADD", "TS.CREATERULE", "TS.DELETERULE",
      // documents
      "DOC.INDEXCREATE", "DOC.INDEXDROP", "DOC.INDEXADD", "DOC.INDEXDEL", "DOC.INDEXUPDATE", "DOC.INDEXREBUILD",
      // cuckoo filters
      "CF.RESERVE", "CF.ADD", "CF.ADDNX", "CF.DEL", "CF.INSERT", "CF.INSERTNX", "CF.MADD",
      // streams
      "XADD", "XDEL", "XTRIM", "XACK", "XGROUP",
      // ttl
      "EXPIRE", "PERSIST",
      // snapshot
      "SAVE"
    ]);
    this.channels = new Map(); // channel -> Set<socket>
    this.slowlog = [];
    this.slowlogLen = 128;
    const slowEnv = process.env.REDISJS_SLOWLOG_THRESHOLD_US ? parseInt(process.env.REDISJS_SLOWLOG_THRESHOLD_US, 10) : undefined;
    this.slowlogThresholdUs = options.slowlogThresholdUs ?? (Number.isFinite(slowEnv) ? slowEnv : 1000); // 1ms default
    // Keyspace notifications configuration (subset of Redis flags): K/E channels and classes g,$,l,s,h,z,x or A
    this.notifyKeyspaceFlags = String(process.env.REDISJS_NOTIFY_KEYSPACE_EVENTS || '');
    this._notify = this._parseNotifyFlags(this.notifyKeyspaceFlags);
    // replication role and peers
    this.role = (options.role || process.env.REDISJS_ROLE || 'master').toLowerCase();
    this.replicas = new Set();
    this.master = null;
    // replication identity and backlog (byte-based)
    this.runId = options.runId || crypto.randomBytes(20).toString('hex');
    this.replicationOffset = 0; // last byte offset written to backlog
    this.replBacklogBuf = Buffer.alloc(0);
    this.replBacklogMaxBytes = (() => {
      const envBytes = process.env.REDISJS_REPL_BACKLOG_BYTES ? parseInt(process.env.REDISJS_REPL_BACKLOG_BYTES, 10) : undefined;
      const opt = options.replicationBacklogBytes;
      const v = Number.isFinite(opt) && opt > 0 ? opt : (Number.isFinite(envBytes) && envBytes > 0 ? envBytes : 1024 * 1024);
      return v;
    })();
    this.masterRunId = null; // used when acting as replica
    this.replAppliedOffset = -1; // used when acting as replica
    this._replBackoffMs = 1000;
    this._bgsaveInProgress = false;
  }

  async start(callback) {
    // Load snapshot first (precedence over AOF)
    let loadedSnapshot = false;
    try {
      if (this.snapshot && this.snapshot.exists()) {
        await this.snapshot.loadInto(this.store);
        loadedSnapshot = true;
      }
    } catch {}

    if (this.aof) {
      await this.aof.loadAndReplay((cmd, args) => {
        try {
          const upper = String(cmd).toUpperCase();
          const effective = this._rewriteArgsForDb(upper, args, 0);
          this.store.dispatch(upper, effective);
        } catch {}
      });
    }

    this.server.listen(this.port, callback || (() => {
      console.log(`Server listening on 127.0.0.1:${this.port}`);
    }));
    if (this.tlsOptions && this.tlsPort) {
      this.tlsServer = tls.createServer(this.tlsOptions, this._handleConnection.bind(this));
      this.tlsServer.listen(this.tlsPort, () => {
        console.log(`TLS Server listening on 127.0.0.1:${this.tlsPort}`);
      });
    }
    // Monitoring UI: only start if explicitly configured
    try {
      const envPort = process.env.REDISJS_MONITOR_PORT;
      const port = envPort !== undefined ? parseInt(envPort, 10) : null;
      if (Number.isFinite(port) && port > 0) {
        this.monitorServer = createMonitoringServer(this, {});
        // Ensure the monitor server never keeps the process alive during tests
        try { this.monitorServer.unref?.(); } catch {}
        this.monitorServer.listen(port, () => {
          console.log(`Monitor UI on http://127.0.0.1:${port}`);
        });
        this.monitorServer.on('error', () => { try { this.monitorServer.unref?.(); } catch {} });
        // In tests, auto-close monitor server when main TCP closes to avoid hanging the runner
        if (process.env.NODE_ENV === 'test') {
          try { this.server.once('close', () => { try { this.monitorServer.close(); } catch {} }); } catch {}
        }
      }
    } catch {}
  }

  _handleConnection(socket) {
    // track client connection (both TCP and TLS)
    try { this.clients.add(socket); } catch {}
    const parser = new CommandParser();
    const state = {
      inMulti: false,
      queue: [], // [cmd, args]
      subscriptions: new Set(),
      blockers: [], // [{type:'BLPOP'|'BRPOP', keys:string[], timeout:number, started:number}]
      db: 0
    };
    // per-socket tracking state
    socket.__tracking = false;
    socket.__trackingBcast = false;
    socket.__trackingPrefixes = new Set();
    socket.__trackedStoredKeys = new Set();
    socket.__user = 'default';
    socket.on("data", (chunk) => {
      try {
        const messages = parser.feed(chunk);
        for (const node of messages) {
          // Expect arrays of bulk strings: [CMD, ...args]
          const arr = arrayNodeToStringArray(node);
          if (!arr) {
            socket.write(encodeError("expected array of bulk strings"));
            continue;
          }
          const [cmd, ...args] = arr;
          const upper = String(cmd).toUpperCase();
          // Enforce auth early for all commands except AUTH
          if (this.acl.requiresAuth() && !socket.__authed && upper !== 'AUTH') {
            socket.write(encodeError("NOAUTH Authentication required."));
            continue;
          }
          // SELECT (logical databases)
          if (upper === 'SELECT') {
            if (args.length !== 1) { socket.write(encodeError("wrong number of arguments for 'SELECT'")); continue; }
            const idx = parseInt(String(args[0]), 10);
            if (!Number.isFinite(idx) || idx < 0 || idx > 15) { socket.write(encodeError("DB index is out of range")); continue; }
            state.db = idx;
            socket.write("+OK\r\n");
            continue;
          }
          // Simple connection/utility commands
          if (upper === "CLIENT") {
            const sub = String(args[0] || '').toUpperCase();
            if (sub === 'TRACKING') {
              let i = 1; let turnOn = false; let turnOff = false; let bcast = false; const prefixes = [];
              while (i < args.length) {
                const opt = String(args[i]).toUpperCase();
                if (opt === 'ON') { turnOn = true; i++; continue; }
                if (opt === 'OFF') { turnOff = true; i++; continue; }
                if (opt === 'BCAST') { bcast = true; i++; continue; }
                if (opt === 'PREFIX' && args[i + 1]) { prefixes.push(String(args[i + 1])); i += 2; continue; }
                i++;
              }
              if (turnOff) {
                socket.__tracking = false; socket.__trackingBcast = false;
                this.trackingBcastClients.delete(socket);
                for (const key of socket.__trackedStoredKeys) {
                  const set = this.trackingKeyToClients.get(key);
                  if (set) { set.delete(socket); if (set.size === 0) this.trackingKeyToClients.delete(key); }
                }
                socket.__trackedStoredKeys.clear();
                socket.__trackingPrefixes.clear();
                socket.write("+OK\r\n");
                continue;
              }
              if (turnOn) {
                socket.__tracking = true;
                socket.__trackingBcast = !!bcast;
                socket.__trackingPrefixes = new Set(prefixes);
                if (socket.__trackingBcast) this.trackingBcastClients.add(socket); else this.trackingBcastClients.delete(socket);
                socket.write("+OK\r\n");
                continue;
              }
              socket.write(encodeError("unknown CLIENT TRACKING usage"));
              continue;
            }
            socket.write(encodeError("unknown CLIENT subcommand"));
            continue;
          }
          if (upper === "PING") {
            const msg = args[0] ? String(args[0]) : "PONG";
            socket.write(`+${msg}\r\n`);
            continue;
          }
          if (upper === "ECHO") {
            if (args.length !== 1) { socket.write(encodeError("wrong number of arguments for 'ECHO'")); continue; }
            const msg = String(args[0]);
            socket.write(`$${msg.length}\r\n${msg}\r\n`);
            continue;
          }
          if (upper === "SCAN") {
            if (args.length < 1) { socket.write(encodeError("wrong number of arguments for 'SCAN'")); continue; }
            const cursor = args[0];
            let i = 1; let match = undefined; let count = undefined;
            while (i < args.length) {
              const opt = String(args[i] || '').toUpperCase();
              if (opt === 'MATCH' && args[i + 1]) { match = String(args[i + 1]); i += 2; continue; }
              if (opt === 'COUNT' && args[i + 1]) { const n = parseInt(String(args[i + 1]), 10); if (Number.isFinite(n)) count = n; i += 2; continue; }
              break;
            }
            const prefix = this._dbPrefix(state.db);
            const res = this.store.scan(cursor, { match: match ? prefix + match : undefined, count });
            const nextStr = String(res.next);
            let out = `*2\r\n$${nextStr.length}\r\n${nextStr}\r\n*${res.keys.length}\r\n`;
            for (let k of res.keys) {
              const disp = k.startsWith(prefix) ? k.slice(prefix.length) : k;
              out += `$${disp.length}\r\n${disp}\r\n`;
            }
            socket.write(out);
            continue;
          }

          if (upper === "XREAD") {
            if (args.length < 3) { socket.write(encodeError("wrong number of arguments for 'XREAD'")); continue; }
            let i = 0; let count = undefined; let blockMs = undefined;
            while (i < args.length) {
              const opt = String(args[i]).toUpperCase();
              if (opt === 'COUNT' && args[i + 1]) { const n = parseInt(String(args[i + 1]), 10); if (!Number.isFinite(n) || n <= 0) { socket.write(encodeError("value is not an integer or out of range")); } else { count = n; } i += 2; continue; }
              if (opt === 'BLOCK' && args[i + 1]) { const n = parseInt(String(args[i + 1]), 10); if (!Number.isFinite(n) || n < 0) { socket.write(encodeError("value is not an integer or out of range")); } else { blockMs = n; } i += 2; continue; }
              if (opt === 'STREAMS') { i += 1; break; }
              break;
            }
            if (i >= args.length) { socket.write(encodeError("syntax error")); continue; }
            const rem = args.length - i;
            if (rem % 2 !== 0) { socket.write(encodeError("syntax error")); continue; }
            const half = rem / 2;
            const keys = args.slice(i, i + half).map(String);
            const ids = args.slice(i + half).map(String);
            const tryRead = () => {
              const resp = this.store.xreadNonBlocking(keys, ids, count);
              if (resp && typeof resp === 'string') { socket.write(resp); return true; }
              return false;
            };
            if (tryRead()) continue;
            if (blockMs === undefined) { socket.write(encodeBulkString(null)); continue; }
            const deadline = blockMs === 0 ? Number.MAX_SAFE_INTEGER : Date.now() + blockMs;
            const tick = () => {
              if (socket.destroyed) return;
              if (tryRead()) return;
              if (Date.now() >= deadline) { socket.write(encodeBulkString(null)); return; }
              setTimeout(tick, 50).unref?.();
            };
            setTimeout(tick, 50).unref?.();
            continue;
          }

          // AUTH (supports: AUTH <password> or AUTH <username> <password>)
          if (upper === "AUTH") {
            if (args.length === 1) {
              const res = this.acl.authenticate('default', args[0]);
              if (res.ok) { socket.__authed = true; socket.__user = 'default'; socket.write("+OK\r\n"); }
              else { socket.write(encodeError(res.message || "authentication failed")); }
              continue;
            }
            if (args.length === 2) {
              const username = String(args[0]);
              const res = this.acl.authenticate(username, args[1]);
              if (res.ok) { socket.__authed = true; socket.__user = username; socket.write("+OK\r\n"); }
              else { socket.write(encodeError(res.message || "authentication failed")); }
              continue;
            }
            socket.write(encodeError("wrong number of arguments for 'AUTH'"));
            continue;
          }

          // enforce auth if configured
          if (this.acl.requiresAuth() && !socket.__authed) {
            socket.write(encodeError("NOAUTH Authentication required."));
            continue;
          }

          // ACL command
          if (upper === "ACL") {
            const sub = String(args[0] || '').toUpperCase();
            if (sub === 'WHOAMI') {
              const name = socket.__user || 'default';
              socket.write(encodeBulkString(name));
              continue;
            }
            if (sub === 'USERS') {
              const list = this.acl.usersList();
              socket.write(encodeArrayOfBulkStrings(list));
              continue;
            }
            if (sub === 'LIST') {
              const desc = this.acl.listUsers();
              socket.write(encodeArrayOfBulkStrings(desc));
              continue;
            }
            if (sub === 'DELUSER') {
              if (args.length !== 2) { socket.write(encodeError("wrong number of arguments for 'ACL DELUSER'")); continue; }
              const n = this.acl.delUser(args[1]);
              socket.write(`:${n}\r\n`);
              continue;
            }
            if (sub === 'SETUSER') {
              if (args.length < 2) { socket.write(encodeError("wrong number of arguments for 'ACL SETUSER'")); continue; }
              const name = args[1];
              const rules = args.slice(2).map(String);
              try { this.acl.setUser(name, rules); socket.write("+OK\r\n"); } catch (e) { socket.write(encodeError(e.message || 'ACL error')); }
              continue;
            }
            socket.write(encodeError("unknown ACL subcommand"));
            continue;
          }

          // Snapshot SAVE
          if (upper === "SAVE") {
            // snapshot save
            this.snapshot.saveFrom(this.store).then(() => {
              socket.write("+OK\r\n");
            }).catch((err) => {
              socket.write(encodeError(err.message || "snapshot error"));
            });
            continue;
          }

          if (upper === "BGSAVE") {
            if (this._bgsaveInProgress) { socket.write(encodeError("Background save already in progress")); continue; }
            this._bgsaveInProgress = true;
            setTimeout(() => {
              this.snapshot.saveFrom(this.store).catch(() => {}).finally(() => {
                this._bgsaveInProgress = false;
              });
            }, 0).unref?.();
            socket.write("+Background saving started.\r\n");
            continue;
          }

          // Replication commands
          if (upper === "REPLICAOF") {
            if (args.length === 2 && String(args[0]).toUpperCase() === 'NO' && String(args[1]).toUpperCase() === 'ONE') {
              this.role = 'master';
              if (this.master) { try { this.master.destroy(); } catch {} this.master = null; }
              this.masterRunId = null; this.replAppliedOffset = -1;
              socket.write("+OK\r\n");
              continue;
            }
            if (args.length !== 2) { socket.write(encodeError("syntax error")); continue; }
            const host = String(args[0]);
            const port = parseInt(String(args[1]), 10);
            if (!Number.isFinite(port)) { socket.write(encodeError("invalid port")); continue; }
            this._becomeReplica(host, port).then(() => {
              socket.write("+OK\r\n");
            }).catch(() => {
              socket.write(encodeError("replication error"));
            });
            continue;
          }
          if (upper === "REPLCONF") { socket.write("+OK\r\n"); continue; }
          if (upper === "PSYNC") {
            // PSYNC <runId> <offset>
            const wantId = args[0] ? String(args[0]) : null;
            const wantOff = args[1] !== undefined ? parseInt(String(args[1]), 10) : NaN;
            const backlogStart = this._replBacklogStartOffset();
            if (wantId && wantId === this.runId && Number.isFinite(wantOff) && wantOff >= backlogStart - 1 && wantOff <= this.replicationOffset) {
              // Can continue from backlog
              socket.write(`+CONTINUE\r\n`);
              // Register as replica first so it also gets live writes
              this.replicas.add(socket);
              socket.on('close', () => { this.replicas.delete(socket); });
              const startIndex = Math.max(0, (wantOff + 1) - backlogStart);
              const slice = this.replBacklogBuf.slice(startIndex);
              if (slice.length > 0) {
                try { socket.write(slice); } catch {}
              }
              continue;
            }
            // Full resync
            socket.write(`+FULLRESYNC ${this.runId} ${this.replicationOffset}\r\n`);
            const snapObj = serializeStore(this.store);
            const json = JSON.stringify(snapObj);
            socket.write(`$${json.length}\r\n${json}\r\n`);
            // Register as replica to receive subsequent writes
            this.replicas.add(socket);
            socket.on('close', () => { this.replicas.delete(socket); });
            continue;
          }
          if (upper === "SYNC") {
            // Treat legacy SYNC as FULLRESYNC
            socket.write(`+FULLRESYNC ${this.runId} ${this.replicationOffset}\r\n`);
            const snapObj = serializeStore(this.store);
            const json = JSON.stringify(snapObj);
            socket.write(`$${json.length}\r\n${json}\r\n`);
            this.replicas.add(socket);
            socket.on('close', () => { this.replicas.delete(socket); });
            continue;
          }

          // Pub/Sub
          if (upper === "SUBSCRIBE") {
            if (args.length < 1) {
              socket.write(encodeError("wrong number of arguments for 'SUBSCRIBE'"));
              continue;
            }
            for (const ch of args) {
              const channel = String(ch);
              if (!this.channels.has(channel)) this.channels.set(channel, new Set());
              this.channels.get(channel).add(socket);
              state.subscriptions.add(channel);
              const count = state.subscriptions.size;
              socket.write(`*3\r\n$9\r\nsubscribe\r\n$${channel.length}\r\n${channel}\r\n$${String(count).length}\r\n${count}\r\n`);
            }
            continue;
          }

          if (upper === "UNSUBSCRIBE") {
            const channelsToRemove = args.length > 0 ? args.map(String) : Array.from(state.subscriptions.values());
            for (const channel of channelsToRemove) {
              const set = this.channels.get(channel);
              if (set) {
                set.delete(socket);
                if (set.size === 0) this.channels.delete(channel);
              }
              state.subscriptions.delete(channel);
              const count = state.subscriptions.size;
              socket.write(`*3\r\n$11\r\nunsubscribe\r\n$${channel.length}\r\n${channel}\r\n$${String(count).length}\r\n${count}\r\n`);
            }
            continue;
          }

          if (upper === "PUBLISH") {
            if (args.length !== 2) {
              socket.write(encodeError("wrong number of arguments for 'PUBLISH'"));
              continue;
            }
            const channel = String(args[0]);
            const message = String(args[1]);
            const subscribers = this.channels.get(channel);
            let delivered = 0;
            if (subscribers) {
              const payload = `*3\r\n$7\r\nmessage\r\n$${channel.length}\r\n${channel}\r\n$${message.length}\r\n${message}\r\n`;
              for (const s of subscribers) {
                try { s.write(payload); delivered++; } catch {}
              }
            }
            socket.write(`:${delivered}\r\n`);
            continue;
          }

          // Blocking list ops (simple cooperative approach)
          if (upper === "BLPOP" || upper === "BRPOP") {
            if (args.length < 2) { socket.write(encodeError(`wrong number of arguments for '${upper}'`)); continue; }
            const timeout = parseInt(String(args[args.length - 1]), 10);
            if (!Number.isFinite(timeout)) { socket.write(encodeError("value is not an integer or out of range")); continue; }
            const keys = args.slice(0, -1).map(String);
            const popRight = upper === 'BRPOP';
            const tryPop = () => {
              for (const k of keys) {
                const val = popRight ? this.store.rpopValue(k) : this.store.lpopValue(k);
                if (val !== null) {
                  const keyStr = String(k);
                  const vStr = String(val);
                  const arr = `*2\r\n$${keyStr.length}\r\n${keyStr}\r\n$${vStr.length}\r\n${vStr}\r\n`;
                  socket.write(arr);
                  return true;
                }
              }
              return false;
            };
            if (tryPop()) continue;
            const expiresAt = Date.now() + timeout * 1000;
            const tick = () => {
              if (socket.destroyed) return;
              if (tryPop()) return;
              if (Date.now() >= expiresAt) { socket.write(`*2\r\n$-1\r\n$-1\r\n`); return; }
              setTimeout(tick, 50).unref?.();
            };
            setTimeout(tick, 50).unref?.();
            continue;
          }

          if (upper === "INFO") {
            const section = (args[0] || '').toString().toLowerCase();
            const stats = {
              server: {
                tcp_port: this.port,
                tls_port: this.tlsPort || 0,
              },
              clients: {
                connected_clients: (this.clients ? this.clients.size : (this.server?.connections ?? 0)),
              },
              keyspace: {
                db0: `keys=${this.store.kv.size}`
              },
              persistence: {
                aof_enabled: !!this.aof
              },
            };
            const pick = section && stats[section] ? { [section]: stats[section] } : stats;
            const lines = [];
            for (const [sect, kv] of Object.entries(pick)) {
              lines.push(`# ${sect}`);
              for (const [k, v] of Object.entries(kv)) lines.push(`${k}:${v}`);
            }
            const text = lines.join("\n");
            socket.write(`$${text.length}\r\n${text}\r\n`);
            continue;
          }

          if (upper === 'CONFIG') {
            const sub = String(args[0] || '').toUpperCase();
            if (sub === 'GET') {
              const param = String(args[1] || '').toLowerCase();
              if (param === 'notify-keyspace-events') {
                const key = 'notify-keyspace-events';
                const val = this.notifyKeyspaceFlags;
                const arr = `*2\r\n$${key.length}\r\n${key}\r\n$${val.length}\r\n${val}\r\n`;
                socket.write(arr); continue;
              }
              socket.write(`*0\r\n`); continue;
            }
            if (sub === 'SET') {
              if (String(args[1] || '').toLowerCase() === 'notify-keyspace-events' && args[2] !== undefined) {
                this.notifyKeyspaceFlags = String(args[2]);
                this._notify = this._parseNotifyFlags(this.notifyKeyspaceFlags);
                socket.write("+OK\r\n"); continue;
              }
              socket.write(encodeError('unsupported CONFIG SET parameter')); continue;
            }
            socket.write(encodeError('unknown CONFIG subcommand')); continue;
          }

          // KEYSPACE-aware commands handled here
          if (upper === 'KEYS') {
            if (args.length !== 1) { socket.write(encodeError("wrong number of arguments for 'KEYS'")); continue; }
            const pattern = String(args[0]);
            const prefix = this._dbPrefix(state.db);
            const matched = this.store.keys(prefix + pattern);
            let out = `*${matched.length}\r\n`;
            for (let k of matched) {
              const disp = k.startsWith(prefix) ? k.slice(prefix.length) : k;
              out += `$${disp.length}\r\n${disp}\r\n`;
            }
            socket.write(out);
            continue;
          }

          if (upper === 'DBSIZE') {
            const prefix = this._dbPrefix(state.db);
            let n = 0;
            for (const k of this.store.kv.keys()) if (String(k).startsWith(prefix)) n++;
            socket.write(`:${n}\r\n`);
            continue;
          }

          if (upper === 'RANDOMKEY') {
            const prefix = this._dbPrefix(state.db);
            const keys = [];
            for (const k of this.store.kv.keys()) if (String(k).startsWith(prefix)) keys.push(String(k));
            if (keys.length === 0) { socket.write(encodeBulkString(null)); continue; }
            const pick = keys[Math.floor(Math.random() * keys.length)];
            const disp = pick.slice(prefix.length);
            socket.write(`$${disp.length}\r\n${disp}\r\n`);
            continue;
          }

          if (upper === 'FLUSHDB') {
            const prefix = this._dbPrefix(state.db);
            const toDel = [];
            for (const k of this.store.kv.keys()) if (String(k).startsWith(prefix)) toDel.push(String(k));
            for (const k of toDel) { this.store.kv.delete(k); this.store.expires.delete(k); }
            socket.write("+OK\r\n");
            continue;
          }

          if (upper === "SLOWLOG") {
            const sub = (args[0] || '').toString().toUpperCase();
            if (sub === 'LEN') {
              socket.write(`:${this.slowlog.length}\r\n`);
              continue;
            }
            if (sub === 'GET') {
              const count = parseInt(String(args[1] ?? this.slowlog.length), 10);
              const slice = this.slowlog.slice(-count);
              let out = `*${slice.length}\r\n`;
              for (const item of slice) {
                const arr = [String(item.id), String(item.timestamp), String(item.durationUs), JSON.stringify([item.cmd, ...item.args])];
                out += `*${arr.length}\r\n` + arr.map((s) => `$${s.length}\r\n${s}\r\n`).join('');
              }
              socket.write(out);
              continue;
            }
            socket.write(encodeError("unknown SLOWLOG subcommand"));
            continue;
          }

          // Transactions
          if (upper === "MULTI") {
            if (state.inMulti) {
              socket.write(encodeError("MULTI calls can not be nested"));
            } else {
              state.inMulti = true;
              state.queue = [];
              socket.write("+OK\r\n");
            }
            continue;
          }

          if (upper === "DISCARD") {
            state.inMulti = false;
            state.queue = [];
            socket.write("+OK\r\n");
            continue;
          }

          if (upper === "EXEC") {
            if (!state.inMulti) {
              socket.write(encodeError("EXEC without MULTI"));
              continue;
            }
            // Execute queued commands atomically (single-threaded)
            const responses = [];
            for (const [qc, qargs] of state.queue) {
              const up = String(qc).toUpperCase();
              const eff = this._rewriteArgsForDb(up, qargs, state.db);
              const resp = this.store.dispatch(up, eff);
              responses.push(resp);
              if (this.aof && this._writeCommands.has(up) && !String(resp).startsWith("-ERR")) {
                const toLog = [String(qc), ...qargs.map((a) => (a === null || a === undefined ? "" : String(a)))];
                this._aofWrite = this._aofWrite.then(() => this.aof.appendCommand(toLog)).catch(() => {});
              }
            }
            state.inMulti = false;
            state.queue = [];
            // Build RESP array from raw RESP replies
            let out = `*${responses.length}\r\n`;
            for (const r of responses) out += r;
            socket.write(out);
            continue;
          }

          if (state.inMulti) {
            state.queue.push([cmd, args]);
            socket.write("+QUEUED\r\n");
            continue;
          }

          // Normal execution with SLOWLOG timing
          // Pipelining: parse may yield multiple messages; we already loop them.
          // Here, we process each command and write replies immediately, which supports pipelining naturally.
          const startNs = process.hrtime.bigint();
          const upperCmd = String(cmd).toUpperCase();
          const isAclWrite = upperCmd === 'ACL' && ['SETUSER','DELUSER'].includes(String(args[0]||'').toUpperCase());
          let isWriteData = this._writeCommands.has(upperCmd);
          // Disallow writes on replicas
          if (this.role === 'replica' && (isWriteData || isAclWrite)) {
            socket.write(encodeError("READONLY You can't write against a read only replica"));
            continue;
          }
          // ACL permission check
          const aclKeys = this._extractKeysForAcl(upperCmd, args);
          const aclRes = this.acl.check(socket.__user || 'default', upperCmd, aclKeys);
          if (!aclRes.ok) { socket.write(encodeError(aclRes.message || 'NOPERM')); continue; }
          const effectiveArgs = this._rewriteArgsForDb(upperCmd, args, state.db);
          const response = this.store.dispatch(cmd, effectiveArgs);
          // Publish keyspace notifications for select write classes
          try {
            const publishFor = (cl) => {
              const keys = this._extractKeysForAcl(upperCmd, effectiveArgs);
              for (const storedKey of keys) {
                const info = this._extractDbAndKeyFromStoredKey(String(storedKey));
                this._maybePublishKeyspace(upperCmd.toLowerCase(), cl, info.db, info.key);
              }
            };
            if (!String(response).startsWith('-ERR')) {
              if (upperCmd === 'SET' || upperCmd === 'SETNX' || upperCmd === 'APPEND' || upperCmd === 'SETRANGE' || upperCmd === 'INCR' || upperCmd === 'INCRBY' || upperCmd === 'DECR' || upperCmd === 'DECRBY' || upperCmd === 'SETEX') publishFor('$');
              else if (upperCmd === 'DEL' || upperCmd === 'EXPIRE' || upperCmd === 'PEXPIRE' || upperCmd === 'EXPIREAT' || upperCmd === 'PEXPIREAT' || upperCmd === 'PERSIST') publishFor('g');
              else if (upperCmd === 'LPUSH' || upperCmd === 'RPUSH' || upperCmd === 'LPOP' || upperCmd === 'RPOP' || upperCmd === 'LSET') publishFor('l');
              else if (upperCmd === 'HSET' || upperCmd === 'HDEL' || upperCmd === 'HMSET') publishFor('h');
              else if (upperCmd === 'SADD' || upperCmd === 'SREM' || upperCmd === 'SPOP' || upperCmd === 'SMOVE' || upperCmd === 'SUNIONSTORE' || upperCmd === 'SINTERSTORE' || upperCmd === 'SDIFFSTORE') publishFor('s');
              else if (upperCmd === 'ZADD' || upperCmd === 'ZREM') publishFor('z');
            }
          } catch {}
          // handled earlier
          const endNs = process.hrtime.bigint();
          const elapsedUs = Number((endNs - startNs) / 1000n);
          socket.write(response);
          // Track read keys for client-side caching (non-bcast)
          try {
            if (!isWriteData && socket.__tracking && !socket.__trackingBcast && !String(response).startsWith("-ERR")) {
              const keys = this._extractKeysForAcl(upperCmd, effectiveArgs);
              for (const dispKey of keys) {
                const storedKey = this._dbPrefix(state.db) + String(dispKey);
                if (!this.trackingKeyToClients.has(storedKey)) this.trackingKeyToClients.set(storedKey, new Set());
                this.trackingKeyToClients.get(storedKey).add(socket);
                socket.__trackedStoredKeys.add(storedKey);
              }
            }
          } catch {}
          // Extend write commands for JSON and Vectors (phase 5): explicitly mark known write JSON ops
          if (upperCmd.startsWith("JSON.")) {
            const writeJson = new Set([
              'JSON.SET','JSON.DEL','JSON.ARRAPPEND','JSON.ARRPOP','JSON.ARRINSERT','JSON.ARRTRIM','JSON.NUMINCRBY','JSON.FORGET','JSON.NUMMULTBY','JSON.TOGGLE','JSON.CLEAR'
            ]);
            if (writeJson.has(upperCmd)) isWriteData = true; // mark as write for logging/replication
          }
          if (this.role === 'master' && this.aof && isWriteData && !String(response).startsWith("-ERR")) {
            const toLog = [String(cmd), ...args.map((a) => (a === null || a === undefined ? "" : String(a)))];
            this._aofWrite = this._aofWrite.then(() => this.aof.appendCommand(toLog)).catch(() => {});
          }
          // SLOWLOG: record if over threshold
          this._recordSlowlog(upperCmd, args, elapsedUs);
          // Replication: enqueue in backlog and forward to replicas if master
          if (this.role === 'master' && isWriteData && !String(response).startsWith("-ERR")) {
            const payloadStr = require('../core/protocol').encodeArrayOfBulkStrings([String(cmd), ...args.map(String)]);
            const payloadBuf = Buffer.from(payloadStr, 'utf8');
            this._appendToBacklog(payloadBuf);
            if (this.replicas.size > 0) { for (const r of this.replicas) { try { r.write(payloadBuf); } catch {} } }
            // Invalidate tracked and bcast clients
            try {
              const keys = this._extractKeysForAcl(upperCmd, effectiveArgs);
              for (const k of keys) this._invalidateKey(this._dbPrefix(state.db) + String(k));
            } catch {}
          }
        }
      } catch (err) {
        socket.write(encodeError(err.message || "server error"));
      }
    });

    socket.on("error", () => {
      // ignore
    });
    const cleanup = () => {
      // remove socket from all subscriptions
      for (const ch of state.subscriptions) {
        const set = this.channels.get(ch);
        if (set) {
          set.delete(socket);
          if (set.size === 0) this.channels.delete(ch);
        }
      }
      state.subscriptions.clear();
      // client tracking cleanup
      this.trackingBcastClients.delete(socket);
      for (const set of this.trackingKeyToClients.values()) set.delete(socket);
      try { this.clients.delete(socket); } catch {}
    };
    socket.on("close", cleanup);
    socket.on("end", cleanup);
  }

  // --- Replication ---
  async _becomeReplica(host, port) {
    try {
      const net = require('net');
      const conn = net.createConnection({ host, port });
      this.role = 'replica';
      this.master = conn;
      const parser = new (require('../core/protocol').CommandParser)();
      // Full or partial resync request
      conn.on('connect', () => {
        const runId = this.masterRunId || '?';
        const off = Number.isFinite(this.replAppliedOffset) && this.replAppliedOffset >= 0 ? this.replAppliedOffset : -1;
        const payload = require('../core/protocol').encodeArrayOfBulkStrings(["PSYNC", runId, String(off)]);
        try { conn.write(payload); } catch {}
        this._replBackoffMs = 1000;
      });
      conn.on('data', async (chunk) => {
        const msgs = parser.feed(chunk);
        for (const m of msgs) {
          if (!m) continue;
          if (m.type === 'simple' && typeof m.value === 'string') {
            const line = m.value;
            if (line.startsWith('FULLRESYNC')) {
              const parts = line.split(/\s+/);
              this.masterRunId = parts[1] || null;
              const off = parseInt(parts[2] || '-1', 10);
              this.replAppliedOffset = Number.isFinite(off) ? off : -1;
              continue;
            }
            if (line.startsWith('CONTINUE')) {
              // nothing special
              continue;
            }
          }
          if (m.type === 'bulk' && m.value && m.value.startsWith('{')) {
            // Snapshot JSON
            try {
              const snapObj = JSON.parse(m.value);
              await loadFromObject(this.store, snapObj);
            } catch {}
            continue;
          }
          const arr = require('../core/protocol').arrayNodeToStringArray(m);
          if (arr && arr.length > 0) {
            const [c, ...a] = arr;
            this.store.dispatch(c, a);
            // Update applied offset based on payload length we just consumed
            const payloadStr = require('../core/protocol').encodeArrayOfBulkStrings(arr.map(String));
            this.replAppliedOffset = (Number.isFinite(this.replAppliedOffset) && this.replAppliedOffset >= 0 ? this.replAppliedOffset : 0) + Buffer.byteLength(payloadStr, 'utf8');
          }
        }
      });
      conn.on('error', () => { this._scheduleReplReconnect(host, port); });
      conn.on('close', () => { this._scheduleReplReconnect(host, port); });
    } catch {}
  }

  _scheduleReplReconnect(host, port) {
    if (this.role !== 'replica') return;
    const delay = this._replBackoffMs;
    this._replBackoffMs = Math.min(this._replBackoffMs * 2, 30000);
    setTimeout(() => { try { this._becomeReplica(host, port); } catch {} }, delay).unref?.();
  }

  _extractKeysForAcl(upperCmd, args) {
    // Conservative extraction for key checks: handle common key-first commands and multi-key variants
    const A = args.map((a) => String(a));
    switch (upperCmd) {
      case 'GET':
      case 'SET':
      case 'SETNX':
      case 'DEL':
      case 'EXISTS':
      case 'TYPE':
      case 'INCR':
      case 'DECR':
      case 'INCRBY':
      case 'DECRBY':
      case 'INCRBYFLOAT':
      case 'APPEND':
      case 'GETSET':
      case 'SETEX':
      case 'STRLEN':
      case 'GETRANGE':
      case 'SETRANGE':
      case 'HGET':
      case 'HSET':
      case 'HMSET':
      case 'HDEL':
      case 'HGETALL':
      case 'HEXISTS':
      case 'HLEN':
      case 'HKEYS':
      case 'HVALS':
      case 'HSTRLEN':
      case 'HSCAN':
      case 'SADD':
      case 'SREM':
      case 'SRANDMEMBER':
      case 'SPOP':
      case 'SMEMBERS':
      case 'SMISMEMBER':
      case 'SCARD':
      case 'SISMEMBER':
      case 'LPUSH':
      case 'RPUSH':
      case 'LPOP':
      case 'RPOP':
      case 'LLEN':
      case 'LRANGE':
      case 'LINDEX':
      case 'LSET':
      case 'ZADD':
      case 'ZREM':
      case 'ZRANK':
      case 'ZREVRANK':
      case 'ZSCORE':
      case 'ZCARD':
      case 'ZRANGE':
      case 'ZRANGEBYSCORE':
      case 'GEOADD':
      case 'GEODIST':
      case 'PFADD':
      case 'SETBIT':
      case 'GETBIT':
      case 'BITPOS':
      case 'BITCOUNT':
      case 'BITFIELD':
      case 'BITFIELD_RO':
      case 'EXPIRE':
      case 'PERSIST':
      case 'PTTL':
      case 'TTL':
      case 'PEXPIRE':
      case 'EXPIREAT':
      case 'PEXPIREAT':
      case 'JSON.SET':
      case 'JSON.GET':
      case 'JSON.DEL':
      case 'JSON.FORGET':
      case 'JSON.MGET':
      case 'JSON.TYPE':
      case 'JSON.OBJKEYS':
      case 'JSON.OBJLEN':
      case 'JSON.ARRLEN':
      case 'JSON.ARRAPPEND':
      case 'JSON.ARRINSERT':
      case 'JSON.ARRPOP':
      case 'JSON.ARRTRIM':
      case 'JSON.ARRINDEX':
      case 'JSON.STRAPPEND':
      case 'JSON.STRLEN':
      case 'JSON.NUMINCRBY':
      case 'JSON.NUMMULTBY':
      case 'JSON.TOGGLE':
      case 'JSON.CLEAR':
      case 'GEOSEARCH':
      case 'GEOHASH':
      case 'GEOPOS':
        return A.length > 0 ? [A[0]] : [];
      case 'VEC.ADD':
        return A.length > 0 ? [A[0]] : [];
      case 'VEC.ADDVEC':
      case 'VEC.SUBVEC':
      case 'VEC.DOT':
        return A.length > 0 ? [A[0]] : [];
      case 'VEC.EMBEDADD':
        return A.length > 0 ? [A[0]] : [];
      case 'VEC.CREATEINDEX':
      case 'VEC.REBUILD':
      case 'VEC.STATS':
      case 'VEC.SEARCH':
      case 'VEC.ADDVEC':
      case 'VEC.SUBVEC':
      case 'VEC.DOT':
        return A.length > 0 ? [A[0]] : [];
      case 'DOC.INDEXCREATE':
      case 'DOC.INDEXDROP':
      case 'DOC.INDEXLIST':
      case 'DOC.INDEXADD':
      case 'DOC.INDEXDEL':
      case 'DOC.INDEXUPDATE':
      case 'DOC.INDEXREBUILD':
      case 'DOC.SEARCH':
      case 'DOC.AGGREGATE':
        return A; // treat first as index name; keys inside JSON lookup, so leave as-is
      case 'MGET':
      case 'DEL':
      case 'SINTER':
      case 'SUNION':
      case 'SDIFF':
        return A;
      case 'MSET':
      case 'MSETNX': {
        // For MSET/MSETNX ACL, only check keys (even positions), not values
        const keys = [];
        for (let i = 0; i < A.length; i += 2) {
          keys.push(A[i]);
        }
        return keys;
      }
      case 'HMGET':
        return A.length > 0 ? [A[0]] : [];
      case 'RPOPLPUSH':
      case 'LMOVE':
      case 'SMOVE':
        return A.slice(0, 2);
      case 'SUNIONSTORE':
      case 'SINTERSTORE':
      case 'SDIFFSTORE':
        return A; // dest + all source keys
      case 'TS.CREATERULE':
      case 'TS.DELETERULE':
        return A.slice(0, 2);
      default:
        return [];
    }
  }

  _appendToBacklog(buf) {
    if (!buf || buf.length === 0) return;
    this.replBacklogBuf = Buffer.concat([this.replBacklogBuf, buf]);
    this.replicationOffset += buf.length;
    if (this.replBacklogBuf.length > this.replBacklogMaxBytes) {
      const drop = this.replBacklogBuf.length - this.replBacklogMaxBytes;
      this.replBacklogBuf = this.replBacklogBuf.slice(drop);
    }
  }

  _replBacklogStartOffset() {
    // If buffer empty, define next byte as replicationOffset + 1
    if (this.replBacklogBuf.length === 0) return this.replicationOffset + 1;
    return this.replicationOffset - this.replBacklogBuf.length + 1;
  }

  _recordSlowlog(cmd, args, durationUs) {
    if (durationUs >= this.slowlogThresholdUs) {
      const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
      this.slowlog.push({ id, timestamp: Math.floor(Date.now() / 1000), durationUs, cmd, args });
      if (this.slowlog.length > this.slowlogLen) this.slowlog.shift();
    }
  }

  _invalidateKey(storedKey) {
    const subs = this.trackingKeyToClients.get(storedKey);
    const channel = `__redis__:invalidate`;
    const message = storedKey;
    const payload = `*3\r\n$7\r\nmessage\r\n$${channel.length}\r\n${channel}\r\n$${message.length}\r\n${message}\r\n`;
    if (subs && subs.size > 0) {
      for (const s of subs) { try { s.write(payload); } catch {} }
      this.trackingKeyToClients.delete(storedKey);
    }
    // broadcast by prefix
    const prefixes = new Set();
    for (const s of this.trackingBcastClients) {
      for (const p of (s.__trackingPrefixes || [])) prefixes.add(String(p));
    }
    for (const p of prefixes) {
      if (storedKey.startsWith(p)) {
        for (const s of this.trackingBcastClients) {
          if (s.__trackingPrefixes && s.__trackingPrefixes.has(p)) {
            try { s.write(payload); } catch {}
          }
        }
      }
    }
  }

  _dbPrefix(db) {
    const idx = Number.isFinite(db) ? db : 0;
    return `{db${idx}}:`;
  }

  _extractDbAndKeyFromStoredKey(stored) {
    const m = String(stored).match(/^\{db(\d+)\}:(.*)$/);
    if (!m) return { db: 0, key: String(stored) };
    return { db: parseInt(m[1], 10) || 0, key: m[2] };
  }

  _parseNotifyFlags(flags) {
    const s = String(flags || '');
    const conf = { keyspace: false, keyevent: false, classes: new Set() };
    for (const ch of s) {
      if (ch === 'K') conf.keyspace = true;
      else if (ch === 'E') conf.keyevent = true;
      else if (ch === 'A') { conf.classes = new Set(['g','$','l','s','h','z','x']); }
      else conf.classes.add(ch);
    }
    return conf;
  }

  _maybePublishKeyspace(event, clazz, db, key) {
    // clazz one of: g=generic,$=string,l=list,s=set,h=hash,z=zset,x=expired
    if (!this._notify.classes.has(clazz) && !this._notify.classes.has('A')) return;
    const msg = String(key);
    if (this._notify.keyevent) {
      const ch = `__keyevent@${db}__:${event}`;
      const subs = this.channels.get(ch);
      if (subs) {
        const payload = `*3\r\n$7\r\nmessage\r\n$${ch.length}\r\n${ch}\r\n$${msg.length}\r\n${msg}\r\n`;
        for (const s of subs) { try { s.write(payload); } catch {} }
      }
    }
    if (this._notify.keyspace) {
      const ch = `__keyspace@${db}__:${key}`;
      const subs = this.channels.get(ch);
      if (subs) {
        const payload = `*3\r\n$7\r\nmessage\r\n$${ch.length}\r\n${ch}\r\n$${event.length}\r\n${event}\r\n`;
        for (const s of subs) { try { s.write(payload); } catch {} }
      }
    }
  }

  _rewriteArgsForDb(upperCmd, args, db) {
    const prefix = this._dbPrefix(db);
    const A = args.map((x) => (x == null ? "" : String(x)));
    const oneKey = (arr, pos = 0) => { if (arr.length > pos) arr[pos] = prefix + arr[pos]; };
    const multiKeys = (arr) => arr.map((k) => prefix + k);
    switch (upperCmd) {
      case 'GET':
      case 'SET':
      case 'SETNX':
      case 'DEL':
      case 'EXISTS':
      case 'TYPE':
      case 'APPEND':
      case 'GETSET':
      case 'STRLEN':
      case 'GETRANGE':
      case 'SETRANGE':
      case 'INCR':
      case 'DECR':
      case 'INCRBY':
      case 'DECRBY':
      case 'INCRBYFLOAT':
      case 'SETBIT':
      case 'GETBIT':
      case 'BITPOS':
      case 'BITCOUNT':
      case 'BITFIELD':
      case 'BITFIELD_RO':
      case 'LPUSH':
      case 'RPUSH':
      case 'LPOP':
      case 'RPOP':
      case 'LLEN':
      case 'LRANGE':
      case 'LINDEX':
      case 'LSET':
      case 'HGET':
      case 'HSET':
      case 'HMSET':
      case 'HDEL':
      case 'HGETALL':
      case 'HEXISTS':
      case 'HLEN':
      case 'HKEYS':
      case 'HVALS':
      case 'HSTRLEN':
      case 'HSCAN':
      case 'SADD':
      case 'SREM':
      case 'SRANDMEMBER':
      case 'SPOP':
      case 'SMEMBERS':
      case 'SMISMEMBER':
      case 'SCARD':
      case 'SISMEMBER':
      case 'ZADD':
      case 'ZREM':
      case 'ZRANK':
      case 'ZREVRANK':
      case 'ZSCORE':
      case 'ZCARD':
      case 'ZRANGE':
      case 'ZRANGEBYSCORE':
      case 'GEOADD':
      case 'GEODIST':
      case 'PFADD':
      case 'EXPIRE':
      case 'SETEX':
      case 'PEXPIRE':
      case 'PERSIST':
      case 'EXPIREAT':
      case 'PEXPIREAT':
      case 'TTL':
      case 'PTTL':
      case 'TS.CREATE':
      case 'TS.ADD':
      case 'TS.RANGE':
      case 'TS.GET':
        oneKey(A, 0); return A;
      case 'BITOP': {
        if (A.length >= 2) A[1] = prefix + A[1];
        for (let i = 2; i < A.length; i++) A[i] = prefix + A[i];
        return A;
      }
      case 'TS.CREATERULE':
      case 'TS.DELETERULE':
        oneKey(A, 0); oneKey(A, 1); return A;
      case 'JSON.SET':
      case 'JSON.GET':
      case 'JSON.DEL':
      case 'JSON.FORGET':
      case 'JSON.MGET':
      case 'JSON.TYPE':
      case 'JSON.OBJKEYS':
      case 'JSON.OBJLEN':
      case 'JSON.ARRLEN':
      case 'JSON.ARRAPPEND':
      case 'JSON.ARRINSERT':
      case 'JSON.ARRPOP':
      case 'JSON.ARRTRIM':
      case 'JSON.ARRINDEX':
      case 'JSON.STRAPPEND':
      case 'JSON.STRLEN':
      case 'JSON.NUMINCRBY':
      case 'JSON.NUMMULTBY':
      case 'JSON.TOGGLE':
      case 'JSON.CLEAR':
      case 'VEC.ADD':
      case 'VEC.CREATEINDEX':
      case 'VEC.REBUILD':
      case 'VEC.STATS':
      case 'VEC.SEARCH':
      case 'VEC.ADDVEC':
      case 'VEC.SUBVEC':
      case 'VEC.DOT':
      case 'VEC.EMBEDADD':
        oneKey(A, 0); return A;
      case 'DOC.INDEXADD':
      case 'DOC.INDEXDEL':
      case 'DOC.INDEXUPDATE':
        // index name at A[0], document key at A[1]
        oneKey(A, 1); return A;
      case 'GEOSEARCH':
      case 'GEOHASH':
      case 'GEOPOS':
      case 'GEORADIUS':
      case 'GEORADIUSBYMEMBER':
        oneKey(A, 0); return A;
      case 'GEOSEARCHSTORE':
        oneKey(A, 0); oneKey(A, 1); return A;
      case 'MGET':
      case 'DEL':
      case 'SINTER':
      case 'SUNION':
      case 'SDIFF':
      case 'PFCOUNT':
      case 'PFMERGE':
        return multiKeys(A);
      case 'MSET':
      case 'MSETNX': {
        // For MSET/MSETNX, only prefix keys (even positions), not values (odd positions)
        for (let i = 0; i < A.length; i += 2) {
          A[i] = prefix + A[i];
        }
        return A;
      }
      case 'HMGET':
        oneKey(A, 0); return A;
      case 'RPOPLPUSH':
      case 'LMOVE':
      case 'SMOVE':
        oneKey(A, 0); oneKey(A, 1); return A;
      case 'SUNIONSTORE':
      case 'SINTERSTORE':
      case 'SDIFFSTORE': {
        oneKey(A, 0); // destination key
        for (let i = 1; i < A.length; i++) oneKey(A, i); // prefix all source keys
        return A;
      }
      default:
        return A;
    }
  }
}

if (require.main === module) {
  const server = new RedisLikeServer();
  server.start();
}

module.exports = { RedisLikeServer };


