"use strict";

class EmbeddingRegistry {
  constructor() {
    this.providers = new Map();
    // Built-in provider: 'json' expects payload as JSON array or {vector:[..]}
    this.register('json', (payload) => {
      let v;
      try {
        const parsed = JSON.parse(String(payload));
        if (Array.isArray(parsed)) v = parsed; else if (parsed && Array.isArray(parsed.vector)) v = parsed.vector; else return { error: "payload must be array or {vector:[..]}" };
      } catch { return { error: "invalid JSON payload" } }
      const nums = v.map((x) => Number(x));
      if (nums.some((n) => !Number.isFinite(n))) return { error: "vector contains non-numeric values" };
      return { vector: nums };
    });
  }

  register(name, fn) {
    this.providers.set(String(name).toLowerCase(), fn);
  }

  list() {
    return Array.from(this.providers.keys());
  }

  compute(name, payload) {
    const fn = this.providers.get(String(name).toLowerCase());
    if (!fn) return { error: "unknown provider" };
    try { return fn(payload) || { error: "provider returned no result" }; } catch (e) { return { error: e && e.message ? String(e.message) : "provider error" }; }
  }
}

const GlobalEmbeddingRegistry = new EmbeddingRegistry();

module.exports = { EmbeddingRegistry, GlobalEmbeddingRegistry };


