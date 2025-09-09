"use strict";

const test = require("node:test");
const assert = require("assert");
const { withServer, session } = require("./helpers");

test("Streams: XADD/XRANGE/XLEN and XREAD", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    let res = await s.send(["XADD", "mystream", "*", "f1", "v1"]);
    assert.equal(res.type, "bulk");

    res = await s.send(["XADD", "mystream", "*", "f2", "v2"]);
    assert.equal(res.type, "bulk");

    res = await s.send(["XLEN", "mystream"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 2);

    res = await s.send(["XRANGE", "mystream", "-", "+"]);
    assert.equal(res.type, "array");
    assert.ok(res.value.length >= 2);

    // XREAD COUNT 1 STREAMS mystream $  (should return null if nothing new)
    res = await s.send(["XREAD", "COUNT", "1", "BLOCK", "1", "STREAMS", "mystream", "$"]);
    assert.ok(res.type === 'bulk' || res.type === 'array');

    s.close();
  });
});

test("Streams: consumer groups basic flow", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    await s.send(["XADD", "s", "*", "f", "1"]);
    await s.send(["XGROUP", "CREATE", "s", "g1", "$"]);

    let res = await s.send(["XREADGROUP", "GROUP", "g1", "c1", "COUNT", "1", "STREAMS", "s", ">"]);
    assert.ok(res.type === 'array' || res.type === 'bulk');

    // Acknowledge first message if present via XACK s g1 <id>
    if (res.type === 'array' && res.value.length > 0) {
      const streamArr = res.value[0].value; // [ streamKey, [ [id, [k,v...]], ... ] ]
      if (Array.isArray(streamArr) && streamArr.length === 2) {
        const entries = streamArr[1].value || [];
        if (entries.length > 0) {
          const firstId = entries[0].value[0].value;
          const ack = await s.send(["XACK", "s", "g1", firstId]);
          assert.equal(ack.type, 'integer');
        }
      }
    }

    s.close();
  });
});


