import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareManifest, validateRelease } from '../../.github/scripts/node-publication.mjs';

const stable = { version: '1.2.3', tag: 'v1.2.3', channel: 'stable', registry: 'https://registry.npmjs.org', manager: 'npm', directory: '.' };
const dev = { ...stable, version: '1.3.0-dev.2', tag: 'v1.3.0-dev.2', channel: 'dev' };

test('stable and dev releases are accepted for both registries and managers', () => {
  for (const release of [stable, dev]) {
    for (const registry of ['https://registry.npmjs.org', 'https://npm.pkg.github.com']) {
      for (const manager of ['npm', 'pnpm']) validateRelease({ ...release, registry, manager });
    }
  }
});

test('rejects mismatched tags, unsafe paths, and cross-channel promotions', () => {
  for (const change of [
    { tag: 'v9.9.9' }, { version: '1.2.3-beta.1', tag: 'v1.2.3-beta.1' },
    { channel: 'dev' }, { channel: 'latest' }, { directory: '../project' },
    { directory: '/tmp/project' }, { directory: 'C:\\project' }, { registry: 'https://example.invalid' },
    { manager: 'yarn' }, { version: '01.2.3', tag: 'v01.2.3' },
  ]) assert.throws(() => validateRelease({ ...stable, ...change }));
  assert.throws(() => validateRelease({ ...dev, channel: 'stable' }));
});

test('release version and channel override source manifest publication defaults', () => {
  const source = { name: '@medrunner/api-client', version: '0.7.0', publishConfig: { access: 'public', tag: 'latest', '@medrunner:registry': 'https://example.invalid' } };
  const result = prepareManifest(source, dev);
  assert.equal(result.version, dev.version);
  assert.deepEqual(result.publishConfig, { access: 'public', tag: 'dev', registry: dev.registry });
  assert.equal(source.publishConfig.tag, 'latest');
});

test('private or invalid packages cannot be published', () => {
  assert.throws(() => prepareManifest({ name: '@medrunner/api-client', private: true }, stable));
  assert.throws(() => prepareManifest({ name: 'bad name' }, stable));
});
