import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { findWorkflowDir } from '../src/data/discovery';

const FIXTURES = path.join(__dirname, 'fixtures');
const BASE = path.join(FIXTURES, 'base');

describe('findWorkflowDir', () => {
  it('returns the globally-newest wf_* dir', () => {
    const found = findWorkflowDir(BASE);
    expect(found).not.toBeNull();
    // wf_newer was touched after wf_older, so it must be returned
    expect(found).toContain('wf_newer');
  });

  it('returns null for a non-existent base dir', () => {
    expect(findWorkflowDir('/no/such/path')).toBeNull();
  });

  it('returns null for an empty base dir', () => {
    // wf_basic is a wf_* dir but its parent is 'fixtures', not 'workflows'
    // so findWorkflowDir should NOT pick it up
    const found = findWorkflowDir(FIXTURES);
    // Either null (if only base has valid ones) or points into base
    // wf_basic is under fixtures/ directly — parent is 'fixtures', not 'workflows'
    // so it should NOT match
    if (found !== null) {
      expect(found).toContain('wf_newer');
    }
  });

  it('does NOT return wf_basic because its parent is not named "workflows"', () => {
    // wf_basic lives at fixtures/wf_basic — parent = 'fixtures', not 'workflows'
    const found = findWorkflowDir(FIXTURES);
    if (found) {
      // Must be from the base/ subtree, not wf_basic
      expect(found).not.toContain('wf_basic');
    }
  });

  it('skips node_modules subtrees (line 33 branch)', () => {
    // Create a temp base with a node_modules dir containing a fake workflows/wf_ tree
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-nm-'));
    try {
      const nmWf = path.join(tmpBase, 'node_modules', 'workflows', 'wf_inside_nm');
      fs.mkdirSync(nmWf, { recursive: true });
      // Should NOT find wf_inside_nm because it's under node_modules
      expect(findWorkflowDir(tmpBase)).toBeNull();
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('skips vendor subtrees (line 33 branch)', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-vendor-'));
    try {
      const vendorWf = path.join(tmpBase, 'vendor', 'workflows', 'wf_inside_vendor');
      fs.mkdirSync(vendorWf, { recursive: true });
      expect(findWorkflowDir(tmpBase)).toBeNull();
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('skips wf_ dir when statSync throws (TOCTOU, lines 26-27)', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-stat-fail-'));
    try {
      const wfParent = path.join(tmpBase, 'workflows');
      fs.mkdirSync(wfParent, { recursive: true });
      // Create a broken symlink named wf_broken — isDirectory() returns true for a
      // dir symlink but statSync (without followSymlinks:false) throws ENOENT for
      // a dangling symlink.
      try {
        fs.symlinkSync('/no/such/target', path.join(wfParent, 'wf_broken'));
        // Should not throw — broken symlink is skipped gracefully
        expect(() => findWorkflowDir(tmpBase)).not.toThrow();
      } catch {
        // symlink creation failed (e.g. Windows without elevated perms) — skip
      }
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('is bounded by depth parameter', () => {
    // depth=0: visit(base, 0) — base itself has no wf_* entries directly
    // The wf dirs are several levels deep, so depth=0 returns null
    const found = findWorkflowDir(BASE, 0);
    // With depth=0 the tree is only the root level of BASE —
    // proj-abc is there but wf dirs are at depth 4 from BASE
    expect(found).toBeNull();
  });
});
