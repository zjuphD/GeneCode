// Real frozen executable -> API -> frozen HTTP worker -> local mock upstream.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const binary = resolve(process.argv[2] || 'src-tauri/binaries/agent-server');
let calls = 0;
const upstream = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  assert.equal(req.url, '/v1/chat/completions');
  assert.equal(req.headers.authorization, 'Bearer smoke-only-fake-key');
  assert.equal(JSON.parse(body).model, 'smoke-model');
  calls++;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
});
await new Promise(r => upstream.listen(0, '127.0.0.1', r));
const dataDir = mkdtempSync(join(tmpdir(), 'genecode-frozen-http-'));
const port = 18769;
const child = spawn(binary, ['--host', '127.0.0.1', '--port', String(port)], {
  cwd: dataDir, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PRIMER_DATA_DIR: dataDir,
    GENE_CODE_API_TOKEN: 'local-smoke-token', AGENT_LLM_ENABLED: 'true',
    AGENT_LLM_PROVIDER: 'smoke', AGENT_LLM_MODEL: 'smoke-model',
    AGENT_LLM_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`,
    AGENT_LLM_API_KEY: 'smoke-only-fake-key' },
});
child.stdout.resume(); child.stderr.resume();
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('Sidecar exited: ' + child.exitCode);
    try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) {ready = true; break;} } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  assert.ok(ready, 'sidecar startup');
  const response = await fetch(`http://127.0.0.1:${port}/api/agent/test-llm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GeneCode-Token': 'local-smoke-token' },
    body: '{}', signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.connected, true, JSON.stringify(result));
  assert.equal(calls, 1);
  console.log('PASS: packaged API -> packaged HTTP worker -> mock upstream; connected=true; one authenticated request');
} finally {
  child.kill('SIGTERM'); upstream.close();
}
