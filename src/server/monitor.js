"use strict";

const http = require("http");

function buildMetrics(srv) {
  const mem = process.memoryUsage();
  return {
    server: {
      tcp_port: srv.port,
      tls_port: srv.tlsPort || 0,
      role: srv.role || 'master',
      run_id: srv.runId || '',
      replication_offset: srv.replicationOffset || 0,
      uptime_sec: Math.floor(process.uptime())
    },
    clients: {
      connected_clients: (srv.clients ? srv.clients.size : (srv.server?.connections ?? 0))
    },
    keyspace: {
      db0: `keys=${srv.store?.kv?.size ?? 0}`
    },
    persistence: {
      aof_enabled: !!srv.aof
    },
    memory: {
      rss: mem.rss,
      heap_total: mem.heapTotal,
      heap_used: mem.heapUsed,
      external: mem.external
    },
    slowlog: {
      length: Array.isArray(srv.slowlog) ? srv.slowlog.length : 0
    }
  };
}

function htmlPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>RedisJS Monitor</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0f1419 0%, #1a1f2e 100%);
      color: #e6edf3; 
      min-height: 100vh;
      padding: 20px;
    }
    .header { 
      text-align: center; 
      margin-bottom: 30px;
      background: rgba(255,255,255,0.05);
      padding: 20px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .header h1 { 
      font-size: 2.5rem; 
      font-weight: 300;
      background: linear-gradient(45deg, #58a6ff, #79c0ff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    .status { 
      display: inline-block;
      background: #238636;
      color: white;
      padding: 4px 12px;
      border-radius: 16px;
      font-size: 0.85rem;
      font-weight: 500;
    }
    .grid { 
      display: grid; 
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); 
      gap: 20px; 
      margin-bottom: 30px;
    }
    .card { 
      background: rgba(255,255,255,0.08);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px;
      padding: 20px;
      position: relative;
      overflow: hidden;
    }
    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, #58a6ff, #79c0ff);
    }
    .card h3 { 
      font-size: 1.1rem;
      margin-bottom: 15px;
      color: #58a6ff;
      font-weight: 600;
    }
    .metric { 
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .metric:last-child { border-bottom: none; margin-bottom: 0; }
    .metric-label { 
      color: #b1bac4;
      font-size: 0.9rem;
    }
    .metric-value { 
      font-weight: 600;
      color: #e6edf3;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    }
    .metric-value.large {
      font-size: 1.8rem;
      color: #58a6ff;
    }
    .memory-bar {
      width: 100%;
      height: 8px;
      background: rgba(255,255,255,0.1);
      border-radius: 4px;
      overflow: hidden;
      margin-top: 8px;
    }
    .memory-fill {
      height: 100%;
      background: linear-gradient(90deg, #238636, #2ea043);
      border-radius: 4px;
      transition: width 0.3s ease;
    }
    .raw-section {
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 20px;
    }
    .raw-section h3 {
      color: #58a6ff;
      margin-bottom: 15px;
      font-size: 1.1rem;
    }
    .raw-content {
      background: #0d1117;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      padding: 16px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      font-size: 0.85rem;
      line-height: 1.5;
      white-space: pre-wrap;
      max-height: 300px;
      overflow-y: auto;
      color: #e6edf3;
    }
    .toggle-btn {
      background: #21262d;
      border: 1px solid rgba(255,255,255,0.2);
      color: #e6edf3;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9rem;
      margin-bottom: 15px;
      transition: all 0.2s ease;
    }
    .toggle-btn:hover {
      background: #30363d;
      border-color: rgba(255,255,255,0.3);
    }
    .hidden { display: none; }
    .uptime { color: #2ea043; }
    .port { color: #58a6ff; }
    .role { 
      background: #1f6feb;
      color: white;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.8rem;
    }
  </style>
  </head><body>
  <div class="header">
    <h1>RedisJS Monitoring</h1>
    <span class="status" id="status">● ONLINE</span>
  </div>
  
  <div class="grid">
    <div class="card">
      <h3>🖥️ Server Info</h3>
      <div class="metric">
        <span class="metric-label">TCP Port</span>
        <span class="metric-value port" id="tcp-port">-</span>
      </div>
      <div class="metric">
        <span class="metric-label">TLS Port</span>
        <span class="metric-value" id="tls-port">-</span>
      </div>
      <div class="metric">
        <span class="metric-label">Role</span>
        <span class="metric-value role" id="role">-</span>
      </div>
      <div class="metric">
        <span class="metric-label">Uptime</span>
        <span class="metric-value uptime" id="uptime">-</span>
      </div>
    </div>

    <div class="card">
      <h3>👥 Clients</h3>
      <div class="metric">
        <span class="metric-label">Connected</span>
        <span class="metric-value large" id="clients-count">0</span>
      </div>
    </div>

    <div class="card">
      <h3>🗂️ Keyspace</h3>
      <div id="keyspace-metrics">
        <div class="metric">
          <span class="metric-label">Total Keys</span>
          <span class="metric-value large" id="total-keys">0</span>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>💾 Persistence</h3>
      <div class="metric">
        <span class="metric-label">AOF Enabled</span>
        <span class="metric-value" id="aof-status">-</span>
      </div>
    </div>

    <div class="card">
      <h3>🧠 Memory Usage</h3>
      <div class="metric">
        <span class="metric-label">RSS</span>
        <span class="metric-value" id="rss">-</span>
      </div>
      <div class="metric">
        <span class="metric-label">Heap Used</span>
        <span class="metric-value" id="heap-used">-</span>
      </div>
      <div class="metric">
        <span class="metric-label">Heap Total</span>
        <span class="metric-value" id="heap-total">-</span>
      </div>
      <div class="memory-bar">
        <div class="memory-fill" id="memory-fill"></div>
      </div>
    </div>

    <div class="card">
      <h3>📊 Performance</h3>
      <div class="metric">
        <span class="metric-label">Slow Log Entries</span>
        <span class="metric-value" id="slowlog-count">-</span>
      </div>
    </div>
  </div>

  <div class="raw-section">
    <button class="toggle-btn" onclick="toggleRaw()">Show Raw JSON</button>
    <div id="raw-container" class="hidden">
      <h3>📋 Raw Data</h3>
      <div class="raw-content" id="raw"></div>
    </div>
  </div>

  <script>
    function formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
    
    function formatUptime(seconds) {
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      
      if (days > 0) return days + 'd ' + hours + 'h ' + mins + 'm';
      if (hours > 0) return hours + 'h ' + mins + 'm ' + secs + 's';
      if (mins > 0) return mins + 'm ' + secs + 's';
      return secs + 's';
    }

    function toggleRaw() {
      const container = document.getElementById('raw-container');
      const btn = document.querySelector('.toggle-btn');
      if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        btn.textContent = 'Hide Raw JSON';
      } else {
        container.classList.add('hidden');
        btn.textContent = 'Show Raw JSON';
      }
    }

    function render(m) {
      // Server info
      document.getElementById('tcp-port').textContent = m.server.tcp_port;
      document.getElementById('tls-port').textContent = m.server.tls_port || 'Disabled';
      document.getElementById('role').textContent = m.server.role.toUpperCase();
      document.getElementById('uptime').textContent = formatUptime(m.server.uptime_sec);

      // Clients
      document.getElementById('clients-count').textContent = m.clients.connected_clients;

      // Keyspace
      const totalKeys = Object.values(m.keyspace).reduce((sum, dbInfo) => {
        const match = dbInfo.match(/keys=(\\d+)/);
        return sum + (match ? parseInt(match[1]) : 0);
      }, 0);
      document.getElementById('total-keys').textContent = totalKeys;

      // Persistence
      document.getElementById('aof-status').textContent = m.persistence.aof_enabled ? '✅ Enabled' : '❌ Disabled';

      // Memory
      document.getElementById('rss').textContent = formatBytes(m.memory.rss);
      document.getElementById('heap-used').textContent = formatBytes(m.memory.heap_used);
      document.getElementById('heap-total').textContent = formatBytes(m.memory.heap_total);
      
      const heapPercent = (m.memory.heap_used / m.memory.heap_total * 100).toFixed(1);
      document.getElementById('memory-fill').style.width = heapPercent + '%';

      // Performance
      document.getElementById('slowlog-count').textContent = m.slowlog.length;

      // Raw JSON
      document.getElementById('raw').textContent = JSON.stringify(m, null, 2);

      // Update status
      document.getElementById('status').textContent = '● ONLINE';
      document.getElementById('status').style.background = '#238636';
    }

    // Initial load
    fetch('/api/stats')
      .then(r => r.json())
      .then(render)
      .catch(() => {
        document.getElementById('status').textContent = '● OFFLINE';
        document.getElementById('status').style.background = '#da3633';
      });

    // Live updates
    const es = new EventSource('/events');
    es.onmessage = (ev) => {
      try { 
        render(JSON.parse(ev.data)); 
      } catch(e) { 
        console.error('Parse error:', e);
      }
    };
    es.onerror = () => {
      document.getElementById('status').textContent = '● DISCONNECTED';
      document.getElementById('status').style.background = '#e3b341';
    };
  </script>
  </body></html>`;
}

function createMonitoringServer(redisServer, options = {}) {
  const clients = new Set(); // SSE clients
  const httpServer = http.createServer((req, res) => {
    const url = req.url || '/';
    if (req.method === 'GET' && url === '/') {
      const body = htmlPage();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
      return;
    }
    if (req.method === 'GET' && url === '/api/stats') {
      const json = JSON.stringify(buildMetrics(redisServer));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(json);
      return;
    }
    if (req.method === 'GET' && url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      res.write('\n');
      clients.add(res);
      req.on('close', () => { clients.delete(res); });
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });

  const intervalMs = options.intervalMs || 1000;
  const timer = setInterval(() => {
    if (clients.size === 0) return;
    const data = JSON.stringify(buildMetrics(redisServer));
    const chunk = `data: ${data}\n\n`;
    for (const res of clients) {
      try { res.write(chunk); } catch {}
    }
  }, intervalMs);
  timer.unref?.();

  httpServer.on('close', () => { clearInterval(timer); clients.clear(); });
  return httpServer;
}

module.exports = { createMonitoringServer };


