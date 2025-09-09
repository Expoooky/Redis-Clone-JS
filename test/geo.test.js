"use strict";

const test = require("node:test");
const assert = require("assert");
const { withServer, session } = require("./helpers");

test("Geo: GEOADD, GEOSEARCH, GEODIST basics", async () => {
  await withServer(async ({ host, port }) => {
    const s = session(host, port);

    let res = await s.send(["GEOADD", "Sicily", "13.361389", "38.115556", "Palermo", "15.087269", "37.502669", "Catania"]);
    assert.equal(res.type, "integer");
    assert.equal(res.value, 2);

    res = await s.send(["GEODIST", "Sicily", "Palermo", "Catania"]);
    assert.equal(res.type, "bulk");
    assert.match(res.value, /^\d+\.\d+$/);

    res = await s.send(["GEOSEARCH", "Sicily", "FROMLONLAT", "15", "37", "BYRADIUS", "200", "km", "ASC"]);
    assert.equal(res.type, "array");
    const got = res.value.map(x => x.value);
    assert.ok(got.includes("Catania") && got.includes("Palermo"));

    s.close();
  });
});


