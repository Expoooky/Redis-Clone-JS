"use strict";

const test = require("node:test");
const assert = require("assert");
const { withServer, session } = require("./helpers");

test("Bitfields: GET/SET/INCRBY", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    // BITFIELD bf SET i8 0 5
    let res = await s.send(["BITFIELD", "bf", "SET", "i8", "0", "5"]);
    assert.equal(res.type, "array");
    assert.equal(res.value.length, 1);

    // GET i8 0 -> 5
    res = await s.send(["BITFIELD", "bf", "GET", "i8", "0"]);
    assert.equal(res.type, "array");
    assert.equal(parseInt(res.value[0].value, 10), 5);

    // INCRBY i8 0 3 -> 8
    res = await s.send(["BITFIELD", "bf", "INCRBY", "i8", "0", "3"]);
    assert.equal(res.type, "array");
    assert.equal(parseInt(res.value[0].value, 10), 8);

    s.close();
  });
});


