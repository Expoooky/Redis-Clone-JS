"use strict";

const test = require("node:test");
const assert = require("assert");
const { withServer, session } = require("./helpers");

test("Documents: index create, add/update, search", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    let res = await s.send(["DOC.INDEXCREATE", "idx", "PREFIX", "doc:*", "SCHEMA", "title", "TEXT", "views", "NUMERIC"]);
    assert.equal(res.type, "simple");

    // Store JSON doc then add to index
    await s.send(["JSON.SET", "doc:1", "$", '{"title":"hello","views":10}']);
    res = await s.send(["DOC.INDEXADD", "idx", "doc:1"]);
    assert.equal(res.type, "simple");

    res = await s.send(["DOC.SEARCH", "idx", "QUERY", "hello"]);
    assert.equal(res.type, "array");
    const results = res.value.map(x => x.value);
    assert.ok(results.some(k => String(k).endsWith("doc:1")));

    await s.send(["JSON.SET", "doc:1", "$", '{"title":"hello world","views":15}']);
    res = await s.send(["DOC.INDEXUPDATE", "idx", "doc:1"]);
    assert.equal(res.type, "simple");

    res = await s.send(["DOC.AGGREGATE", "idx", "GROUPBY", "$.title", "REDUCE", "COUNT"]);
    assert.equal(res.type, "array");
    assert.ok(res.value.length >= 1);

    s.close();
  });
});
