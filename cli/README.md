# Redis Clone JS CLI

A powerful command-line interface for Redis Clone JS that provides all the functionality you need to interact with your Redis server.

## 🚀 Quick Start

### Interactive Mode
```bash
# Start interactive shell
node cli/redis-cli.js

# Connect to specific host/port
node cli/redis-cli.js --host 192.168.1.100 --port 6380
```

### Batch Execution
```bash
# Execute single command
node cli/redis-cli.js --execute "SET mykey 'Hello World'"

# Execute multiple commands
node cli/redis-cli.js --execute "SET counter 1; INCR counter; GET counter"

# Execute commands from file
node cli/redis-cli.js --batch examples/setup.redis
```

## 📋 Command Line Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--host` | `-h` | Server hostname | 127.0.0.1 |
| `--port` | `-p` | Server port | 6379 |
| `--format` | `-f` | Output format (pretty, json, raw, table) | pretty |
| `--verbose` | `-v` | Verbose output with timing | false |
| `--execute` | `-x` | Execute commands separated by semicolons | - |
| `--batch` | `-b` | Execute commands from file | - |
| `--no-interactive` | | Disable interactive mode | false |
| `--help` | | Show help message | - |
| `--version` | | Show version | - |

## 🎨 Output Formats

### Pretty (Default)
```bash
redis-cli> GET mykey
"Hello World"

redis-cli> LRANGE mylist 0 -1
1) "item1"
2) "item2"
3) "item3"
```

### JSON
```bash
node cli/redis-cli.js --format json --execute "GET mykey"
{
  "result": "Hello World",
  "executionTime": 1.23,
  "command": "GET mykey"
}
```

### Raw
```bash
node cli/redis-cli.js --format raw --execute "GET mykey"
Hello World
```

### Table
```bash
node cli/redis-cli.js --format table --execute "LRANGE mylist 0 -1"
┌───────┬───────┐
│ Index │ Value │
├───────┼───────┤
│     1 │ item1 │
│     2 │ item2 │
│     3 │ item3 │
└───────┴───────┘
```

## 🖥️ Interactive Shell Features

### Command Auto-Completion
- Press `TAB` to auto-complete Redis commands
- Context-aware completion for command arguments
- All Redis commands are supported

### Command History
- Use `↑` and `↓` arrows to navigate command history
- History is persistent across sessions
- Type `history` to view recent commands

### Multi-line Commands
```
redis-cli> LPUSH mylist item1 \
... item2 \
... item3
(integer) 3
```

### Built-in Commands
- `help` - Show help information
- `clear` - Clear the screen
- `history` - Show command history
- `status` - Show connection status
- `exit` or `quit` - Exit the CLI

## 📁 Batch Files

Create `.redis` files with Redis commands:

```bash
# setup.redis
SET app:name "My Redis App"
SET app:version "1.0.0"
LPUSH app:features "fast"
LPUSH app:features "reliable"
LPUSH app:features "scalable"

# Check configuration
GET app:name
GET app:version
LRANGE app:features 0 -1
```

Execute with:
```bash
node cli/redis-cli.js --batch setup.redis
```

## 🔧 Examples

### Basic Operations
```bash
# String operations
node cli/redis-cli.js --execute "SET greeting 'Hello Redis!'; GET greeting"

# List operations
node cli/redis-cli.js --execute "LPUSH tasks task1 task2; LRANGE tasks 0 -1"

# Hash operations
node cli/redis-cli.js --execute "HSET user:1 name John email john@example.com; HGETALL user:1"
```

### Performance Testing
```bash
# Verbose mode with timing
node cli/redis-cli.js --verbose --execute "SET perf:test value; GET perf:test"

# Batch performance test
node cli/redis-cli.js --batch cli/performance-test.redis --verbose
```

### Different Output Formats
```bash
# JSON output for scripting
node cli/redis-cli.js --format json --execute "INFO server" > server-info.json

# Raw output for parsing
node cli/redis-cli.js --format raw --execute "KEYS *" | wc -l

# Table format for readability
node cli/redis-cli.js --format table --execute "LRANGE logs 0 10"
```

## 🎯 NPM Scripts

Use predefined npm scripts for common tasks:

```bash
# Start interactive CLI
npm run cli

# Show help
npm run cli:help

# Custom commands
npm run cli -- --host 192.168.1.100 --port 6380
npm run cli -- --batch my-commands.redis
npm run cli -- --execute "PING"
```

## 🔌 Connection Management

The CLI handles connections gracefully:

- **Auto-connect**: Connects automatically when needed
- **Error handling**: Shows clear error messages for connection issues
- **Timeout management**: Commands timeout after 5 seconds
- **Graceful shutdown**: Proper cleanup on exit

## 🛠️ Troubleshooting

### Connection Issues
```bash
# Test connection
node cli/redis-cli.js --execute "PING"

# Check server status
node cli/redis-cli.js --verbose --execute "INFO server"
```

### Command Errors
```bash
# Enable verbose mode for detailed error messages
node cli/redis-cli.js --verbose --execute "YOUR_COMMAND"
```

### Batch File Issues
```bash
# Test batch file syntax
node cli/redis-cli.js --verbose --batch your-file.redis
```

## 📝 Tips

1. **Use TAB completion** - Makes typing commands faster and reduces errors
2. **Enable verbose mode** - Helpful for debugging and performance analysis
3. **Save common commands** - Create batch files for repetitive tasks
4. **Use appropriate formats** - JSON for scripts, table for readability
5. **Check connection first** - Always test with `PING` when troubleshooting

## 🎉 Success!

Your Redis Clone JS CLI is now ready for production use! 🚀
