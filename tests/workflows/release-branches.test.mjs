import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseBranches } from '../../.github/scripts/release-branches.mjs';
import { validateRelease } from '../../.github/scripts/node-publication.mjs';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';

test('prefixed maintenance branches get explicit ranges and safe isolated channels', () => {
  const branches = releaseBranches(['main', 'release/2.x', 'release/1.2.x', 'release/0.7.0', 'release/rc', 'release/1.2.x']);
  assert.deepEqual(branches.slice(0, 2), [
    { name: 'release/1.2.x', range: '1.2.x', channel: 'maintenance-1.2.x' },
    { name: 'release/2.x', range: '2.x', channel: 'maintenance-2.x' },
  ]);
  assert.deepEqual(branches.slice(2), [
    { name: 'release/stable', channel: 'stable' },
    { name: 'release/rc', channel: 'rc', prerelease: 'rc' },
    { name: 'main', channel: 'preview', prerelease: 'dev' },
    { name: 'ci', channel: 'ci', prerelease: 'ci-do-not-use' },
  ]);
});

test('package publication enforces every channel suffix and maintenance version range', () => {
  const base = { registry: 'https://npm.pkg.github.com', manager: 'npm', directory: '.' };
  for (const [channel, version] of [['preview','1.3.0-dev.1'], ['rc','1.3.0-rc.1'], ['ci','1.3.0-ci-do-not-use.1'], ['stable','1.3.0'], ['maintenance-1.x','1.2.4'], ['maintenance-1.2.x','1.2.4']]) {
    validateRelease({ ...base, channel, version, tag: `v${version}` });
  }
  for (const [channel, version] of [['preview','1.3.0-rc.1'], ['rc','1.3.0-dev.1'], ['ci','1.3.0-ci.1'], ['maintenance-1.2.x','1.3.0'], ['maintenance-1.x','2.0.0'], ['maintenance-1.x','1.2.0-dev.1']]) {
    assert.throws(() => validateRelease({ ...base, channel, version, tag: `v${version}` }));
  }
});

test('container verification and publication accept backports but reject cross-range versions', t => {
  const root = mkdtempSync(join(tmpdir(), 'maintenance-validation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  for (const file of ['wf-publish-container.yml','wf-verify-container.yml']) {
    const workflow = parse(readFileSync(new URL('../../.github/workflows/' + file, import.meta.url), 'utf8'));
    const step = Object.values(workflow.jobs)[0].steps.find(s => s.name === 'Validate release and build inputs');
    const run = version => execFileSync(bash, ['-c', step.run], { cwd: root, stdio: 'pipe', env: {
      ...process.env, IMAGE: 'ghcr.io/medrunner-services/test', CONTEXT_PATH: '.', DOCKERFILE_PATH: 'Dockerfile',
      VERSION: version, RELEASE_TAG: `v${version}`, CHANNEL: 'maintenance-1.2.x', VERSION_BUILD_ARG_NAME: 'VERSION', GITHUB_OUTPUT: join(root, 'output').replaceAll('\\','/'),
    }});
    run('1.2.4');
    assert.throws(() => run('1.3.0'));
    assert.throws(() => run('1.2.4-dev.1'));
  }
});
