"use strict";

const fs = require("fs");
const path = require("path");
const { CommandParser, arrayNodeToStringArray, encodeArrayOfBulkStrings } = require("../core/protocol");

class AppendOnlyFile {
  constructor(filePath) {
    this.filePath = filePath || path.resolve(process.cwd(), "aof.log");
    this._ensureDirExists(path.dirname(this.filePath));
  }

  _ensureDirExists(dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }

  async appendCommand(args) {
    const payload = encodeArrayOfBulkStrings(args);
    await fs.promises.appendFile(this.filePath, payload, "utf8");
  }

  async loadAndReplay(executor) {
    if (!fs.existsSync(this.filePath)) return;
    await new Promise((resolve, reject) => {
      const parser = new CommandParser();
      const stream = fs.createReadStream(this.filePath);
      stream.on("data", (chunk) => {
        try {
          const messages = parser.feed(chunk);
          for (const node of messages) {
            const arr = arrayNodeToStringArray(node);
            if (!arr || arr.length === 0) continue;
            const [cmd, ...args] = arr;
            executor(cmd, args);
          }
        } catch (err) {
          reject(err);
        }
      });
      stream.on("end", resolve);
      stream.on("error", reject);
    });
  }
}

module.exports = { AppendOnlyFile };


