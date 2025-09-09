"use strict";

const test = require("node:test");
const assert = require("assert");
const { withServer } = require("./helpers");
const { RedisClient } = require("../src/client/sdk");

test("Client SDK: basic commands", async () => {
  await withServer(async ({ host, port }) => {
    const client = new RedisClient({ host, port });
    await client.connect();

    let res = await client.set("k", "v");
    assert.equal(res, "OK");
    const val = await client.get("k");
    assert.equal(val, "v");

    const inc = await client.incr("n");
    assert.equal(typeof inc, 'number');

    await client.disconnect();
  });
});


