"use strict";

const test = require("node:test");
const assert = require("assert");
const net = require("net");
const { withServer } = require("./helpers");
const { encodeArrayOfBulkStrings, CommandParser } = require("../src/core/protocol");

test("Replication: REPLICAOF and basic data sync", async (t) => {
  await withServer(async ({ host: mHost, port: mPort }) => {
    // Write to master
    const master = net.createConnection({ host: mHost, port: mPort });
    master.write(encodeArrayOfBulkStrings(["SET", "rk", "rv"]));
    await new Promise((r) => setTimeout(r, 50));

    // Start replica and connect to master
    await withServer(async ({ host: rHost, port: rPort }) => {
      const replica = net.createConnection({ host: rHost, port: rPort });
      const parser = new CommandParser();
      replica.write(encodeArrayOfBulkStrings(["REPLICAOF", mHost, String(mPort)]));
      await new Promise((r) => setTimeout(r, 400));

      replica.write(encodeArrayOfBulkStrings(["GET", "rk"]));
      const got = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { try { resolve({ type: 'bulk', value: null }); } catch {} }, 1500).unref?.() || setTimeout(() => { try { resolve({ type: 'bulk', value: null }); } catch {} }, 1500);
        const onData = (chunk) => {
          const msgs = parser.feed(chunk);
          for (const m of msgs) {
            if (m.type === 'bulk') { cleanup(); resolve(m); return; }
          }
        };
        const cleanup = () => {
          try { replica.off('data', onData); } catch {}
          clearTimeout(timer);
        };
        replica.on('data', onData);
        replica.on('error', (e) => { cleanup(); reject(e); });
      });
      assert.equal(got.type, 'bulk');
      assert.equal(got.value, 'rv');
      // Turn replica back to master to stop reconnect loop
      await new Promise((resolve, reject) => {
        const p = new CommandParser();
        const onData = (chunk) => {
          const msgs = p.feed(chunk);
          if (msgs.length > 0) { try { replica.off('data', onData); } catch {}; resolve(); }
        };
        replica.on('data', onData);
        replica.on('error', (e) => { try { replica.off('data', onData); } catch {}; resolve(); });
        replica.write(encodeArrayOfBulkStrings(["REPLICAOF", "NO", "ONE"]));
      });
      try { replica.end(); } catch {}
    });

    try { master.end(); } catch {}
  });
});


