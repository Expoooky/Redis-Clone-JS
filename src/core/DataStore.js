"use strict";

const {
  encodeSimpleString,
  encodeError,
  encodeBulkString,
  encodeInteger,
  encodeArrayOfBulkStrings
} = require("./protocol");
const crypto = require("crypto");
const { GlobalEmbeddingRegistry } = require("./embedders");

class DataStore {
  constructor(options = {}) {
    this.kv = new Map(); // key -> { type: 'string' | 'list' | 'hash' | 'set' | 'zset' | 'json' | 'vec_index', value: any }
    this.expires = new Map(); // key -> expireAt (ms since epoch)
    this._onKeyEvent = typeof options.onKeyEvent === 'function' ? options.onKeyEvent : null;
    // Background purge of expired keys
    this._purgeTimer = setInterval(() => this._purgeExpiredBatch(), 1000).unref?.() || setInterval(() => this._purgeExpiredBatch(), 1000);
    this._docIndexes = new Map(); // name -> { keyPattern, fields: Map<name,type>, docs: Map<docKey, object>, ft: InvertedIndex }
    this._cuckoos = new Map(); // key -> CuckooFilter
  }

  dispatch(command, args) {
    if (!command) return encodeError("empty command");
    const op = command.toUpperCase();
    switch (op) {
      case "SET":
        return this._set(args);
      case "GET":
        return this._get(args);
      case "DEL":
        return this._del(args);
      case "EXISTS":
        return this._exists(args);
      // Phase 2 - Strings
      case "APPEND":
        return this._append(args);
      case "STRLEN":
        return this._strlen(args);
      case "INCR":
        return this._incr(args, 1, true);
      case "DECR":
        return this._incr(args, -1, true);
      case "INCRBY":
        return this._incrby(args, true);
      case "DECRBY":
        return this._decrby(args, true);
      case "GETRANGE":
        return this._getrange(args);
      case "SETRANGE":
        return this._setrange(args);
      case "MGET":
        return this._mget(args);
      case "MSET":
        return this._mset(args);
      case "SETNX":
        return this._setnx(args);
      case "MSETNX":
        return this._msetnx(args);
      case "SETEX":
        return this._setex(args);
      case "PSETEX":
        return encodeError("unknown command 'PSETEX'");
      case "GETSET":
        return this._getset(args);
      case "GETDEL":
        return this._getdel(args);
      case "GETEX":
        return this._getex(args);
      case "INCRBYFLOAT":
        return this._incrbyfloat(args);
      case "SUBSTR":
        return this._substr(args);
      // Bitmaps / Bitfields
      case "SETBIT":
        return this._setbit(args);
      case "GETBIT":
        return this._getbit(args);
      case "BITCOUNT":
        return this._bitcount(args);
      case "BITPOS":
        return this._bitpos(args);
      case "BITOP":
        return this._bitop(args);
      case "BITFIELD":
        return this._bitfield(args);
      case "BITFIELD_RO":
        return this._bitfield_ro(args);
      // Phase 2 - Lists
      case "LPUSH":
        return this._lpush(args);
      case "RPUSH":
        return this._rpush(args);
      case "LPOP":
        return this._lpop(args);
      case "RPOP":
        return this._rpop(args);
      case "LRANGE":
        return this._lrange(args);
      case "LINDEX":
        return this._lindex(args);
      case "LSET":
        return this._lset(args);
      case "LLEN":
        return this._llen(args);
      case "LTRIM":
        return this._ltrim(args);
      case "LREM":
        return this._lrem(args);
      case "RPOPLPUSH":
        return this._rpoplpush(args);
      case "LMOVE":
        return this._lmove(args);
      // Phase 3 - TTL
      case "EXPIRE":
        return this._expire(args);
      case "TTL":
        return this._ttl(args);
      case "PERSIST":
        return this._persist(args);
      case "PTTL":
        return this._pttl(args);
      case "PEXPIRE":
        return this._pexpire(args);
      case "EXPIREAT":
        return this._expireat(args);
      case "PEXPIREAT":
        return this._pexpireat(args);
      case "TYPE":
        return this._type(args);
      case "DBSIZE":
        return this._dbsize(args);
      case "RANDOMKEY":
        return this._randomkey(args);
      case "RENAME":
        return this._rename(args);
      case "RENAMENX":
        return this._renamenx(args);
      // Phase 2 - Hashes
      case "HSET":
        return this._hset(args);
      case "HMSET":
        return this._hmset(args);
      case "HGET":
        return this._hget(args);
      case "HDEL":
        return this._hdel(args);
      case "HEXISTS":
        return this._hexists(args);
      case "HLEN":
        return this._hlen(args);
      case "HKEYS":
        return this._hkeys(args);
      case "HVALS":
        return this._hvals(args);
      case "HGETALL":
        return this._hgetall(args);
      case "HMGET":
        return this._hmget(args);
      case "HSTRLEN":
        return this._hstrlen(args);
      case "HSCAN":
        return this._hscanCommand(args);
      // Phase 2 - Sets
      case "SADD":
        return this._sadd(args);
      case "SREM":
        return this._srem(args);
      case "SISMEMBER":
        return this._sismember(args);
      case "SMISMEMBER":
        return this._smismember(args);
      case "SMEMBERS":
        return this._smembers(args);
      case "SCARD":
        return this._scard(args);
      case "SINTER":
        return this._sinter(args);
      case "SUNION":
        return this._sunion(args);
      case "SDIFF":
        return this._sdiff(args);
      case "SMOVE":
        return this._smove(args);
      case "SPOP":
        return this._spop(args);
      case "SRANDMEMBER":
        return this._srandmember(args);
      case "SUNIONSTORE":
        return this._sunionstore(args);
      case "SINTERSTORE":
        return this._sinterstore(args);
      case "SDIFFSTORE":
        return this._sdiffstore(args);
      case "SSCAN":
        return this._sscanCommand(args);
      // Phase 2 - Sorted Sets
      case "ZADD":
        return this._zadd(args);
      case "ZREM":
        return this._zrem(args);
      case "ZINCRBY":
        return this._zincrby(args);
      case "ZRANK":
        return this._zrank(args);
      case "ZREVRANK":
        return this._zrevrank(args);
      case "ZSCORE":
        return this._zscore(args);
      case "ZCARD":
        return this._zcard(args);
      case "ZRANGE":
        return this._zrange(args);
      case "ZREVRANGE":
        return this._zrevrange(args);
      case "ZRANGEBYSCORE":
        return this._zrangeByScore(args);
      case "ZPOPMIN":
        return this._zpop(args, true);
      case "ZPOPMAX":
        return this._zpop(args, false);
      case "ZSCAN":
        return this._zscanCommand(args);
      // Geospatial
      case "GEOADD":
        return this._geoadd(args);
      case "GEODIST":
        return this._geodist(args);
      case "GEOSEARCH":
        return this._geosearch(args);
      case "GEOHASH":
        return this._geohash(args);
      case "GEOPOS":
        return this._geopos(args);
      case "GEOSEARCHSTORE":
        return this._geosearchstore(args);
      case "GEORADIUS":
        return this._georadius(args);
      case "GEORADIUSBYMEMBER":
        return this._georadiusbymember(args);
      // Time Series
      case "TS.CREATE":
        return this._tsCreate(args);
      case "TS.ADD":
        return this._tsAdd(args);
      case "TS.CREATERULE":
        return this._tsCreateRule(args);
      case "TS.DELETERULE":
        return this._tsDeleteRule(args);
      case "TS.RANGE":
        return this._tsRange(args);
      case "TS.GET":
        return this._tsGet(args);
      // Globals
      case "FLUSHDB":
      case "FLUSHALL":
        return this._flush(args);
      case "KEYS":
        return this._keys(args);
      // Phase 5 - JSON
      case "JSON.SET":
        return this._jsonSet(args);
      case "JSON.GET":
        return this._jsonGet(args);
      case "JSON.DEL":
        return this._jsonDel(args);
      case "JSON.ARRAPPEND":
        return this._jsonArrAppend(args);
      case "JSON.NUMMULTBY":
        return this._jsonNumMultBy(args);
      case "JSON.TOGGLE":
        return this._jsonToggle(args);
      case "JSON.CLEAR":
        return this._jsonClear(args);
      case "JSON.MGET":
        return this._jsonMGet(args);
      case "JSON.TYPE":
        return this._jsonType(args);
      case "JSON.OBJKEYS":
        return this._jsonObjKeys(args);
      case "JSON.OBJLEN":
        return this._jsonObjLen(args);
      case "JSON.ARRLEN":
        return this._jsonArrLen(args);
      case "JSON.ARRPOP":
        return this._jsonArrPop(args);
      case "JSON.ARRINSERT":
        return this._jsonArrInsert(args);
      case "JSON.ARRTRIM":
        return this._jsonArrTrim(args);
      case "JSON.ARRINDEX":
        return this._jsonArrIndex(args);
      case "JSON.STRAPPEND":
        return this._jsonStrAppend(args);
      case "JSON.STRLEN":
        return this._jsonStrLen(args);
      case "JSON.NUMINCRBY":
        return this._jsonNumIncrBy(args);
      case "JSON.FORGET":
        return this._jsonForget(args);
      // Phase 5 - Vectors
      case "VEC.ADD":
        return this._vecAdd(args);
      case "VEC.SEARCH":
        return this._vecSearch(args);
      case "VEC.CREATEINDEX":
        return this._vecCreateIndex(args);
      case "VEC.REBUILD":
        return this._vecRebuild(args);
      case "VEC.STATS":
        return this._vecStats(args);
      case "VEC.ADDVEC":
        return this._vecAddVec(args);
      case "VEC.SUBVEC":
        return this._vecSubVec(args);
      case "VEC.DOT":
        return this._vecDot(args);
      case "EMB.REGISTER":
        return this._embRegister(args);
      case "EMB.LIST":
        return this._embList(args);
      case "VEC.EMBEDADD":
        return this._vecEmbedAdd(args);
      // Streams
      case "XADD":
        return this._xadd(args);
      case "XRANGE":
        return this._xrange(args);
      case "XLEN":
        return this._xlen(args);
      case "XREAD":
        return this._xread(args);
      case "XGROUP":
        return this._xgroupCommand(args);
      case "XREADGROUP":
        return this._xreadgroup(args);
      case "XACK":
        return this._xack(args);
      case "XDEL":
        return this._xdel(args);
      case "XTRIM":
        return this._xtrim(args);
      case "XPENDING":
        return this._xpending(args);
      case "XCLAIM":
        return this._xclaim(args);
      case "XINFO":
        return this._xinfo(args);
      // HyperLogLog
      case "PFADD":
        return this._pfadd(args);
      case "PFCOUNT":
        return this._pfcount(args);
      case "PFMERGE":
        return this._pfmerge(args);
      // Documents
      case "DOC.INDEXCREATE":
        return this._docIndexCreate(args);
      case "DOC.INDEXDROP":
        return this._docIndexDrop(args);
      case "DOC.INDEXLIST":
        return this._docIndexList(args);
      case "DOC.INDEXADD":
        return this._docIndexAdd(args);
      case "DOC.INDEXDEL":
        return this._docIndexDel(args);
      case "DOC.INDEXUPDATE":
        return this._docIndexUpdate(args);
      case "DOC.INDEXREBUILD":
        return this._docIndexRebuild(args);
      case "DOC.SEARCH":
        return this._docSearch(args);
      case "DOC.AGGREGATE":
        return this._docAggregate(args);
      // Cuckoo Filters
      case "CF.RESERVE":
        return this._cfReserve(args);
      case "CF.ADD":
        return this._cfAdd(args, false);
      case "CF.ADDNX":
        return this._cfAdd(args, true);
      case "CF.EXISTS":
        return this._cfExists(args);
      case "CF.DEL":
        return this._cfDel(args);
      case "CF.MADD":
        return this._cfMAdd(args);
      case "CF.MEXISTS":
        return this._cfMExists(args);
      case "CF.INSERT":
        return this._cfInsert(args, false);
      case "CF.INSERTNX":
        return this._cfInsert(args, true);
      default:
        return encodeError(`unknown command '${command}'`);
    }
  }

  // ---------------- Document Indexing/Search ----------------
  _docIndexCreate(args) {
    // DOC.INDEXCREATE name PREFIX <prefix> SCHEMA <field> <TEXT|NUMERIC> [...]
    if (args.length < 5) return encodeError("wrong number of arguments for 'DOC.INDEXCREATE'");
    const name = String(args[0]);
    let i = 1; let prefix = null;
    if (String(args[i]).toUpperCase() !== 'PREFIX') return encodeError("syntax error");
    i++;
    prefix = String(args[i++] || '');
    if (String(args[i]).toUpperCase() !== 'SCHEMA') return encodeError("syntax error");
    i++;
    const fields = new Map();
    while (i < args.length) {
      const fname = String(args[i++]);
      const ftype = String(args[i++] || '').toUpperCase();
      if (!fname || (ftype !== 'TEXT' && ftype !== 'NUMERIC')) return encodeError("invalid schema");
      fields.set(fname, ftype);
    }
    this._docIndexes.set(name, { prefix, fields, text: new Map(), numeric: new Map(), docs: new Set() });
    return encodeSimpleString("OK");
  }

  _docIndexDrop(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'DOC.INDEXDROP'");
    const n = this._docIndexes.delete(String(args[0])) ? 1 : 0;
    return encodeInteger(n);
  }

  _docIndexList(args) {
    if (args.length !== 0) return encodeError("wrong number of arguments for 'DOC.INDEXLIST'");
    return encodeArrayOfBulkStrings(Array.from(this._docIndexes.keys()));
  }

  _docIndexAdd(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'DOC.INDEXADD'");
    const [name, docKey] = args.map(String);
    const idx = this._docIndexes.get(name);
    if (!idx) return encodeError("index not found");
    const obj = this._docGetJsonObject(docKey);
    if (obj === undefined) return encodeError("document not found or not JSON");
    this._docUnindex(idx, docKey);
    this._docIndexObject(idx, docKey, obj);
    idx.docs.add(docKey);
    return encodeSimpleString("OK");
  }

  _docIndexDel(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'DOC.INDEXDEL'");
    const [name, docKey] = args.map(String);
    const idx = this._docIndexes.get(name);
    if (!idx) return encodeError("index not found");
    this._docUnindex(idx, docKey);
    idx.docs.delete(docKey);
    return encodeInteger(1);
  }

  _docIndexUpdate(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'DOC.INDEXUPDATE'");
    const [name, docKey] = args.map(String);
    const idx = this._docIndexes.get(name);
    if (!idx) return encodeError("index not found");
    const obj = this._docGetJsonObject(docKey);
    if (obj === undefined) return encodeError("document not found or not JSON");
    this._docUnindex(idx, docKey);
    this._docIndexObject(idx, docKey, obj);
    idx.docs.add(docKey);
    return encodeSimpleString("OK");
  }

  _docIndexRebuild(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'DOC.INDEXREBUILD'");
    const name = String(args[0]);
    const idx = this._docIndexes.get(name);
    if (!idx) return encodeError("index not found");
    // Clear
    idx.text.clear(); idx.numeric.clear(); idx.docs.clear();
    const pat = idx.prefix ? idx.prefix + '*' : '*';
    const keys = this.keys(pat);
    for (const k of keys) {
      const obj = this._docGetJsonObject(k);
      if (obj !== undefined) {
        this._docIndexObject(idx, k, obj);
        idx.docs.add(k);
      }
    }
    return encodeSimpleString("OK");
  }

  _docSearch(args) {
    // DOC.SEARCH name QUERY <text> [FILTER <field> MIN <min> MAX <max>] [LIMIT offset count]
    if (args.length < 3) return encodeError("wrong number of arguments for 'DOC.SEARCH'");
    const name = String(args[0]);
    const idx = this._docIndexes.get(name);
    if (!idx) return encodeError("index not found");
    let i = 1; if (String(args[i]).toUpperCase() !== 'QUERY') return encodeError("syntax error"); i++;
    const q = String(args[i++] || '').trim().toLowerCase();
    const tokens = this._docTokenize(q);
    let filterField = null, minV = -Infinity, maxV = Infinity;
    let offset = 0, count = 10;
    while (i < args.length) {
      const opt = String(args[i]).toUpperCase();
      if (opt === 'FILTER') {
        filterField = String(args[i + 1]);
        const minS = args[i + 3]; const maxS = args[i + 5];
        if (String(args[i + 2]).toUpperCase() !== 'MIN' || String(args[i + 4]).toUpperCase() !== 'MAX') return encodeError("syntax error");
        minV = parseFloat(String(minS)); maxV = parseFloat(String(maxS));
        if (!Number.isFinite(minV) || !Number.isFinite(maxV)) return encodeError("invalid range");
        i += 6; continue;
      }
      if (opt === 'LIMIT') {
        const off = parseInt(String(args[i + 1]), 10); const cnt = parseInt(String(args[i + 2]), 10);
        if (!Number.isFinite(off) || !Number.isFinite(cnt) || off < 0 || cnt < 0) return encodeError("invalid LIMIT");
        offset = off; count = cnt; i += 3; continue;
      }
      break;
    }
    if (tokens.length === 0) return encodeArrayOfBulkStrings([]);
    // For each token, union postings across TEXT fields (prefix/substring match)
    let current = null;
    for (const t of tokens) {
      const needle = String(t);
      let postings = new Set();
      for (const [field, type] of idx.fields.entries()) {
        if (type !== 'TEXT') continue;
        const fmap = idx.text.get(field);
        if (!fmap) continue;
        for (const [term, set] of fmap.entries()) {
          if (term.includes(needle)) { for (const d of set) postings.add(d); }
        }
      }
      if (current === null) current = postings; else current = new Set([...current].filter((d) => postings.has(d)));
      if (current.size === 0) break;
    }
    if (!current || current.size === 0) return encodeArrayOfBulkStrings([]);
    // Apply numeric filter
    let results = Array.from(current);
    if (filterField) {
      const fmap = idx.numeric.get(filterField);
      if (fmap) {
        results = results.filter((doc) => {
          const v = fmap.get(doc);
          return Number.isFinite(v) && v >= minV && v <= maxV;
        });
      } else {
        results = [];
      }
    }
    const sliced = results.slice(offset, offset + count);
    return encodeArrayOfBulkStrings(sliced);
  }

  _docAggregate(args) {
    // DOC.AGGREGATE name GROUPBY <field> REDUCE COUNT | REDUCE SUM <field>
    if (args.length < 4) return encodeError("wrong number of arguments for 'DOC.AGGREGATE'");
    const name = String(args[0]);
    const idx = this._docIndexes.get(name);
    if (!idx) return encodeError("index not found");
    let i = 1; if (String(args[i]).toUpperCase() !== 'GROUPBY') return encodeError("syntax error"); i++;
    const groupField = String(args[i++]);
    if (String(args[i]).toUpperCase() !== 'REDUCE') return encodeError("syntax error"); i++;
    const reduce = String(args[i++]).toUpperCase();
    let reduceField = null;
    if (reduce === 'SUM') { reduceField = String(args[i++]); }
    const groups = new Map(); // key -> {count,sum}
    for (const doc of idx.docs.values()) {
      const obj = this._docGetJsonObject(doc);
      if (obj === undefined) continue;
      const key = this._docReadPath(obj, groupField);
      const gk = String(key);
      if (!groups.has(gk)) groups.set(gk, { count: 0, sum: 0 });
      const g = groups.get(gk);
      g.count += 1;
      if (reduce === 'SUM') {
        const v = Number(this._docReadPath(obj, reduceField));
        if (Number.isFinite(v)) g.sum += v;
      }
    }
    const outArr = [];
    for (const [k, v] of groups.entries()) {
      if (reduce === 'COUNT') outArr.push([k, String(v.count)]);
      else outArr.push([k, String(v.sum)]);
    }
    // RESP array of arrays
    let out = `*${outArr.length}\r\n`;
    for (const row of outArr) {
      out += `*${row.length}\r\n`;
      for (const cell of row) out += `$${cell.length}\r\n${cell}\r\n`;
    }
    return out;
  }

  _docGetJsonObject(key) {
    const entry = this._getEntry(String(key));
    if (!entry || entry.type !== 'json') return undefined;
    return entry.value;
  }

  _docIndexObject(idx, docKey, obj) {
    for (const [field, type] of idx.fields.entries()) {
      const value = this._docReadPath(obj, field);
      if (type === 'TEXT') {
        const terms = this._docCollectText(value);
        if (!idx.text.has(field)) idx.text.set(field, new Map());
        const fmap = idx.text.get(field);
        for (const t of terms) {
          if (!fmap.has(t)) fmap.set(t, new Set());
          fmap.get(t).add(docKey);
        }
      } else if (type === 'NUMERIC') {
        const num = Number(value);
        if (!Number.isFinite(num)) continue;
        if (!idx.numeric.has(field)) idx.numeric.set(field, new Map());
        idx.numeric.get(field).set(docKey, num);
      }
    }
  }

  _docUnindex(idx, docKey) {
    for (const [field, fmap] of idx.text.entries()) {
      for (const [term, set] of fmap.entries()) {
        if (set.delete(docKey) && set.size === 0) fmap.delete(term);
      }
    }
    for (const [field, m] of idx.numeric.entries()) {
      m.delete(docKey);
    }
  }

  _docCollectText(value) {
    const out = new Set();
    const push = (s) => {
      const tokens = this._docTokenize(String(s).toLowerCase());
      for (const t of tokens) out.add(t);
    };
    if (typeof value === 'string') push(value);
    else if (Array.isArray(value)) { for (const v of value) if (typeof v === 'string') push(v); }
    else if (value && typeof value === 'object') { for (const v of Object.values(value)) if (typeof v === 'string') push(v); }
    return out;
  }

  _docTokenize(text) {
    return text.split(/[^a-z0-9]+/i).filter(Boolean);
  }

  _docReadPath(obj, path) {
    // simple dot-path: a.b.c, numeric indices supported
    if (!path) return undefined;
    const segs = String(path).split('.');
    let cur = obj;
    for (const s of segs) {
      if (cur == null) return undefined;
      const idx = /^[0-9]+$/.test(s) ? parseInt(s, 10) : s;
      cur = cur[idx];
    }
    return cur;
  }

  // ---------------- Cuckoo Filter ----------------
  _ensureCuckoo(key) {
    const k = String(key);
    let cf = this._cuckoos.get(k);
    if (!cf) { cf = new CuckooFilter(); this._cuckoos.set(k, cf); }
    return cf;
  }

  _cfReserve(args) {
    // CF.RESERVE key capacity [BUCKETSIZE bs] [MAXITERATIONS mi]
    if (args.length < 2) return encodeError("wrong number of arguments for 'CF.RESERVE'");
    const key = String(args[0]);
    const cap = parseInt(String(args[1]), 10);
    if (!Number.isFinite(cap) || cap <= 0) return encodeError("invalid capacity");
    let bucketSize = 4; let maxIters = 500;
    for (let i = 2; i < args.length; i++) {
      const opt = String(args[i]).toUpperCase();
      if (opt === 'BUCKETSIZE' && args[i + 1]) { const v = parseInt(String(args[i + 1]), 10); if (Number.isFinite(v) && v > 0) bucketSize = v; i++; continue; }
      if (opt === 'MAXITERATIONS' && args[i + 1]) { const v = parseInt(String(args[i + 1]), 10); if (Number.isFinite(v) && v > 0) maxIters = v; i++; continue; }
    }
    const cf = new CuckooFilter(cap, bucketSize, maxIters);
    this._cuckoos.set(key, cf);
    return encodeSimpleString("OK");
  }

  _cfAdd(args, nxOnly) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'CF.ADD'");
    const [key, item] = args.map(String);
    const cf = this._ensureCuckoo(key);
    if (nxOnly && cf.exists(item)) return encodeInteger(0);
    const ok = cf.add(item);
    return encodeInteger(ok ? 1 : 0);
  }

  _cfExists(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'CF.EXISTS'");
    const [key, item] = args.map(String);
    const cf = this._cuckoos.get(key);
    if (!cf) return encodeInteger(0);
    return encodeInteger(cf.exists(item) ? 1 : 0);
  }

  _cfDel(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'CF.DEL'");
    const [key, item] = args.map(String);
    const cf = this._cuckoos.get(key);
    if (!cf) return encodeInteger(0);
    return encodeInteger(cf.delete(item) ? 1 : 0);
  }

  _cfMAdd(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'CF.MADD'");
    const [key, ...items] = args.map(String);
    const cf = this._ensureCuckoo(key);
    const out = items.map((it) => (cf.add(it) ? 1 : 0));
    let resp = `*${out.length}\r\n`;
    for (const n of out) resp += `:${n}\r\n`;
    return resp;
  }

  _cfMExists(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'CF.MEXISTS'");
    const [key, ...items] = args.map(String);
    const cf = this._cuckoos.get(key);
    const out = items.map((it) => (cf && cf.exists(it) ? 1 : 0));
    let resp = `*${out.length}\r\n`;
    for (const n of out) resp += `:${n}\r\n`;
    return resp;
  }

  _cfInsert(args, nxOnly) {
    // CF.INSERT key ITEMS item [item ...]
    if (args.length < 3) return encodeError("wrong number of arguments for 'CF.INSERT'");
    const key = String(args[0]);
    let i = 1;
    if (String(args[i]).toUpperCase() !== 'ITEMS') return encodeError("syntax error");
    i++;
    const items = args.slice(i).map(String);
    const cf = this._ensureCuckoo(key);
    const out = [];
    for (const it of items) {
      if (nxOnly && cf.exists(it)) { out.push(0); continue; }
      out.push(cf.add(it) ? 1 : 0);
    }
    let resp = `*${out.length}\r\n`;
    for (const n of out) resp += `:${n}\r\n`;
    return resp;
  }

  _set(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'SET'");
    const key = String(args[0]);
    const value = String(args[1]);
    let nx = false, xx = false, keepTTL = false, getOpt = false;
    let expireAtMs = undefined;
    let i = 2;
    while (i < args.length) {
      const opt = String(args[i]).toUpperCase();
      if (opt === 'NX') { nx = true; i += 1; continue; }
      if (opt === 'XX') { xx = true; i += 1; continue; }
      if (opt === 'GET') { getOpt = true; i += 1; continue; }
      if (opt === 'KEEPTTL') { keepTTL = true; i += 1; continue; }
      if (opt === 'EX' && args[i + 1] !== undefined) {
        const seconds = parseInt(String(args[i + 1]), 10);
        if (!Number.isFinite(seconds) || seconds <= 0) return encodeError("value is not an integer or out of range");
        expireAtMs = this._now() + seconds * 1000; i += 2; continue;
      }
      if (opt === 'PX' && args[i + 1] !== undefined) {
        const ms = parseInt(String(args[i + 1]), 10);
        if (!Number.isFinite(ms) || ms <= 0) return encodeError("value is not an integer or out of range");
        expireAtMs = this._now() + ms; i += 2; continue;
      }
      if (opt === 'EXAT' && args[i + 1] !== undefined) {
        const ts = parseInt(String(args[i + 1]), 10);
        if (!Number.isFinite(ts)) return encodeError("value is not an integer or out of range");
        expireAtMs = ts * 1000; i += 2; continue;
      }
      if (opt === 'PXAT' && args[i + 1] !== undefined) {
        const tsms = parseInt(String(args[i + 1]), 10);
        if (!Number.isFinite(tsms)) return encodeError("value is not an integer or out of range");
        expireAtMs = tsms; i += 2; continue;
      }
      return encodeError("syntax error");
    }
    if (nx && xx) return encodeError("syntax error");
    const existing = this._getEntry(key);
    if (nx && existing) return getOpt ? encodeBulkString(null) : encodeBulkString(null);
    if (xx && !existing) return getOpt ? encodeBulkString(null) : encodeBulkString(null);
    // Capture old string value for GET option
    const oldVal = existing && existing.type === 'string' ? String(existing.value) : null;
    // Set new value
    this.kv.set(key, { type: "string", value });
    if (expireAtMs !== undefined) {
      this.expires.set(key, expireAtMs);
    } else if (!keepTTL) {
      this.expires.delete(key);
    }
    if (getOpt) return encodeBulkString(oldVal);
    return encodeSimpleString("OK");
  }

  _get(args) {
    if (args.length !== 1) {
      return encodeError("wrong number of arguments for 'GET'");
    }
    const [key] = args;
    const entry = this._getEntry(String(key));
    if (!entry) return encodeBulkString(null);
    if (entry.type !== "string") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    return encodeBulkString(entry.value);
  }

  _del(args) {
    if (args.length < 1) {
      return encodeError("wrong number of arguments for 'DEL'");
    }
    let removed = 0;
    for (const k of args) {
      const kk = String(k);
      this._purgeIfExpired(kk);
      if (this.kv.delete(kk)) {
        this.expires.delete(kk);
        removed += 1;
      }
    }
    return encodeInteger(removed);
  }

  _exists(args) {
    if (args.length < 1) {
      return encodeError("wrong number of arguments for 'EXISTS'");
    }
    let count = 0;
    for (const k of args) {
      const kk = String(k);
      const entry = this._getEntry(kk);
      if (entry) count += 1;
    }
    return encodeInteger(count);
  }

  keys(pattern) {
    // Very simple glob: '*' matches anything, no char classes
    const pat = String(pattern || '*');
    const regex = new RegExp('^' + pat.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    const out = [];
    for (const k of this.kv.keys()) {
      this._purgeIfExpired(k);
      if (this.kv.has(k) && regex.test(k)) out.push(k);
    }
    return out;
  }

  scan(cursor, opts) {
    const match = opts && opts.match ? String(opts.match) : '*';
    const count = opts && Number.isFinite(opts.count) && opts.count > 0 ? opts.count : 10;
    const all = this.keys(match); // filtered, insertion-ish order
    const start = parseInt(String(cursor), 10) || 0;
    const slice = all.slice(start, start + count);
    const next = start + slice.length >= all.length ? 0 : start + slice.length;
    return { next, keys: slice };
  }

  _flush(args) {
    if (args.length !== 0) return encodeError("wrong number of arguments for 'FLUSHDB'");
    this.kv.clear();
    this.expires.clear();
    return encodeSimpleString("OK");
  }

  _keys(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'KEYS'");
    const matched = this.keys(String(args[0]));
    return encodeArrayOfBulkStrings(matched);
  }

  // ---------- Strings (Phase 2) ----------

  _ensureStringEntry(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) return null;
    if (entry.type !== "string") return "WRONGTYPE";
    return entry;
  }

  _getOrInitString(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) {
      const e = { type: "string", value: "" };
      this.kv.set(k, e);
      return e;
    }
    return entry;
  }

  // --- Bit helpers on underlying string value ---
  _ensureStringForBits(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) {
      const e = { type: "string", value: "" };
      this.kv.set(k, e);
      return e;
    }
    if (entry.type !== "string") return "WRONGTYPE";
    return entry;
  }

  _setbit(args) {
    // SETBIT key offset value
    if (args.length !== 3) return encodeError("wrong number of arguments for 'SETBIT'");
    const [key, offsetStr, valueStr] = args;
    const offset = parseInt(String(offsetStr), 10);
    if (!Number.isFinite(offset) || offset < 0) return encodeError("offset is out of range");
    const bitVal = parseInt(String(valueStr), 10);
    if (!(bitVal === 0 || bitVal === 1)) return encodeError("bit is not an integer or out of range");
    const entry = this._ensureStringForBits(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    let buf = Buffer.from(String(entry.value), 'binary');
    const byteIndex = Math.floor(offset / 8);
    const bitIndex = 7 - (offset % 8);
    if (byteIndex >= buf.length) {
      const extended = Buffer.alloc(byteIndex + 1);
      buf.copy(extended);
      buf = extended;
    }
    const oldBit = (buf[byteIndex] >> bitIndex) & 1;
    if (bitVal === 1) buf[byteIndex] |= (1 << bitIndex); else buf[byteIndex] &= ~(1 << bitIndex);
    entry.value = buf.toString('binary');
    return encodeInteger(oldBit);
  }

  _getbit(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'GETBIT'");
    const [key, offsetStr] = args;
    const offset = parseInt(String(offsetStr), 10);
    if (!Number.isFinite(offset) || offset < 0) return encodeError("offset is out of range");
    const entry = this._ensureStringEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeInteger(0);
    const buf = Buffer.from(String(entry.value), 'binary');
    const byteIndex = Math.floor(offset / 8);
    const bitIndex = 7 - (offset % 8);
    if (byteIndex >= buf.length) return encodeInteger(0);
    const bit = (buf[byteIndex] >> bitIndex) & 1;
    return encodeInteger(bit);
  }

  _bitcount(args) {
    // BITCOUNT key [start end]
    if (args.length !== 1 && args.length !== 3) return encodeError("wrong number of arguments for 'BITCOUNT'");
    const key = String(args[0]);
    const entry = this._ensureStringEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeInteger(0);
    const s = String(entry.value);
    let start = 0; let end = s.length - 1; // byte indices
    if (args.length === 3) {
      start = parseInt(String(args[1]), 10);
      end = parseInt(String(args[2]), 10);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return encodeError("value is not an integer or out of range");
      if (start < 0) start = s.length + start;
      if (end < 0) end = s.length + end;
      if (start < 0) start = 0;
      if (end < 0) end = -1;
      if (end < start) return encodeInteger(0);
      if (end >= s.length) end = s.length - 1;
    }
    const buf = Buffer.from(s, 'binary');
    let count = 0;
    for (let i = start; i <= end; i++) {
      const b = buf[i] || 0;
      count += this._popcountByte(b);
    }
    return encodeInteger(count);
  }

  _bitpos(args) {
    // BITPOS key bit [start [end]]
    if (args.length < 2 || args.length > 4) return encodeError("wrong number of arguments for 'BITPOS'");
    const key = String(args[0]);
    const bitVal = parseInt(String(args[1]), 10);
    if (!(bitVal === 0 || bitVal === 1)) return encodeError("bit is not an integer or out of range");
    const entry = this._ensureStringEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const s = entry ? String(entry.value) : "";
    const buf = Buffer.from(s, 'binary');
    
    // Handle empty string
    if (buf.length === 0) return encodeInteger(bitVal === 1 ? -1 : 0);
    
    let startByte = 0;
    let endByte = buf.length - 1;
    
    if (args.length >= 3) {
      startByte = parseInt(String(args[2]), 10);
      if (!Number.isFinite(startByte)) return encodeError("value is not an integer or out of range");
      if (startByte < 0) startByte = buf.length + startByte;
      if (startByte < 0) startByte = 0;
      if (startByte >= buf.length) return encodeInteger(bitVal === 1 ? -1 : buf.length * 8);
    }
    
    if (args.length === 4) {
      endByte = parseInt(String(args[3]), 10);
      if (!Number.isFinite(endByte)) return encodeError("value is not an integer or out of range");
      if (endByte < 0) endByte = buf.length + endByte;
      if (endByte < 0) return encodeInteger(-1);
      if (endByte >= buf.length) endByte = buf.length - 1;
      if (endByte < startByte) return encodeInteger(-1);
    }
    
    // Search for first bit equal to bitVal between startByte and endByte
    for (let byteIdx = startByte; byteIdx <= endByte; byteIdx++) {
      const byte = buf[byteIdx];
      
      // Check each bit in this byte (MSB first, index 7 to 0)
      for (let bitIdx = 7; bitIdx >= 0; bitIdx--) {
        const bit = (byte >> bitIdx) & 1;
        if (bit === bitVal) {
          return encodeInteger(byteIdx * 8 + (7 - bitIdx));
        }
      }
    }
    
    // Not found
    if (bitVal === 1) {
      return encodeInteger(-1);
    } else {
      // For bit 0, return the position after the search range
      return encodeInteger((endByte + 1) * 8);
    }
  }

  _popcountByte(b) {
    // fast popcount for 0..255
    let x = b;
    x = x - ((x >> 1) & 0x55);
    x = (x & 0x33) + ((x >> 2) & 0x33);
    return (((x + (x >> 4)) & 0x0F) * 0x01) & 0xFF;
  }

  _bitop(args) {
    // BITOP op dest key [key ...]
    if (args.length < 3) return encodeError("wrong number of arguments for 'BITOP'");
    const op = String(args[0]).toUpperCase();
    const dest = String(args[1]);
    const keys = args.slice(2).map(String);
    if (!['AND','OR','XOR','NOT'].includes(op)) return encodeError("syntax error");
    if (op === 'NOT' && keys.length !== 1) return encodeError("BITOP NOT must be against a single key");
    const bufs = keys.map((k) => {
      const e = this._ensureStringEntry(k);
      if (e === "WRONGTYPE") return null;
      const s = e ? String(e.value) : "";
      return Buffer.from(s, 'binary');
    });
    if (bufs.includes(null)) return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const maxLen = bufs.reduce((m, b) => Math.max(m, b.length), 0);
    let out = Buffer.alloc(maxLen);
    if (op === 'NOT') {
      const b = bufs[0];
      out = Buffer.alloc(b.length);
      for (let i = 0; i < b.length; i++) out[i] = (~b[i]) & 0xFF;
    } else if (op === 'AND') {
      out.fill(0xFF);
      for (let i = 0; i < maxLen; i++) {
        let v = 0xFF;
        for (const b of bufs) v &= (b[i] || 0);
        out[i] = v;
      }
    } else if (op === 'OR') {
      for (let i = 0; i < maxLen; i++) {
        let v = 0;
        for (const b of bufs) v |= (b[i] || 0);
        out[i] = v;
      }
    } else if (op === 'XOR') {
      for (let i = 0; i < maxLen; i++) {
        let v = 0;
        for (const b of bufs) v ^= (b[i] || 0);
        out[i] = v;
      }
    }
    this.kv.set(dest, { type: 'string', value: out.toString('binary') });
    this.expires.delete(dest);
    return encodeInteger(out.length);
  }

  _bitfield(args) {
    // BITFIELD key [OVERFLOW WRAP|SAT|FAIL] [GET type offset] [SET type offset value] [INCRBY type offset increment]
    if (args.length < 2) return encodeError("wrong number of arguments for 'BITFIELD'");
    const key = String(args[0]);
    let i = 1;
    let overflowPolicy = 'WRAP'; // default overflow policy
    const responses = [];
    
    // Debug logging for overflow handling
    // console.log(`BITFIELD called with args:`, args);
    
    while (i < args.length) {
      const sub = String(args[i]).toUpperCase();
      
      if (sub === 'OVERFLOW') {
        if (i + 1 >= args.length) return encodeError("syntax error");
        const policy = String(args[i + 1]).toUpperCase();
        if (!['WRAP', 'SAT', 'FAIL'].includes(policy)) return encodeError("syntax error");
        overflowPolicy = policy;
        i += 2;
        continue;
      }
      
      if (sub === 'GET') {
        if (i + 2 >= args.length) return encodeError("syntax error");
        const type = String(args[i + 1]);
        const offsetStr = String(args[i + 2]);
        const { offset, width, signed } = this._parseBitfieldArgs(type, offsetStr);
        if (offset === null || width === null) return encodeError("syntax error");
        try {
          const val = this._bitfieldRead(key, offset, width, signed);
          responses.push(Number(val));
        } catch (e) {
          return encodeError(e.message);
        }
        i += 3;
        continue;
      }
      
      if (sub === 'SET') {
        if (i + 3 >= args.length) return encodeError("syntax error");
        const type = String(args[i + 1]);
        const offsetStr = String(args[i + 2]);
        const valStr = String(args[i + 3]);
        const { offset, width, signed } = this._parseBitfieldArgs(type, offsetStr);
        if (offset === null || width === null) return encodeError("syntax error");
        try {
          const v = BigInt(valStr);
          const oldVal = this._bitfieldRead(key, offset, width, signed);
          this._bitfieldWrite(key, offset, width, v);
          responses.push(Number(oldVal));
        } catch (e) {
          return encodeError(e.message);
        }
        i += 4;
        continue;
      }
      
      if (sub === 'INCRBY') {
        if (i + 3 >= args.length) return encodeError("syntax error");
        const type = String(args[i + 1]);
        const offsetStr = String(args[i + 2]);
        const incStr = String(args[i + 3]);
        const { offset, width, signed } = this._parseBitfieldArgs(type, offsetStr);
        if (offset === null || width === null) return encodeError("syntax error");
        try {
          const inc = BigInt(incStr);
          const cur = this._bitfieldRead(key, offset, width, signed);
          const newVal = cur + inc;
          const result = this._bitfieldHandleOverflow(newVal, width, signed, overflowPolicy);
          if (result === null) {
            responses.push(null); // FAIL policy returns null
          } else {
            this._bitfieldWrite(key, offset, width, result);
            responses.push(Number(result));
          }
        } catch (e) {
          return encodeError(e.message);
        }
        i += 4;
        continue;
      }
      
      return encodeError("syntax error");
    }
    
    // Return RESP array (mix of integers and null values)
    // Manual RESP encoding since we need to handle null values and integers
    let result = `*${responses.length}\r\n`;
    for (const r of responses) {
      if (r === null) {
        result += "$-1\r\n"; // null bulk string
      } else {
        result += encodeInteger(r);
      }
    }
    return result;
  }

  _bitfield_ro(args) {
    // BITFIELD_RO key [GET type offset] [GET type offset] ...
    // Read-only variant of BITFIELD that only supports GET operations
    if (args.length < 2) return encodeError("wrong number of arguments for 'BITFIELD_RO'");
    const key = String(args[0]);
    let i = 1;
    const responses = [];
    
    while (i < args.length) {
      const sub = String(args[i]).toUpperCase();
      
      if (sub === 'GET') {
        if (i + 2 >= args.length) return encodeError("syntax error");
        const type = String(args[i + 1]);
        const offsetStr = String(args[i + 2]);
        const { offset, width, signed } = this._parseBitfieldArgs(type, offsetStr);
        if (offset === null || width === null) return encodeError("syntax error");
        try {
          const val = this._bitfieldRead(key, offset, width, signed);
          responses.push(Number(val));
        } catch (e) {
          return encodeError(e.message);
        }
        i += 3;
        continue;
      }
      
      // BITFIELD_RO only supports GET operations
      return encodeError("syntax error");
    }
    
    // Return RESP array of integers
    let result = `*${responses.length}\r\n`;
    for (const r of responses) {
      result += encodeInteger(r);
    }
    return result;
  }

  _parseBitfieldArgs(type, offsetStr) {
    // Parse type and offset, return {offset, width, signed}
    const m = /^(u|i)(\d+)$/.exec(String(type).toLowerCase());
    if (!m) return { offset: null, width: null, signed: false };
    const signed = m[1] === 'i';
    const width = parseInt(m[2], 10);
    if (!Number.isFinite(width) || width <= 0 || width > 64) return { offset: null, width: null, signed };
    
    // Parse offset: #N means N*width, otherwise absolute bit offset
    let offset;
    const offsetStr2 = String(offsetStr);
    if (offsetStr2.startsWith('#')) {
      const mult = parseInt(offsetStr2.slice(1), 10);
      if (!Number.isFinite(mult)) return { offset: null, width, signed };
      offset = mult * width;
    } else {
      offset = parseInt(offsetStr2, 10);
      if (!Number.isFinite(offset)) return { offset: null, width, signed };
    }
    
    return { offset, width, signed };
  }

  _bitfieldHandleOverflow(value, width, signed, policy) {
    // Handle overflow according to policy: WRAP, SAT, FAIL
    let min, max;
    if (signed) {
      const half = 1n << BigInt(width - 1);
      min = -half;
      max = half - 1n;
    } else {
      min = 0n;
      max = (1n << BigInt(width)) - 1n;
    }
    
    if (value >= min && value <= max) {
      return value; // No overflow
    }
    
    switch (policy) {
      case 'FAIL':
        return null; // Return null to indicate failure
      case 'SAT':
        return value < min ? min : max; // Saturate to bounds
      case 'WRAP':
      default:
        // Wrap around using modular arithmetic
        const range = max - min + 1n;
        let wrapped = ((value - min) % range + range) % range + min;
        return wrapped;
    }
  }

  _parseBitfieldOffset(s) {
    // Legacy function, kept for compatibility
    if (typeof s !== 'string') s = String(s);
    if (s.startsWith('#')) s = s.slice(1);
    const n = parseInt(s, 10);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  _parseBitfieldTypeWidth(type) {
    // Legacy function, kept for compatibility
    const m = /^(u|i)(\d+)$/.exec(String(type).toLowerCase());
    if (!m) return null;
    const signed = m[1] === 'i';
    const width = parseInt(m[2], 10);
    if (!Number.isFinite(width) || width <= 0 || width > 64) return null;
    return width;
  }

  _isSignedType(type) { return String(type).toLowerCase().startsWith('i'); }

  _bitfieldRead(key, bitOffset, width, signed) {
    const entry = this._ensureStringEntry(key);
    if (entry === "WRONGTYPE") throw new Error("WRONGTYPE");
    if (!entry) return 0n;
    const s = String(entry.value);
    const totalBits = s.length * 8;
    if (bitOffset + width <= 0) return 0n;
    const endBit = Math.min(bitOffset + width, totalBits);
    let result = 0n;
    for (let i = bitOffset; i < endBit; i++) {
      const bit = Number(this._getbit([key, String(i)]).slice(1, -2)); // hacky: reuse _getbit RESP? avoid; instead compute directly
    }
    // Direct computation without RESP parsing
    const buf = Buffer.from(s, 'binary');
    for (let i = 0; i < width; i++) {
      const pos = bitOffset + i;
      const byteIndex = Math.floor(pos / 8);
      const bitIndex = 7 - (pos % 8);
      const b = byteIndex < buf.length ? ((buf[byteIndex] >> bitIndex) & 1) : 0;
      result = (result << 1n) | BigInt(b);
    }
    if (signed) {
      const signBit = 1n << BigInt(width - 1);
      if ((result & signBit) !== 0n) {
        const mask = (1n << BigInt(width)) - 1n;
        result = -((~result & mask) + 1n);
      }
    }
    return result;
  }

  _bitfieldWrite(key, bitOffset, width, valueBig) {
    // Write unsigned magnitude of valueBig truncated to width
    const entry = this._ensureStringForBits(key);
    if (entry === "WRONGTYPE") throw new Error("WRONGTYPE");
    const buf = Buffer.from(String(entry.value), 'binary');
    const neededBytes = Math.ceil((bitOffset + width) / 8);
    let out = buf;
    if (neededBytes > out.length) {
      const nbuf = Buffer.alloc(neededBytes);
      out.copy(nbuf);
      out = nbuf;
    }
    // normalize value to width bits
    const mask = (1n << BigInt(width)) - 1n;
    let v = valueBig & mask;
    for (let i = width - 1; i >= 0; i--) {
      const pos = bitOffset + (width - 1 - i);
      const byteIndex = Math.floor(pos / 8);
      const bitIndex = 7 - (pos % 8);
      const bit = Number((v >> BigInt(i)) & 1n);
      if (bit === 1) out[byteIndex] |= (1 << bitIndex); else out[byteIndex] &= ~(1 << bitIndex);
    }
    entry.value = out.toString('binary');
    // return the stored value (as signed magnitude isn't needed here)
    return v;
  }

  _append(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'APPEND'");
    const [key, value] = args;
    const entry = this._getOrInitString(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    entry.value = String(entry.value) + String(value);
    return encodeInteger(Buffer.from(entry.value, "utf8").length);
  }

  _strlen(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'STRLEN'");
    const [key] = args;
    const entry = this._ensureStringEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeInteger(0);
    return encodeInteger(Buffer.from(String(entry.value), "utf8").length);
  }

  _incr(args, delta, strictOne) {
    if (args.length !== 1) return encodeError(`wrong number of arguments for '${delta === 1 ? "INCR" : "DECR"}'`);
    const [key] = args;
    return this._applyIncrBy(key, delta);
  }

  _incrby(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'INCRBY'");
    const [key, by] = args;
    const n = this._parseIntegerStrict(by);
    if (n === null) return encodeError("value is not an integer or out of range");
    return this._applyIncrBy(key, n);
  }

  _decrby(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'DECRBY'");
    const [key, by] = args;
    const n = this._parseIntegerStrict(by);
    if (n === null) return encodeError("value is not an integer or out of range");
    return this._applyIncrBy(key, -n);
  }

  _applyIncrBy(key, amount) {
    const entry = this._getOrInitString(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const curStr = String(entry.value);
    if (!/^[-]?\d+$/.test(curStr) && curStr !== "") {
      return encodeError("value is not an integer or out of range");
    }
    
    // Parse current value with 64-bit validation
    let cur;
    if (curStr === "") {
      cur = 0;
    } else {
      cur = this._parseIntegerStrict(curStr);
      if (cur === null) return encodeError("value is not an integer or out of range");
    }
    
    const next = cur + amount;
    // Check if result overflows 64-bit signed integer
    const MIN_INT64 = -9223372036854775808;
    const MAX_INT64 = 9223372036854775807;
    if (next < MIN_INT64 || next > MAX_INT64) {
      return encodeError("value is not an integer or out of range");
    }
    
    entry.value = String(next);
    return encodeInteger(next);
  }

  _parseIntegerStrict(s) {
    const str = String(s);
    if (!/^[-]?\d+$/.test(str)) return null;
    
    // Redis 64-bit signed integer limits
    const MIN_INT64 = -9223372036854775808n;
    const MAX_INT64 = 9223372036854775807n;
    
    try {
      const bigIntVal = BigInt(str);
      if (bigIntVal < MIN_INT64 || bigIntVal > MAX_INT64) return null;
      return Number(bigIntVal);
    } catch {
      return null;
    }
  }

  _getrange(args) {
    if (args.length !== 3) return encodeError("wrong number of arguments for 'GETRANGE'");
    const [key, startStr, endStr] = args;
    const entry = this._ensureStringEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const s = entry ? String(entry.value) : "";
    const len = s.length;
    let start = parseInt(startStr, 10);
    let end = parseInt(endStr, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return encodeError("value is not an integer or out of range");
    if (start < 0) start = len + start;
    if (end < 0) end = len + end;
    if (start < 0) start = 0;
    if (end < 0) end = -1;
    if (start > len - 1) return encodeBulkString("");
    if (end > len - 1) end = len - 1;
    if (end < start) return encodeBulkString("");
    const out = s.slice(start, end + 1);
    return encodeBulkString(out);
  }

  _setrange(args) {
    if (args.length !== 3) return encodeError("wrong number of arguments for 'SETRANGE'");
    const [key, offsetStr, value] = args;
    const offset = parseInt(offsetStr, 10);
    if (!Number.isFinite(offset) || offset < 0) return encodeError("value is not an integer or out of range");
    const entry = this._getOrInitString(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const s = String(entry.value);
    const padLen = Math.max(0, offset - s.length);
    const padding = padLen > 0 ? "\0".repeat(padLen) : "";
    const left = s.slice(0, offset) + padding;
    const rightStart = offset + String(value).length;
    const right = rightStart < s.length ? s.slice(rightStart) : "";
    entry.value = left + String(value) + right;
    return encodeInteger(Buffer.from(entry.value, "utf8").length);
  }

  _mget(args) {
    const out = [];
    for (const key of args) {
      const entry = this._getEntry(String(key));
      if (!entry) out.push(null);
      else if (entry.type !== "string") out.push(null);
      else out.push(String(entry.value));
    }
    return encodeArrayOfBulkStrings(out);
  }

  _mset(args) {
    if (args.length < 2 || args.length % 2 !== 0) return encodeError("wrong number of arguments for 'MSET'");
    for (let i = 0; i < args.length; i += 2) {
      const k = String(args[i]);
      const v = String(args[i + 1]);
      this.kv.set(k, { type: "string", value: v });
      this.expires.delete(k);
    }
    return encodeSimpleString("OK");
  }

  _setnx(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'SETNX'");
    const [key, value] = args;
    const k = String(key);
    const entry = this._getEntry(k);
    if (entry) return encodeInteger(0);
    this.kv.set(k, { type: "string", value: String(value) });
    this.expires.delete(k);
    return encodeInteger(1);
  }

  _msetnx(args) {
    if (args.length < 2 || args.length % 2 !== 0) return encodeError("wrong number of arguments for 'MSETNX'");
    // check none exist
    for (let i = 0; i < args.length; i += 2) {
      const k = String(args[i]);
      if (this._getEntry(k)) return encodeInteger(0);
    }
    for (let i = 0; i < args.length; i += 2) {
      const k = String(args[i]);
      const v = String(args[i + 1]);
      this.kv.set(k, { type: "string", value: v });
      this.expires.delete(k);
    }
    return encodeInteger(1);
  }

  _setex(args) {
    if (args.length !== 3) return encodeError("wrong number of arguments for 'SETEX'");
    const [key, secondsStr, value] = args;
    const seconds = parseInt(String(secondsStr), 10);
    if (!Number.isFinite(seconds) || seconds <= 0) return encodeError("value is not an integer or out of range");
    const k = String(key);
    this.kv.set(k, { type: "string", value: String(value) });
    this.expires.set(k, this._now() + seconds * 1000);
    return encodeSimpleString("OK");
  }

  _psetex(args) { return encodeError("unknown command 'PSETEX'"); }

  _getset(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'GETSET'");
    const [key, value] = args;
    const k = String(key);
    const entry = this._getEntry(k);
    if (entry && entry.type !== "string") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const oldVal = entry ? String(entry.value) : null;
    this.kv.set(k, { type: "string", value: String(value) });
    this.expires.delete(k);
    return encodeBulkString(oldVal);
  }

  _getdel(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'GETDEL'");
    const [key] = args;
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) return encodeBulkString(null);
    if (entry.type !== "string") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const oldVal = String(entry.value);
    this.kv.delete(k);
    this.expires.delete(k);
    return encodeBulkString(oldVal);
  }

  _getex(args) {
    if (args.length < 1) return encodeError("wrong number of arguments for 'GETEX'");
    const [key, opt, optVal] = args;
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) return encodeBulkString(null);
    if (entry.type !== "string") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (opt !== undefined) {
      const u = String(opt).toUpperCase();
      if (u === "PERSIST") {
        this.expires.delete(k);
      } else if (u === "EX") {
        const seconds = parseInt(String(optVal), 10);
        if (!Number.isFinite(seconds) || seconds <= 0) return encodeError("value is not an integer or out of range");
        this.expires.set(k, this._now() + seconds * 1000);
      } else if (u === "PX") {
        const ms = parseInt(String(optVal), 10);
        if (!Number.isFinite(ms) || ms <= 0) return encodeError("value is not an integer or out of range");
        this.expires.set(k, this._now() + ms);
      } else {
        return encodeError("syntax error");
      }
    }
    return encodeBulkString(String(entry.value));
  }

  _incrbyfloat(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'INCRBYFLOAT'");
    const [key, byStr] = args;
    const by = parseFloat(String(byStr));
    if (!Number.isFinite(by)) return encodeError("value is not a valid float");
    const entry = this._getOrInitString(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const curStr = String(entry.value);
    const cur = curStr === "" ? 0 : parseFloat(curStr);
    if (!Number.isFinite(cur)) return encodeError("value is not a valid float");
    const next = cur + by;
    entry.value = String(next);
    return encodeBulkString(String(next));
  }

  _substr(args) {
    if (args.length !== 3) return encodeError("wrong number of arguments for 'SUBSTR'");
    // Alias to GETRANGE
    return this._getrange(args);
  }

  // ---------- Lists (Phase 2) ----------

  _ensureListEntry(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) return null;
    if (entry.type !== "list") return "WRONGTYPE";
    return entry;
  }

  _getOrInitList(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) {
      const e = { type: "list", value: [] };
      this.kv.set(k, e);
      return e;
    }
    return entry;
  }

  _lpush(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'LPUSH'");
    const [key, ...values] = args;
    const entry = this._getOrInitList(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    for (const v of values) {
      entry.value.unshift(String(v));
    }
    return encodeInteger(entry.value.length);
  }

  _rpush(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'RPUSH'");
    const [key, ...values] = args;
    const entry = this._getOrInitList(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    for (const v of values) {
      entry.value.push(String(v));
    }
    return encodeInteger(entry.value.length);
  }

  _lpop(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'LPOP'");
    const [key] = args;
    const entry = this._ensureListEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry || entry.value.length === 0) return encodeBulkString(null);
    const v = entry.value.shift();
    return encodeBulkString(v);
  }

  _rpop(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'RPOP'");
    const [key] = args;
    const entry = this._ensureListEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry || entry.value.length === 0) return encodeBulkString(null);
    const v = entry.value.pop();
    return encodeBulkString(v);
  }

  _lrange(args) {
    if (args.length !== 3) return encodeError("wrong number of arguments for 'LRANGE'");
    const [key, startStr, endStr] = args;
    const entry = this._ensureListEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const list = entry ? entry.value : [];
    const len = list.length;
    let start = parseInt(startStr, 10);
    let end = parseInt(endStr, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return encodeError("value is not an integer or out of range");
    if (start < 0) start = len + start;
    if (end < 0) end = len + end;
    if (start < 0) start = 0;
    if (end < 0) end = -1;
    if (start > len - 1) return encodeArrayOfBulkStrings([]);
    if (end > len - 1) end = len - 1;
    if (end < start) return encodeArrayOfBulkStrings([]);
    const out = list.slice(start, end + 1);
    return encodeArrayOfBulkStrings(out);
  }

  _lindex(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'LINDEX'");
    const [key, indexStr] = args;
    const entry = this._ensureListEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeBulkString(null);
    let index = parseInt(indexStr, 10);
    if (!Number.isFinite(index)) return encodeError("value is not an integer or out of range");
    if (index < 0) index = entry.value.length + index;
    if (index < 0 || index >= entry.value.length) return encodeBulkString(null);
    return encodeBulkString(entry.value[index]);
  }

  _lset(args) {
    if (args.length !== 3) return encodeError("wrong number of arguments for 'LSET'");
    const [key, indexStr, value] = args;
    const entry = this._ensureListEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeError("no such key");
    let index = parseInt(indexStr, 10);
    if (!Number.isFinite(index)) return encodeError("value is not an integer or out of range");
    if (index < 0) index = entry.value.length + index;
    if (index < 0 || index >= entry.value.length) return encodeError("index out of range");
    entry.value[index] = String(value);
    return encodeSimpleString("OK");
  }

  _llen(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'LLEN'");
    const [key] = args;
    const entry = this._ensureListEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeInteger(0);
    return encodeInteger(entry.value.length);
  }

  // Helpers for server blocking ops
  listLength(key) {
    const entry = this._ensureListEntry(key);
    if (entry === "WRONGTYPE" || !entry) return 0;
    return entry.value.length;
  }

  lpopValue(key) {
    const entry = this._ensureListEntry(key);
    if (entry === "WRONGTYPE" || !entry || entry.value.length === 0) return null;
    return entry.value.shift();
  }

  rpopValue(key) {
    const entry = this._ensureListEntry(key);
    if (entry === "WRONGTYPE" || !entry || entry.value.length === 0) return null;
    return entry.value.pop();
  }

  _ltrim(args) {
    if (args.length !== 3) return encodeError("wrong number of arguments for 'LTRIM'");
    const [key, startStr, endStr] = args;
    const entry = this._ensureListEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeSimpleString("OK");
    const len = entry.value.length;
    let start = parseInt(String(startStr), 10);
    let end = parseInt(String(endStr), 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return encodeError("value is not an integer or out of range");
    if (start < 0) start = len + start;
    if (end < 0) end = len + end;
    if (start < 0) start = 0;
    if (end > len - 1) end = len - 1;
    if (end < start) {
      entry.value = [];
      return encodeSimpleString("OK");
    }
    entry.value = entry.value.slice(start, end + 1);
    return encodeSimpleString("OK");
  }

  _lrem(args) {
    if (args.length !== 3) return encodeError("wrong number of arguments for 'LREM'");
    const [key, countStr, value] = args;
    const k = String(key);
    const entry = this._ensureListEntry(k);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeInteger(0);
    const count = parseInt(String(countStr), 10);
    if (!Number.isFinite(count)) return encodeError("value is not an integer or out of range");
    const target = String(value);
    let removed = 0;
    if (count === 0) {
      const before = entry.value.length;
      entry.value = entry.value.filter((v) => v !== target);
      removed = before - entry.value.length;
    } else if (count > 0) {
      for (let i = 0; i < entry.value.length && removed < count; ) {
        if (entry.value[i] === target) {
          entry.value.splice(i, 1); removed++;
        } else { i++; }
      }
    } else { // count < 0 from tail
      let i = entry.value.length - 1;
      while (i >= 0 && removed < Math.abs(count)) {
        if (entry.value[i] === target) { entry.value.splice(i, 1); removed++; }
        i--;
      }
    }
    return encodeInteger(removed);
  }

  _rpoplpush(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'RPOPLPUSH'");
    const [srcKey, dstKey] = args;
    const src = this._ensureListEntry(srcKey);
    if (src === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!src || src.value.length === 0) return encodeBulkString(null);
    const val = src.value.pop();
    const dst = this._getOrInitList(dstKey);
    if (dst === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    dst.value.unshift(val);
    return encodeBulkString(val);
  }

  _lmove(args) {
    if (args.length !== 4) return encodeError("wrong number of arguments for 'LMOVE'");
    const [srcKey, dstKey, fromStr, toStr] = args;
    const from = String(fromStr).toUpperCase();
    const to = String(toStr).toUpperCase();
    if (!['LEFT','RIGHT'].includes(from) || !['LEFT','RIGHT'].includes(to)) return encodeError("syntax error");
    const src = this._ensureListEntry(srcKey);
    if (src === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!src || src.value.length === 0) return encodeBulkString(null);
    let val;
    if (from === 'LEFT') val = src.value.shift(); else val = src.value.pop();
    const dst = this._getOrInitList(dstKey);
    if (dst === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (to === 'LEFT') dst.value.unshift(val); else dst.value.push(val);
    return encodeBulkString(val);
  }

  // ---------- Hashes (Phase 2) ----------

  _ensureHashEntry(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) return null;
    if (entry.type !== "hash") return "WRONGTYPE";
    return entry;
  }

  _getOrInitHash(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) {
      const e = { type: "hash", value: new Map() };
      this.kv.set(k, e);
      return e;
    }
    return entry;
  }

  _hset(args) {
    if (args.length < 3 || args.length % 2 === 0) return encodeError("wrong number of arguments for 'HSET'");
    const [key, ...rest] = args;
    const entry = this._getOrInitHash(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    let added = 0;
    for (let i = 0; i < rest.length; i += 2) {
      const field = String(rest[i]);
      const value = String(rest[i + 1]);
      if (!entry.value.has(field)) added += 1;
      entry.value.set(field, value);
    }
    return encodeInteger(added);
  }

  _hmset(args) {
    if (args.length < 3 || args.length % 2 === 0) return encodeError("wrong number of arguments for 'HMSET'");
    const [key, ...rest] = args;
    const entry = this._getOrInitHash(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    for (let i = 0; i < rest.length; i += 2) {
      const field = String(rest[i]);
      const value = String(rest[i + 1]);
      entry.value.set(field, value);
    }
    return encodeSimpleString("OK");
  }

  _hget(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'HGET'");
    const [key, field] = args;
    const entry = this._ensureHashEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeBulkString(null);
    const v = entry.value.get(String(field));
    return encodeBulkString(v === undefined ? null : String(v));
  }

  _hdel(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'HDEL'");
    const [key, ...fields] = args;
    const entry = this._ensureHashEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeInteger(0);
    let removed = 0;
    for (const f of fields) {
      if (entry.value.delete(String(f))) removed += 1;
    }
    return encodeInteger(removed);
  }

  _hexists(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'HEXISTS'");
    const [key, field] = args;
    const entry = this._ensureHashEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeInteger(0);
    return encodeInteger(entry.value.has(String(field)) ? 1 : 0);
  }

  _hlen(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'HLEN'");
    const [key] = args;
    const entry = this._ensureHashEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeInteger(0);
    return encodeInteger(entry.value.size);
  }

  _hkeys(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'HKEYS'");
    const [key] = args;
    const entry = this._ensureHashEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const keys = entry ? Array.from(entry.value.keys()) : [];
    return encodeArrayOfBulkStrings(keys);
  }

  _hvals(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'HVALS'");
    const [key] = args;
    const entry = this._ensureHashEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const vals = entry ? Array.from(entry.value.values()) : [];
    return encodeArrayOfBulkStrings(vals);
  }

  _hgetall(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'HGETALL'");
    const [key] = args;
    const entry = this._ensureHashEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const out = [];
    if (entry) {
      for (const [f, v] of entry.value.entries()) {
        out.push(String(f));
        out.push(String(v));
      }
    }
    return encodeArrayOfBulkStrings(out);
  }

  _hmget(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'HMGET'");
    const [key, ...fields] = args;
    const entry = this._ensureHashEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const out = [];
    for (const f of fields) {
      const v = entry ? entry.value.get(String(f)) : undefined;
      out.push(v === undefined ? null : String(v));
    }
    return encodeArrayOfBulkStrings(out);
  }

  _hstrlen(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'HSTRLEN'");
    const [key, field] = args;
    const entry = this._ensureHashEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeInteger(0);
    const v = entry.value.get(String(field));
    if (v === undefined) return encodeInteger(0);
    return encodeInteger(Buffer.from(String(v), 'utf8').length);
  }

  _hscanCommand(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'HSCAN'");
    const key = String(args[0]);
    const cursor = args[1];
    let i = 2; let match = undefined; let count = undefined;
    while (i < args.length) {
      const opt = String(args[i] || '').toUpperCase();
      if (opt === 'MATCH' && args[i + 1]) { match = String(args[i + 1]); i += 2; continue; }
      if (opt === 'COUNT' && args[i + 1]) { const n = parseInt(String(args[i + 1]), 10); if (Number.isFinite(n)) count = n; i += 2; continue; }
      break;
    }
    const res = this.hscan(key, cursor, { match, count });
    const nextStr = String(res.next);
    let out = `*2\r\n$${nextStr.length}\r\n${nextStr}\r\n*${res.tuples.length}\r\n`;
    for (const [f, v] of res.tuples) {
      out += `$${f.length}\r\n${f}\r\n$${v.length}\r\n${v}\r\n`;
    }
    return out;
  }

  hscan(key, cursor, opts) {
    const entry = this._ensureHashEntry(key);
    if (entry === "WRONGTYPE") return { next: 0, tuples: [] };
    const pairs = entry ? Array.from(entry.value.entries()).map(([f, v]) => [String(f), String(v)]) : [];
    const pat = String(opts && opts.match ? opts.match : '*');
    const regex = new RegExp('^' + pat.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    const filtered = pairs.filter(([f]) => regex.test(f));
    const count = opts && Number.isFinite(opts.count) && opts.count > 0 ? opts.count : 10;
    const start = parseInt(String(cursor), 10) || 0;
    const slice = filtered.slice(start, start + count);
    const next = start + slice.length >= filtered.length ? 0 : start + slice.length;
    return { next, tuples: slice };
  }

  // ---------- Sets (Phase 2) ----------

  _ensureSetEntry(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) return null;
    if (entry.type !== "set") return "WRONGTYPE";
    return entry;
  }

  _getOrInitSet(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) {
      const e = { type: "set", value: new Set() };
      this.kv.set(k, e);
      return e;
    }
    return entry;
  }

  _sadd(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'SADD'");
    const [key, ...members] = args;
    const entry = this._getOrInitSet(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    let added = 0;
    for (const m of members) {
      const s = String(m);
      if (!entry.value.has(s)) {
        entry.value.add(s);
        added += 1;
      }
    }
    return encodeInteger(added);
  }

  _srem(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'SREM'");
    const [key, ...members] = args;
    const entry = this._ensureSetEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeInteger(0);
    let removed = 0;
    for (const m of members) {
      if (entry.value.delete(String(m))) removed += 1;
    }
    return encodeInteger(removed);
  }

  _sismember(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'SISMEMBER'");
    const [key, member] = args;
    const entry = this._ensureSetEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeInteger(0);
    return encodeInteger(entry.value.has(String(member)) ? 1 : 0);
  }

  _smismember(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'SMISMEMBER'");
    const [key, ...members] = args;
    const entry = this._ensureSetEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const set = entry ? entry.value : new Set();
    // Return RESP array of integers
    let out = `*${members.length}\r\n`;
    for (const m of members) {
      const v = set.has(String(m)) ? 1 : 0;
      out += `:${v}\r\n`;
    }
    return out;
  }

  _smembers(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'SMEMBERS'");
    const [key] = args;
    const entry = this._ensureSetEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const members = entry ? Array.from(entry.value.values()) : [];
    return encodeArrayOfBulkStrings(members);
  }

  _scard(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'SCARD'");
    const [key] = args;
    const entry = this._ensureSetEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeInteger(0);
    return encodeInteger(entry.value.size);
  }

  _sinter(args) {
    if (args.length < 1) return encodeArrayOfBulkStrings([]);
    const sets = [];
    for (const k of args) {
      const e = this._ensureSetEntry(k);
      if (e === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
      sets.push(e ? e.value : new Set());
    }
    if (sets.length === 0) return encodeArrayOfBulkStrings([]);
    // Start with smallest set
    sets.sort((a, b) => a.size - b.size);
    const [first, ...rest] = sets;
    const out = [];
    for (const val of first.values()) {
      let present = true;
      for (const s of rest) {
        if (!s.has(val)) { present = false; break; }
      }
      if (present) out.push(val);
    }
    return encodeArrayOfBulkStrings(out);
  }

  _sunion(args) {
    const union = new Set();
    for (const k of args) {
      const e = this._ensureSetEntry(k);
      if (e === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
      if (e) {
        for (const v of e.value.values()) union.add(v);
      }
    }
    return encodeArrayOfBulkStrings(Array.from(union.values()));
  }

  _sdiff(args) {
    if (args.length < 1) return encodeArrayOfBulkStrings([]);
    const base = this._ensureSetEntry(args[0]);
    if (base === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const baseSet = base ? new Set(base.value.values()) : new Set();
    for (let i = 1; i < args.length; i++) {
      const e = this._ensureSetEntry(args[i]);
      if (e === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
      if (e) {
        for (const v of e.value.values()) baseSet.delete(v);
      }
    }
    return encodeArrayOfBulkStrings(Array.from(baseSet.values()));
  }

  _smove(args) {
    if (args.length !== 3) return encodeError("wrong number of arguments for 'SMOVE'");
    const [srcKey, dstKey, member] = args;
    const src = this._ensureSetEntry(srcKey);
    if (src === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!src || !src.value.has(String(member))) return encodeInteger(0);
    const dst = this._getOrInitSet(dstKey);
    if (dst === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    src.value.delete(String(member));
    dst.value.add(String(member));
    return encodeInteger(1);
  }

  _spop(args) {
    if (args.length < 1 || args.length > 2) return encodeError("wrong number of arguments for 'SPOP'");
    const [key, countStr] = args;
    const entry = this._ensureSetEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry || entry.value.size === 0) {
      if (countStr === undefined) return encodeBulkString(null);
      return encodeArrayOfBulkStrings([]);
    }
    const members = Array.from(entry.value.values());
    function pickRandom(n) { return Math.floor(Math.random() * n); }
    if (countStr === undefined) {
      const idx = pickRandom(members.length);
      const val = members[idx];
      entry.value.delete(val);
      return encodeBulkString(val);
    }
    let count = parseInt(String(countStr), 10);
    if (!Number.isFinite(count) || count < 0) return encodeError("value is not an integer or out of range");
    const result = [];
    count = Math.min(count, members.length);
    for (let i = 0; i < count; i++) {
      const idx = pickRandom(members.length);
      const val = members[idx];
      result.push(val);
      members.splice(idx, 1);
      entry.value.delete(val);
    }
    return encodeArrayOfBulkStrings(result);
  }

  _srandmember(args) {
    if (args.length < 1 || args.length > 2) return encodeError("wrong number of arguments for 'SRANDMEMBER'");
    const [key, countStr] = args;
    const entry = this._ensureSetEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const members = entry ? Array.from(entry.value.values()) : [];
    if (members.length === 0) {
      if (countStr === undefined) return encodeBulkString(null);
      return encodeArrayOfBulkStrings([]);
    }
    function pickRandom(n) { return Math.floor(Math.random() * n); }
    if (countStr === undefined) {
      const val = members[pickRandom(members.length)];
      return encodeBulkString(val);
    }
    let count = parseInt(String(countStr), 10);
    if (!Number.isFinite(count)) return encodeError("value is not an integer or out of range");
    const out = [];
    if (count >= 0) {
      // distinct up to size
      count = Math.min(count, members.length);
      const copy = members.slice();
      for (let i = 0; i < count; i++) {
        const idx = pickRandom(copy.length);
        out.push(copy[idx]);
        copy.splice(idx, 1);
      }
    } else {
      // negative => allow duplicates, use absolute value
      count = Math.abs(count);
      for (let i = 0; i < count; i++) out.push(members[pickRandom(members.length)]);
    }
    return encodeArrayOfBulkStrings(out);
  }

  _sunionstore(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'SUNIONSTORE'");
    const [destKey, ...keys] = args;
    const dest = this._getOrInitSet(destKey);
    if (dest === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const result = new Set();
    for (const k of keys) {
      const e = this._ensureSetEntry(k);
      if (e === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
      if (e) for (const v of e.value.values()) result.add(v);
    }
    dest.value = result;
    this.expires.delete(String(destKey));
    return encodeInteger(result.size);
  }

  _sinterstore(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'SINTERSTORE'");
    const [destKey, ...keys] = args;
    const sets = [];
    for (const k of keys) {
      const e = this._ensureSetEntry(k);
      if (e === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
      sets.push(e ? e.value : new Set());
    }
    if (sets.length === 0) {
      const dest = this._getOrInitSet(destKey);
      dest.value = new Set();
      this.expires.delete(String(destKey));
      return encodeInteger(0);
    }
    sets.sort((a, b) => a.size - b.size);
    const [first, ...rest] = sets;
    const result = new Set();
    for (const val of first.values()) {
      let ok = true;
      for (const s of rest) if (!s.has(val)) { ok = false; break; }
      if (ok) result.add(val);
    }
    const dest = this._getOrInitSet(destKey);
    if (dest === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    dest.value = result;
    this.expires.delete(String(destKey));
    return encodeInteger(result.size);
  }

  _sdiffstore(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'SDIFFSTORE'");
    const [destKey, ...keys] = args;
    const base = this._ensureSetEntry(keys[0]);
    if (base === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const baseSet = base ? new Set(base.value.values()) : new Set();
    for (let i = 1; i < keys.length; i++) {
      const e = this._ensureSetEntry(keys[i]);
      if (e === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
      if (e) for (const v of e.value.values()) baseSet.delete(v);
    }
    const dest = this._getOrInitSet(destKey);
    if (dest === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    dest.value = baseSet;
    this.expires.delete(String(destKey));
    return encodeInteger(baseSet.size);
  }

  _sscanCommand(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'SSCAN'");
    const key = String(args[0]);
    const cursor = args[1];
    let i = 2; let match = undefined; let count = undefined;
    while (i < args.length) {
      const opt = String(args[i] || '').toUpperCase();
      if (opt === 'MATCH' && args[i + 1]) { match = String(args[i + 1]); i += 2; continue; }
      if (opt === 'COUNT' && args[i + 1]) { const n = parseInt(String(args[i + 1]), 10); if (Number.isFinite(n)) count = n; i += 2; continue; }
      break;
    }
    const res = this.sscan(key, cursor, { match, count });
    // Build RESP: [ next-cursor, [elements...] ]
    const nextStr = String(res.next);
    let out = `*2\r\n$${nextStr.length}\r\n${nextStr}\r\n*${res.members.length}\r\n`;
    for (const m of res.members) out += `$${m.length}\r\n${m}\r\n`;
    return out;
  }

  sscan(key, cursor, opts) {
    const entry = this._ensureSetEntry(key);
    if (entry === "WRONGTYPE") return { next: 0, members: [] };
    const members = entry ? Array.from(entry.value.values()) : [];
    const pat = String(opts && opts.match ? opts.match : '*');
    const regex = new RegExp('^' + pat.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    const filtered = members.filter((m) => regex.test(m));
    const count = opts && Number.isFinite(opts.count) && opts.count > 0 ? opts.count : 10;
    const start = parseInt(String(cursor), 10) || 0;
    const slice = filtered.slice(start, start + count);
    const next = start + slice.length >= filtered.length ? 0 : start + slice.length;
    return { next, members: slice };
  }

  // ---------- Sorted Sets (Phase 2) ----------

  _ensureZSetEntry(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) return null;
    if (entry.type !== "zset") return "WRONGTYPE";
    return entry;
  }

  _getOrInitZSet(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) {
      const e = { type: "zset", value: { memberToScore: new Map(), sorted: [] } };
      this.kv.set(k, e);
      return e;
    }
    return entry;
  }

  // ---------- Streams ----------

  _ensureStreamEntry(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) return null;
    if (entry.type !== "stream") return "WRONGTYPE";
    return entry;
  }

  _getOrInitStream(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) {
      const e = { type: "stream", value: { entries: [], groups: new Map() } };
      this.kv.set(k, e);
      return e;
    }
    return entry;
  }

  _xadd(args) {
    if (args.length < 3) return encodeError("wrong number of arguments for 'XADD'");
    const [key, id, ...fieldValues] = args;
    if (fieldValues.length === 0 || fieldValues.length % 2 !== 0) return encodeError("wrong number of arguments for 'XADD'");
    const stream = this._getOrInitStream(key);
    if (stream === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    // Generate ID
    let entryId;
    if (id === '*') {
      const ms = this._now();
      const seq = (stream.value.lastSeq && stream.value.lastMs === ms) ? stream.value.lastSeq + 1 : 0;
      entryId = `${ms}-${seq}`;
      stream.value.lastMs = ms; stream.value.lastSeq = seq;
    } else {
      entryId = String(id);
    }
    const fields = [];
    for (let i = 0; i < fieldValues.length; i += 2) {
      fields.push(String(fieldValues[i]));
      fields.push(String(fieldValues[i + 1]));
    }
    stream.value.entries.push([entryId, fields]);
    return encodeBulkString(entryId);
  }

  _xrange(args) {
    if (args.length < 3) return encodeError("wrong number of arguments for 'XRANGE'");
    const [key, start, end] = args;
    const stream = this._ensureStreamEntry(key);
    if (stream === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const entries = stream ? stream.value.entries : [];
    const out = [];
    for (const [id, fields] of entries) {
      if ((start === '-' || id >= String(start)) && (end === '+' || id <= String(end))) {
        out.push([id, fields]);
      }
    }
    return this._encodeStreamEntries(out);
  }

  _xlen(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'XLEN'");
    const stream = this._ensureStreamEntry(args[0]);
    if (stream === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    return encodeInteger(stream ? stream.value.entries.length : 0);
  }

  _xread(args) {
    // XREAD COUNT n STREAMS key id [key id ...]
    if (args.length < 3) return encodeError("wrong number of arguments for 'XREAD'");
    let i = 0; let count = Infinity;
    if (String(args[i]).toUpperCase() === 'COUNT') {
      const n = parseInt(String(args[i + 1]), 10);
      if (!Number.isFinite(n) || n <= 0) return encodeError("value is not an integer or out of range");
      count = n; i += 2;
    }
    if (String(args[i]).toUpperCase() !== 'STREAMS') return encodeError("syntax error");
    i += 1;
    const keys = []; const ids = [];
    while (i < args.length && keys.length === 0) { keys.push(String(args[i++])); }
    while (i < args.length && keys.length < (args.length - i)) { keys.push(String(args[i++])); }
    // remaining are ids
    while (i < args.length) ids.push(String(args[i++]));
    if (keys.length === 0 || ids.length !== keys.length) return encodeError("syntax error");
    const result = [];
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      const id = ids[k];
      const stream = this._ensureStreamEntry(key);
      if (stream === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
      const entries = stream ? stream.value.entries : [];
      const out = [];
      for (const [eid, fields] of entries) {
        if (eid > id) { out.push([eid, fields]); if (out.length >= count) break; }
      }
      if (out.length > 0) result.push([key, out]);
    }
    if (result.length === 0) return encodeBulkString(null);
    return this._encodeStreamRead(result);
  }

  // Helper for server blocking XREAD
  xreadNonBlocking(keys, ids, count) {
    const result = [];
    for (let k = 0; k < keys.length; k++) {
      const key = String(keys[k]);
      const id = String(ids[k]);
      const stream = this._ensureStreamEntry(key);
      if (stream === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
      const entries = stream ? stream.value.entries : [];
      const out = [];
      let delivered = 0;
      for (const [eid, fields] of entries) {
        if (eid > id) { out.push([eid, fields]); delivered++; if (delivered >= (count ?? Infinity)) break; }
      }
      if (out.length > 0) result.push([key, out]);
    }
    if (result.length === 0) return null;
    return this._encodeStreamRead(result);
  }

  _xgroupCommand(args) {
    if (args.length < 3) return encodeError("wrong number of arguments for 'XGROUP'");
    const sub = String(args[0]).toUpperCase();
    if (sub !== 'CREATE') return encodeError("only CREATE is supported in this implementation");
    // XGROUP CREATE key group $
    const key = String(args[1]);
    const group = String(args[2]);
    const id = args[3] ? String(args[3]) : '$';
    const stream = this._getOrInitStream(key);
    if (stream === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (stream.value.groups.has(group)) return encodeError("BUSYGROUP Consumer Group name already exists");
    // record last-delivered id
    const lastId = id === '$' ? (stream.value.entries.length ? stream.value.entries[stream.value.entries.length - 1][0] : '0-0') : id;
    stream.value.groups.set(group, { lastId, consumers: new Map(), pending: [] });
    return encodeSimpleString("OK");
  }

  _xreadgroup(args) {
    // XREADGROUP GROUP group consumer COUNT n STREAMS key id ...
    if (args.length < 5) return encodeError("wrong number of arguments for 'XREADGROUP'");
    if (String(args[0]).toUpperCase() !== 'GROUP') return encodeError("syntax error");
    const group = String(args[1]);
    const consumer = String(args[2]);
    let i = 3; let count = Infinity;
    if (String(args[i]).toUpperCase() === 'COUNT') { const n = parseInt(String(args[i + 1]), 10); if (Number.isFinite(n) && n > 0) count = n; i += 2; }
    if (String(args[i]).toUpperCase() !== 'STREAMS') return encodeError("syntax error");
    i += 1;
    const keys = []; while (i < args.length && (keys.length === 0 || keys.length < (args.length - i)/2)) keys.push(String(args[i++]));
    const ids = []; while (i < args.length) ids.push(String(args[i++]));
    if (keys.length === 0 || ids.length !== keys.length) return encodeError("syntax error");
    const result = [];
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      const stream = this._ensureStreamEntry(key);
      if (stream === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
      const g = stream && stream.value.groups.get(group);
      if (!g) return encodeError("-NOGROUP No such consumer group");
      // ensure consumer exists
      if (!g.consumers.has(consumer)) g.consumers.set(consumer, { pending: new Map() });
      const entries = stream ? stream.value.entries : [];
      const out = [];
      let delivered = 0;
      for (const [eid, fields] of entries) {
        if (eid > g.lastId) { out.push([eid, fields]); g.pending.push([eid, consumer]); g.consumers.get(consumer).pending.set(eid, true); g.lastId = eid; delivered++; if (delivered >= count) break; }
      }
      if (out.length > 0) result.push([key, out]);
    }
    if (result.length === 0) return encodeBulkString(null);
    return this._encodeStreamRead(result);
  }

  _xack(args) {
    // XACK key group id [id ...]
    if (args.length < 3) return encodeError("wrong number of arguments for 'XACK'");
    const key = String(args[0]);
    const group = String(args[1]);
    const stream = this._ensureStreamEntry(key);
    if (stream === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const g = stream && stream.value.groups.get(group);
    if (!g) return encodeInteger(0);
    let acked = 0;
    for (let i = 2; i < args.length; i++) {
      const id = String(args[i]);
      // remove from group pending
      const idx = g.pending.findIndex(([pid]) => pid === id);
      if (idx !== -1) { g.pending.splice(idx, 1); acked++; }
      // remove from any consumer pending
      for (const c of g.consumers.values()) c.pending.delete(id);
    }
    return encodeInteger(acked);
  }

  _xpending(args) {
    // XPENDING key group
    if (args.length < 2) return encodeError("wrong number of arguments for 'XPENDING'");
    const key = String(args[0]);
    const group = String(args[1]);
    const stream = this._ensureStreamEntry(key);
    if (stream === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const g = stream && stream.value.groups.get(group);
    if (!g) return encodeError("-NOGROUP No such consumer group");
    // Return summary: count, smallest-id, greatest-id, consumers-count
    const count = g.pending.length;
    const ids = g.pending.map(([id]) => id).sort();
    const smallest = ids[0] || "0-0";
    const greatest = ids[ids.length - 1] || "0-0";
    const consumers = Array.from(g.consumers.keys());
    let out = `*4\r\n:${count}\r\n$${smallest.length}\r\n${smallest}\r\n$${greatest.length}\r\n${greatest}\r\n*${consumers.length}\r\n`;
    for (const c of consumers) out += `$${c.length}\r\n${c}\r\n`;
    return out;
  }

  _xclaim(args) {
    // Simplified: XCLAIM key group consumer min-idle-time id [id ...]
    if (args.length < 5) return encodeError("wrong number of arguments for 'XCLAIM'");
    const key = String(args[0]);
    const group = String(args[1]);
    const consumer = String(args[2]);
    // ignore min-idle-time in this simplified model
    const stream = this._ensureStreamEntry(key);
    if (stream === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const g = stream && stream.value.groups.get(group);
    if (!g) return encodeError("-NOGROUP No such consumer group");
    if (!g.consumers.has(consumer)) g.consumers.set(consumer, { pending: new Map() });
    const ids = args.slice(4).map(String);
    const claimed = [];
    for (const id of ids) {
      const idx = g.pending.findIndex(([pid]) => pid === id);
      if (idx !== -1) {
        // move to this consumer
        g.pending[idx][1] = consumer;
        g.consumers.get(consumer).pending.set(id, true);
        const entry = (stream.value.entries.find(([eid]) => eid === id));
        if (entry) claimed.push(entry);
      }
    }
    return this._encodeStreamEntries(claimed);
  }

  _encodeStreamEntries(arr) {
    // [[id, [f1,v1,...]], ...]
    let out = `*${arr.length}\r\n`;
    for (const [id, fields] of arr) {
      out += `*2\r\n$${id.length}\r\n${id}\r\n*${fields.length}\r\n`;
      for (const s of fields) out += `$${s.length}\r\n${s}\r\n`;
    }
    return out;
    }

  _encodeStreamRead(keysToEntries) {
    // [[key, [[id, [f,v,...]], ...]], ...]
    let out = `*${keysToEntries.length}\r\n`;
    for (const [key, entries] of keysToEntries) {
      out += `*2\r\n$${key.length}\r\n${key}\r\n`;
      out += this._encodeStreamEntries(entries);
    }
    return out;
  }

  _xdel(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'XDEL'");
    const [key, ...ids] = args;
    const stream = this._ensureStreamEntry(key);
    if (stream === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!stream) return encodeInteger(0);
    let removed = 0;
    for (const id of ids.map(String)) {
      const idx = stream.value.entries.findIndex(([eid]) => eid === id);
      if (idx !== -1) { stream.value.entries.splice(idx, 1); removed++; }
    }
    return encodeInteger(removed);
  }

  _xtrim(args) {
    // XTRIM key MAXLEN n (approximate not implemented)
    if (args.length < 3) return encodeError("wrong number of arguments for 'XTRIM'");
    const key = String(args[0]);
    const sub = String(args[1]).toUpperCase();
    const n = parseInt(String(args[2]), 10);
    if (sub !== 'MAXLEN' || !Number.isFinite(n) || n < 0) return encodeError("syntax error");
    const stream = this._ensureStreamEntry(key);
    if (stream === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!stream) return encodeInteger(0);
    const before = stream.value.entries.length;
    if (before > n) stream.value.entries = stream.value.entries.slice(before - n);
    return encodeInteger(before - stream.value.entries.length);
  }

  _xinfo(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'XINFO'");
    const sub = String(args[0]).toUpperCase();
    if (sub === 'STREAM') {
      if (args.length !== 2) return encodeError("wrong number of arguments for 'XINFO STREAM'");
      const key = String(args[1]);
      const stream = this._ensureStreamEntry(key);
      if (stream === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
      const entries = stream ? stream.value.entries : [];
      const length = entries.length;
      const lastId = length ? entries[length - 1][0] : '0-0';
      const groups = stream ? (stream.value.groups?.size || 0) : 0;
      const kv = [
        ['length', String(length)],
        ['last-generated-id', String(lastId)],
        ['groups', String(groups)]
      ];
      let out = `*${kv.length * 2}\r\n`;
      for (const [k, v] of kv) {
        out += `$${k.length}\r\n${k}\r\n$${v.length}\r\n${v}\r\n`;
      }
      return out;
    }
    if (sub === 'GROUPS') {
      if (args.length !== 2) return encodeError("wrong number of arguments for 'XINFO GROUPS'");
      const key = String(args[1]);
      const stream = this._ensureStreamEntry(key);
      if (stream === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
      const groups = stream && stream.value.groups ? Array.from(stream.value.groups.entries()) : [];
      let out = `*${groups.length}\r\n`;
      for (const [name, g] of groups) {
        const kv = [
          ['name', name],
          ['consumers', String(g.consumers.size)],
          ['pending', String(g.pending.length)],
          ['last-delivered-id', String(g.lastId || '0-0')]
        ];
        out += `*${kv.length * 2}\r\n`;
        for (const [k, v] of kv) out += `$${k.length}\r\n${k}\r\n$${v.length}\r\n${v}\r\n`;
      }
      return out;
    }
    return encodeError("syntax error");
  }

  // ---------- TTL helpers and commands ----------

  _now() {
    return Date.now();
  }

  _purgeIfExpired(key, now = this._now()) {
    const exp = this.expires.get(key);
    if (exp === undefined) return false;
    if (now >= exp) {
      this.kv.delete(key);
      this.expires.delete(key);
      return true;
    }
    return false;
  }

  _getEntry(key) {
    this._purgeIfExpired(key);
    return this.kv.get(key);
  }

  _purgeExpiredBatch() {
    const now = this._now();
    for (const [key, exp] of this.expires.entries()) {
      if (now >= exp) {
        this.kv.delete(key);
        this.expires.delete(key);
        if (this._onKeyEvent) {
          try { this._onKeyEvent('expired', key); } catch {}
        }
      }
    }
  }

  _expire(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'EXPIRE'");
    const [key, secondsStr] = args;
    const kk = String(key);
    const entry = this._getEntry(kk);
    if (!entry) return encodeInteger(0);
    const seconds = parseInt(secondsStr, 10);
    if (!Number.isFinite(seconds)) return encodeError("value is not an integer or out of range");
    const when = this._now() + seconds * 1000;
    if (seconds <= 0) {
      // expire immediately
      this.kv.delete(kk);
      this.expires.delete(kk);
      if (this._onKeyEvent) {
        try { this._onKeyEvent('expired', kk); } catch {}
      }
      return encodeInteger(1);
    }
    this.expires.set(kk, when);
    return encodeInteger(1);
  }

  _ttl(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'TTL'");
    const [key] = args;
    const kk = String(key);
    const entry = this._getEntry(kk);
    if (!entry) return encodeInteger(-2);
    const exp = this.expires.get(kk);
    if (exp === undefined) return encodeInteger(-1);
    const remMs = exp - this._now();
    const rem = Math.ceil(remMs / 1000);
    return encodeInteger(rem <= 0 ? -2 : rem);
  }

  _persist(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'PERSIST'");
    const [key] = args;
    const kk = String(key);
    const entry = this._getEntry(kk);
    if (!entry) return encodeInteger(0);
    if (this.expires.has(kk)) {
      this.expires.delete(kk);
      return encodeInteger(1);
    }
    return encodeInteger(0);
  }

  _pttl(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'PTTL'");
    const [key] = args;
    const kk = String(key);
    const entry = this._getEntry(kk);
    if (!entry) return encodeInteger(-2);
    const exp = this.expires.get(kk);
    if (exp === undefined) return encodeInteger(-1);
    const remMs = exp - this._now();
    return encodeInteger(remMs <= 0 ? -2 : Math.ceil(remMs));
  }

  _pexpire(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'PEXPIRE'");
    const [key, msStr] = args;
    const kk = String(key);
    const entry = this._getEntry(kk);
    if (!entry) return encodeInteger(0);
    const ms = parseInt(String(msStr), 10);
    if (!Number.isFinite(ms)) return encodeError("value is not an integer or out of range");
    if (ms <= 0) { this.kv.delete(kk); this.expires.delete(kk); return encodeInteger(1); }
    this.expires.set(kk, this._now() + ms);
    return encodeInteger(1);
  }

  _expireat(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'EXPIREAT'");
    const [key, tsStr] = args;
    const kk = String(key);
    const entry = this._getEntry(kk);
    if (!entry) return encodeInteger(0);
    const ts = parseInt(String(tsStr), 10);
    if (!Number.isFinite(ts)) return encodeError("value is not an integer or out of range");
    this.expires.set(kk, ts * 1000);
    return encodeInteger(1);
  }

  _pexpireat(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'PEXPIREAT'");
    const [key, tsmsStr] = args;
    const kk = String(key);
    const entry = this._getEntry(kk);
    if (!entry) return encodeInteger(0);
    const tsms = parseInt(String(tsmsStr), 10);
    if (!Number.isFinite(tsms)) return encodeError("value is not an integer or out of range");
    this.expires.set(kk, tsms);
    return encodeInteger(1);
  }

  _type(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'TYPE'");
    const [key] = args;
    const entry = this._getEntry(String(key));
    const t = !entry ? 'none' : entry.type === 'vec_index' ? 'hash' : entry.type; // expose vec_index as hash-like
    return encodeSimpleString(t);
  }

  _dbsize(args) {
    if (args.length !== 0) return encodeError("wrong number of arguments for 'DBSIZE'");
    // Count only non-expired
    let n = 0;
    for (const k of this.kv.keys()) { this._purgeIfExpired(k); if (this.kv.has(k)) n++; }
    return encodeInteger(n);
  }

  _randomkey(args) {
    if (args.length !== 0) return encodeError("wrong number of arguments for 'RANDOMKEY'");
    const keys = [];
    for (const k of this.kv.keys()) { this._purgeIfExpired(k); if (this.kv.has(k)) keys.push(k); }
    if (keys.length === 0) return encodeBulkString(null);
    const k = keys[Math.floor(Math.random() * keys.length)];
    return encodeBulkString(k);
  }

  _rename(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'RENAME'");
    const [src, dst] = args.map(String);
    const entry = this._getEntry(src);
    if (!entry) return encodeError("no such key");
    const ttl = this.expires.get(src);
    this.kv.set(dst, entry);
    if (ttl !== undefined) this.expires.set(dst, ttl); else this.expires.delete(dst);
    this.kv.delete(src);
    this.expires.delete(src);
    return encodeSimpleString("OK");
  }

  _renamenx(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'RENAMENX'");
    const [src, dst] = args.map(String);
    const entry = this._getEntry(src);
    if (!entry) return encodeError("no such key");
    if (this._getEntry(dst)) return encodeInteger(0);
    const ttl = this.expires.get(src);
    this.kv.set(dst, entry);
    if (ttl !== undefined) this.expires.set(dst, ttl); else this.expires.delete(dst);
    this.kv.delete(src);
    this.expires.delete(src);
    return encodeInteger(1);
  }

  _zadd(args) {
    if (args.length < 3 || args.length % 2 === 0) return encodeError("wrong number of arguments for 'ZADD'");
    const [key, ...rest] = args;
    const entry = this._getOrInitZSet(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    let added = 0;
    for (let i = 0; i < rest.length; i += 2) {
      const scoreStr = rest[i];
      const member = String(rest[i + 1]);
      const score = parseFloat(String(scoreStr));
      if (!Number.isFinite(score)) return encodeError("value is not a valid float");
      if (entry.value.memberToScore.has(member)) {
        const prevScore = entry.value.memberToScore.get(member);
        if (prevScore !== score) {
          // update score: remove old position then insert new
          this._zsetRemoveFromSorted(entry.value.sorted, member);
          this._zsetInsert(entry.value.sorted, { member, score });
          entry.value.memberToScore.set(member, score);
        }
      } else {
        entry.value.memberToScore.set(member, score);
        this._zsetInsert(entry.value.sorted, { member, score });
        added += 1;
      }
    }
    return encodeInteger(added);
  }

  _zrem(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'ZREM'");
    const [key, ...members] = args;
    const entry = this._ensureZSetEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeInteger(0);
    let removed = 0;
    for (const m of members) {
      const member = String(m);
      if (entry.value.memberToScore.has(member)) {
        entry.value.memberToScore.delete(member);
        this._zsetRemoveFromSorted(entry.value.sorted, member);
        removed += 1;
      }
    }
    return encodeInteger(removed);
  }

  _zrank(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'ZRANK'");
    const [key, member] = args;
    const entry = this._ensureZSetEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeBulkString(null);
    const idx = this._zsetIndexOf(entry.value.sorted, String(member));
    if (idx === -1) return encodeBulkString(null);
    return encodeInteger(idx);
  }

  _zscore(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'ZSCORE'");
    const [key, member] = args;
    const entry = this._ensureZSetEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeBulkString(null);
    const sc = entry.value.memberToScore.get(String(member));
    return encodeBulkString(sc === undefined ? null : String(sc));
  }

  _zcard(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'ZCARD'");
    const [key] = args;
    const entry = this._ensureZSetEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeInteger(0);
    return encodeInteger(entry.value.memberToScore.size);
  }

  _zrange(args) {
    if (args.length !== 3 && args.length !== 4) return encodeError("wrong number of arguments for 'ZRANGE'");
    const [key, startStr, stopStr] = args;
    const withScores = args.length === 4 && String(args[3]).toUpperCase() === 'WITHSCORES';
    if (args.length === 4 && !withScores) return encodeError("syntax error");
    const entry = this._ensureZSetEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const arr = entry ? entry.value.sorted : [];
    const len = arr.length;
    let start = parseInt(startStr, 10);
    let stop = parseInt(stopStr, 10);
    if (!Number.isFinite(start) || !Number.isFinite(stop)) return encodeError("value is not an integer or out of range");
    if (start < 0) start = len + start;
    if (stop < 0) stop = len + stop;
    if (start < 0) start = 0;
    if (stop < 0) stop = -1;
    if (start > len - 1) return encodeArrayOfBulkStrings([]);
    if (stop > len - 1) stop = len - 1;
    if (stop < start) return encodeArrayOfBulkStrings([]);
    const out = [];
    for (let i = start; i <= stop; i++) {
      if (withScores) {
        out.push(arr[i].member, String(arr[i].score));
      } else {
        out.push(arr[i].member);
      }
    }
    return encodeArrayOfBulkStrings(out);
  }

  _zrevrange(args) {
    if (args.length !== 3 && args.length !== 4) return encodeError("wrong number of arguments for 'ZREVRANGE'");
    const [key, startStr, stopStr] = args;
    const withScores = args.length === 4 && String(args[3]).toUpperCase() === 'WITHSCORES';
    if (args.length === 4 && !withScores) return encodeError("syntax error");
    const entry = this._ensureZSetEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const arr = entry ? entry.value.sorted : [];
    const len = arr.length;
    let start = parseInt(startStr, 10);
    let stop = parseInt(stopStr, 10);
    if (!Number.isFinite(start) || !Number.isFinite(stop)) return encodeError("value is not an integer or out of range");
    // reverse indexes from end
    const rev = arr.slice().reverse();
    const rlen = rev.length;
    if (start < 0) start = rlen + start;
    if (stop < 0) stop = rlen + stop;
    if (start < 0) start = 0;
    if (stop < 0) stop = -1;
    if (start > rlen - 1) return encodeArrayOfBulkStrings([]);
    if (stop > rlen - 1) stop = rlen - 1;
    if (stop < start) return encodeArrayOfBulkStrings([]);
    const out = [];
    for (let i = start; i <= stop; i++) {
      if (withScores) {
        out.push(rev[i].member, String(rev[i].score));
      } else {
        out.push(rev[i].member);
      }
    }
    return encodeArrayOfBulkStrings(out);
  }

  _zincrby(args) {
    if (args.length !== 3) return encodeError("wrong number of arguments for 'ZINCRBY'");
    const [key, incStr, member] = args;
    const inc = parseFloat(String(incStr));
    if (!Number.isFinite(inc)) return encodeError("value is not a valid float");
    const entry = this._getOrInitZSet(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const cur = entry.value.memberToScore.get(String(member)) ?? 0;
    const next = cur + inc;
    if (entry.value.memberToScore.has(String(member))) this._zsetRemoveFromSorted(entry.value.sorted, String(member));
    entry.value.memberToScore.set(String(member), next);
    this._zsetInsert(entry.value.sorted, { member: String(member), score: next });
    return encodeBulkString(String(next));
  }

  _zrevrank(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'ZREVRANK'");
    const [key, member] = args;
    const entry = this._ensureZSetEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeBulkString(null);
    const idx = this._zsetIndexOf(entry.value.sorted.slice().reverse(), String(member));
    if (idx === -1) return encodeBulkString(null);
    return encodeInteger(idx);
  }

  _zpop(args, minFirst) {
    if (args.length < 1 || args.length > 2) return encodeError("wrong number of arguments for 'ZPOP'");
    const [key, countStr] = args;
    const entry = this._ensureZSetEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry || entry.value.sorted.length === 0) return encodeArrayOfBulkStrings([]);
    let count = 1;
    if (countStr !== undefined) {
      const n = parseInt(String(countStr), 10);
      if (!Number.isFinite(n) || n < 0) return encodeError("value is not an integer or out of range");
      count = Math.max(1, n);
    }
    const out = [];
    for (let i = 0; i < count && entry.value.sorted.length > 0; i++) {
      const idx = minFirst ? 0 : entry.value.sorted.length - 1;
      const item = entry.value.sorted.splice(idx, 1)[0];
      entry.value.memberToScore.delete(item.member);
      out.push(item.member);
    }
    return encodeArrayOfBulkStrings(out);
  }

  _zscanCommand(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'ZSCAN'");
    const key = String(args[0]);
    const cursor = args[1];
    let i = 2; let match = undefined; let count = undefined;
    while (i < args.length) {
      const opt = String(args[i] || '').toUpperCase();
      if (opt === 'MATCH' && args[i + 1]) { match = String(args[i + 1]); i += 2; continue; }
      if (opt === 'COUNT' && args[i + 1]) { const n = parseInt(String(args[i + 1]), 10); if (Number.isFinite(n)) count = n; i += 2; continue; }
      break;
    }
    const res = this.zscan(key, cursor, { match, count });
    const nextStr = String(res.next);
    let out = `*2\r\n$${nextStr.length}\r\n${nextStr}\r\n*${res.tuples.length}\r\n`;
    for (const [m, s] of res.tuples) {
      out += `$${m.length}\r\n${m}\r\n$${s.length}\r\n${s}\r\n`;
    }
    return out;
  }

  zscan(key, cursor, opts) {
    const entry = this._ensureZSetEntry(key);
    if (entry === "WRONGTYPE") return { next: 0, tuples: [] };
    const arr = entry ? entry.value.sorted : [];
    const pairs = arr.map((it) => [it.member, String(it.score)]);
    const pat = String(opts && opts.match ? opts.match : '*');
    const regex = new RegExp('^' + pat.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    const filtered = pairs.filter(([m]) => regex.test(m));
    const count = opts && Number.isFinite(opts.count) && opts.count > 0 ? opts.count : 10;
    const start = parseInt(String(cursor), 10) || 0;
    const slice = filtered.slice(start, start + count);
    const next = start + slice.length >= filtered.length ? 0 : start + slice.length;
    return { next, tuples: slice };
  }

  _zrangeByScore(args) {
    if (args.length !== 3 && args.length !== 4) return encodeError("wrong number of arguments for 'ZRANGEBYSCORE'");
    const [key, minStr, maxStr] = args;
    const withScores = args.length === 4 && String(args[3]).toUpperCase() === 'WITHSCORES';
    if (args.length === 4 && !withScores) return encodeError("syntax error");
    const entry = this._ensureZSetEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const arr = entry ? entry.value.sorted : [];
    const min = this._parseScoreBound(minStr, -Infinity);
    const max = this._parseScoreBound(maxStr, Infinity);
    if (min === null || max === null) return encodeError("value is not a valid float");
    const out = [];
    for (const item of arr) {
      if (item.score >= min && item.score <= max) {
        if (withScores) { out.push(item.member, String(item.score)); }
        else { out.push(item.member); }
      }
      if (item.score > max) break;
    }
    return encodeArrayOfBulkStrings(out);
  }

  _parseScoreBound(str, fallback) {
    const s = String(str).toLowerCase();
    if (s === "-inf") return -Infinity;
    if (s === "+inf" || s === "inf") return Infinity;
    const n = parseFloat(String(str));
    return Number.isFinite(n) ? n : null;
  }

  _zsetInsert(sorted, item) {
    // binary search for insertion index based on (score, member)
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const cmp = this._zsetCompare(item, sorted[mid]);
      if (cmp <= 0) hi = mid; else lo = mid + 1;
    }
    sorted.splice(lo, 0, item);
  }

  _zsetRemoveFromSorted(sorted, member) {
    const idx = this._zsetIndexOf(sorted, member);
    if (idx !== -1) sorted.splice(idx, 1);
  }

  _zsetIndexOf(sorted, member) {
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].member === member) return i;
    }
    return -1;
  }

  _zsetCompare(a, b) {
    if (a.score < b.score) return -1;
    if (a.score > b.score) return 1;
    if (a.member < b.member) return -1;
    if (a.member > b.member) return 1;
    return 0;
  }

  // ---------- JSON (Phase 5) ----------

  _ensureJsonEntry(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) return null;
    if (entry.type !== "json") return "WRONGTYPE";
    return entry;
  }

  _getOrInitJson(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) {
      const e = { type: "json", value: {} };
      this.kv.set(k, e);
      return e;
    }
    return entry;
  }

  _jsonSet(args) {
    if (args.length !== 3) return encodeError("wrong number of arguments for 'JSON.SET'");
    const [key, path, rawJson] = args;
    const value = this._parseJsonOrString(rawJson);
    const entry = this._getOrInitJson(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const segs = this._jsonPathTokens(String(path));
    if (segs.length === 0) {
      entry.value = value;
    } else {
      this._jsonSetAtPath(entry, segs, value);
    }
    return encodeSimpleString("OK");
  }

  _jsonGet(args) {
    if (args.length < 1 || args.length > 2) return encodeError("wrong number of arguments for 'JSON.GET'");
    const [key, path] = args;
    const entry = this._ensureJsonEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeBulkString(null);
    if (path === undefined) return encodeBulkString(JSON.stringify(entry.value));
    const segs = this._jsonPathTokens(String(path));
    if (segs.length === 0) return encodeBulkString(JSON.stringify(entry.value));
    const hasWildcard = segs.some((s) => s === '*');
    if (!hasWildcard) {
      const found = this._jsonGetAtPath(entry.value, segs);
      if (found === undefined) return encodeBulkString(null);
      return encodeBulkString(JSON.stringify(found));
    }
    const matches = [];
    this._jsonCollectMatches(entry.value, segs, 0, matches);
    if (matches.length === 0) return encodeBulkString(null);
    return encodeBulkString(JSON.stringify(matches));
  }

  _jsonDel(args) {
    if (args.length < 1 || args.length > 2) return encodeError("wrong number of arguments for 'JSON.DEL'");
    const [key, path] = args;
    const k = String(key);
    if (path === undefined || String(path) === "." || String(path) === "$") {
      const existed = this.kv.delete(k) ? 1 : 0;
      this.expires.delete(k);
      return encodeInteger(existed);
    }
    const entry = this._ensureJsonEntry(k);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeInteger(0);
    const segs = this._jsonPathTokens(String(path));
    if (segs.length === 0) {
      const existed = this.kv.delete(k) ? 1 : 0;
      this.expires.delete(k);
      return encodeInteger(existed);
    }
    const removed = this._jsonDelAtPath(entry, segs) ? 1 : 0;
    return encodeInteger(removed);
  }

  _jsonArrAppend(args) {
    if (args.length < 3) return encodeError("wrong number of arguments for 'JSON.ARRAPPEND'");
    const [key, path, ...rest] = args;
    const entry = this._ensureJsonEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeError("path does not exist");
    const segs = this._jsonPathTokens(String(path));
    const target = segs.length === 0 ? entry.value : this._jsonGetAtPath(entry.value, segs);
    if (target === undefined) return encodeError("path does not exist");
    if (!Array.isArray(target)) return encodeError("path is not an array");
    const values = rest.map((v) => this._parseJsonOrString(v));
    for (const v of values) target.push(v);
    return encodeInteger(target.length);
  }

  _parseJsonOrString(raw) {
    const s = String(raw);
    try {
      return JSON.parse(s);
    } catch {}
    // If wrapped in quotes, strip one layer
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
    return s;
  }

  _jsonPathTokens(path) {
    const p = String(path).trim();
    if (p === "." || p === "$" || p === "") return [];
    const tokens = [];
    let i = 0;
    const len = p.length;
    // Skip optional leading '$'
    if (p[0] === '$') { i = 1; if (i < len && p[i] === '.') i++; }
    function readIdent() {
      let start = i;
      while (i < len && p[i] !== '.' && p[i] !== '[') i++;
      if (i > start) tokens.push(p.slice(start, i));
    }
    while (i < len) {
      const ch = p[i];
      if (ch === '.') {
        // Handle recursive descent '..'
        if (i + 1 < len && p[i + 1] === '.') {
          tokens.push('**');
          i += 2;
        } else {
          i++;
          readIdent();
        }
        continue;
      }
      if (ch === '[') {
        i++;
        if (i >= len) break;
        const q = p[i];
        if (q === '"' || q === "'") {
          i++;
          let str = '';
          while (i < len && p[i] !== q) {
            if (p[i] === '\\' && i + 1 < len) { str += p[i + 1]; i += 2; continue; }
            str += p[i++];
          }
          i++; // skip closing quote
          tokens.push(str);
        } else {
          // star wildcard or number
          if (p[i] === '*') {
            tokens.push('*');
            i++;
          } else {
            let start = i;
            while (i < len && /[0-9]/.test(p[i])) i++;
            const numStr = p.slice(start, i);
            const idx = parseInt(numStr, 10);
            if (Number.isFinite(idx)) tokens.push(idx);
          }
        }
        if (p[i] === ']') i++;
        continue;
      }
      // start of ident
      readIdent();
    }
    return tokens;
  }

  _jsonGetAtPath(root, segs) {
    let cur = root;
    for (const seg of segs) {
      if (cur == null) return undefined;
      if (typeof seg === 'number') {
        if (!Array.isArray(cur)) return undefined;
        cur = cur[seg];
      } else {
        if (typeof cur !== 'object') return undefined;
        cur = cur[seg];
      }
    }
    return cur;
  }

  _jsonCollectMatches(node, segs, idx, out) {
    if (idx >= segs.length) { out.push(node); return; }
    const seg = segs[idx];
    if (seg === '**') {
      // Recursive descent: match next segment at current node, and also descend
      this._jsonCollectMatches(node, segs, idx + 1, out);
      if (Array.isArray(node)) {
        for (const val of node) this._jsonCollectMatches(val, segs, idx, out);
      } else if (node && typeof node === 'object') {
        for (const k of Object.keys(node)) this._jsonCollectMatches(node[k], segs, idx, out);
      }
      return;
    }
    if (seg === '*') {
      if (Array.isArray(node)) {
        for (const val of node) this._jsonCollectMatches(val, segs, idx + 1, out);
      } else if (node && typeof node === 'object') {
        for (const k of Object.keys(node)) this._jsonCollectMatches(node[k], segs, idx + 1, out);
      }
      return;
    }
    if (typeof seg === 'number') {
      if (!Array.isArray(node)) return;
      if (seg < 0 || seg >= node.length) return;
      this._jsonCollectMatches(node[seg], segs, idx + 1, out);
      return;
    }
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      return;
    }
    this._jsonCollectMatches(node[seg], segs, idx + 1, out);
  }

  _jsonSetAtPath(entry, segs, value) {
    // entry: { type: 'json', value: any }
    let parent = null;
    let keyForParent = null;
    let cur = entry.value;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const isLast = i === segs.length - 1;
      if (typeof seg === 'number') {
        // ensure current is array
        if (!Array.isArray(cur)) {
          const newArr = [];
          if (parent === null) { entry.value = newArr; } else { parent[keyForParent] = newArr; }
          cur = newArr;
        }
        // grow array with nulls
        while (cur.length < seg) cur.push(null);
        if (isLast) {
          cur[seg] = value;
          return;
        } else {
          if (cur[seg] == null || typeof cur[seg] !== 'object') {
            // pick container based on next token
            const next = segs[i + 1];
            cur[seg] = (typeof next === 'number') ? [] : {};
          }
          parent = cur;
          keyForParent = seg;
          cur = cur[seg];
        }
      } else {
        // property name
        if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) {
          const newObj = {};
          if (parent === null) { entry.value = newObj; } else { parent[keyForParent] = newObj; }
          cur = newObj;
        }
        if (isLast) {
          cur[seg] = value;
          return;
        } else {
          if (cur[seg] == null || typeof cur[seg] !== 'object') {
            const next = segs[i + 1];
            cur[seg] = (typeof next === 'number') ? [] : {};
          }
          parent = cur;
          keyForParent = seg;
          cur = cur[seg];
        }
      }
    }
  }

  _jsonDelAtPath(entry, segs) {
    let cur = entry.value;
    let parent = null;
    let keyForParent = null;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i];
      if (cur == null) return false;
      if (typeof seg === 'number') {
        if (!Array.isArray(cur)) return false;
        parent = cur;
        keyForParent = seg;
        cur = cur[seg];
      } else {
        if (typeof cur !== 'object') return false;
        parent = cur;
        keyForParent = seg;
        cur = cur[seg];
      }
    }
    if (cur == null) return false;
    const last = segs[segs.length - 1];
    if (typeof last === 'number') {
      if (!Array.isArray(cur) || last < 0 || last >= cur.length) return false;
      cur.splice(last, 1);
      return true;
    } else {
      if (typeof cur !== 'object') return false;
      if (Object.prototype.hasOwnProperty.call(cur, last)) { delete cur[last]; return true; }
      return false;
    }
  }

  _jsonHasWildcard(segs) {
    return Array.isArray(segs) && segs.some((s) => s === '*');
  }

  _jsonResolveParent(root, segs) {
    if (!Array.isArray(segs)) return null;
    if (segs.length === 0) return { parent: null, key: null };
    let cur = root;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i];
      if (typeof seg === 'number') {
        if (!Array.isArray(cur)) return null;
        cur = cur[seg];
      } else {
        if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return null;
        cur = cur[seg];
      }
      if (cur === undefined || cur === null) return null;
    }
    return { parent: cur, key: segs[segs.length - 1] };
  }

  _jsonMGet(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'JSON.MGET'");
    const path = String(args[args.length - 1]);
    const keys = args.slice(0, -1).map(String);
    const segs = this._jsonPathTokens(path);
    const out = [];
    for (const k of keys) {
      const entry = this._ensureJsonEntry(k);
      if (!entry || entry === 'WRONGTYPE') { out.push(null); continue; }
      if (segs.length === 0) { out.push(JSON.stringify(entry.value)); continue; }
      if (this._jsonHasWildcard(segs)) {
        const matches = [];
        this._jsonCollectMatches(entry.value, segs, 0, matches);
        out.push(matches.length === 0 ? null : JSON.stringify(matches));
      } else {
        const node = this._jsonGetAtPath(entry.value, segs);
        out.push(node === undefined ? null : JSON.stringify(node));
      }
    }
    return encodeArrayOfBulkStrings(out);
  }

  _jsonType(args) {
    if (args.length < 1 || args.length > 2) return encodeError("wrong number of arguments for 'JSON.TYPE'");
    const [key, path] = args;
    const entry = this._ensureJsonEntry(key);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeBulkString(null);
    const node = path === undefined ? entry.value : this._jsonGetAtPath(entry.value, this._jsonPathTokens(String(path)));
    if (node === undefined) return encodeBulkString(null);
    const t = (v) => {
      if (v === null) return 'null';
      if (Array.isArray(v)) return 'array';
      switch (typeof v) {
        case 'string': return 'string';
        case 'number': return 'number';
        case 'boolean': return 'boolean';
        case 'object': return 'object';
        default: return 'null';
      }
    };
    return encodeBulkString(t(node));
  }

  _jsonObjKeys(args) {
    if (args.length < 1 || args.length > 2) return encodeError("wrong number of arguments for 'JSON.OBJKEYS'");
    const [key, path] = args;
    const entry = this._ensureJsonEntry(key);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeBulkString(null);
    const node = path === undefined ? entry.value : this._jsonGetAtPath(entry.value, this._jsonPathTokens(String(path)));
    if (!node || typeof node !== 'object' || Array.isArray(node)) return encodeBulkString(null);
    const keys = Object.keys(node);
    return encodeArrayOfBulkStrings(keys);
  }

  _jsonObjLen(args) {
    if (args.length < 1 || args.length > 2) return encodeError("wrong number of arguments for 'JSON.OBJLEN'");
    const [key, path] = args;
    const entry = this._ensureJsonEntry(key);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeBulkString(null);
    const node = path === undefined ? entry.value : this._jsonGetAtPath(entry.value, this._jsonPathTokens(String(path)));
    if (!node || typeof node !== 'object' || Array.isArray(node)) return encodeBulkString(null);
    return encodeInteger(Object.keys(node).length);
  }

  _jsonArrLen(args) {
    if (args.length < 1 || args.length > 2) return encodeError("wrong number of arguments for 'JSON.ARRLEN'");
    const [key, path] = args;
    const entry = this._ensureJsonEntry(key);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeBulkString(null);
    const node = path === undefined ? entry.value : this._jsonGetAtPath(entry.value, this._jsonPathTokens(String(path)));
    if (!Array.isArray(node)) return encodeBulkString(null);
    return encodeInteger(node.length);
  }

  _jsonArrPop(args) {
    if (args.length < 1 || args.length > 3) return encodeError("wrong number of arguments for 'JSON.ARRPOP'");
    const [key, pathMaybe, indexMaybe] = args;
    const hasPath = args.length >= 2;
    const path = hasPath ? String(pathMaybe) : '.';
    const segs = this._jsonPathTokens(path);
    if (this._jsonHasWildcard(segs)) return encodeError("path may not contain wildcard for write operation");
    const entry = this._ensureJsonEntry(key);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeBulkString(null);
    const node = segs.length === 0 ? entry.value : this._jsonGetAtPath(entry.value, segs);
    if (!Array.isArray(node)) return encodeBulkString(null);
    let idx = indexMaybe === undefined ? -1 : parseInt(String(indexMaybe), 10);
    if (!Number.isFinite(idx)) return encodeError("value is not an integer or out of range");
    if (idx < 0) idx = node.length + idx;
    if (idx < 0 || idx >= node.length) return encodeBulkString(null);
    const [removed] = node.splice(idx, 1);
    return encodeBulkString(removed === undefined ? null : JSON.stringify(removed));
  }

  _jsonArrInsert(args) {
    if (args.length < 4) return encodeError("wrong number of arguments for 'JSON.ARRINSERT'");
    const [key, pathStr, indexStr, ...rest] = args;
    const segs = this._jsonPathTokens(String(pathStr));
    if (this._jsonHasWildcard(segs)) return encodeError("path may not contain wildcard for write operation");
    const entry = this._ensureJsonEntry(key);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeError("path does not exist");
    const node = segs.length === 0 ? entry.value : this._jsonGetAtPath(entry.value, segs);
    if (!Array.isArray(node)) return encodeError("path is not an array");
    let idx = parseInt(String(indexStr), 10);
    if (!Number.isFinite(idx)) return encodeError("value is not an integer or out of range");
    if (idx < 0) idx = node.length + idx + 1;
    if (idx < 0) idx = 0;
    if (idx > node.length) idx = node.length;
    const values = rest.map((v) => this._parseJsonOrString(v));
    node.splice(idx, 0, ...values);
    return encodeInteger(node.length);
  }

  _jsonArrTrim(args) {
    if (args.length !== 4) return encodeError("wrong number of arguments for 'JSON.ARRTRIM'");
    const [key, pathStr, startStr, stopStr] = args;
    const segs = this._jsonPathTokens(String(pathStr));
    if (this._jsonHasWildcard(segs)) return encodeError("path may not contain wildcard for write operation");
    const entry = this._ensureJsonEntry(key);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeError("path does not exist");
    const node = segs.length === 0 ? entry.value : this._jsonGetAtPath(entry.value, segs);
    if (!Array.isArray(node)) return encodeError("path is not an array");
    let start = parseInt(String(startStr), 10);
    let stop = parseInt(String(stopStr), 10);
    if (!Number.isFinite(start) || !Number.isFinite(stop)) return encodeError("value is not an integer or out of range");
    const n = node.length;
    if (start < 0) start = n + start;
    if (stop < 0) stop = n + stop;
    if (start < 0) start = 0;
    if (stop < 0) stop = 0;
    if (start > n - 1) { node.length = 0; return encodeInteger(0); }
    if (stop > n - 1) stop = n - 1;
    if (stop < start) { node.length = 0; return encodeInteger(0); }
    const slice = node.slice(start, stop + 1);
    node.splice(0, node.length, ...slice);
    return encodeInteger(node.length);
  }

  _jsonArrIndex(args) {
    if (args.length < 3 || args.length > 5) return encodeError("wrong number of arguments for 'JSON.ARRINDEX'");
    const [key, pathStr, valueRaw, startStr, stopStr] = args;
    const segs = this._jsonPathTokens(String(pathStr));
    const entry = this._ensureJsonEntry(key);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeInteger(-1);
    const node = segs.length === 0 ? entry.value : this._jsonGetAtPath(entry.value, segs);
    if (!Array.isArray(node)) return encodeInteger(-1);
    const value = this._parseJsonOrString(valueRaw);
    const n = node.length;
    let start = startStr === undefined ? 0 : parseInt(String(startStr), 10);
    let stop = stopStr === undefined ? n - 1 : parseInt(String(stopStr), 10);
    if (!Number.isFinite(start) || !Number.isFinite(stop)) return encodeError("value is not an integer or out of range");
    if (start < 0) start = n + start;
    if (stop < 0) stop = n + stop;
    if (start < 0) start = 0;
    if (stop > n - 1) stop = n - 1;
    const eq = (a, b) => {
      try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
    };
    for (let i = start; i <= stop; i++) {
      if (eq(node[i], value)) return encodeInteger(i);
    }
    return encodeInteger(-1);
  }

  _jsonStrAppend(args) {
    if (args.length < 2 || args.length > 3) return encodeError("wrong number of arguments for 'JSON.STRAPPEND'");
    const [key, pathOrVal, maybeVal] = args;
    const appended = this._parseJsonOrString(maybeVal === undefined ? pathOrVal : maybeVal);
    const hasPath = maybeVal !== undefined;
    const path = hasPath ? String(pathOrVal) : '.';
    const segs = this._jsonPathTokens(path);
    if (this._jsonHasWildcard(segs)) return encodeError("path may not contain wildcard for write operation");
    const entry = this._ensureJsonEntry(key);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeError("path does not exist");
    if (segs.length === 0) {
      if (typeof entry.value !== 'string') return encodeError("path is not a string");
      entry.value = String(entry.value) + String(appended);
      return encodeInteger(entry.value.length);
    }
    const ref = this._jsonResolveParent(entry.value, segs);
    if (!ref) return encodeError("path does not exist");
    const cur = typeof ref.key === 'number' ? (Array.isArray(ref.parent) ? ref.parent[ref.key] : undefined) : ref.parent[ref.key];
    if (typeof cur !== 'string') return encodeError("path is not a string");
    const next = String(cur) + String(appended);
    ref.parent[ref.key] = next;
    return encodeInteger(next.length);
  }

  _jsonStrLen(args) {
    if (args.length < 1 || args.length > 2) return encodeError("wrong number of arguments for 'JSON.STRLEN'");
    const [key, path] = args;
    const entry = this._ensureJsonEntry(key);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeBulkString(null);
    const node = path === undefined ? entry.value : this._jsonGetAtPath(entry.value, this._jsonPathTokens(String(path)));
    if (typeof node !== 'string') return encodeBulkString(null);
    return encodeInteger(node.length);
  }

  _jsonNumIncrBy(args) {
    if (args.length !== 3) return encodeError("wrong number of arguments for 'JSON.NUMINCRBY'");
    const [key, pathStr, incStr] = args;
    const segs = this._jsonPathTokens(String(pathStr));
    if (this._jsonHasWildcard(segs)) return encodeError("path may not contain wildcard for write operation");
    const inc = parseFloat(String(incStr));
    if (!Number.isFinite(inc)) return encodeError("value is not a valid float");
    const entry = this._ensureJsonEntry(key);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeError("path does not exist");
    if (segs.length === 0) {
      if (typeof entry.value !== 'number') return encodeError("path is not a number");
      entry.value = entry.value + inc;
      return encodeBulkString(String(entry.value));
    }
    const ref = this._jsonResolveParent(entry.value, segs);
    if (!ref) return encodeError("path does not exist");
    const cur = typeof ref.key === 'number' ? (Array.isArray(ref.parent) ? ref.parent[ref.key] : undefined) : ref.parent[ref.key];
    if (typeof cur !== 'number') return encodeError("path is not a number");
    const next = cur + inc;
    ref.parent[ref.key] = next;
    return encodeBulkString(String(next));
  }

  _jsonForget(args) {
    // Alias of JSON.DEL semantics but returns integer count
    if (args.length < 1 || args.length > 2) return encodeError("wrong number of arguments for 'JSON.FORGET'");
    const [key, path] = args;
    if (path === undefined || String(path) === "." || String(path) === "$") {
      const existed = this.kv.delete(String(key)) ? 1 : 0;
      this.expires.delete(String(key));
      return encodeInteger(existed);
    }
    const entry = this._ensureJsonEntry(key);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeInteger(0);
    const segs = this._jsonPathTokens(String(path));
    if (segs.length === 0) {
      const existed = this.kv.delete(String(key)) ? 1 : 0;
      this.expires.delete(String(key));
      return encodeInteger(existed);
    }
    const removed = this._jsonDelAtPath(entry, segs) ? 1 : 0;
    return encodeInteger(removed);
  }

  _jsonNumMultBy(args) {
    if (args.length !== 3) return encodeError("wrong number of arguments for 'JSON.NUMMULTBY'");
    const [key, pathStr, factorStr] = args;
    const segs = this._jsonPathTokens(String(pathStr));
    if (this._jsonHasWildcard(segs)) return encodeError("path may not contain wildcard for write operation");
    const factor = parseFloat(String(factorStr));
    if (!Number.isFinite(factor)) return encodeError("value is not a valid float");
    const entry = this._ensureJsonEntry(key);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeError("path does not exist");
    if (segs.length === 0) {
      if (typeof entry.value !== 'number') return encodeError("path is not a number");
      entry.value = entry.value * factor;
      return encodeBulkString(String(entry.value));
    }
    const ref = this._jsonResolveParent(entry.value, segs);
    if (!ref) return encodeError("path does not exist");
    const cur = typeof ref.key === 'number' ? (Array.isArray(ref.parent) ? ref.parent[ref.key] : undefined) : ref.parent[ref.key];
    if (typeof cur !== 'number') return encodeError("path is not a number");
    const next = cur * factor;
    ref.parent[ref.key] = next;
    return encodeBulkString(String(next));
  }

  _jsonToggle(args) {
    if (args.length !== 2) return encodeError("wrong number of arguments for 'JSON.TOGGLE'");
    const [key, pathStr] = args;
    const segs = this._jsonPathTokens(String(pathStr));
    if (this._jsonHasWildcard(segs)) return encodeError("path may not contain wildcard for write operation");
    const entry = this._ensureJsonEntry(key);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeError("path does not exist");
    if (segs.length === 0) {
      if (typeof entry.value !== 'boolean') return encodeError("path is not a boolean");
      entry.value = !entry.value;
      return encodeInteger(entry.value ? 1 : 0);
    }
    const ref = this._jsonResolveParent(entry.value, segs);
    if (!ref) return encodeError("path does not exist");
    const cur = typeof ref.key === 'number' ? (Array.isArray(ref.parent) ? ref.parent[ref.key] : undefined) : ref.parent[ref.key];
    if (typeof cur !== 'boolean') return encodeError("path is not a boolean");
    const next = !cur;
    ref.parent[ref.key] = next;
    return encodeInteger(next ? 1 : 0);
  }

  _jsonClear(args) {
    if (args.length < 1 || args.length > 2) return encodeError("wrong number of arguments for 'JSON.CLEAR'");
    const [key, pathStr] = args;
    const segs = pathStr === undefined ? [] : this._jsonPathTokens(String(pathStr));
    if (this._jsonHasWildcard(segs)) return encodeError("path may not contain wildcard for write operation");
    const entry = this._ensureJsonEntry(key);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeInteger(0);
    let node, parentRef = null;
    if (segs.length === 0) {
      node = entry.value;
    } else {
      parentRef = this._jsonResolveParent(entry.value, segs);
      if (!parentRef) return encodeInteger(0);
      node = typeof parentRef.key === 'number' ? (Array.isArray(parentRef.parent) ? parentRef.parent[parentRef.key] : undefined) : parentRef.parent[parentRef.key];
    }
    if (Array.isArray(node)) {
      node.length = 0;
      return encodeInteger(1);
    }
    if (node && typeof node === 'object') {
      for (const k of Object.keys(node)) delete node[k];
      return encodeInteger(1);
    }
    return encodeInteger(0);
  }

  // ---------- Vectors (Phase 5) ----------

  _ensureVecIndexEntry(name) {
    const n = String(name);
    const entry = this._getEntry(n);
    if (!entry) return null;
    if (entry.type !== "vec_index") return "WRONGTYPE";
    return entry;
  }

  _getOrInitVecIndex(name) {
    const n = String(name);
    const entry = this._getEntry(n);
    if (!entry) {
      const e = { type: "vec_index", value: { idToVector: new Map(), idToOrder: new Map(), nextOrder: 1, hnsw: null, dim: null } };
      this.kv.set(n, e);
      return e;
    }
    return entry;
  }

  _vecAdd(args) {
    if (args.length !== 3) return encodeError("wrong number of arguments for 'VEC.ADD'");
    const [indexName, vectorId, raw] = args;
    let vec;
    try {
      const parsed = JSON.parse(String(raw));
      if (Array.isArray(parsed)) vec = parsed;
      else if (parsed && Array.isArray(parsed.vector)) vec = parsed.vector;
      else return encodeError("vector_json must be an array or {vector:[..]}");
    } catch {
      return encodeError("invalid JSON");
    }
    const vector = vec.map((x) => Number(x)).filter((x) => Number.isFinite(x));
    if (vector.length !== vec.length) return encodeError("vector contains non-numeric values");
    const entry = this._getOrInitVecIndex(indexName);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (entry.value.dim == null) entry.value.dim = vector.length; else if (entry.value.dim !== vector.length) return encodeError("dimension mismatch");
    const idStr = String(vectorId);
    const isNewId = !entry.value.idToVector.has(idStr);
    entry.value.idToVector.set(idStr, vector);
    if (isNewId) {
      try {
        entry.value.idToOrder.set(idStr, entry.value.nextOrder++);
      } catch {}
    }
    if (entry.value.hnsw) entry.value.hnsw.insert(String(vectorId), vector);
    return encodeSimpleString("OK");
  }

  _vecSearch(args) {
    if (args.length < 3) return encodeError("wrong number of arguments for 'VEC.SEARCH'");
    const [indexName, rawQuery, kStr, ...rest] = args;
    const entry = this._ensureVecIndexEntry(indexName);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const idToVector = entry ? entry.value.idToVector : null;
    const hnsw = entry ? entry.value.hnsw : null;
    if (!idToVector || idToVector.size === 0) return encodeArrayOfBulkStrings([]);
    let query;
    try {
      const parsed = JSON.parse(String(rawQuery));
      if (Array.isArray(parsed)) query = parsed;
      else if (parsed && Array.isArray(parsed.vector)) query = parsed.vector;
      else return encodeError("query_vector must be an array or {vector:[..]}");
    } catch {
      return encodeError("invalid JSON");
    }
    const k = parseInt(String(kStr), 10);
    if (!Number.isFinite(k) || k <= 0) return encodeError("K must be a positive integer");
    let metric = "euclidean";
    let efOverride = undefined;
    for (let i = 0; i < rest.length; i++) {
      if (String(rest[i]).toUpperCase() === "METRIC" && rest[i + 1]) {
        metric = String(rest[i + 1]).toLowerCase();
        i++;
        continue;
      }
      if (String(rest[i]).toUpperCase() === "EF" && rest[i + 1]) {
        const v = parseInt(String(rest[i + 1]), 10);
        if (Number.isFinite(v) && v > 0) efOverride = v;
        i++;
      }
    }
    const queryVec = query.map((x) => Number(x)).filter((x) => Number.isFinite(x));
    if (queryVec.length !== query.length) return encodeError("query contains non-numeric values");
    if (entry && entry.value && entry.value.dim != null && queryVec.length !== entry.value.dim) return encodeError("dimension mismatch");
    const scores = [];
    const useCosine = metric === "cosine";
    let queryNorm = 1;
    if (useCosine) {
      queryNorm = Math.sqrt(queryVec.reduce((s, v) => s + v * v, 0));
      if (queryNorm === 0) return encodeArrayOfBulkStrings([]);
    }
    const candidates = hnsw ? hnsw.approximateCandidates(queryVec, { metric, ef: efOverride }) : idToVector.entries();
    for (const [id, vec] of candidates) {
      if (vec.length !== queryVec.length) continue; // skip dimension mismatch
      if (useCosine) {
        const dot = vec.reduce((s, v, i) => s + v * queryVec[i], 0);
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
        if (norm === 0) continue;
        const cosine = dot / (norm * queryNorm);
        scores.push([id, 1 - cosine]); // smaller better
      } else {
        const dist = Math.sqrt(vec.reduce((s, v, i) => s + (v - queryVec[i]) * (v - queryVec[i]), 0));
        scores.push([id, dist]);
      }
    }
    scores.sort((a, b) => {
      const d = a[1] - b[1];
      if (d !== 0) return d;
      try {
        const orderA = entry && entry.value && entry.value.idToOrder ? (entry.value.idToOrder.get(a[0]) || 0) : 0;
        const orderB = entry && entry.value && entry.value.idToOrder ? (entry.value.idToOrder.get(b[0]) || 0) : 0;
        if (orderA !== orderB) return orderB - orderA; // prefer newer insertions
      } catch {}
      const sa = String(a[0]); const sb = String(b[0]);
      if (sa < sb) return 1;
      if (sa > sb) return -1;
      return 0;
    });
    const top = scores.slice(0, k).map(([id]) => id);
    return encodeArrayOfBulkStrings(top);
  }

  _vecCreateIndex(args) {
    // VEC.CREATEINDEX index_name METRIC <euclidean|cosine> M <int> EF <int> [DIM n]
    if (args.length < 1) return encodeError("wrong number of arguments for 'VEC.CREATEINDEX'");
    const name = String(args[0]);
    let metric = 'euclidean';
    let m = 8; // connectivity
    let ef = 64; // search breadth
    let dim = null;
    for (let i = 1; i < args.length; i++) {
      const opt = String(args[i]).toUpperCase();
      if (opt === 'METRIC' && args[i + 1]) { metric = String(args[i + 1]).toLowerCase(); i++; continue; }
      if (opt === 'M' && args[i + 1]) { const v = parseInt(String(args[i + 1]), 10); if (Number.isFinite(v) && v > 0) m = v; i++; continue; }
      if (opt === 'EF' && args[i + 1]) { const v = parseInt(String(args[i + 1]), 10); if (Number.isFinite(v) && v > 0) ef = v; i++; continue; }
      if (opt === 'DIM' && args[i + 1]) { const v = parseInt(String(args[i + 1]), 10); if (Number.isFinite(v) && v > 0) dim = v; i++; continue; }
    }
    const entry = this._getOrInitVecIndex(name);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry.value.hnsw) entry.value.hnsw = new HnswIndex(metric, m, ef);
    entry.value.hnsw.metric = metric;
    entry.value.hnsw.m = m;
    entry.value.hnsw.ef = ef;
    if (dim != null) entry.value.dim = dim;
    // rebuild graph from current vectors
    entry.value.hnsw.rebuild(entry.value.idToVector);
    return encodeSimpleString("OK");
  }

  _vecRebuild(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'VEC.REBUILD'");
    const name = String(args[0]);
    const entry = this._ensureVecIndexEntry(name);
    if (!entry || entry === 'WRONGTYPE') return encodeError("no such index");
    if (!entry.value.hnsw) entry.value.hnsw = new SimpleHnsw('euclidean', 8, 64);
    entry.value.hnsw.rebuild(entry.value.idToVector);
    return encodeSimpleString("OK");
  }

  _vecStats(args) {
    if (args.length !== 1) return encodeError("wrong number of arguments for 'VEC.STATS'");
    const name = String(args[0]);
    const entry = this._ensureVecIndexEntry(name);
    if (!entry || entry === 'WRONGTYPE') return encodeError("no such index");
    const h = entry.value.hnsw;
    const stats = h ? { nodes: h.nodes.size, metric: h.metric, m: h.m, ef: h.ef } : { nodes: 0 };
    return encodeBulkString(JSON.stringify(stats));
  }

  _vecRequire(indexName, id) {
    const entry = this._ensureVecIndexEntry(indexName);
    if (entry === "WRONGTYPE") return { err: encodeError("WRONGTYPE Operation against a key holding the wrong kind of value") };
    if (!entry) return { err: encodeError("no such index") };
    const vec = entry.value.idToVector.get(String(id));
    if (!vec) return { err: encodeError("no such vector id") };
    return { entry, vec };
  }

  _parseVectorJson(raw, name) {
    let v;
    try {
      const parsed = JSON.parse(String(raw));
      if (Array.isArray(parsed)) v = parsed; else if (parsed && Array.isArray(parsed.vector)) v = parsed.vector; else return { err: encodeError(`${name} must be an array or {vector:[..]}`) };
    } catch { return { err: encodeError("invalid JSON") } }
    const out = v.map((x) => Number(x));
    if (out.some((n) => !Number.isFinite(n))) return { err: encodeError("vector contains non-numeric values") };
    return { vec: out };
  }

  _vecAddVec(args) {
    // VEC.ADDVEC index id vector_json → adds element-wise into stored vector
    if (args.length !== 3) return encodeError("wrong number of arguments for 'VEC.ADDVEC'");
    const [indexName, id, raw] = args;
    const req = this._vecRequire(indexName, id); if (req.err) return req.err; const { entry, vec } = req;
    const p = this._parseVectorJson(raw, 'vector_json'); if (p.err) return p.err; const add = p.vec;
    if (add.length !== vec.length) return encodeError("dimension mismatch");
    const res = vec.map((v, i) => v + add[i]);
    entry.value.idToVector.set(String(id), res);
    if (entry.value.hnsw) entry.value.hnsw.insert(String(id), res);
    return encodeSimpleString("OK");
  }

  _vecSubVec(args) {
    // VEC.SUBVEC index id vector_json → subtract element-wise
    if (args.length !== 3) return encodeError("wrong number of arguments for 'VEC.SUBVEC'");
    const [indexName, id, raw] = args;
    const req = this._vecRequire(indexName, id); if (req.err) return req.err; const { entry, vec } = req;
    const p = this._parseVectorJson(raw, 'vector_json'); if (p.err) return p.err; const sub = p.vec;
    if (sub.length !== vec.length) return encodeError("dimension mismatch");
    const res = vec.map((v, i) => v - sub[i]);
    entry.value.idToVector.set(String(id), res);
    if (entry.value.hnsw) entry.value.hnsw.insert(String(id), res);
    return encodeSimpleString("OK");
  }

  _vecDot(args) {
    // VEC.DOT index id vector_json → returns dot product as bulk
    if (args.length !== 3) return encodeError("wrong number of arguments for 'VEC.DOT'");
    const [indexName, id, raw] = args;
    const req = this._vecRequire(indexName, id); if (req.err) return req.err; const { vec } = req;
    const p = this._parseVectorJson(raw, 'vector_json'); if (p.err) return p.err; const other = p.vec;
    if (other.length !== vec.length) return encodeError("dimension mismatch");
    const dot = vec.reduce((s, v, i) => s + v * other[i], 0);
    return encodeBulkString(String(dot));
  }

  _embRegister(args) {
    // EMB.REGISTER name module? Not loading external modules for safety; accept only 'json' passthrough.
    // For extensibility, allow dynamic registration of a simple JS expression is unsafe; keep to built-ins.
    // Here we just acknowledge built-in is present; users can extend registry in code if needed.
    if (args.length !== 1) return encodeError("wrong number of arguments for 'EMB.REGISTER'");
    const name = String(args[0]).toLowerCase();
    if (name !== 'json') return encodeError("only built-in 'json' provider available in this build");
    return encodeSimpleString("OK");
  }

  _embList(args) {
    if (args.length !== 0) return encodeError("wrong number of arguments for 'EMB.LIST'");
    return encodeArrayOfBulkStrings(GlobalEmbeddingRegistry.list());
  }

  _vecEmbedAdd(args) {
    // VEC.EMBEDADD index id provider payload
    if (args.length !== 4) return encodeError("wrong number of arguments for 'VEC.EMBEDADD'");
    const [indexName, id, provider, payload] = args;
    const res = GlobalEmbeddingRegistry.compute(String(provider), String(payload));
    if (res.error) return encodeError(res.error);
    // reuse VEC.ADD path
    return this._vecAdd([indexName, id, JSON.stringify(res.vector)]);
  }

  // ---------- Geospatial ----------

  _ensureGeoEntry(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) return null;
    if (entry.type !== "geo") return "WRONGTYPE";
    return entry;
  }

  _getOrInitGeo(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) {
      const e = { type: "geo", value: { memberToCoord: new Map() } };
      this.kv.set(k, e);
      return e;
    }
    return entry;
  }

  _geoadd(args) {
    // GEOADD key lon lat member [lon lat member ...]
    if (args.length < 4) return encodeError("wrong number of arguments for 'GEOADD'");
    const key = String(args[0]);
    const rest = args.slice(1);
    if (rest.length % 3 !== 0) return encodeError("wrong number of arguments for 'GEOADD'");
    const entry = this._getOrInitGeo(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    let added = 0;
    for (let i = 0; i < rest.length; i += 3) {
      const lon = parseFloat(String(rest[i]));
      const lat = parseFloat(String(rest[i + 1]));
      const member = String(rest[i + 2]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        return encodeError("invalid longitude,latitude pair");
      }
      if (!entry.value.memberToCoord.has(member)) added += 1;
      entry.value.memberToCoord.set(member, [lon, lat]);
    }
    return encodeInteger(added);
  }

  _geodist(args) {
    // GEODIST key member1 member2 [unit]
    if (args.length < 3 || args.length > 4) return encodeError("wrong number of arguments for 'GEODIST'");
    const [key, m1, m2, unitOpt] = args.map(String);
    const entry = this._ensureGeoEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeBulkString(null);
    const c1 = entry.value.memberToCoord.get(String(m1));
    const c2 = entry.value.memberToCoord.get(String(m2));
    if (!c1 || !c2) return encodeBulkString(null);
    const unit = this._geoNormalizeUnit(unitOpt || 'm');
    if (!unit) return encodeError("unsupported unit");
    const meters = this._haversineMeters(c1[1], c1[0], c2[1], c2[0]);
    const val = meters / this._metersPerUnit(unit);

    // Format according to Redis precision rules
    let formattedVal;
    if (unit === 'm') {
      // For meters, return with appropriate decimal precision (don't round)
      formattedVal = val.toFixed(4);
    } else {
      // For other units, use appropriate decimal precision
      switch (unit) {
        case 'km':
          formattedVal = val.toFixed(4);
          break;
        case 'mi':
          formattedVal = val.toFixed(4);
          break;
        case 'ft':
          formattedVal = val.toFixed(1);
          break;
        default:
          formattedVal = val.toString();
      }
    }

    return encodeBulkString(formattedVal);
  }

  _geosearch(args) {
    // GEOSEARCH key FROMMEMBER member | FROMLONLAT lon lat BYRADIUS r unit | BYBOX w h unit [ASC|DESC] [COUNT n] [WITHDIST]
    if (args.length < 6) return encodeError("wrong number of arguments for 'GEOSEARCH'");
    const key = String(args[0]);
    let i = 1;
    let centerLon = null, centerLat = null, haveCenter = false;
    const from = String(args[i] || '').toUpperCase();
    if (from === 'FROMMEMBER') {
      const member = String(args[i + 1]);
      i += 2;
      const entry = this._ensureGeoEntry(key);
      if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
      const c = entry && entry.value.memberToCoord.get(member);
      if (!c) return encodeArrayOfBulkStrings([]);
      centerLon = c[0]; centerLat = c[1]; haveCenter = true;
    } else if (from === 'FROMLONLAT') {
      const lon = parseFloat(String(args[i + 1]));
      const lat = parseFloat(String(args[i + 2]));
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return encodeError("invalid longitude,latitude pair");
      centerLon = lon; centerLat = lat; haveCenter = true; i += 3;
    } else {
      return encodeError("syntax error");
    }
    if (!haveCenter) return encodeError("syntax error");
    const by = String(args[i] || '').toUpperCase();
    i += 1;
    let mode = null; // 'radius' | 'box'
    let radius = null, width = null, height = null; // in meters
    let unitStr = null;
    if (by === 'BYRADIUS') {
      const r = parseFloat(String(args[i]));
      const u = this._geoNormalizeUnit(String(args[i + 1] || 'm'));
      if (!Number.isFinite(r) || r < 0 || !u) return encodeError("syntax error");
      radius = r * this._metersPerUnit(u);
      unitStr = u;
      mode = 'radius';
      i += 2;
    } else if (by === 'BYBOX') {
      const w = parseFloat(String(args[i]));
      const h = parseFloat(String(args[i + 1]));
      const u = this._geoNormalizeUnit(String(args[i + 2] || 'm'));
      if (!Number.isFinite(w) || !Number.isFinite(h) || w < 0 || h < 0 || !u) return encodeError("syntax error");
      width = w * this._metersPerUnit(u);
      height = h * this._metersPerUnit(u);
      unitStr = u;
      mode = 'box';
      i += 3;
    } else {
      return encodeError("syntax error");
    }
    // options
    let asc = false, desc = false, withdist = false; let count = Infinity;
    while (i < args.length) {
      const opt = String(args[i]).toUpperCase();
      if (opt === 'ASC') { asc = true; i += 1; continue; }
      if (opt === 'DESC') { desc = true; i += 1; continue; }
      if (opt === 'WITHDIST') { withdist = true; i += 1; continue; }
      if (opt === 'COUNT' && args[i + 1]) { const n = parseInt(String(args[i + 1]), 10); if (Number.isFinite(n) && n > 0) count = n; i += 2; continue; }
      break;
    }
    if (asc && desc) desc = false; // prefer ASC if both set mistakenly
    const entry = this._ensureGeoEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const map = entry ? entry.value.memberToCoord : new Map();
    const results = [];
    const centerLatRad = this._degToRad(centerLat);
    // Precompute bbox for BYBOX mode
    let minLon = -Infinity, maxLon = Infinity, minLat = -Infinity, maxLat = Infinity;
    if (mode === 'box') {
      const dLat = height / 111320; // degrees approx
      const dLon = width / (111320 * Math.max(Math.cos(centerLatRad), 1e-6));
      minLat = centerLat - dLat / 2; maxLat = centerLat + dLat / 2;
      minLon = centerLon - dLon / 2; maxLon = centerLon + dLon / 2;
    }
    for (const [member, [lon, lat]] of map.entries()) {
      if (mode === 'box') {
        if (lat < minLat || lat > maxLat) continue;
        if (lon < minLon || lon > maxLon) continue;
      }
      let distM = this._haversineMeters(centerLat, centerLon, lat, lon);
      if (mode === 'radius' && distM > radius) continue;
      const distUnit = distM / this._metersPerUnit(unitStr || 'm');
      results.push([member, distUnit]);
    }
    // GEOSEARCH defaults to ascending order (closest first) when no ASC/DESC specified
    results.sort((a, b) => (desc) ? (b[1] - a[1]) : (a[1] - b[1]));
    const limited = results.slice(0, count);
    if (withdist) {
      let out = `*${limited.length}\r\n`;
      for (const [m, d] of limited) {
        const ms = String(m);
        // Format distance to 4 decimal places like Redis
        const ds = Number(d).toFixed(4);
        out += `*2\r\n$${ms.length}\r\n${ms}\r\n$${ds.length}\r\n${ds}\r\n`;
      }
      return out;
    }
    const onlyMembers = limited.map(([m]) => m);
    return encodeArrayOfBulkStrings(onlyMembers);
  }

  _geohash(args) {
    // GEOHASH key member [member ...]
    if (args.length < 2) return encodeError("wrong number of arguments for 'GEOHASH'");
    const key = String(args[0]);
    const entry = this._ensureGeoEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const out = [];
    const members = args.slice(1).map(String);
    for (const m of members) {
      const c = entry && entry.value.memberToCoord.get(m);
      out.push(c ? this._geoEncodeHash(c[1], c[0]) : null);
    }
    return encodeArrayOfBulkStrings(out);
  }

  _geopos(args) {
    // GEOPOS key member [member ...]
    if (args.length < 2) return encodeError("wrong number of arguments for 'GEOPOS'");
    const key = String(args[0]);
    const entry = this._ensureGeoEntry(key);
    if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const members = args.slice(1).map(String);
    const results = [];

    for (const m of members) {
      const c = entry && entry.value.memberToCoord.get(m);
      if (c) {
        // Redis returns coordinates as separate array elements
        results.push([String(c[0]), String(c[1])]);
      } else {
        results.push(null);
      }
    }

    // Build RESP array of arrays (or nulls)
    let out = `*${results.length}\r\n`;
    for (const result of results) {
      if (result === null) {
        out += `$-1\r\n`; // Null bulk string
      } else {
        out += `*2\r\n$${result[0].length}\r\n${result[0]}\r\n$${result[1].length}\r\n${result[1]}\r\n`;
      }
    }
    return out;
  }

  _geosearchstore(args) {
    // GEOSEARCHSTORE dest key ...options (same as GEOSEARCH) [STOREDIST]
    if (args.length < 7) return encodeError("wrong number of arguments for 'GEOSEARCHSTORE'");
    const dest = String(args[0]);
    const key = String(args[1]);
    const searchArgs = args.slice(2);
    // detect STOREDIST option at end
    let storeDist = false;
    for (let i = 0; i < searchArgs.length; i++) {
      if (String(searchArgs[i]).toUpperCase() === 'STOREDIST') { storeDist = true; searchArgs.splice(i, 1); break; }
    }
    // Run GEOSEARCH to get members (and maybe distances)
    const result = this._geosearch([key, ...searchArgs]);
    // _geosearch returns RESP-encoded; to avoid re-parsing RESP, rerun logic directly
    // We duplicate minimal selection logic here to get structured results
    const structured = this._geosearchStructured(key, searchArgs);
    if (typeof structured === 'string') return structured; // error
    // Store into dest as a sorted set: score=distance if STOREDIST else 0/1 incrementing order
    const z = this._getOrInitZSet(dest);
    if (z === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    z.value.memberToScore.clear();
    z.value.sorted = [];
    let added = 0;
    for (const [m, d] of structured) {
      const score = storeDist ? Number(d) : 0;
      z.value.memberToScore.set(m, score);
      this._zsetInsert(z.value.sorted, { member: m, score });
      added++;
    }
    this.expires.delete(dest);
    return encodeInteger(added);
  }

  _georadius(args) {
    // GEORADIUS key longitude latitude radius unit [WITHCOORD] [WITHDIST] [WITHHASH] [COUNT count] [ASC|DESC] [STORE key] [STOREDIST key]
    if (args.length < 5) return encodeError("wrong number of arguments for 'GEORADIUS'");
    const key = String(args[0]);
    const lon = parseFloat(String(args[1]));
    const lat = parseFloat(String(args[2]));
    const radius = parseFloat(String(args[3]));
    const unit = String(args[4]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return encodeError("invalid longitude,latitude pair");
    if (!Number.isFinite(radius) || radius < 0) return encodeError("invalid radius");
    const normalizedUnit = this._geoNormalizeUnit(unit);
    if (!normalizedUnit) return encodeError("unsupported unit");

    // Parse options
    let i = 5;
    let withcoord = false, withdist = false, withhash = false, count = Infinity, asc = false, desc = false;
    let store = null, storedist = null;

    while (i < args.length) {
      const opt = String(args[i]).toUpperCase();
      if (opt === 'WITHCOORD') { withcoord = true; i++; continue; }
      if (opt === 'WITHDIST') { withdist = true; i++; continue; }
      if (opt === 'WITHHASH') { withhash = true; i++; continue; }
      if (opt === 'COUNT') {
        const c = parseInt(String(args[i + 1]), 10);
        if (!Number.isFinite(c) || c <= 0) return encodeError("value is not an integer or out of range");
        count = c; i += 2; continue;
      }
      if (opt === 'ASC') { asc = true; desc = false; i++; continue; }
      if (opt === 'DESC') { desc = true; asc = false; i++; continue; }
      if (opt === 'STORE') {
        if (args[i + 1] === undefined) return encodeError("syntax error");
        store = String(args[i + 1]); i += 2; continue;
      }
      if (opt === 'STOREDIST') {
        if (args[i + 1] === undefined) return encodeError("syntax error");
        storedist = String(args[i + 1]); i += 2; continue;
      }
      break;
    }

    // Convert GEORADIUS to GEOSEARCH syntax
    const geosearchArgs = [
      key,
      'FROMLONLAT', String(lon), String(lat),
      'BYRADIUS', String(radius), normalizedUnit
    ];

    if (asc) geosearchArgs.push('ASC');
    else if (desc) geosearchArgs.push('DESC');

    if (count !== Infinity) {
      geosearchArgs.push('COUNT', String(count));
    }

    if (withdist) geosearchArgs.push('WITHDIST');

    // Handle STORE and STOREDIST - these need to use GEOSEARCHSTORE
    if (store || storedist) {
      const geosearchstoreArgs = [];
      if (storedist) {
        geosearchstoreArgs.push(storedist, key, ...geosearchArgs.slice(1), 'STOREDIST');
      } else {
        geosearchstoreArgs.push(store, key, ...geosearchArgs.slice(1));
      }
      return this._geosearchstore(geosearchstoreArgs);
    }

    // For regular search (not storing), use GEOSEARCH
    const result = this._geosearch(geosearchArgs);

    // If WITHCOORD or WITHHASH are requested, we need to process the result
    // GEOSEARCH only supports WITHDIST, so we need to handle WITHCOORD and WITHHASH differently
    if (withcoord || withhash) {
      // Parse the RESP result from _geosearch and enhance it
      const structured = this._geosearchStructured(key, geosearchArgs.slice(1));
      if (typeof structured === 'string') return structured; // error

      let out = `*${structured.length}\r\n`;
      for (const [member, dist] of structured) {
        const entry = this._ensureGeoEntry(key);
        if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");

        let arr = [`$${member.length}\r\n${member}\r\n`];

        if (withdist) {
          // Format distance to 4 decimal places like Redis
          const formattedDist = Number(dist).toFixed(4);
          arr.push(`$${formattedDist.length}\r\n${formattedDist}\r\n`);
        }

        if (withcoord) {
          const c = entry && entry.value.memberToCoord.get(member);
          if (c) {
            arr.push(`*2\r\n$${String(c[0]).length}\r\n${c[0]}\r\n$${String(c[1]).length}\r\n${c[1]}\r\n`);
          } else {
            arr.push(`*2\r\n$-1\r\n$-1\r\n`);
          }
        }

        if (withhash) {
          const c = entry && entry.value.memberToCoord.get(member);
          if (c) {
            const hash = this._geoEncodeHash(c[1], c[0]);
            arr.push(`$${hash.length}\r\n${hash}\r\n`);
          } else {
            arr.push(`$-1\r\n`);
          }
        }

        out += `*${arr.length}\r\n${arr.join('')}`;
      }
      return out;
    }

    return result;
  }

  _georadiusbymember(args) {
    // GEORADIUSBYMEMBER key member radius unit [WITHCOORD] [WITHDIST] [WITHHASH] [COUNT count] [ASC|DESC] [STORE key] [STOREDIST key]
    if (args.length < 4) return encodeError("wrong number of arguments for 'GEORADIUSBYMEMBER'");
    const key = String(args[0]);
    const member = String(args[1]);
    const radius = parseFloat(String(args[2]));
    const unit = String(args[3]);
    if (!Number.isFinite(radius) || radius < 0) return encodeError("invalid radius");
    const normalizedUnit = this._geoNormalizeUnit(unit);
    if (!normalizedUnit) return encodeError("unsupported unit");

    // Parse options
    let i = 4;
    let withcoord = false, withdist = false, withhash = false, count = Infinity, asc = false, desc = false;
    let store = null, storedist = null;

    while (i < args.length) {
      const opt = String(args[i]).toUpperCase();
      if (opt === 'WITHCOORD') { withcoord = true; i++; continue; }
      if (opt === 'WITHDIST') { withdist = true; i++; continue; }
      if (opt === 'WITHHASH') { withhash = true; i++; continue; }
      if (opt === 'COUNT') {
        const c = parseInt(String(args[i + 1]), 10);
        if (!Number.isFinite(c) || c <= 0) return encodeError("value is not an integer or out of range");
        count = c; i += 2; continue;
      }
      if (opt === 'ASC') { asc = true; desc = false; i++; continue; }
      if (opt === 'DESC') { desc = true; asc = false; i++; continue; }
      if (opt === 'STORE') {
        if (args[i + 1] === undefined) return encodeError("syntax error");
        store = String(args[i + 1]); i += 2; continue;
      }
      if (opt === 'STOREDIST') {
        if (args[i + 1] === undefined) return encodeError("syntax error");
        storedist = String(args[i + 1]); i += 2; continue;
      }
      break;
    }

    // Convert GEORADIUSBYMEMBER to GEOSEARCH syntax
    const geosearchArgs = [
      key,
      'FROMMEMBER', member,
      'BYRADIUS', String(radius), normalizedUnit
    ];

    if (asc) geosearchArgs.push('ASC');
    else if (desc) geosearchArgs.push('DESC');

    if (count !== Infinity) {
      geosearchArgs.push('COUNT', String(count));
    }

    if (withdist) geosearchArgs.push('WITHDIST');

    // Handle STORE and STOREDIST - these need to use GEOSEARCHSTORE
    if (store || storedist) {
      const geosearchstoreArgs = [];
      if (storedist) {
        geosearchstoreArgs.push(storedist, key, ...geosearchArgs.slice(1), 'STOREDIST');
      } else {
        geosearchstoreArgs.push(store, key, ...geosearchArgs.slice(1));
      }
      return this._geosearchstore(geosearchstoreArgs);
    }

    // For regular search (not storing), use GEOSEARCH
    const result = this._geosearch(geosearchArgs);

    // If WITHCOORD or WITHHASH are requested, we need to process the result
    // GEOSEARCH only supports WITHDIST, so we need to handle WITHCOORD and WITHHASH differently
    if (withcoord || withhash) {
      // Parse the RESP result from _geosearch and enhance it
      const structured = this._geosearchStructured(key, geosearchArgs.slice(1));
      if (typeof structured === 'string') return structured; // error

      let out = `*${structured.length}\r\n`;
      for (const [memberName, dist] of structured) {
        const entry = this._ensureGeoEntry(key);
        if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");

        let arr = [`$${memberName.length}\r\n${memberName}\r\n`];

        if (withdist) {
          // Format distance to 4 decimal places like Redis
          const formattedDist = Number(dist).toFixed(4);
          arr.push(`$${formattedDist.length}\r\n${formattedDist}\r\n`);
        }

        if (withcoord) {
          const c = entry && entry.value.memberToCoord.get(memberName);
          if (c) {
            arr.push(`*2\r\n$${String(c[0]).length}\r\n${c[0]}\r\n$${String(c[1]).length}\r\n${c[1]}\r\n`);
          } else {
            arr.push(`*2\r\n$-1\r\n$-1\r\n`);
          }
        }

        if (withhash) {
          const c = entry && entry.value.memberToCoord.get(memberName);
          if (c) {
            const hash = this._geoEncodeHash(c[1], c[0]);
            arr.push(`$${hash.length}\r\n${hash}\r\n`);
          } else {
            arr.push(`$-1\r\n`);
          }
        }

        out += `*${arr.length}\r\n${arr.join('')}`;
      }
      return out;
    }

    return result;
  }

  _geosearchStructured(key, args) {
    // Return [[member, dist], ...] using same logic as _geosearch
    try {
      let i = 0;
      let centerLon = null, centerLat = null;
      const from = String(args[i] || '').toUpperCase();
      if (from === 'FROMMEMBER') {
        const member = String(args[i + 1]);
        i += 2;
        const entry = this._ensureGeoEntry(key);
        if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
        const c = entry && entry.value.memberToCoord.get(member);
        if (!c) return [];
        centerLon = c[0]; centerLat = c[1];
      } else if (from === 'FROMLONLAT') {
        const lon = parseFloat(String(args[i + 1]));
        const lat = parseFloat(String(args[i + 2]));
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return encodeError("invalid longitude,latitude pair");
        centerLon = lon; centerLat = lat; i += 3;
      } else {
        return encodeError("syntax error");
      }
      const by = String(args[i] || '').toUpperCase();
      i += 1;
      let mode = null; let radius = null, width = null, height = null; let unitStr = null;
      if (by === 'BYRADIUS') {
        const r = parseFloat(String(args[i]));
        const u = this._geoNormalizeUnit(String(args[i + 1] || 'm'));
        if (!Number.isFinite(r) || r < 0 || !u) return encodeError("syntax error");
        radius = r * this._metersPerUnit(u); unitStr = u; mode = 'radius'; i += 2;
      } else if (by === 'BYBOX') {
        const w = parseFloat(String(args[i]));
        const h = parseFloat(String(args[i + 1]));
        const u = this._geoNormalizeUnit(String(args[i + 2] || 'm'));
        if (!Number.isFinite(w) || !Number.isFinite(h) || w < 0 || h < 0 || !u) return encodeError("syntax error");
        width = w * this._metersPerUnit(u); height = h * this._metersPerUnit(u); unitStr = u; mode = 'box'; i += 3;
      } else {
        return encodeError("syntax error");
      }
      let asc = false, desc = false, withdist = false; let count = Infinity;
      while (i < args.length) {
        const opt = String(args[i]).toUpperCase();
        if (opt === 'ASC') { asc = true; i += 1; continue; }
        if (opt === 'DESC') { desc = true; i += 1; continue; }
        if (opt === 'WITHDIST') { withdist = true; i += 1; continue; }
        if (opt === 'COUNT' && args[i + 1]) { const n = parseInt(String(args[i + 1]), 10); if (Number.isFinite(n) && n > 0) count = n; i += 2; continue; }
        break;
      }
      if (asc && desc) desc = false;
      const entry = this._ensureGeoEntry(key);
      if (entry === "WRONGTYPE") return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
      const map = entry ? entry.value.memberToCoord : new Map();
      const results = [];
      const centerLatRad = this._degToRad(centerLat);
      let minLon = -Infinity, maxLon = Infinity, minLat = -Infinity, maxLat = Infinity;
      if (mode === 'box') {
        const dLat = height / 111320;
        const dLon = width / (111320 * Math.max(Math.cos(centerLatRad), 1e-6));
        minLat = centerLat - dLat / 2; maxLat = centerLat + dLat / 2;
        minLon = centerLon - dLon / 2; maxLon = centerLon + dLon / 2;
      }
      for (const [member, [lon, lat]] of map.entries()) {
        if (mode === 'box') {
          if (lat < minLat || lat > maxLat) continue;
          if (lon < minLon || lon > maxLon) continue;
        }
        let distM = this._haversineMeters(centerLat, centerLon, lat, lon);
        if (mode === 'radius' && distM > radius) continue;
        const distUnit = distM / this._metersPerUnit(unitStr || 'm');
        results.push([member, distUnit]);
      }
      // GEOSEARCH defaults to ascending order (closest first) when no ASC/DESC specified
      results.sort((a, b) => (desc) ? (b[1] - a[1]) : (a[1] - b[1]));
      const limited = results.slice(0, count);
      return limited.map(([m, d]) => [String(m), Number(d)]);
    } catch (e) {
      return encodeError("syntax error");
    }
  }

  _geoEncodeHash(lat, lon) {
    // Redis-compatible geohash (50 bits precision, 11 chars total)
    const base32 = '0123456789bcdefghjkmnpqrstuvwxyz';
    let minLat = -90, maxLat = 90, minLon = -180, maxLon = 180;
    let hash = '';
    let isLon = true; // Start with longitude
    let bit = 0, ch = 0;

    // Process 50 bits (10 full characters)
    for (let i = 0; i < 50; i++) {
      if (isLon) {
        const mid = (minLon + maxLon) / 2;
        if (lon >= mid) {
          ch |= (1 << (4 - bit));
          minLon = mid;
        } else {
          maxLon = mid;
        }
      } else {
        const mid = (minLat + maxLat) / 2;
        if (lat >= mid) {
          ch |= (1 << (4 - bit));
          minLat = mid;
        } else {
          maxLat = mid;
        }
      }

      isLon = !isLon;
      bit++;

      if (bit === 5) {
        hash += base32[ch];
        bit = 0;
        ch = 0;
      }
    }

    // Pad to 11 characters with '0' (Redis standard)
    while (hash.length < 11) {
      hash += '0';
    }

    return hash;
  }
  
  _haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6372793.490855331; // meters (exact radius for Redis compatibility)
    const dLat = this._degToRad(lat2 - lat1);
    const dLon = this._degToRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(this._degToRad(lat1)) * Math.cos(this._degToRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  _degToRad(d) { return d * Math.PI / 180; }

  _geoNormalizeUnit(u) {
    const s = String(u || 'm').toLowerCase();
    if (s === 'm' || s === 'km' || s === 'mi' || s === 'ft') return s;
    return null;
  }

  _metersPerUnit(u) {
    switch (u) {
      case 'm': return 1;
      case 'km': return 1000;
      case 'mi': return 1609.340383398085; // Adjusted to match Redis output
      case 'ft': return 0.3048;
      default: return 1;
    }
  }

  // ---------- HyperLogLog (simple implementation) ----------

  _ensureHllEntry(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) return null;
    if (entry.type !== 'hll') return 'WRONGTYPE';
    return entry;
  }

  _getOrInitHll(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) {
      // m registers (p precision). Using p=14 => m=16384 similar to Redis default
      const p = 14;
      const m = 1 << p;
      const regs = new Uint8Array(m);
      const e = { type: 'hll', value: { p, m, regs } };
      this.kv.set(k, e);
      return e;
    }
    return entry;
  }

  _pfadd(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'PFADD'");
    const [key, ...elements] = args.map(String);
    const entry = this._getOrInitHll(key);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const { p, m, regs } = entry.value;
    let updated = 0;
    for (const el of elements) {
      const h = this._hllHash(el);
      const idx = h >>> (32 - p);
      const w = (h << p) | 0;
      const rho = this._hllRho(w, 32 - p);
      if (rho > regs[idx]) { regs[idx] = rho; updated = 1; }
    }
    return encodeInteger(updated);
  }

  _pfcount(args) {
    if (args.length < 1) return encodeError("wrong number of arguments for 'PFCOUNT'");
    if (args.length === 1) {
      const entry = this._ensureHllEntry(args[0]);
      if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
      if (!entry) return encodeInteger(0);
      const est = this._hllEstimate(entry.value.regs, entry.value.p);
      return encodeInteger(Math.round(est));
    }
    // Multiple keys: merge virtually and estimate
    let merged = null; let p = null; let m = null;
    for (const k of args) {
      const e = this._ensureHllEntry(k);
      if (e === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
      if (!e) continue;
      if (!merged) {
        merged = new Uint8Array(e.value.regs.length);
        for (let i = 0; i < e.value.regs.length; i++) merged[i] = e.value.regs[i];
        p = e.value.p; m = e.value.m;
      }
      else {
        if (e.value.p !== p) return encodeError("HLL precision mismatch");
        for (let i = 0; i < merged.length; i++) merged[i] = Math.max(merged[i], e.value.regs[i]);
      }
    }
    const est = merged ? this._hllEstimate(merged, p) : 0;
    return encodeInteger(Math.round(est));
  }

  _pfmerge(args) {
    if (args.length < 2) return encodeError("wrong number of arguments for 'PFMERGE'");
    const dest = String(args[0]);
    const sources = args.slice(1);
    let p = 14; let m = 1 << p; let merged = new Uint8Array(m);
    for (const k of sources) {
      const e = this._ensureHllEntry(k);
      if (e === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
      if (!e) continue;
      if (e.value.p !== p) { p = e.value.p; m = e.value.m; const n = new Uint8Array(m); for (let i = 0; i < Math.min(merged.length, n.length); i++) n[i] = merged[i]; merged = n; }
      for (let i = 0; i < merged.length; i++) merged[i] = Math.max(merged[i], e.value.regs[i]);
    }
    const destEntry = this._getOrInitHll(dest);
    if (destEntry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    destEntry.value.p = p; destEntry.value.m = m; destEntry.value.regs = merged;
    this.expires.delete(dest);
    return encodeSimpleString("OK");
  }

  _hllHash(s) {
    // 32-bit hash via murmur-like: use built-in hashing to bytes then take first 4 bytes of sha1 for simplicity
    const h = crypto.createHash('sha1').update(String(s)).digest();
    return (h[0] << 24) | (h[1] << 16) | (h[2] << 8) | (h[3] << 0);
  }

  _hllRho(w, max) {
    // position of first 1 bit starting from MSB+1 among "max" bits; min 1
    let rho = 1;
    for (let i = 0; i < max; i++) {
      if (((w >>> (31 - i)) & 1) === 1) break;
      rho++;
    }
    if (rho > 32) rho = 32;
    return rho;
  }

  _hllEstimate(regs, p) {
    const m = 1 << p;
    const alpha = this._hllAlpha(m);
    let sum = 0;
    let zeros = 0;
    for (let i = 0; i < regs.length; i++) {
      const r = regs[i];
      sum += 1 / (1 << r);
      if (r === 0) zeros++;
    }
    let E = alpha * m * m / sum;
    // small range correction
    if (E <= (5/2) * m && zeros > 0) {
      E = m * Math.log(m / zeros);
    }
    return E;
  }

  _hllAlpha(m) {
    switch (m) {
      case 16: return 0.673;
      case 32: return 0.697;
      case 64: return 0.709;
      default: return 0.7213 / (1 + 1.079 / m);
    }
  }

  // ---------- Time Series (simplified) ----------

  _ensureTsEntry(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) return null;
    if (entry.type !== 'timeseries') return 'WRONGTYPE';
    return entry;
  }

  _getOrInitTs(key) {
    const k = String(key);
    const entry = this._getEntry(k);
    if (!entry) {
      const e = { type: 'timeseries', value: { samples: [], retentionMs: null, rules: [] } }; // samples: [ [tsMs, valueStr], ... ]
      this.kv.set(k, e);
      return e;
    }
    return entry;
  }

  _tsCreate(args) {
    // TS.CREATE key [RETENTION retentionMs]
    if (args.length < 1) return encodeError("wrong number of arguments for 'TS.CREATE'");
    const key = String(args[0]);
    const entry = this._getOrInitTs(key);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    let i = 1;
    while (i < args.length) {
      const opt = String(args[i]).toUpperCase();
      if (opt === 'RETENTION' && args[i + 1]) {
        const ms = parseInt(String(args[i + 1]), 10);
        if (!Number.isFinite(ms) || ms < 0) return encodeError("value is not an integer or out of range");
        entry.value.retentionMs = ms;
        i += 2; continue;
      }
      return encodeError("syntax error");
    }
    this.expires.delete(key);
    return encodeSimpleString("OK");
  }

  _tsAdd(args) {
    // TS.ADD key timestamp value
    if (args.length !== 3) return encodeError("wrong number of arguments for 'TS.ADD'");
    const key = String(args[0]);
    let ts = String(args[1]);
    const value = String(args[2]);
    const entry = this._getOrInitTs(key);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (ts === '*') ts = String(this._now());
    const tsNum = parseInt(ts, 10);
    if (!Number.isFinite(tsNum)) return encodeError("value is not an integer or out of range");
    // ensure monotonic insert (append or replace if equal)
    const samples = entry.value.samples;
    if (samples.length > 0 && tsNum < samples[samples.length - 1][0]) return encodeError("TSDB: timestamp older than last sample");
    if (samples.length > 0 && tsNum === samples[samples.length - 1][0]) samples[samples.length - 1][1] = value; else samples.push([tsNum, value]);
    // retention purge
    const r = entry.value.retentionMs;
    if (r !== null && Number.isFinite(r) && r >= 0) {
      const cutoff = tsNum - r;
      let idx = 0;
      while (idx < samples.length && samples[idx][0] < cutoff) idx++;
      if (idx > 0) samples.splice(0, idx);
    }
    // apply downsampling rules if any
    this._tsApplyRules(key, tsNum, value);
    // Return timestamp as integer reply
    return encodeInteger(tsNum);
  }

  _tsCreateRule(args) {
    // TS.CREATERULE source dest AGGREGATION agg bucketMs
    if (args.length !== 5) return encodeError("wrong number of arguments for 'TS.CREATERULE'");
    const [source, dest, tok, aggRaw, bucketRaw] = args.map(String);
    if (tok.toUpperCase() !== 'AGGREGATION') return encodeError('syntax error');
    const agg = String(aggRaw).toLowerCase();
    if (!['avg','sum','min','max'].includes(agg)) return encodeError('syntax error');
    const bucketMs = parseInt(bucketRaw, 10);
    if (!Number.isFinite(bucketMs) || bucketMs <= 0) return encodeError("value is not an integer or out of range");
    const src = this._getOrInitTs(source);
    if (src === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    const dst = this._getOrInitTs(dest);
    if (dst === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!Array.isArray(src.value.rules)) src.value.rules = [];
    // avoid duplicates
    for (const r of src.value.rules) {
      if (r.dest === String(dest) && r.agg === agg && r.bucketMs === bucketMs) return encodeSimpleString('OK');
    }
    src.value.rules.push({ dest: String(dest), agg, bucketMs, state: new Map() });
    return encodeSimpleString('OK');
  }

  _tsDeleteRule(args) {
    // TS.DELETERULE source dest
    if (args.length !== 2) return encodeError("wrong number of arguments for 'TS.DELETERULE'");
    const [source, dest] = args.map(String);
    const src = this._ensureTsEntry(source);
    if (src === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!src || !Array.isArray(src.value.rules)) return encodeInteger(0);
    const before = src.value.rules.length;
    src.value.rules = src.value.rules.filter((r) => r.dest !== String(dest));
    return encodeInteger(before - src.value.rules.length);
  }

  _tsApplyRules(sourceKey, tsNum, valueStr) {
    // Called after TS.ADD on sourceKey
    const src = this._ensureTsEntry(sourceKey);
    if (!src || src === 'WRONGTYPE') return;
    const rules = src.value.rules || [];
    if (rules.length === 0) return;
    const valNum = parseFloat(String(valueStr));
    if (!Number.isFinite(valNum)) return;
    for (const rule of rules) {
      const bucketStart = Math.floor(tsNum / rule.bucketMs) * rule.bucketMs;
      if (!rule.state) rule.state = new Map();
      let st = rule.state.get(bucketStart);
      if (!st) { st = { sum: 0, count: 0, min: Infinity, max: -Infinity }; rule.state.set(bucketStart, st); }
      st.sum += valNum; st.count += 1; if (valNum < st.min) st.min = valNum; if (valNum > st.max) st.max = valNum;
      let outVal;
      switch (rule.agg) {
        case 'sum': outVal = st.sum; break;
        case 'min': outVal = st.min; break;
        case 'max': outVal = st.max; break;
        case 'avg': default: outVal = st.sum / st.count; break;
      }
      const dst = this._getOrInitTs(rule.dest);
      if (dst === 'WRONGTYPE') continue;
      const arr = dst.value.samples;
      if (arr.length > 0 && arr[arr.length - 1][0] === bucketStart) {
        arr[arr.length - 1][1] = String(outVal);
      } else {
        arr.push([bucketStart, String(outVal)]);
      }
    }
  }

  _tsRange(args) {
    // TS.RANGE key from to [AGGREGATION avg|sum|min|max bucketMs]
    if (args.length < 3) return encodeError("wrong number of arguments for 'TS.RANGE'");
    const key = String(args[0]);
    const fromStr = String(args[1]);
    const toStr = String(args[2]);
    const entry = this._ensureTsEntry(key);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry) return encodeArrayOfBulkStrings([]);
    const samples = entry.value.samples;
    const from = fromStr === '-' ? -Infinity : parseInt(fromStr, 10);
    const to = toStr === '+' ? Infinity : parseInt(toStr, 10);
    if (!Number.isFinite(from) && from !== -Infinity) return encodeError("value is not an integer or out of range");
    if (!Number.isFinite(to) && to !== Infinity) return encodeError("value is not an integer or out of range");
    let i = 3; let agg = null; let bucketMs = null;
    while (i < args.length) {
      const opt = String(args[i]).toUpperCase();
      if (opt === 'AGGREGATION' && args[i + 1] && args[i + 2]) {
        const a = String(args[i + 1]).toLowerCase();
        if (!['avg','sum','min','max'].includes(a)) return encodeError("syntax error");
        const b = parseInt(String(args[i + 2]), 10);
        if (!Number.isFinite(b) || b <= 0) return encodeError("value is not an integer or out of range");
        agg = a; bucketMs = b; i += 3; continue;
      }
      return encodeError("syntax error");
    }
    if (!agg) {
      // raw
      const rows = [];
      for (const [t, v] of samples) {
        if (t < from || t > to) continue;
        rows.push([t, String(v)]);
      }
      let out = `*${rows.length}\r\n`;
      for (const [t, v] of rows) {
        out += `*2\r\n`;
        out += encodeInteger(t);
        // value as integer if numeric integer, otherwise bulk string
        if (/^-?\d+$/.test(v)) out += encodeInteger(parseInt(v, 10)); else out += encodeBulkString(v);
      }
      return out;
    }
    // aggregated buckets
    const buckets = new Map(); // bucketStart -> array of numeric values
    for (const [t, v] of samples) {
      if (t < from || t > to) continue;
      const bucketStart = Math.floor((t - from) / bucketMs) * bucketMs + from;
      if (!buckets.has(bucketStart)) buckets.set(bucketStart, []);
      const num = parseFloat(String(v)); if (!Number.isFinite(num)) continue;
      buckets.get(bucketStart).push(num);
    }
    const sortedStarts = Array.from(buckets.keys()).sort((a, b) => a - b);
    const rows = [];
    for (const start of sortedStarts) {
      const arr = buckets.get(start);
      if (!arr || arr.length === 0) continue;
      let val;
      if (agg === 'sum') val = arr.reduce((s, x) => s + x, 0);
      else if (agg === 'avg') val = arr.reduce((s, x) => s + x, 0) / arr.length;
      else if (agg === 'min') val = Math.min(...arr);
      else if (agg === 'max') val = Math.max(...arr);
      rows.push([start, String(val)]);
    }
    let out = `*${rows.length}\r\n`;
    for (const [t, v] of rows) {
      out += `*2\r\n`;
      out += encodeInteger(t);
      if (/^-?\d+$/.test(v)) out += encodeInteger(parseInt(v, 10)); else out += encodeBulkString(v);
    }
    return out;
  }

  _tsGet(args) {
    // TS.GET key
    if (args.length !== 1) return encodeError("wrong number of arguments for 'TS.GET'");
    const key = String(args[0]);
    const entry = this._ensureTsEntry(key);
    if (entry === 'WRONGTYPE') return encodeError("WRONGTYPE Operation against a key holding the wrong kind of value");
    if (!entry || entry.value.samples.length === 0) return encodeBulkString(null);
    const [t, v] = entry.value.samples[entry.value.samples.length - 1];
    // Return array of two integers when possible (timestamp always integer)
    let out = `*2\r\n`;
    out += encodeInteger(t);
    const vStr = String(v);
    if (/^-?\d+$/.test(vStr)) out += encodeInteger(parseInt(vStr, 10)); else out += encodeBulkString(vStr);
    return out;
  }

}

// Minimal HNSW-inspired structure (placeholder, approximate via random subset)
class HnswIndex {
  constructor(metric = 'euclidean', m = 8, ef = 64) {
    this.metric = metric;
    this.m = m;
    this.ef = ef;
    this.nodes = new Map(); // id -> { vector, level }
    this.neighbors = new Map(); // id -> Map<level, Set<id>>
    this.enterpoint = null;
    this.maxLevel = -1;
  }

  rebuild(idToVector) {
    this.nodes.clear();
    this.neighbors.clear();
    this.enterpoint = null;
    this.maxLevel = -1;
    for (const [id, vec] of idToVector.entries()) this.insert(id, vec);
  }

  insert(id, vec) {
    const nodeId = String(id);
    const level = this._randomLevel();
    this.nodes.set(nodeId, { vector: vec.slice(), level });
    if (!this.neighbors.has(nodeId)) this.neighbors.set(nodeId, new Map());
    for (let l = 0; l <= level; l++) {
      if (!this.neighbors.get(nodeId).has(l)) this.neighbors.get(nodeId).set(l, new Set());
    }
    if (this.enterpoint === null) {
      this.enterpoint = nodeId;
      this.maxLevel = level;
      return;
    }
    let ep = this.enterpoint;
    // Greedy search from top layer down to level+1
    for (let l = this.maxLevel; l > level; l--) {
      ep = this._greedySearch(vec, ep, l);
    }
    // For each layer <= level, do efConstruction search and connect M nearest
    for (let l = Math.min(level, this.maxLevel); l >= 0; l--) {
      const candidates = this._searchLayer(vec, ep, l, this.ef);
      const selected = candidates.slice(0, this.m); // already sorted by distance
      this._connectNeighbors(nodeId, vec, selected, l);
    }
    // Possibly update enterpoint
    if (level > this.maxLevel) {
      this.maxLevel = level;
      this.enterpoint = nodeId;
    }
  }

  approximateCandidates(queryVec, opts) {
    if (this.enterpoint === null) return [];
    const efSearch = (opts && Number.isFinite(opts.ef)) ? opts.ef : this.ef;
    let ep = this.enterpoint;
    for (let l = this.maxLevel; l > 0; l--) {
      ep = this._greedySearch(queryVec, ep, l);
    }
    const res = this._searchLayer(queryVec, ep, 0, efSearch);
    // Convert to [id, vec]
    return res.map(([id]) => [id, this.nodes.get(id).vector]);
  }

  _distance(a, b) {
    if (this.metric === 'cosine') {
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) { const x = a[i], y = b[i]; dot += x * y; na += x * x; nb += y * y; }
      const denom = Math.sqrt(na) * Math.sqrt(nb);
      if (denom === 0) return 1;
      return 1 - (dot / denom);
    }
    // euclidean
    let s = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s);
  }

  _greedySearch(q, epId, level) {
    let curr = epId;
    let improved = true;
    while (improved) {
      improved = false;
      const nb = this.neighbors.get(curr)?.get(level);
      if (!nb || nb.size === 0) break;
      let best = curr;
      let bestDist = this._distance(q, this.nodes.get(curr).vector);
      for (const n of nb) {
        const d = this._distance(q, this.nodes.get(n).vector);
        if (d < bestDist) { bestDist = d; best = n; improved = true; }
      }
      curr = best;
    }
    return curr;
  }

  _searchLayer(q, epId, level, ef) {
    // Return array of [id, distance] sorted by distance asc, length up to ef
    const visited = new Set([epId]);
    const results = [];
    const candidates = [];
    const pushResult = (id, d) => {
      results.push([id, d]);
      results.sort((a, b) => a[1] - b[1]);
      if (results.length > ef) results.pop();
    };
    const pushCandidate = (id, d) => {
      candidates.push([id, d]);
      candidates.sort((a, b) => a[1] - b[1]);
    };
    const epDist = this._distance(q, this.nodes.get(epId).vector);
    pushResult(epId, epDist);
    pushCandidate(epId, epDist);
    while (candidates.length > 0) {
      const [cid, cd] = candidates.shift();
      const worst = results.length === 0 ? Infinity : results[results.length - 1][1];
      if (cd > worst && results.length >= ef) break;
      const nb = this.neighbors.get(cid)?.get(level) || new Set();
      for (const n of nb) {
        if (visited.has(n)) continue;
        visited.add(n);
        const d = this._distance(q, this.nodes.get(n).vector);
        // update candidate list
        pushCandidate(n, d);
        // update results
        if (results.length < ef || d < worst) pushResult(n, d);
      }
    }
    return results;
  }

  _connectNeighbors(id, vec, selected, level) {
    const set = this.neighbors.get(id).get(level);
    for (const [nid] of selected) {
      set.add(nid);
      // symmetric link
      if (!this.neighbors.get(nid).has(level)) this.neighbors.get(nid).set(level, new Set());
      const nset = this.neighbors.get(nid).get(level);
      nset.add(id);
      // prune neighbor to M nearest
      if (nset.size > this.m) {
        const arr = Array.from(nset).map((x) => [x, this._distance(this.nodes.get(nid).vector, this.nodes.get(x).vector)]);
        arr.sort((a, b) => a[1] - b[1]);
        const keep = new Set(arr.slice(0, this.m).map(([x]) => x));
        for (const x of nset) if (!keep.has(x)) nset.delete(x);
      }
    }
    // prune subject's neighbors too
    if (set.size > this.m) {
      const arr = Array.from(set).map((x) => [x, this._distance(vec, this.nodes.get(x).vector)]);
      arr.sort((a, b) => a[1] - b[1]);
      const keep = new Set(arr.slice(0, this.m).map(([x]) => x));
      for (const x of set) if (!keep.has(x)) set.delete(x);
    }
  }

  _randomLevel() {
    const p = 1 / Math.E; // typical ~0.367
    let lvl = 0;
    while (Math.random() < p && lvl < 16) lvl++;
    return lvl;
  }
}

// Simple Cuckoo Filter implementation
class CuckooFilter {
  constructor(capacity = 1024, bucketSize = 4, maxIterations = 500) {
    // round capacity to next power of two buckets
    this.bucketSize = bucketSize;
    this.maxIterations = maxIterations;
    const buckets = 1 << Math.ceil(Math.log2(Math.max(1, Math.floor(capacity / bucketSize))));
    this.numBuckets = buckets;
    this.buckets = Array.from({ length: buckets }, () => []);
  }
  _hash(item) {
    const s = String(item);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  _fingerprint(item) {
    const h = this._hash(item);
    const fp = ((h ^ (h >>> 16)) & 0xff) || 1; // 8-bit non-zero fingerprint
    return fp;
  }
  _index(h) {
    return h & (this.numBuckets - 1);
  }
  _altIndex(i1, fp) {
    const hfp = this._hash(fp);
    return this._index(i1 ^ hfp);
  }
  add(item) {
    const fp = this._fingerprint(item);
    let i1 = this._index(this._hash(item));
    let i2 = this._altIndex(i1, fp);
    if (this._insertInto(i1, fp)) return true;
    if (this._insertInto(i2, fp)) return true;
    // kick-out loop
    let i = Math.random() < 0.5 ? i1 : i2;
    let f = fp;
    for (let n = 0; n < this.maxIterations; n++) {
      const bucket = this.buckets[i];
      const idx = Math.floor(Math.random() * bucket.length);
      const victim = bucket[idx];
      bucket[idx] = f;
      f = victim;
      i = this._altIndex(i, f);
      if (this._insertInto(i, f)) return true;
    }
    return false;
  }
  _insertInto(i, fp) {
    const bucket = this.buckets[i];
    if (bucket.length < this.bucketSize) { bucket.push(fp); return true; }
    return false;
  }
  exists(item) {
    const fp = this._fingerprint(item);
    const i1 = this._index(this._hash(item));
    const i2 = this._altIndex(i1, fp);
    return this.buckets[i1].includes(fp) || this.buckets[i2].includes(fp);
  }
  delete(item) {
    const fp = this._fingerprint(item);
    const i1 = this._index(this._hash(item));
    const i2 = this._altIndex(i1, fp);
    const b1 = this.buckets[i1];
    const j1 = b1.indexOf(fp);
    if (j1 !== -1) { b1.splice(j1, 1); return true; }
    const b2 = this.buckets[i2];
    const j2 = b2.indexOf(fp);
    if (j2 !== -1) { b2.splice(j2, 1); return true; }
    return false;
  }
}

module.exports = { DataStore };


