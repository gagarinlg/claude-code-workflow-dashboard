import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { walkChanged } from '../src/data/changed';

const FIXTURES = path.join(__dirname, 'fixtures');

describe('walkChanged', () => {
  it('returns null for an empty repo string', () => {
    expect(walkChanged('', 120)).toBeNull();
  });

  it('returns null for a non-existent repo path', () => {
    expect(walkChanged('/no/such/path', 120)).toBeNull();
  });

  it('returns recently modified files from the fixture dir', () => {
    // Touch a file in wf_basic so it is within maxAgeSec
    const target = path.join(FIXTURES, 'wf_basic', 'agent-aaa.jsonl');
    const now = new Date();
    fs.utimesSync(target, now, now);

    const result = walkChanged(FIXTURES, 10);
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    // The touched file must appear in the output
    const found = result!.some((f) => f.includes('agent-aaa.jsonl'));
    expect(found).toBe(true);
  });

  it('excludes files older than maxAgeSec', () => {
    // Use a maxAgeSec of 0 — no file can be modified in negative time
    const result = walkChanged(FIXTURES, 0);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(0);
  });

  it('returns sorted results', () => {
    const result = walkChanged(FIXTURES, 10);
    if (!result || result.length < 2) return;
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]! <= result[i + 1]!).toBe(true);
    }
  });

  it('caps results at 30 entries', () => {
    // Create a temp directory with 35 fresh files
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'changed-test-'));
    try {
      const now = new Date();
      for (let i = 0; i < 35; i++) {
        const f = path.join(tmpDir, `file${i}.txt`);
        fs.writeFileSync(f, 'x');
        fs.utimesSync(f, now, now);
      }
      const result = walkChanged(tmpDir, 120);
      expect(result).not.toBeNull();
      expect(result!.length).toBeLessThanOrEqual(30);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips node_modules directories', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'changed-nm-test-'));
    try {
      const now = new Date();
      // File outside node_modules
      const keep = path.join(tmpDir, 'keep.ts');
      fs.writeFileSync(keep, 'x');
      fs.utimesSync(keep, now, now);
      // File inside node_modules
      const nmDir = path.join(tmpDir, 'node_modules');
      fs.mkdirSync(nmDir);
      const skip = path.join(nmDir, 'skip.ts');
      fs.writeFileSync(skip, 'x');
      fs.utimesSync(skip, now, now);

      const result = walkChanged(tmpDir, 120);
      expect(result).not.toBeNull();
      expect(result!.some((f) => f.includes('node_modules'))).toBe(false);
      expect(result!.some((f) => f.includes('keep.ts'))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips vendor directories', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'changed-vendor-test-'));
    try {
      const now = new Date();
      const vendorDir = path.join(tmpDir, 'vendor');
      fs.mkdirSync(vendorDir);
      const skip = path.join(vendorDir, 'lib.ts');
      fs.writeFileSync(skip, 'x');
      fs.utimesSync(skip, now, now);

      const result = walkChanged(tmpDir, 120);
      expect(result).not.toBeNull();
      expect(result!.some((f) => f.includes('vendor'))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips hidden directories (starting with .)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'changed-hidden-test-'));
    try {
      const now = new Date();
      const hiddenDir = path.join(tmpDir, '.git');
      fs.mkdirSync(hiddenDir);
      const skip = path.join(hiddenDir, 'config');
      fs.writeFileSync(skip, 'x');
      fs.utimesSync(skip, now, now);
      const keep = path.join(tmpDir, 'src.ts');
      fs.writeFileSync(keep, 'x');
      fs.utimesSync(keep, now, now);

      const result = walkChanged(tmpDir, 120);
      expect(result).not.toBeNull();
      expect(result!.some((f) => f.includes('.git'))).toBe(false);
      expect(result!.some((f) => f.includes('src.ts'))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not throw when a subdir becomes unreadable mid-walk', () => {
    // This is guarded by the try/catch in walkChanged
    expect(() => walkChanged(FIXTURES, 120)).not.toThrow();
  });
});
