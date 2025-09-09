"use strict";

const test = require("node:test");
const assert = require("assert");
const { withServer, session } = require("./helpers");

test("Vector: create index, add vectors, search", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    let res = await s.send(["VEC.CREATEINDEX", "vi", "METRIC", "euclidean", "M", "8", "EF", "32"]);
    assert.equal(res.type, "simple");

    res = await s.send(["VEC.ADD", "vi", "id1", "[1,0,0]"]);
    assert.equal(res.type, "simple");
    res = await s.send(["VEC.ADD", "vi", "id2", "[0,1,0]"]);
    assert.equal(res.type, "simple");

    res = await s.send(["VEC.SEARCH", "vi", "[1,0,0]", "1"]);
    assert.equal(res.type, "array");
    // expect id1 as nearest
    const ids = res.value.map(x => x.value?.[0]?.value || x.value);
    const flat = ids.flat().filter(Boolean);
    assert.ok(flat.join(',').includes('id1'));

    s.close();
  });
});


