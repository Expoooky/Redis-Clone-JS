"use strict";

const test = require("node:test");
const assert = require("assert");
const { withServer, session } = require("./helpers");

test("Strings: SET/GET/APPEND/STRLEN and INCR/DECR", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    let res = await s.send(["SET", "s", "a"]);
    assert.equal(res.type, "simple");

    res = await s.send(["APPEND", "s", "bc"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 3);

    res = await s.send(["GET", "s"]);
    assert.equal(res.type, "bulk");
    assert.equal(res.value, "abc");

    res = await s.send(["STRLEN", "s"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 3);

    res = await s.send(["SET", "n", "1"]);
    assert.equal(res.type, "simple");

    res = await s.send(["INCR", "n"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 2);

    res = await s.send(["DECRBY", "n", "1"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 1);

    s.close();
  });
});

test("Strings: GETRANGE/SETRANGE", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    let res = await s.send(["SET", "t", "hello world"]);
    assert.equal(res.type, "simple");

    res = await s.send(["GETRANGE", "t", "0", "4"]);
    assert.equal(res.type, "bulk");
    assert.equal(res.value, "hello");

    res = await s.send(["SETRANGE", "t", "6", "redis"]);
    assert.equal(res.type, "integer");

    res = await s.send(["GET", "t"]);
    assert.equal(res.type, "bulk");
    assert.equal(res.value, "hello redis");

    s.close();
  });
});
