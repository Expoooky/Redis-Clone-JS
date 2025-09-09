"use strict";

const test = require("node:test");
const assert = require("assert");
const { withServer, session } = require("./helpers");

test("HLL: PFADD/PFCOUNT and PFMERGE", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    let res = await s.send(["PFADD", "hll", "foo", "bar", "zap"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 1);

    res = await s.send(["PFADD", "hll", "zap", "zap", "zap"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 0);

    res = await s.send(["PFCOUNT", "hll"]);
    assert.equal(res.type, "integer");
    assert.ok(res.value >= 3);

    res = await s.send(["PFADD", "hll2", "a", "b", "c", "foo"]);
    assert.equal(res.type, "integer");

    res = await s.send(["PFMERGE", "hll3", "hll", "hll2"]);
    assert.equal(res.type, "simple");

    res = await s.send(["PFCOUNT", "hll3"]);
    assert.equal(res.type, "integer");
    assert.ok(res.value >= 6);

    s.close();
  });
});


