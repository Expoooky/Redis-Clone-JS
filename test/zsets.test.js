"use strict";

const test = require("node:test");
const assert = require("assert");
const { withServer, session } = require("./helpers");

test("Sorted Sets: ZADD, ZRANGE, ZRANGEBYSCORE, ZRANK, ZREM", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    let res = await s.send(["ZADD", "Z", "1", "a", "2", "b", "3", "c"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 3);

    res = await s.send(["ZRANGE", "Z", "0", "-1"]);
    assert.equal(res.type, "array");
    assert.deepEqual(res.value.map(x => x.value), ["a","b","c"]);

    res = await s.send(["ZRANGEBYSCORE", "Z", "1", "2"]);
    assert.equal(res.type, "array");
    assert.deepEqual(res.value.map(x => x.value), ["a","b"]);

    res = await s.send(["ZRANK", "Z", "b"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 1);

    res = await s.send(["ZREM", "Z", "b"]);
    assert.equal(res.type, "integer");

    res = await s.send(["ZRANGE", "Z", "0", "-1"]);
    assert.equal(res.type, "array");
    assert.deepEqual(res.value.map(x => x.value), ["a","c"]);

    s.close();
  });
});


