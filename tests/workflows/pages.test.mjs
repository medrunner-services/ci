import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pages-workflow-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'github-env'), '');
  writeFileSync(join(root, 'github-output'), '');
  writeFileSync(join(root, 'package.json'), '{"name":"fixture","version":"2.10.0"}\n');
  mkdirSync(join(root, 'dist'));
  return root;
}
function runStep(name, root, patch = {}) {
  const workflow = parse(readFileSync(new URL('../../.github/workflows/wf-deploy-cloudflare-pages.yml', import.meta.url), 'utf8'));
  const step = workflow.jobs.deploy.steps.find(step => step.name === name);
  assert.ok(step, 'Expected inline workflow step: ' + name);
  const script = step.run.match(/<<'NODE'\n([\s\S]*)\nNODE\s*$/)[1];
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, GITHUB_ENV: join(root, 'github-env'), GITHUB_OUTPUT: join(root, 'github-output'),
      WORKING_DIRECTORY: '.', RELEASE_VERSION: '', DEPLOY_BRANCH: 'main', PRODUCTION_BRANCH: 'release/stable',
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: root, ...patch },
  });
}
function publicEnv(patch = {}) {
  return { PUBLIC_VARIABLES: '{"API_URL":"https://api.example.com","CALLBACK_URL":"https://stage.example.com","UNRELATED":"do-not-export"}',
    PUBLIC_ENV_MAP: '{"SITE_API_URL":"API_URL","SITE_CALLBACK":"CALLBACK_URL","SITE_ANALYTICS":"ANALYTICS"}',
    REQUIRED_PUBLIC_ENV: '["SITE_API_URL","SITE_CALLBACK"]', ...patch };
}

test('only requested public environment variables are exported, with missing optional values empty', t => {
  const root = fixture(t);
  const result = runStep('Set public build environment', root, publicEnv({ CLOUDFLARE_API_TOKEN: 'do-not-export' }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(root, 'github-env'), 'utf8'), 'SITE_API_URL=https://api.example.com\nSITE_CALLBACK=https://stage.example.com\nSITE_ANALYTICS=\n');
});
test('missing required values fail before anything is exported', t => {
  const root = fixture(t);
  const result = runStep('Set public build environment', root, publicEnv({ PUBLIC_VARIABLES: '{}' }));
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(join(root, 'github-env'), 'utf8'), '');
});
test('multiline values and reserved runner variables cannot be injected', t => {
  for (const patch of [
    { PUBLIC_VARIABLES: '{"API_URL":"https://example.com\\nPRIVATE_TOKEN=oops"}' },
    { PUBLIC_ENV_MAP: '{"NODE_OPTIONS":"API_URL"}' },
  ]) {
    const root = fixture(t);
    assert.notEqual(runStep('Set public build environment', root, publicEnv(patch)).status, 0);
    assert.equal(readFileSync(join(root, 'github-env'), 'utf8'), '');
  }
});
test('a published version stamps the local manifest without changing the frozen lockfile', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'unchanged lockfile');
  const result = runStep('Set build version', root, { RELEASE_VERSION: '2.11.0-dev.3' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).version, '2.11.0-dev.3');
  assert.equal(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'), 'unchanged lockfile');
  assert.equal(readFileSync(join(root, 'github-output'), 'utf8'), 'version=2.11.0-dev.3\n');
});
test('invalid versions fail without changing the build manifest', t => {
  const root = fixture(t);
  assert.notEqual(runStep('Set build version', root, { RELEASE_VERSION: 'version\nBAD=value' }).status, 0);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).version, '2.10.0');
});
test('without release history the source package version is preserved', t => {
  const root = fixture(t);
  const result = runStep('Set build version', root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(root, 'github-output'), 'utf8'), 'version=2.10.0\n');
});

function releaseFixture(t) {
  const root = fixture(t);
  const git = (...args) => execFileSync('git', ['-c', 'safe.directory=' + root, ...args], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Workflow test');
  git('config', 'user.email', 'workflow@example.invalid');
  git('commit', '--allow-empty', '-m', 'feat: stable release');
  git('tag', '-a', 'v2.12.0', '-m', 'stable');
  return { root, git };
}

test('commit metadata identifies exact released source and is exported to the build environment', t => {
  const { root, git } = releaseFixture(t);
  const version = '2.12.0+0.g' + git('rev-parse', '--short=7', 'HEAD');
  const result = runStep('Set build version', root, {
    RELEASE_VERSION: '2.12.0', INCLUDE_COMMIT_METADATA: 'true',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).version, version);
  assert.equal(readFileSync(join(root, 'github-output'), 'utf8'), 'version=' + version + '\n');
  assert.equal(readFileSync(join(root, 'github-env'), 'utf8'), 'APP_VERSION=' + version + '\n');
});

test('metadata distinguishes nonrelease commits while production excludes prerelease tags', t => {
  const { root, git } = releaseFixture(t);
  git('commit', '--allow-empty', '-m', 'feat: staging release');
  git('tag', '-a', 'v2.13.0-dev.1', '-m', 'staging');
  git('commit', '--allow-empty', '-m', 'ci: deploy without a new release');
  const sha = git('rev-parse', '--short=7', 'HEAD');
  for (const [branch, version] of [
    ['main', '2.13.0-dev.1+1.g' + sha], ['release/stable', '2.12.0+2.g' + sha],
  ]) {
    writeFileSync(join(root, 'github-output'), '');
    const result = runStep('Set build version', root, { DEPLOY_BRANCH: branch, INCLUDE_COMMIT_METADATA: 'true' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(root, 'github-output'), 'utf8'), 'version=' + version + '\n');
  }
});

test('valid caller build metadata is accepted without opting into Git metadata', t => {
  const root = fixture(t);
  const result = runStep('Set build version', root, { RELEASE_VERSION: '2.11.0-dev.3+build.42' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).version, '2.11.0-dev.3+build.42');
});

test('tagless Git builds still identify their source and do not invent a tag distance', t => {
  const { root, git } = releaseFixture(t);
  git('tag', '-d', 'v2.12.0');
  const result = runStep('Set build version', root, { INCLUDE_COMMIT_METADATA: 'true' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).version, '2.10.0+g' + git('rev-parse', '--short=7', 'HEAD'));
});

test('malformed SemVer identifiers fail before changing the manifest', t => {
  for (const version of ['02.11.0', '2.11.0-dev..3', '2.11.0-dev.03', '2.11.0+build..42', '2.11.0\n']) {
    const root = fixture(t);
    assert.notEqual(runStep('Set build version', root, { RELEASE_VERSION: version }).status, 0, version);
    assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).version, '2.10.0');
  }
});
test('nonrelease merges keep the reachable release version; production ignores prerelease tags', t => {
  const root = fixture(t);
  const git = (...args) => execFileSync('git', ['-c', 'safe.directory=' + root, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Workflow test');
  git('config', 'user.email', 'workflow@example.invalid');
  git('commit', '--allow-empty', '-m', 'feat: stable release');
  git('tag', '-a', 'v2.12.0', '-m', 'stable');
  git('commit', '--allow-empty', '-m', 'feat: staging release');
  git('tag', '-a', 'v2.13.0-dev.1', '-m', 'staging');
  git('commit', '--allow-empty', '-m', 'docs: merge with no new version');
  for (const [branch, version] of [['main', '2.13.0-dev.1'], ['release/stable', '2.12.0']]) {
    writeFileSync(join(root, 'github-output'), '');
    const result = runStep('Set build version', root, { DEPLOY_BRANCH: branch });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).version, version);
  }
});
