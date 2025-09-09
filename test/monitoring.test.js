"use strict";

const test = require("node:test");
const assert = require("assert");
const { withServer, session } = require("./helpers");

test("Monitoring: INFO and SLOWLOG", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    let res = await s.send(["INFO"]);
    assert.equal(res.type, 'bulk');
    assert.match(res.value, /# server/);

    res = await s.send(["SLOWLOG", "LEN"]);
    assert.equal(res.type, 'integer');

    res = await s.send(["SLOWLOG", "GET", "1"]);
    assert.ok(res.type === 'array');

    s.close();
  });
});


