"use strict";

const fs = require("fs");
const path = require("path");

class SnapshotManager {
  constructor(filePath) {
    this.filePath = filePath || path.resolve(process.cwd(), "dump.json");
  }

  exists() {
    return fs.existsSync(this.filePath);
  }

  async saveFrom(store) {
    const data = { kv: {}, expires: {} };
    for (const [key, entry] of store.kv.entries()) {
      data.kv[key] = serializeEntry(entry);
    }
    for (const [key, exp] of store.expires.entries()) {
      data.expires[key] = exp;
    }
    const json = JSON.stringify(data);
    await fs.promises.writeFile(this.filePath, json, "utf8");
  }

  async loadInto(store) {
    if (!this.exists()) return false;
    const raw = await fs.promises.readFile(this.filePath, "utf8");
    const data = JSON.parse(raw);
    store.kv.clear();
    store.expires.clear();
    if (data.kv) {
      for (const key of Object.keys(data.kv)) {
        store.kv.set(key, deserializeEntry(data.kv[key]));
      }
    }
    if (data.expires) {
      for (const key of Object.keys(data.expires)) {
        store.expires.set(key, data.expires[key]);
      }
    }
    return true;
  }
}

function serializeEntry(entry) {
  switch (entry.type) {
    case "string":
      return { type: "string", value: String(entry.value) };
    case "list":
      return { type: "list", value: Array.from(entry.value) };
    case "hash":
      return { type: "hash", value: Array.from(entry.value.entries()) };
    case "set":
      return { type: "set", value: Array.from(entry.value.values()) };
    case "zset":
      return {
        type: "zset",
        value: Array.from(entry.value.memberToScore.entries())
      };
    case "json":
      return { type: "json", value: entry.value };
    default:
      throw new Error(`Unknown type '${entry.type}'`);
  }
}

function deserializeEntry(obj) {
  switch (obj.type) {
    case "string":
      return { type: "string", value: String(obj.value) };
    case "list":
      return { type: "list", value: Array.isArray(obj.value) ? obj.value.slice() : [] };
    case "hash": {
      const map = new Map();
      for (const [f, v] of obj.value || []) map.set(String(f), String(v));
      return { type: "hash", value: map };
    }
    case "set": {
      const set = new Set();
      for (const v of obj.value || []) set.add(String(v));
      return { type: "set", value: set };
    }
    case "zset": {
      const memberToScore = new Map();
      const sorted = [];
      for (const [m, s] of obj.value || []) {
        const member = String(m);
        const score = Number(s);
        memberToScore.set(member, score);
        sorted.push({ member, score });
      }
      sorted.sort((a, b) => (a.score - b.score) || (a.member < b.member ? -1 : a.member > b.member ? 1 : 0));
      return { type: "zset", value: { memberToScore, sorted } };
    }
    case "json": {
      // value can be any JSON-serializable structure
      return { type: "json", value: obj.value };
    }
    default:
      throw new Error(`Unknown type '${obj.type}'`);
  }
}

function serializeStore(store) {
  const data = { kv: {}, expires: {} };
  for (const [key, entry] of store.kv.entries()) {
    data.kv[key] = serializeEntry(entry);
  }
  for (const [key, exp] of store.expires.entries()) {
    data.expires[key] = exp;
  }
  return data;
}

async function loadFromObject(store, data) {
  store.kv.clear();
  store.expires.clear();
  if (data.kv) {
    for (const key of Object.keys(data.kv)) {
      store.kv.set(key, deserializeEntry(data.kv[key]));
    }
  }
  if (data.expires) {
    for (const key of Object.keys(data.expires)) {
      store.expires.set(key, data.expires[key]);
    }
  }
}

module.exports = { SnapshotManager, serializeStore, loadFromObject };


