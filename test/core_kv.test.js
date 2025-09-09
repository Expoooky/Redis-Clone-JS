"use strict";

const test = require("node:test");
const assert = require("assert");
const { withServer, session } = require("./helpers");
const { encodeArrayOfBulkStrings, CommandParser } = require("../src/core/protocol");

test("Core KV: SET, GET, DEL, EXISTS", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    // SET foo bar
    let res = await s.send(["SET", "foo", "bar"]);
    assert.equal(res.type, "simple");
    assert.equal(res.value, "OK");

    // GET foo -> bar
    res = await s.send(["GET", "foo"]);
    assert.equal(res.type, "bulk");
    assert.equal(res.value, "bar");

    // EXISTS foo -> 1
    res = await s.send(["EXISTS", "foo"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 1);

    // DEL foo -> 1
    res = await s.send(["DEL", "foo"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 1);

    // GET foo -> null
    res = await s.send(["GET", "foo"]);
    assert.equal(res.type, "bulk");
    assert.equal(res.value, null);

    // EXISTS foo -> 0
    res = await s.send(["EXISTS", "foo"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 0);

    s.close();
  });
});


