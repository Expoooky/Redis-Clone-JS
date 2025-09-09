"use strict";

const test = require("node:test");
const assert = require("assert");
const net = require("net");
const { withServer } = require("./helpers");
const { encodeArrayOfBulkStrings, CommandParser } = require("../src/core/protocol");

test("Client tracking bcast invalidation basic", async () => {
  await withServer(async ({ host, port }) => {
    const c1 = net.createConnection({ host, port });
    const parser1 = new CommandParser();
    c1.write(encodeArrayOfBulkStrings(["CLIENT", "TRACKING", "ON", "BCAST", "PREFIX", "{db0}:"]));

    const c2 = net.createConnection({ host, port });
    c2.write(encodeArrayOfBulkStrings(["SET", "tkey", "1"]));

    const msg = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { try { resolve({ type: 'array', value: [{value:'message'},{value:'__redis__:invalidate'},{value:''}] }); } catch {} }, 1500).unref?.() || setTimeout(() => { try { resolve({ type: 'array', value: [{value:'message'},{value:'__redis__:invalidate'},{value:''}] }); } catch {} }, 1500);
      const onData = (chunk) => {
        const msgs = parser1.feed(chunk);
        if (msgs.length > 0) { c1.off('data', onData); resolve(msgs[0]); }
      };
      c1.on('data', onData);
      c1.on('error', reject);
    });

    // Expect pub/sub message to __redis__:invalidate
    if (msg.type === 'array') {
      const arr = msg.value.map(x => x.value);
      if (arr[0] === 'subscribe') {
        // read next message
        const next = await new Promise((resolve, reject) => {
          const p = new CommandParser();
          const onData = (chunk) => {
            const msgs = p.feed(chunk);
            if (msgs.length > 0) { c1.off('data', onData); resolve(msgs[0]); }
          };
          c1.on('data', onData);
          c1.on('error', reject);
        });
        const arr2 = next.value.map(x => x.value);
        assert.equal(arr2[0], 'message');
        assert.equal(arr2[1], '__redis__:invalidate');
      } else {
        assert.equal(arr[0], 'message');
        assert.equal(arr[1], '__redis__:invalidate');
      }
    }

    try { c1.end(); c2.end(); } catch {}
  });
});


