"use strict";

const test = require("node:test");
const assert = require("assert");
const { withServer, session } = require("./helpers");

test("Bitmaps: SETBIT/GETBIT, BITCOUNT, BITOP", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    let res = await s.send(["SETBIT", "bm", "1", "1"]);
    assert.equal(res.type, "integer");

    res = await s.send(["GETBIT", "bm", "1"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 1);

    // Count bits
    res = await s.send(["BITCOUNT", "bm"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value >= 1, true);

    // BITOP OR bm2 bm bm
    res = await s.send(["BITOP", "OR", "bm2", "bm", "bm"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value >= 1, true);

    s.close();
  });
});


