"use strict";

const test = require("node:test");
const assert = require("assert");
const { withServer, session } = require("./helpers");

test("Lists: LPUSH/RPUSH, LPOP/RPOP, LRANGE, LINDEX, LSET", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    let res = await s.send(["LPUSH", "L", "b", "a"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 2);

    res = await s.send(["RPUSH", "L", "c"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 3);

    res = await s.send(["LRANGE", "L", "0", "-1"]);
    assert.equal(res.type, "array");
    assert.deepEqual(res.value.map(x => x.value), ["a","b","c"]);

    res = await s.send(["LINDEX", "L", "1"]);
    assert.equal(res.type, "bulk");
    assert.equal(res.value, "b");

    res = await s.send(["LSET", "L", "1", "B"]);
    assert.equal(res.type, "simple");

    res = await s.send(["LRANGE", "L", "0", "-1"]);
    assert.equal(res.type, "array");
    assert.deepEqual(res.value.map(x => x.value), ["a","B","c"]);

    res = await s.send(["LPOP", "L"]);
    assert.equal(res.type, "bulk");
    assert.equal(res.value, "a");

    res = await s.send(["RPOP", "L"]);
    assert.equal(res.type, "bulk");
    assert.equal(res.value, "c");

    s.close();
  });
});


