"use strict";

const net = require("net");
const tls = require("tls");
const EventEmitter = require("events");
const { encodeArrayOfBulkStrings, CommandParser } = require("../core/protocol");

function decodeNode(node) {
  if (!node) return null;
  switch (node.type) {
    case "simple": return node.value;
    case "error": {
      const err = new Error(node.message || "ERR");
      err.code = "REDIS_ERR";
      err.redis = true;
      return err; // caller throws
    }
    case "integer": return node.value;
    case "bulk": return node.value === null ? null : node.value;
    case "array": return node.value === null ? null : node.value.map(decodeNode);
    default: return node;
  }
}

class RedisClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = options.host || "127.0.0.1";
    this.port = options.port || 6379;
    this.tls = !!options.tls;
    this.username = options.username || null;
    this.password = options.password || null;
    this.reconnect = options.reconnect !== false;
    this.retryDelayMs = options.retryDelayMs || 300;
    this.maxRetryDelayMs = options.maxRetryDelayMs || 5000;
    this.offlineQueue = options.offlineQueue !== false;
    this._socket = null;
    this._parser = new CommandParser();
    this._pending = []; // [{resolve,reject}]
    this._connecting = false;
    this._connected = false;
    this._backoff = this.retryDelayMs;
    this._offlineQueueBuf = [];
  }

  async connect() {
    if (this._connected) return;
    if (this._connecting) return new Promise((res) => this.once("connect", res));
    this._connecting = true;
    await new Promise((resolve, reject) => {
      const onConnect = () => {
        this._connected = true;
        this._connecting = false;
        this._backoff = this.retryDelayMs;
        // AUTH if needed
        if (this.password) {
          const args = this.username ? ["AUTH", this.username, this.password] : ["AUTH", this.password];
          this._writeAndTrack(args).then((node) => {
            const dec = decodeNode(node);
            if (dec instanceof Error) { this.emit("error", dec); reject(dec); return; }
            // Flush offline queue if any
            this._flushOfflineQueue();
            this.emit("connect");
            resolve();
          }).catch(reject);
        } else {
          this._flushOfflineQueue();
          this.emit("connect");
          resolve();
        }
      };
      const onError = (err) => {
        cleanup();
        this._connecting = false;
        reject(err);
      };
      const onClose = () => {
        cleanup();
        this._connecting = false;
        reject(new Error("Connection closed"));
      };
      const cleanup = () => {
        this._socket?.removeListener("connect", onConnect);
        this._socket?.removeListener("error", onError);
        this._socket?.removeListener("close", onClose);
      };
      this._openSocket();
      this._socket.once("connect", onConnect);
      this._socket.once("error", onError);
      this._socket.once("close", onClose);
    });
  }

  _openSocket() {
    const opts = { host: this.host, port: this.port };
    const sock = this.tls ? tls.connect(opts) : net.createConnection(opts);
    this._socket = sock;
    sock.on("data", (chunk) => {
      const msgs = this._parser.feed(chunk);
      for (const node of msgs) {
        const waiter = this._pending.shift();
        if (waiter) {
          waiter.resolve(node);
        } else {
          // unsolicited (pub/sub) - emit raw
          this.emit("message", node);
        }
      }
    });
    const handleEnd = () => {
      this._connected = false;
      this.emit("disconnect");
      if (this.reconnect) this._scheduleReconnect();
      // Fail all pending
      while (this._pending.length) {
        const p = this._pending.shift();
        p.reject(new Error("Connection lost"));
      }
    };
    sock.on("close", handleEnd);
    sock.on("end", handleEnd);
    sock.on("error", (err) => { this.emit("error", err); });
  }

  _scheduleReconnect() {
    const delay = this._backoff;
    this._backoff = Math.min(this._backoff * 2, this.maxRetryDelayMs);
    setTimeout(() => {
      try { this.connect().catch(() => {}); } catch {}
    }, delay).unref?.();
  }

  async disconnect() {
    this.reconnect = false;
    if (this._socket) { try { this._socket.end(); } catch {} }
    this._connected = false;
  }

  // Convenience helpers
  async set(key, value) { return this.call('SET', key, value); }
  async get(key) { return this.call('GET', key); }
  async incr(key) { return this.call('INCR', key); }

  async call(cmd, ...args) {
    if (!this._connected) {
      if (!this.offlineQueue) throw new Error("Not connected");
      return new Promise((resolve, reject) => {
        this._offlineQueueBuf.push({ cmd, args, resolve, reject });
        if (!this._connecting) this.connect().catch(reject);
      }).then((node) => {
        const dec = decodeNode(node);
        if (dec instanceof Error) throw dec;
        return dec;
      });
    }
    const node = await this._writeAndTrack([cmd, ...args]);
    const dec = decodeNode(node);
    if (dec instanceof Error) throw dec;
    return dec;
  }

  _flushOfflineQueue() {
    if (!this._connected) return;
    if (this._offlineQueueBuf.length === 0) return;
    const buf = this._offlineQueueBuf.splice(0);
    for (const item of buf) {
      this._writeAndTrack([item.cmd, ...item.args]).then(item.resolve, item.reject);
    }
  }

  _writeAndTrack(args) {
    return new Promise((resolve, reject) => {
      this._pending.push({ resolve, reject });
      const payload = encodeArrayOfBulkStrings(args.map((a) => (a === null || a === undefined ? "" : String(a))));
      try { this._socket.write(payload); } catch (e) { this._pending.pop(); reject(e); }
    });
  }

  pipeline() {
    const client = this;
    const cmds = [];
    return {
      add(cmd, ...args) { cmds.push([cmd, ...args]); return this; },
      async exec() {
        if (!client._connected) { await client.connect(); }
        const waiters = [];
        let payload = "";
        for (const c of cmds) {
          payload += encodeArrayOfBulkStrings(c.map((a) => (a === null || a === undefined ? "" : String(a))));
          waiters.push(new Promise((resolve, reject) => client._pending.push({ resolve, reject })));
        }
        client._socket.write(payload);
        const nodes = await Promise.all(waiters);
        return nodes.map((n) => {
          const dec = decodeNode(n);
          if (dec instanceof Error) throw dec;
          return dec;
        });
      }
    };
  }

  // Dynamic command proxy: client.commands.GET('key') -> call('GET','key')
  get commands() {
    const self = this;
    return new Proxy({}, {
      get(_, prop) {
        return (...args) => self.call(String(prop).toUpperCase(), ...args);
      }
    });
  }
}

module.exports = { RedisClient };


