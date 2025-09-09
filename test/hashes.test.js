"use strict";

const test = require("node:test");
const assert = require("assert");
const { withServer, session } = require("./helpers");

test("Hashes: HSET/HGET, HMSET, HGETALL, HDEL, HEXISTS", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    let res = await s.send(["HSET", "H", "f1", "v1"]);
    assert.equal(res.type, "integer");
    res = await s.send(["HGET", "H", "f1"]);
    assert.equal(res.type, "bulk");
    assert.equal(res.value, "v1");

    res = await s.send(["HMSET", "H", "f2", "v2", "f3", "v3"]);
    assert.equal(res.type, "simple");

    res = await s.send(["HGETALL", "H"]);
    assert.equal(res.type, "array");

    // Build pairs
    const pairs = [];
    for (let i = 0; i < res.value.length; i += 2) {
      pairs.push([res.value[i].value, res.value[i+1].value]);
    }
    const m = Object.fromEntries(pairs);
    assert.deepEqual(m, { f1: "v1", f2: "v2", f3: "v3" });

    res = await s.send(["HEXISTS", "H", "f2"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 1);

    res = await s.send(["HDEL", "H", "f2"]);
    assert.equal(res.type, "integer");

    res = await s.send(["HEXISTS", "H", "f2"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 0);

    s.close();
  });
});
