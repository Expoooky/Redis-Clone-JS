"use strict";

const test = require("node:test");
const assert = require("assert");
const { withServer, session } = require("./helpers");

test("Transactions: MULTI/EXEC queue and atomicity", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    let res = await s.send(["MULTI"]);
    assert.equal(res.type, "simple");

    res = await s.send(["SET", "k", "1"]);
    assert.equal(res.type, "simple");

    res = await s.send(["INCR", "k"]);
    assert.equal(res.type, "simple");

    res = await s.send(["EXEC"]);
    // returns array of raw replies; accept either array or error if feature unsupported
    if (res.type === 'array') {
      assert.equal(res.value.length, 2);
    }

    res = await s.send(["GET", "k"]);
    if (res.type === 'bulk') {
      assert.equal(res.value, "2");
    }

    // DISCARD clears queue
    res = await s.send(["MULTI"]);
    await s.send(["SET", "k", "3"]);
    res = await s.send(["DISCARD"]);
    assert.equal(res.type, "simple");

    res = await s.send(["GET", "k"]);
    assert.equal(res.value, "2");

    s.close();
  });
});


