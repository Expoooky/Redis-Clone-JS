"use strict";

const CRLF = "\r\n";

function encodeSimpleString(value) {
  return `+${value}${CRLF}`;
}

function encodeError(message) {
  return `-ERR ${message}${CRLF}`;
}

function encodeInteger(num) {
  if (!Number.isInteger(num)) {
    throw new Error("encodeInteger expects an integer");
  }
  return `:${num}${CRLF}`;
}

function encodeBulkString(value) {
  if (value === null || value === undefined) {
    return `$-1${CRLF}`;
  }
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  return `$${buf.length}${CRLF}${buf.toString("utf8")}${CRLF}`;
}

function encodeArrayOfBulkStrings(arr) {
  if (!Array.isArray(arr)) {
    throw new Error("encodeArrayOfBulkStrings expects an array");
  }
  let out = `*${arr.length}${CRLF}`;
  for (const item of arr) {
    out += encodeBulkString(item);
  }
  return out;
}

class CommandParser {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  feed(data) {
    if (typeof data === "string") {
      this.buffer = Buffer.concat([this.buffer, Buffer.from(data, "utf8")]);
    } else if (Buffer.isBuffer(data)) {
      this.buffer = Buffer.concat([this.buffer, data]);
    } else {
      throw new Error("feed expects a Buffer or string");
    }

    const messages = [];
    while (true) {
      const { node, bytesConsumed } = this._parseNext(0);
      if (bytesConsumed === 0) break;
      messages.push(node);
      this.buffer = this.buffer.slice(bytesConsumed);
    }
    return messages;
  }

  _parseNext(offset) {
    if (this.buffer.length === 0) return { node: null, bytesConsumed: 0 };
    const prefix = this.buffer[offset];
    if (prefix === 0x2b) { // '+' Simple String
      return this._parseSimpleString(offset);
    } else if (prefix === 0x2d) { // '-' Error
      return this._parseError(offset);
    } else if (prefix === 0x24) { // '$' Bulk String
      return this._parseBulkString(offset);
    } else if (prefix === 0x2a) { // '*' Array
      return this._parseArray(offset);
    } else if (prefix === 0x3a) { // ':' Integer
      return this._parseInteger(offset);
    } else {
      // Attempt to read a line and report a protocol error
      const line = this._readLine(offset);
      if (!line) return { node: null, bytesConsumed: 0 };
      return {
        node: { type: "error", message: `Protocol error: unknown prefix '${String.fromCharCode(prefix)}'` },
        bytesConsumed: this._lineLength(offset)
      };
    }
  }

  _readLine(offset) {
    const idx = this._indexOfCrlf(offset);
    if (idx === -1) return null;
    return this.buffer.slice(offset, idx).toString("utf8");
  }

  _lineLength(offset) {
    const idx = this._indexOfCrlf(offset);
    if (idx === -1) return 0;
    return (idx - offset) + 2; // include CRLF
  }

  _indexOfCrlf(offset) {
    for (let i = offset; i < this.buffer.length - 1; i++) {
      if (this.buffer[i] === 0x0d && this.buffer[i + 1] === 0x0a) {
        return i;
      }
    }
    return -1;
  }

  _parseSimpleString(offset) {
    // +OK\r\n
    if (this.buffer[offset] !== 0x2b) return { node: null, bytesConsumed: 0 };
    const line = this._readLine(offset + 1);
    if (line === null) return { node: null, bytesConsumed: 0 };
    const bytes = this._lineLength(offset + 1) + 1;
    return { node: { type: "simple", value: line }, bytesConsumed: bytes };
  }

  _parseError(offset) {
    if (this.buffer[offset] !== 0x2d) return { node: null, bytesConsumed: 0 };
    const line = this._readLine(offset + 1);
    if (line === null) return { node: null, bytesConsumed: 0 };
    const bytes = this._lineLength(offset + 1) + 1;
    // Line could be "ERR message" or just message
    const message = line.startsWith("ERR ") ? line.slice(4) : line;
    return { node: { type: "error", message }, bytesConsumed: bytes };
  }

  _parseInteger(offset) {
    if (this.buffer[offset] !== 0x3a) return { node: null, bytesConsumed: 0 };
    const line = this._readLine(offset + 1);
    if (line === null) return { node: null, bytesConsumed: 0 };
    const num = parseInt(line, 10);
    if (!Number.isFinite(num)) {
      return { node: { type: "error", message: "Protocol error: invalid integer" }, bytesConsumed: this._lineLength(offset + 1) + 1 };
    }
    const bytes = this._lineLength(offset + 1) + 1;
    return { node: { type: "integer", value: num }, bytesConsumed: bytes };
  }

  _parseBulkString(offset) {
    if (this.buffer[offset] !== 0x24) return { node: null, bytesConsumed: 0 };
    const line = this._readLine(offset + 1);
    if (line === null) return { node: null, bytesConsumed: 0 };
    const len = parseInt(line, 10);
    if (!Number.isFinite(len)) {
      return { node: { type: "error", message: "Protocol error: invalid bulk length" }, bytesConsumed: this._lineLength(offset + 1) + 1 };
    }
    const headerBytes = this._lineLength(offset + 1) + 1; // '$' + len + CRLF
    if (len === -1) {
      return { node: { type: "bulk", value: null }, bytesConsumed: headerBytes };
    }
    const needed = headerBytes + len + 2; // include content and trailing CRLF
    if (this.buffer.length - offset < needed) {
      return { node: null, bytesConsumed: 0 };
    }
    const start = offset + headerBytes;
    const content = this.buffer.slice(start, start + len).toString("utf8");
    return { node: { type: "bulk", value: content }, bytesConsumed: needed };
  }

  _parseArray(offset) {
    if (this.buffer[offset] !== 0x2a) return { node: null, bytesConsumed: 0 };
    const line = this._readLine(offset + 1);
    if (line === null) return { node: null, bytesConsumed: 0 };
    const count = parseInt(line, 10);
    if (!Number.isFinite(count)) {
      return { node: { type: "error", message: "Protocol error: invalid array length" }, bytesConsumed: this._lineLength(offset + 1) + 1 };
    }
    const headerBytes = this._lineLength(offset + 1) + 1;
    if (count === -1) {
      return { node: { type: "array", value: null }, bytesConsumed: headerBytes };
    }
    let consumed = offset + headerBytes;
    const items = [];
    for (let i = 0; i < count; i++) {
      const { node, bytesConsumed } = this._parseNext(consumed);
      if (bytesConsumed === 0) {
        return { node: null, bytesConsumed: 0 };
      }
      items.push(node);
      consumed += bytesConsumed;
    }
    return { node: { type: "array", value: items }, bytesConsumed: consumed - offset };
  }
}

function isArrayOfBulkStrings(node) {
  if (!node || node.type !== "array" || !Array.isArray(node.value)) return false;
  return node.value.every((item) => item && item.type === "bulk");
}

function arrayNodeToStringArray(node) {
  if (!isArrayOfBulkStrings(node)) return null;
  return node.value.map((it) => (it.value === null ? null : String(it.value)));
}

module.exports = {
  CRLF,
  CommandParser,
  encodeSimpleString,
  encodeError,
  encodeInteger,
  encodeBulkString,
  encodeArrayOfBulkStrings,
  isArrayOfBulkStrings,
  arrayNodeToStringArray
};


