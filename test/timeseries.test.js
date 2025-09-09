"use strict";

const test = require("node:test");
const assert = require("assert");
const { withServer, session } = require("./helpers");

test("TimeSeries: TS.CREATE, TS.ADD, TS.RANGE, TS.GET (integers)", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    let res = await s.send(["TS.CREATE", "ts1"]);
    assert.equal(res.type, "simple");

    res = await s.send(["TS.ADD", "ts1", "1", "10"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 1);

    res = await s.send(["TS.ADD", "ts1", "2", "20"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 2);

    res = await s.send(["TS.GET", "ts1"]);
    assert.equal(res.type, "array");
    assert.equal(res.value[0].type, 'integer');
    assert.equal(res.value[0].value, 2);
    assert.equal(res.value[1].type, 'integer');
    assert.equal(res.value[1].value, 20);

    res = await s.send(["TS.RANGE", "ts1", "0", "10"]);
    assert.equal(res.type, "array");
    assert.equal(res.value.length, 2);
    // first row
    assert.equal(res.value[0].value[0].type, 'integer');
    assert.equal(res.value[0].value[0].value, 1);
    assert.equal(res.value[0].value[1].type, 'integer');
    assert.equal(res.value[0].value[1].value, 10);

    s.close();
  });
});


