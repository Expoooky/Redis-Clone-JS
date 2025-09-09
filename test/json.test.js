"use strict";

const test = require("node:test");
const assert = require("assert");
const { withServer, session } = require("./helpers");

// Covers: JSON.SET, JSON.GET, JSON.DEL, JSON.ARRAPPEND, and basic path queries

test("JSON: set/get/del and array append with paths", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    // JSON.SET doc $ {"name":"alice","tags":["a"]}
    let res = await s.send(["JSON.SET", "doc", "$", '{"name":"alice","tags":["a"]}']);
    assert.equal(res.type, "simple");

    // JSON.GET doc $.name -> "alice"
    res = await s.send(["JSON.GET", "doc", "$.name"]);
    assert.equal(res.type, "bulk");
    assert.equal(res.value, '"alice"');

    // JSON.ARRAPPEND doc $.tags "b" -> count
    res = await s.send(["JSON.ARRAPPEND", "doc", "$.tags", '"b"']);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 2);

    // JSON.GET doc $.tags -> ["a","b"]
    res = await s.send(["JSON.GET", "doc", "$.tags"]);
    assert.equal(res.type, "bulk");
    assert.equal(res.value, '["a","b"]');

    // JSON.DEL doc $.name -> 1
    res = await s.send(["JSON.DEL", "doc", "$.name"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 1);

    // JSON.GET doc $ -> full doc
    res = await s.send(["JSON.GET", "doc", "$"]);
    assert.equal(res.type, "bulk");
    // should contain tags only after deletion of name
    assert.match(res.value, /"tags"/);

    s.close();
  });
});
