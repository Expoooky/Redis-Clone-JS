"use strict";

const test = require("node:test");
const assert = require("assert");
const { withServer, session } = require("./helpers");

test("Sets: SADD/SREM, SISMEMBER/SMEMBERS, SINTER/SUNION/SDIFF", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    let res = await s.send(["SADD", "A", "a", "b", "c"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 3);

    res = await s.send(["SADD", "B", "b", "c", "d"]);
    assert.equal(res.type, "integer");

    res = await s.send(["SISMEMBER", "A", "a"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 1);

    res = await s.send(["SMEMBERS", "A"]);
    assert.equal(res.type, "array");
    const membersA = new Set(res.value.map(x => x.value));
    assert.deepEqual(membersA, new Set(["a","b","c"]));

    res = await s.send(["SINTER", "A", "B"]);
    assert.equal(res.type, "array");
    const inter = new Set(res.value.map(x => x.value));
    assert.deepEqual(inter, new Set(["b","c"]));

    res = await s.send(["SUNION", "A", "B"]);
    assert.equal(res.type, "array");
    const uni = new Set(res.value.map(x => x.value));
    assert.deepEqual(uni, new Set(["a","b","c","d"]));

    res = await s.send(["SDIFF", "A", "B"]);
    assert.equal(res.type, "array");
    const diff = new Set(res.value.map(x => x.value));
    assert.deepEqual(diff, new Set(["a"]));

    res = await s.send(["SREM", "A", "a"]);
    assert.equal(res.type, "integer");

    s.close();
  });
});
