"use strict";

const test = require("node:test");
const assert = require("assert");
const net = require("net");
const { withServer } = require("./helpers");
const { encodeArrayOfBulkStrings, CommandParser } = require("../src/core/protocol");

test("Pub/Sub: SUBSCRIBE and PUBLISH", async () => {
  await withServer(async ({ host, port }) => {
    const subSock = net.createConnection({ host, port });
    const subParser = new CommandParser();
    subSock.write(encodeArrayOfBulkStrings(["SUBSCRIBE", "news"]));

    const pubSock = net.createConnection({ host, port });
    // Wait a tick to ensure subscription is registered before publish
    await new Promise((r) => setTimeout(r, 10));
    pubSock.write(encodeArrayOfBulkStrings(["PUBLISH", "news", "hello"]));

    const msgNode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 1000).unref?.() || setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 1000);
      const onData = (chunk) => {
        const msgs = subParser.feed(chunk);
        for (const m of msgs) {
          if (m && m.type === 'array' && Array.isArray(m.value) && m.value[0]?.value === 'message') {
            cleanup();
            resolve(m);
            return;
          }
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        try { subSock.off('data', onData); } catch {}
      };
      subSock.on('data', onData);
      subSock.on('error', (e) => { cleanup(); reject(e); });
    });

    const arr = msgNode.value.map(x => x.value);
    assert.equal(arr[0], 'message');
    assert.equal(arr[1], 'news');
    assert.equal(arr[2], 'hello');

    try { subSock.end(); pubSock.end(); } catch {}
  });
});


