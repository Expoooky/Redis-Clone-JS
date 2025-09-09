"use strict";

const test = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { withServer, session } = require("./helpers");

test("Persistence: snapshot save and reload", async () => {
  const snapPath = path.join(__dirname, "tmp-dump.json");
  try { fs.unlinkSync(snapPath); } catch {}

  // First run: set value and trigger SAVE
  await withServer(async ({ host, port }) => {
    const s = session(host, port);
    let res = await s.send(["SET", "persist:key", "value"]);
    assert.equal(res.type, "simple");
    res = await s.send(["SAVE"]);
    assert.equal(res.type, "simple");
    s.close();
  }, { snapshotPath: snapPath });

  // Second run: should load snapshot and have key
  await withServer(async ({ host, port }) => {
    const s = session(host, port);
    const res = await s.send(["GET", "persist:key"]);
    assert.equal(res.type, "bulk");
    assert.equal(res.value, "value");
    s.close();
  }, { snapshotPath: snapPath });

  try { fs.unlinkSync(snapPath); } catch {}
});


