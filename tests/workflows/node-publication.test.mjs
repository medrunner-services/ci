import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { prepareManifest, validateRelease } from '../../.github/scripts/node-publication.mjs';

const stable = { version: '1.2.3', tag: 'v1.2.3', channel: 'stable', registry: 'https://registry.npmjs.org', manager: 'npm', directory: '.' };
const dev = { ...stable, version: '1.3.0-dev.2', tag: 'v1.3.0-dev.2', channel: 'preview' };

test('stable and dev releases are accepted for both registries and managers', () => {
  for (const release of [stable, dev]) {
    for (const registry of ['https://registry.npmjs.org', 'https://npm.pkg.github.com']) {
      for (const manager of ['npm', 'pnpm']) validateRelease({ ...release, registry, manager });
    }
  }
});

test('rejects malformed versions, mismatched tags, unsafe paths and invalid tag syntax', () => {
  for (const change of [
    { tag: 'v9.9.9' }, { version: '1.2.3-01', tag: 'v1.2.3-01' },
    { channel: 'my/channel' }, { channel: 'bad tag' }, { directory: '../project' },
    { directory: '/tmp/project' }, { directory: 'C:\\project' }, { registry: 'file:///tmp/registry' },
    { manager: 'yarn' }, { version: '01.2.3', tag: 'v01.2.3' },
  ]) assert.throws(() => validateRelease({ ...stable, ...change }));
});

test('release version and channel override source manifest publication defaults', () => {
  const source = { name: '@medrunner/api-client', version: '0.7.0', publishConfig: { access: 'public', tag: 'latest', '@medrunner:registry': 'https://example.invalid' } };
  const result = prepareManifest(source, dev);
  assert.equal(result.version, dev.version);
  assert.deepEqual(result.publishConfig, { access: 'public', tag: 'preview', registry: dev.registry });
  assert.equal(source.publishConfig.tag, 'latest');
});

test('private or invalid packages cannot be published', () => {
  assert.throws(() => prepareManifest({ name: '@medrunner/api-client', private: true }, stable));
  assert.throws(() => prepareManifest({ name: 'bad name' }, stable));
});

test('publication helper stamps the artifact without changing dependency locks', t => {
  const root = mkdtempSync(join(tmpdir(), 'node-publication-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = { name: '@medrunner/api-client', version: '0.7.0', publishConfig: { tag: 'latest' }, files: ['dist'] };
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3}');
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist/index.js'), 'export const value = 1;');
  const helper = new URL('../../.github/scripts/node-publication.mjs', import.meta.url);
  execFileSync(process.execPath, [fileURLToPath(helper)], {
    cwd: root,
    env: { ...process.env, VERSION: dev.version, RELEASE_TAG: dev.tag, CHANNEL: dev.channel,
      REGISTRY_URL: dev.registry, PACKAGE_MANAGER: dev.manager, WORKING_DIRECTORY: '.', GITHUB_OUTPUT: join(root, 'output') },
  });
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).version, dev.version);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).publishConfig.tag, 'preview');
  assert.equal(readFileSync(join(root, 'package-lock.json'), 'utf8'), '{"lockfileVersion":3}');
  assert.match(readFileSync(join(root, 'output'), 'utf8'), /package-name=@medrunner\/api-client/);
});

test('optional tests skip only missing scripts, and propagate failures', t => {
  const root = mkdtempSync(join(tmpdir(), 'node-validation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workflow = parse(readFileSync(new URL('../../.github/workflows/wf-test-node.yml', import.meta.url), 'utf8'));
  const step = workflow.jobs.test.steps.find(step => step.name === 'Test');
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const run = optional => execFileSync(bash, ['-c', step.run], { cwd: root,
    env: { ...process.env, PACKAGE_MANAGER: 'npm', TEST_IF_PRESENT: String(optional) }, stdio: 'pipe' });
  writeFileSync(join(root, 'package.json'), '{"private":true}');
  run(true);
  assert.throws(() => run(false));
  // Write through JSON.stringify so the script is parsed exactly as npm receives it.
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(7)"' } }));
  assert.throws(() => run(true));
});
