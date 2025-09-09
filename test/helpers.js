"use strict";

const net = require("net");
const { RedisLikeServer } = require("../src/server/server");
const { encodeArrayOfBulkStrings, CommandParser } = require("../src/core/protocol");

function session(host, port) {
  const socket = net.createConnection({ host, port });
  const parser = new CommandParser();
  const send = (args) => new Promise((resolve, reject) => {
    const onData = (chunk) => {
      const msgs = parser.feed(chunk);
      if (msgs.length > 0) { socket.off('data', onData); resolve(msgs[0]); }
    };
    socket.on('data', onData);
    socket.write(encodeArrayOfBulkStrings(args));
    socket.on('error', reject);
  });
  const close = () => { try { socket.end(); } catch {} };
  return { send, close };
}

async function withServer(fn, opts = {}) {
  const prevMonitor = process.env.REDISJS_MONITOR_PORT;
  process.env.REDISJS_MONITOR_PORT = '0';
  const server = new RedisLikeServer({ port: 0, ...opts });
  await server.start();
  const addr = server.server.address();
  const port = (addr && addr.port) ? addr.port : 0;
  try {
    await fn({ host: "127.0.0.1", port });
  } finally {
    try { await server._aofWrite; } catch {}
    try { server.server.close(); } catch {}
    try { server.tlsServer?.close?.(); } catch {}
    if (prevMonitor === undefined) delete process.env.REDISJS_MONITOR_PORT; else process.env.REDISJS_MONITOR_PORT = prevMonitor;
  }
}

module.exports = { session, withServer };


