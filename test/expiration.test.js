"use strict";

const test = require("node:test");
const assert = require("assert");
const { withServer, session } = require("./helpers");

test("Expiration: EXPIRE, TTL, PERSIST with GET checks", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    let res = await s.send(["SET", "k", "v"]);
    assert.equal(res.type, "simple");

    res = await s.send(["EXPIRE", "k", "1"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 1);

    res = await s.send(["TTL", "k"]);
    assert.equal(res.type, "integer");
    assert.ok(res.value >= 0);

    // PERSIST cancels expiration
    res = await s.send(["PERSIST", "k"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 1);

    res = await s.send(["GET", "k"]);
    assert.equal(res.type, "bulk");
    assert.equal(res.value, "v");

    s.close();
  });
});


