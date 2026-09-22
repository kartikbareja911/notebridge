import type { IncomingMessage, ServerResponse } from "node:http";
import type { Database } from "../db/client.js";
import { notes, toolCalls } from "../db/schema.js";
import { desc } from "drizzle-orm";

export async function handleDashboardRequest(
  request: IncomingMessage,
  response: ServerResponse,
  database?: Database,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (url.pathname === "/" || url.pathname === "/dashboard") {
    sendHtml(response, getDashboardHtml());
    return true;
  }

  if (url.pathname === "/api/notes" && database) {
    const noteRows = await database
      .select()
      .from(notes)
      .orderBy(desc(notes.createdAt))
      .limit(50);
    sendJson(response, 200, { notes: noteRows });
    return true;
  }

  if (url.pathname === "/api/tool-calls" && database) {
    const logs = await database
      .select()
      .from(toolCalls)
      .orderBy(desc(toolCalls.createdAt))
      .limit(50);
    sendJson(response, 200, { toolCalls: logs });
    return true;
  }

  return false;
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(html)),
  });
  response.end(html);
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(body)),
  });
  response.end(body);
}

function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NoteBridge MCP — Control Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #0a0d14;
      --bg-card: rgba(22, 27, 38, 0.7);
      --bg-card-hover: rgba(30, 38, 54, 0.8);
      --border-color: rgba(255, 255, 255, 0.08);
      --accent-blue: #3b82f6;
      --accent-purple: #8b5cf6;
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
      --text-dim: #6b7280;
      --success: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', sans-serif;
      background-color: var(--bg-primary);
      background-image: 
        radial-gradient(at 20% 20%, rgba(59, 130, 246, 0.15) 0px, transparent 50%),
        radial-gradient(at 80% 80%, rgba(139, 92, 246, 0.15) 0px, transparent 50%);
      background-attachment: fixed;
      color: var(--text-main);
      min-height: 100vh;
      padding: 2rem;
    }
    header {
      max-width: 1200px;
      margin: 0 auto 2rem auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--border-color);
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .logo-badge {
      background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
      width: 40px;
      height: 40px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 1.25rem;
      box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);
    }
    h1 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.025em; }
    .status-pill {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.2);
      color: var(--success);
      padding: 0.4rem 0.8rem;
      border-radius: 9999px;
      font-size: 0.85rem;
      font-weight: 500;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      background-color: var(--success);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--success);
      animation: pulse 2s infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    main { max-width: 1200px; margin: 0 auto; }
    .nav-tabs {
      display: flex;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .tab-btn {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      padding: 0.6rem 1.2rem;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.9rem;
      font-weight: 500;
      transition: all 0.2s ease;
    }
    .tab-btn.active, .tab-btn:hover {
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-main);
      border-color: rgba(255, 255, 255, 0.2);
    }
    .grid-container {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      gap: 1.25rem;
    }
    .card {
      background: var(--bg-card);
      backdrop-filter: blur(12px);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      padding: 1.25rem;
      transition: transform 0.2s ease, border-color 0.2s ease;
    }
    .card:hover {
      transform: translateY(-2px);
      border-color: rgba(255, 255, 255, 0.15);
      background: var(--bg-card-hover);
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 0.75rem;
    }
    .card-title { font-size: 1.1rem; font-weight: 600; color: #fff; }
    .tag-list { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.75rem; }
    .tag {
      background: rgba(59, 130, 246, 0.12);
      border: 1px solid rgba(59, 130, 246, 0.25);
      color: #60a5fa;
      padding: 0.2rem 0.5rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-family: 'JetBrains Mono', monospace;
    }
    .content-preview {
      color: var(--text-muted);
      font-size: 0.875rem;
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .table-container {
      background: var(--bg-card);
      backdrop-filter: blur(12px);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      overflow: hidden;
    }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th, td { padding: 1rem; border-bottom: 1px solid var(--border-color); font-size: 0.875rem; }
    th { background: rgba(255, 255, 255, 0.02); color: var(--text-muted); font-weight: 600; }
    tr:last-child td { border-bottom: none; }
    code { font-family: 'JetBrains Mono', monospace; color: #a7f3d0; background: rgba(16, 185, 129, 0.1); padding: 0.1rem 0.3rem; border-radius: 4px; }
  </style>
</head>
<body>
  <header>
    <div class="logo">
      <div class="logo-badge">NB</div>
      <div>
        <h1>NoteBridge MCP Dashboard</h1>
        <p style="font-size: 0.8rem; color: var(--text-muted);">Vector Knowledge Base & Tool Observer</p>
      </div>
    </div>
    <div class="status-pill">
      <div class="status-dot"></div>
      MCP Server Active
    </div>
  </header>

  <main>
    <div class="nav-tabs">
      <button class="tab-btn active" onclick="showTab('notes')">Notes & Embeddings</button>
      <button class="tab-btn" onclick="showTab('logs')">MCP Tool Execution Logs</button>
    </div>

    <div id="notes-tab">
      <div class="grid-container" id="notes-grid">
        <p style="color: var(--text-muted);">Loading notes...</p>
      </div>
    </div>

    <div id="logs-tab" style="display: none;">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Tool Name</th>
              <th>Status</th>
              <th>Latency</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody id="logs-tbody">
            <tr><td colspan="4" style="color: var(--text-muted);">Loading tool execution logs...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <script>
    async function loadNotes() {
      try {
        const res = await fetch('/api/notes');
        const data = await res.json();
        const grid = document.getElementById('notes-grid');
        if (!data.notes || data.notes.length === 0) {
          grid.innerHTML = '<p style="color: var(--text-muted);">No notes stored yet. Create notes using MCP tools!</p>';
          return;
        }
        grid.innerHTML = data.notes.map(n => \`
          <div class="card">
            <div class="card-header">
              <div class="card-title">\${escapeHtml(n.title)}</div>
            </div>
            <p class="content-preview">\${escapeHtml(n.content)}</p>
            <div class="tag-list">
              \${(n.tags || []).map(t => \`<span class="tag">#\${escapeHtml(t)}</span>\`).join('')}
            </div>
          </div>
        \`).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function loadLogs() {
      try {
        const res = await fetch('/api/tool-calls');
        const data = await res.json();
        const tbody = document.getElementById('logs-tbody');
        if (!data.toolCalls || data.toolCalls.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" style="color: var(--text-muted);">No recorded tool executions yet.</td></tr>';
          return;
        }
        tbody.innerHTML = data.toolCalls.map(l => \`
          <tr>
            <td><code>\${escapeHtml(l.toolName)}</code></td>
            <td><span style="color: \${l.success ? 'var(--success)' : '#ef4444'}; font-weight: 500;">\${l.success ? 'Success' : 'Failed'}</span></td>
            <td>\${l.latencyMs} ms</td>
            <td style="color: var(--text-muted);">\${new Date(l.createdAt).toLocaleString()}</td>
          </tr>
        \`).join('');
      } catch (e) {
        console.error(e);
      }
    }

    function showTab(tab) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      if (tab === 'notes') {
        document.getElementById('notes-tab').style.display = 'block';
        document.getElementById('logs-tab').style.display = 'none';
        event.target.classList.add('active');
        loadNotes();
      } else {
        document.getElementById('notes-tab').style.display = 'none';
        document.getElementById('logs-tab').style.display = 'block';
        event.target.classList.add('active');
        loadLogs();
      }
    }

    function escapeHtml(str) {
      return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    loadNotes();
  </script>
</body>
</html>`;
}
