"use strict";

const crypto = require("crypto");

class AclManager {
  constructor(options = {}) {
    this.users = new Map(); // name -> user
    // Initialize default user
    const defaultUser = this._newUser("default");
    defaultUser.active = true;
    defaultUser.allCommands = true;
    defaultUser.allKeys = true;
    if (options.defaultPassword) {
      defaultUser.nopass = false;
      defaultUser.passwords.add(this._hash(String(options.defaultPassword)));
    } else {
      defaultUser.nopass = true;
    }
    this.users.set("default", defaultUser);
  }

  _newUser(name) {
    return {
      name: String(name),
      active: false,
      passwords: new Set(), // hashed
      nopass: false,
      allCommands: false,
      allowedCommands: new Set(), // upper names
      allKeys: false,
      keyPatterns: [] // strings
    };
  }

  _hash(s) {
    return "sha256:" + crypto.createHash("sha256").update(s, "utf8").digest("hex");
  }

  requiresAuth() {
    const u = this.users.get("default");
    if (!u || !u.active) return true;
    if (u.nopass) return false;
    // Has at least one password => require auth
    return u.passwords.size > 0;
  }

  authenticate(username, password) {
    const user = this.users.get(String(username || "default"));
    if (!user || !user.active) return { ok: false, message: "invalid user" };
    if (user.nopass) return { ok: true, user };
    if (password == null) return { ok: false, message: "invalid password" };
    const h = this._hash(String(password));
    if (user.passwords.has(h)) return { ok: true, user };
    return { ok: false, message: "invalid password" };
  }

  getUser(name) {
    return this.users.get(String(name));
  }

  getEffectiveUser(name) {
    return this.getUser(name) || this.getUser("default");
  }

  listUsers() {
    const out = [];
    for (const user of this.users.values()) {
      const parts = ["user", user.name, user.active ? "on" : "off"];
      if (user.nopass) parts.push("nopass");
      if (user.passwords.size > 0) parts.push(">" + user.passwords.size);
      parts.push(user.allCommands ? "allcommands" : "rescommands" + (user.allowedCommands.size > 0 ? "+" + user.allowedCommands.size : ""));
      parts.push(user.allKeys ? "allkeys" : "reskeys" + (user.keyPatterns.length > 0 ? "+" + user.keyPatterns.length : ""));
      out.push(parts.join(" "));
    }
    return out;
  }

  usersList() {
    return Array.from(this.users.keys());
  }

  delUser(name) {
    const key = String(name);
    if (key === "default") return 0;
    return this.users.delete(key) ? 1 : 0;
  }

  setUser(name, rules) {
    const uname = String(name);
    let user = this.users.get(uname);
    if (!user) { user = this._newUser(uname); this.users.set(uname, user); }
    for (const raw of rules) {
      const r = String(raw);
      if (r === "on") { user.active = true; continue; }
      if (r === "off") { user.active = false; continue; }
      if (r === "allcommands") { user.allCommands = true; user.allowedCommands.clear(); continue; }
      if (r === "resetcommands") { user.allCommands = false; user.allowedCommands.clear(); continue; }
      if (r === "allkeys") { user.allKeys = true; user.keyPatterns = []; continue; }
      if (r === "resetkeys") { user.allKeys = false; user.keyPatterns = []; continue; }
      if (r === "resetpass") { user.passwords.clear(); user.nopass = false; continue; }
      if (r === "nopass") { user.nopass = true; user.passwords.clear(); continue; }
      if (r === "reset") {
        const fresh = this._newUser(uname);
        fresh.name = uname;
        // Keep active? Redis sets off; we'll reset to off
        this.users.set(uname, fresh);
        user = fresh;
        continue;
      }
      if (r.startsWith(">")) {
        const pass = r.slice(1);
        if (!pass) continue;
        user.nopass = false;
        user.passwords.add(this._hash(pass));
        continue;
      }
      if (r.startsWith("~")) {
        const pat = r.slice(1);
        if (!pat) continue;
        user.allKeys = false;
        user.keyPatterns.push(pat);
        continue;
      }
      if (r.startsWith("+")) {
        const cmd = r.slice(1).toUpperCase();
        if (!cmd) continue;
        user.allCommands = false;
        user.allowedCommands.add(cmd);
        continue;
      }
      if (r.startsWith("-")) {
        const cmd = r.slice(1).toUpperCase();
        if (!cmd) continue;
        user.allCommands = false;
        user.allowedCommands.delete(cmd);
        continue;
      }
      // ignore unknown tokens for simplicity
    }
    return true;
  }

  check(userName, upperCmd, keys) {
    const user = this.getEffectiveUser(userName);
    if (!user || !user.active) return { ok: false, message: "ACLs are not enabled for this user" };
    // Command check
    if (!user.allCommands && !user.allowedCommands.has(upperCmd)) {
      return { ok: false, message: "ACL: command not permitted" };
    }
    // Keys check
    if (!user.allKeys) {
      const pats = user.keyPatterns;
      if (keys && keys.length > 0) {
        for (const k of keys) {
          let matched = false;
          for (const pat of pats) {
            if (globMatch(pat, String(k))) { matched = true; break; }
          }
          if (!matched) return { ok: false, message: "ACL: key not permitted" };
        }
      }
    }
    return { ok: true };
  }
}

function globMatch(pattern, text) {
  // simple glob: * and ? only
  const p = String(pattern);
  const t = String(text);
  let pi = 0, ti = 0, star = -1, match = 0;
  while (ti < t.length) {
    if (pi < p.length && (p[pi] === '?' || p[pi] === t[ti])) { pi++; ti++; continue; }
    if (pi < p.length && p[pi] === '*') { star = pi++; match = ti; continue; }
    if (star !== -1) { pi = star + 1; ti = ++match; continue; }
    return false;
  }
  while (pi < p.length && p[pi] === '*') pi++;
  return pi === p.length;
}

module.exports = { AclManager };


