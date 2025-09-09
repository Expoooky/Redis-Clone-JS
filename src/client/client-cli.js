"use strict";

const net = require("net");
const readline = require("readline");
const { encodeArrayOfBulkStrings, CommandParser } = require("../core/protocol");

function sendEval(host, port, args) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      const payload = encodeArrayOfBulkStrings(args);
      socket.write(payload);
    });
    const parser = new CommandParser();
    socket.on("data", (chunk) => {
      const messages = parser.feed(chunk);
      if (messages.length > 0) {
        const first = messages[0];
        socket.end();
        resolve(renderNode(first));
      }
    });
    socket.on("error", reject);
  });
}

function renderNode(node) {
  if (!node) return "(nil)";
  return renderLines(node, 0).join("\n");
}

function escapeForDisplay(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 0x22) { // "
      out += '\\"';
    } else if (code === 0x5C) { // \
      out += '\\\\';
    } else if (code === 0x0A) { // \n
      out += '\\n';
    } else if (code === 0x0D) { // \r
      out += '\\r';
    } else if (code === 0x09) { // \t
      out += '\\t';
    } else if (code < 0x20 || code === 0x7F) { // control chars
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else if (code >= 0x80 && code <= 0xFF) {
      out += `\\x${code.toString(16).padStart(2, '0')}`;
    } else {
      out += str[i];
    }
  }
  return out;
}

function renderLines(node, depth) {
  const indent = '    '.repeat(depth);
  if (!node) return [indent + "(nil)"];
  switch (node.type) {
    case "simple":
      return [indent + `${node.value}`];
    case "error":
      return [indent + `(error) ${node.message}`];
    case "integer":
      return [indent + `(integer) ${node.value}`];
    case "bulk":
      return [indent + (node.value === null ? "(nil)" : `"${escapeForDisplay(node.value)}` + `"`)];
    case "array": {
      if (node.value === null) return [indent + "(nil)"];
      if (Array.isArray(node.value) && node.value.length === 0) return [indent + "(empty array)"];
      const lines = [];
      for (let i = 0; i < node.value.length; i++) {
        const child = node.value[i];
        const prefix = `${indent}${i + 1}) `;
        if (child && child.type === 'array') {
          const childLines = renderLines(child, 0); // render without indent, we will align
          if (childLines.length > 0) {
            lines.push(prefix + childLines[0]);
            const pad = ' '.repeat(prefix.length);
            for (let j = 1; j < childLines.length; j++) {
              lines.push(pad + childLines[j]);
            }
          } else {
            lines.push(prefix + "(nil)");
          }
        } else {
          const renderedChild = renderLines(child, 0)[0];
          lines.push(prefix + renderedChild);
        }
      }
      return lines;
    }
    default:
      return [indent + JSON.stringify(node)];
  }
}

async function runInteractive(host = "127.0.0.1", port = 6379) {
  const socket = net.createConnection({ host, port });
  const parser = new CommandParser();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: `${host}:${port}> ` });
  rl.prompt();

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      rl.prompt();
      return;
    }
    const args = splitArgs(trimmed);
    const payload = encodeArrayOfBulkStrings(args);
    socket.write(payload);
  });

  socket.on("data", (chunk) => {
    const messages = parser.feed(chunk);
    for (const msg of messages) {
      console.log(renderNode(msg));
    }
    rl.prompt();
  });

  socket.on("end", () => {
    console.log("Connection closed");
    rl.close();
  });

  socket.on("error", (err) => {
    console.error("Connection error:", err.message);
    rl.close();
  });
}

function splitArgs(input) {
  // Simple shell-like splitting supporting quoted strings
  const result = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && i + 1 < input.length) {
        // Handle escape sequences inside quotes
        i += 1;
        const nextCh = input[i];
        if (nextCh === 'x' && i + 2 < input.length) {
          // Hex escape sequence \xNN
          const hex = input.slice(i + 1, i + 3);
          if (/^[0-9a-fA-F]{2}$/.test(hex)) {
            current += String.fromCharCode(parseInt(hex, 16));
            i += 2; // Skip the two hex digits
          } else {
            current += nextCh; // Not a valid hex escape, treat as literal
          }
        } else if (nextCh === 'n') {
          current += '\n';
        } else if (nextCh === 'r') {
          current += '\r';
        } else if (nextCh === 't') {
          current += '\t';
        } else if (nextCh === '\\') {
          current += '\\';
        } else if (nextCh === quote) {
          current += quote;
        } else {
          current += nextCh; // Other escapes, treat literally
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === " ") {
        if (current.length > 0) {
          result.push(current);
          current = "";
        }
      } else {
        current += ch;
      }
    }
  }
  if (current.length > 0) result.push(current);
  return result;
}

async function main() {
  const host = process.env.HOST || "127.0.0.1";
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 6379;

  const args = process.argv.slice(2);
  const evalIdx = args.indexOf("--eval");
  if (evalIdx !== -1) {
    const cmdArgs = args.slice(evalIdx + 1);
    const output = await sendEval(host, port, cmdArgs);
    console.log(output);
    return;
  }

  await runInteractive(host, port);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runInteractive, sendEval };


