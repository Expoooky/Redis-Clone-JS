"use strict";

const test = require("node:test");
const assert = require("assert");
const { withServer, session } = require("./helpers");

test("Keyspace: SELECT, FLUSHDB, RANDOMKEY", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    let res = await s.send(["SET", "a", "1"]);
    assert.equal(res.type, 'simple');

    res = await s.send(["SELECT", "1"]);
    assert.equal(res.type, 'simple');
    await s.send(["SET", "b", "2"]);

    res = await s.send(["RANDOMKEY"]);
    assert.equal(res.type, 'bulk');
    assert.ok(res.value === 'b');

    res = await s.send(["FLUSHDB"]);
    assert.equal(res.type, 'simple');

    res = await s.send(["DBSIZE"]);
    assert.equal(res.type, 'integer');
    assert.equal(res.value, 0);

    s.close();
  });
});


