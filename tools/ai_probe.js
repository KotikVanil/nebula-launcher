// Dev check: run the built-in AI chat command exactly like the launcher does and print raw output.
// Usage: node tools/ai_probe.js [model]
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ai = require('../src/main/ai.js');
const core = require('../src/core');

const claude = ai.findClaude();
const cfgFile = path.join(core.paths.tmp, 'mcp-nebula-probe.json');
fs.writeFileSync(cfgFile, JSON.stringify({ mcpServers: { nebula: ai.mcpServerConfig() } }));
const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
  `--mcp-config=${cfgFile}`, '--strict-mcp-config', '--allowedTools=mcp__nebula', '--tools=', '--setting-sources=',
  `--model=${process.argv[2] || 'claude-sonnet-5-5'}`, '--append-system-prompt=test'];
console.log('claude:', claude);
const p = spawn(claude, args, { windowsHide: true, cwd: core.paths.root });
p.stdin.end('Ответь одним словом: ок');
let out = '', err = '';
p.stdout.on('data', (d) => (out += d));
p.stderr.on('data', (d) => (err += d));
p.on('close', (code) => {
  console.log('exit', code);
  console.log('STDERR:', err.slice(0, 1500));
  const lines = out.split('\n').filter(Boolean);
  for (const l of lines) {
    try { const j = JSON.parse(l); if (j.type === 'assistant') console.log('TEXT', JSON.stringify(j.message.content)); if (j.type === 'result') console.log('RESULT', j.is_error, JSON.stringify(j.result).slice(0, 400)); } catch { console.log('RAW', l.slice(0, 300)); }
  }
});
