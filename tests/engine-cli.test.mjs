import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_DIR = fileURLToPath(new URL('../engine/', import.meta.url));

// Clones can live in folders with spaces (e.g. ".../Claude Code/claudes-portfolio"), and on macOS the temp
// folder is behind a symlink. The CLI used to print nothing and exit 0 there; it must always answer.
function withEngineCopy(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'engine cli '));
  try {
    const dir = path.join(root, 'Claude Code', 'engine');
    cpSync(ENGINE_DIR, dir, { recursive: true });
    const input = path.join(root, 'input.json');
    writeFileSync(input, JSON.stringify({ events: [], asOf: '2026-10-26' }));
    return fn(path.join(dir, 'cli.mjs'), input);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('CLI prints its JSON result when the repo path contains spaces', () => {
  withEngineCopy((cli, input) => {
    const out = execFileSync(process.execPath, [cli, 'verify', input], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out), { ok: true, issues: [] });
  });
});

test('CLI refusals still print { ok:false } and exit 2 from such a path', () => {
  withEngineCopy((cli, input) => {
    let status = 0, stdout = '';
    try { execFileSync(process.execPath, [cli, 'no-such-command', input], { encoding: 'utf8' }); }
    catch (e) { status = e.status; stdout = e.stdout; }
    assert.equal(status, 2);
    assert.equal(JSON.parse(stdout).error, 'UNKNOWN_COMMAND');
  });
});
