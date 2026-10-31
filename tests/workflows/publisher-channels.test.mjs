import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateRelease, prepareManifest } from '../../.github/scripts/node-publication.mjs';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';

test('repositories can publish arbitrary channel and version combinations', () => {
  const base = { registry: 'https://npm.pkg.github.com', manager: 'npm', directory: '.' };
  validateRelease({ ...base, registry: 'https://packages.example.invalid/repository/npm/', channel: 'custom', version: '1.2.3', tag: 'v1.2.3' });
  for (const channel of ['', 'latest', 'beta', 'nightly', 'customer-a', 'stable', 'preview', 'maintenance-1.2.x']) {
    for (const version of ['1.3.0', '1.3.0-beta.2', '1.3.0-custom.1', '1.3.0+build.7']) {
      validateRelease({ ...base, channel, version, tag: `v${version}` });
    }
  }
});

test('the semantic-release default channel uses the registry latest tag', () => {
  assert.equal(prepareManifest({ name: 'fixture' }, { version: '1.2.3', channel: '', registry: 'https://registry.npmjs.org' }).publishConfig.tag, 'latest');
});

test('container validation accepts arbitrary channels while enforcing OCI syntax', t => {
  const root = mkdtempSync(join(tmpdir(), 'maintenance-validation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  for (const file of ['wf-publish-container.yml','wf-verify-container.yml']) {
    const workflow = parse(readFileSync(new URL('../../.github/workflows/' + file, import.meta.url), 'utf8'));
    const step = Object.values(workflow.jobs)[0].steps.find(s => s.name === 'Validate release and build inputs');
    const run = (version, channel = 'customer-a', additionalTags = '') => execFileSync(bash, ['-c', step.run], { cwd: root, stdio: 'pipe', env: {
      ...process.env, IMAGE: 'ghcr.io/medrunner-services/test', CONTEXT_PATH: '.', DOCKERFILE_PATH: 'Dockerfile',
      VERSION: version, RELEASE_TAG: `v${version}`, CHANNEL: channel, ADDITIONAL_TAGS: additionalTags, VERSION_BUILD_ARG_NAME: 'VERSION', GITHUB_OUTPUT: join(root, 'output').replaceAll('\\','/'),
    }});
    for (const channel of ['latest', 'beta', 'nightly', 'customer-a', 'stable', 'maintenance-1.2.x']) {
      run('1.3.0', channel);
      run('1.3.0-custom.1', channel);
    }
    assert.throws(() => run('1.3.0', 'bad/tag'));
    assert.throws(() => run('1.3.0', 'bad tag'));
    if (file === 'wf-publish-container.yml') {
      run('1.3.0', 'customer-a', 'latest,rolling');
      assert.throws(() => run('1.3.0', 'customer-a', 'bad/tag'));
    }
  }
});
