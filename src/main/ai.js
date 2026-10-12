// AI workshop: connect Claude Code / Codex to the launcher via MCP, and a built-in chat that
// drives the Claude CLI headless with ONLY the launcher tools enabled.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const core = require('../core');

const APP_ROOT = path.join(__dirname, '..', '..');
const MCP_SCRIPT = path.join(APP_ROOT, 'mcp', 'server.mjs');

function newestFile(globDirs, rel) {
  const found = [];
  for (const base of globDirs) {
    let vers = [];
    try { vers = fs.readdirSync(base); } catch { continue; }
    for (const v of vers) {
      let hashes = [];
      try { hashes = fs.readdirSync(path.join(base, v)); } catch { continue; }
      for (const h of hashes) {
        const f = path.join(base, v, h, rel);
        try { found.push({ f, t: fs.statSync(f).mtimeMs }); } catch {}
      }
    }
  }
  found.sort((a, b) => b.t - a.t);
  return found[0] ? found[0].f : null;
}

function findClaude() {
  const dirs = [path.join(process.env.APPDATA || '', 'Claude', 'claude-code')];
  try {
    const pk = path.join(process.env.LOCALAPPDATA || '', 'Packages');
    for (const d of fs.readdirSync(pk)) if (d.startsWith('Claude_')) dirs.push(path.join(pk, d, 'LocalCache', 'Roaming', 'Claude', 'claude-code'));
  } catch {}
  const f = newestFile(dirs, 'claude.exe');
  if (f) return f;
  const npm = path.join(process.env.APPDATA || '', 'npm', 'claude.cmd');
  return fs.existsSync(npm) ? npm : null;
}

function findCodex() {
  const npm = path.join(process.env.APPDATA || '', 'npm', 'codex.cmd');
  return fs.existsSync(npm) ? npm : null;
}

// The MCP server runs on the Electron binary in node mode: works even without Node.js installed.
function mcpServerConfig() {
  return { command: process.execPath, args: [MCP_SCRIPT], env: { ELECTRON_RUN_AS_NODE: '1', NEBULA_HOME: core.paths.root } };
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const shell = /\.cmd$/i.test(cmd);
    execFile(cmd, args, { windowsHide: true, timeout: 60000, shell, ...opts }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout) + String(stderr) }));
  });
}

async function status() {
  const claude = findClaude();
  const codex = findCodex();
  let claudeLinked = false, codexLinked = false;
  try {
    const cj = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
    claudeLinked = !!(cj.mcpServers && cj.mcpServers.nebula);
  } catch {}
  try { codexLinked = /\[mcp_servers\.nebula\]/.test(fs.readFileSync(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8')); } catch {}
  return { claude: !!claude, claudePath: claude, codex: !!codex, claudeLinked, codexLinked, mcp: mcpServerConfig() };
}

async function linkClaude() {
  const claude = findClaude();
  if (!claude) throw new Error('Claude Code не найден. Установите Claude Desktop или Claude Code.');
  await run(claude, ['mcp', 'remove', 'nebula', '-s', 'user']);
  const r = await run(claude, ['mcp', 'add-json', 'nebula', JSON.stringify(mcpServerConfig()), '-s', 'user']);
  if (!r.ok) throw new Error('claude mcp add-json: ' + r.out.slice(0, 300));
  return status();
}

function tomlStr(s) { return "'" + String(s).replace(/'/g, '') + "'"; }

async function linkCodex() {
  const file = path.join(os.homedir(), '.codex', 'config.toml');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch {}
  const cfg = mcpServerConfig();
  const block = [
    '[mcp_servers.nebula]',
    `command = ${tomlStr(cfg.command)}`,
    `args = [${cfg.args.map(tomlStr).join(', ')}]`,
    `env = { ELECTRON_RUN_AS_NODE = "1", NEBULA_HOME = ${tomlStr(cfg.env.NEBULA_HOME)} }`,
    '',
  ].join('\n');
  // replace an existing block (up to the next table header) or append
  const re = /\[mcp_servers\.nebula\][\s\S]*?(?=\n\[|$)/;
  text = re.test(text) ? text.replace(re, block.trimEnd()) : (text.trimEnd() + '\n\n' + block);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.nebula-backup');
  fs.writeFileSync(file, text);
  return status();
}

const SYSTEM_PROMPT = [
  'Ты — ИИ-мастер сборок внутри Minecraft-лаунчера Nebula. Отвечай по-русски, коротко и дружелюбно.',
  'У тебя есть только инструменты лаунчера (mcp__nebula__*). Через них ты создаёшь сборки, ищешь и ставишь моды с Modrinth, проверяешь совместимость, правишь конфиги и читаешь логи падений.',
  'Правила: перед установкой ищи моды через search_mods и проверяй, что есть версия под нужные Minecraft и загрузчик. После установки всегда вызывай check_instance и чини проблемы (fix_missing_dependencies).',
  'Не ставь моды на разные загрузчики в одну сборку. Для оптимизации на Fabric/NeoForge бери Sodium, на Forge — Embeddium. Для шейдеров на Fabric — Iris.',
  'Если пользователь просит «сборку», выбери популярную стабильную версию Minecraft, где есть все нужные моды, и объясни выбор в одной фразе.',
  'В конце дай краткий итог: что создано, сколько модов, что стоит проверить в игре.',
].join('\n');

const chats = new Map(); // chatId -> {proc}

function chat({ chatId, prompt, sessionId, model, instanceId }, send) {
  const claude = findClaude();
  if (!claude) throw new Error('Claude Code не найден на этом компьютере');
  const cfgFile = path.join(core.paths.tmp, 'mcp-nebula.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ mcpServers: { nebula: mcpServerConfig() } }));
  const s = core.settings.get();
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    `--mcp-config=${cfgFile}`, '--strict-mcp-config', '--allowedTools=mcp__nebula', '--tools=', '--setting-sources=',
    `--model=${model || s.aiModel || 'claude-sonnet-5-5'}`, `--append-system-prompt=${SYSTEM_PROMPT}`,
  ];
  if (sessionId) args.push(`--resume=${sessionId}`);
  const ctx = instanceId ? `\n\n[Контекст: пользователь сейчас смотрит сборку id=${instanceId}]` : '';
  const proc = spawn(claude, args, { windowsHide: true, cwd: core.paths.root, env: { ...process.env, NEBULA_HOME: core.paths.root } });
  chats.set(chatId, { proc });
  proc.stdin.write(prompt + ctx);
  proc.stdin.end();
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'stream_event' && ev.event) {
        const e = ev.event;
        if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') send({ chatId, type: 'text', text: e.delta.text });
        if (e.type === 'content_block_start' && e.content_block && e.content_block.type === 'tool_use') send({ chatId, type: 'tool', name: e.content_block.name.replace(/^mcp__nebula__/, '') });
      } else if (ev.type === 'user' && ev.message && Array.isArray(ev.message.content)) {
        for (const c of ev.message.content) if (c.type === 'tool_result') send({ chatId, type: 'tool_done', error: !!c.is_error });
      } else if (ev.type === 'result') {
        send({ chatId, type: 'done', sessionId: ev.session_id, cost: ev.total_cost_usd, error: ev.is_error ? (ev.result || 'ошибка') : null });
      } else if (ev.type === 'system' && ev.subtype === 'init') {
        send({ chatId, type: 'init', sessionId: ev.session_id, model: ev.model });
      }
    }
  });
  let err = '';
  proc.stderr.on('data', (d) => { err += d.toString(); });
  proc.on('close', (code) => {
    chats.delete(chatId);
    if (code !== 0) send({ chatId, type: 'done', error: (err || `Claude завершился с кодом ${code}`).slice(-600) });
  });
  return { started: true };
}

function stopChat(chatId) {
  const c = chats.get(chatId);
  if (c) { try { spawn('taskkill', ['/pid', String(c.proc.pid), '/T', '/F'], { windowsHide: true }); } catch {} }
}

module.exports = { status, linkClaude, linkCodex, chat, stopChat, mcpServerConfig, findClaude, SYSTEM_PROMPT };
