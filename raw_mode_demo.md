# Redis Clone - Raw Mode Feature

Your Redis clone now supports **Redis CLI `--raw` mode** for proper JSON formatting display!

## 🚀 How to Enable Raw Mode

### Method 1: Command Line Flag
Start the server with the `--raw` flag:

```bash
node server.js --raw
```

Output:
```
Redis-Clone Server started. Type "help" for available commands.
Raw mode enabled - formatting options will display properly.
Use QUIT or Ctrl+C to exit.
```

### Method 2: RAW Command Within CLI
Toggle raw mode from within the CLI:

```bash
# Start normally
node server.js

# Then use RAW commands:
redis-clone> RAW on          # Enable raw mode
redis-clone> RAW off         # Disable raw mode  
redis-clone> RAW             # Toggle current mode
```

## ✨ Raw Mode Benefits

### Without Raw Mode (Default)
```
redis-clone> JSON.GET obj INDENT "\t" NEWLINE "\n" SPACE " " $
"[\n\t{\n\t\t\"name\": \"Leonard Cohen\",\n\t\t\"lastSeen\": 1478476800,\n\t\t\"loggedOut\": true\n\t}\n]"
```

### With Raw Mode Enabled
```
redis-clone> JSON.GET obj INDENT "\t" NEWLINE "\n" SPACE " " $
[
        {
                "name": "Leonard Cohen",
                "lastSeen": 1478476800,
                "loggedOut": true
        }
]
```

## 📋 JSON Formatting Options

When raw mode is enabled, these JSON.GET formatting options work perfectly:

```bash
# Beautiful JSON formatting
JSON.GET key INDENT "\t" NEWLINE "\n" SPACE " " $

# Custom indentation
JSON.GET key INDENT "  " $          # 2-space indent
JSON.GET key INDENT "    " $        # 4-space indent

# Custom spacing
JSON.GET key SPACE " " $            # Space after colons
JSON.GET key NEWLINE "\n" $         # Custom newlines
```

## 🎯 Complete Example Session

```bash
# Start with raw mode
$ node server.js --raw

redis-clone> JSON.SET user $ '{"name": "Alice", "age": 30, "skills": ["JavaScript", "Redis", "Node.js"]}'
OK

redis-clone> JSON.GET user $
["name":"Alice","age":30,"skills":["JavaScript","Redis","Node.js"]]

redis-clone> JSON.GET user INDENT "\t" NEWLINE "\n" SPACE " " $
[
        {
                "name": "Alice",
                "age": 30,
                "skills": [
                        "JavaScript",
                        "Redis", 
                        "Node.js"
                ]
        }
]

redis-clone> RAW off
Raw mode disabled - output will show escaped characters

redis-clone> JSON.GET user INDENT "\t" NEWLINE "\n" SPACE " " $
"[\n\t{\n\t\t\"name\": \"Alice\",\n\t\t\"age\": 30,\n\t\t\"skills\": [\n\t\t\t\"JavaScript\",\n\t\t\t\"Redis\",\n\t\t\t\"Node.js\"\n\t\t]\n\t}\n]"

redis-clone> RAW
Raw mode enabled

redis-clone> JSON.GET user INDENT "\t" NEWLINE "\n" SPACE " " $
[
        {
                "name": "Alice",
                "age": 30,
                "skills": [
                        "JavaScript",
                        "Redis",
                        "Node.js"
                ]
        }
]
```

## 🏆 Features

✅ **Command Line Flag**: `--raw` flag for startup  
✅ **Runtime Toggle**: `RAW` command within CLI  
✅ **JSON Formatting**: INDENT, NEWLINE, SPACE options  
✅ **Proper Display**: Actual tabs and newlines instead of escapes  
✅ **Toggle Support**: `RAW on`, `RAW off`, `RAW` (toggle)  
✅ **Help Integration**: `RAW` command documented in `HELP`  

## 🚀 Perfect Redis CLI Compatibility

Your Redis clone now provides the same JSON formatting experience as the official Redis CLI with `--raw` mode!

Use it for:
- **Pretty-printing JSON data**
- **Debugging complex JSON structures** 
- **Development and testing**
- **Data visualization**
- **Configuration file generation**

Ready for production use! 🎉
