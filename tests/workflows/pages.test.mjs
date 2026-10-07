import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, truncateSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';

function runStep(workflow, name, root, env = {}) {
  const file = new URL(`../../.github/workflows/${workflow}`, import.meta.url);
  const definition = parse(readFileSync(file, 'utf8'));
  const step = Object.values(definition.jobs).flatMap(job => job.steps || []).find(step => step.name === name);
  const script = step.run.match(/<<'NODE'\n([\s\S]*)\nNODE\s*$/)[1];
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_WORKSPACE: root, ...env },
  });
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pages-workflow-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'github-env'), '');
  writeFileSync(join(root, 'github-output'), '');
  writeFileSync(join(root, 'package.json'), '{"name":"fixture","version":"2.10.0"}\n');
  mkdirSync(join(root, '.pages-deploy/dist'), { recursive: true });
  writeFileSync(join(root, '.pages-deploy/dist/index.html'), '<html>Fixture</html>');
  writeFileSync(join(root, 'wrangler.json'), JSON.stringify({ name: 'fixture-pages', pages_build_output_dir: './public', compatibility_date: '2026-10-07' }));
  return root;
}
function publicEnvironment(t, values = {}) {
  const root = fixture(t);
  const env = {
    GITHUB_ENV: join(root, 'github-env'), PUBLIC_VARIABLES: JSON.stringify({ API_URL: 'https://api.example.com', ...values }),
    PUBLIC_ENV_MAP: '{"SITE_API_URL":"API_URL","SITE_CALLBACK":"CALLBACK_URL"}',
    PUBLIC_ENV_OVERRIDES: '{"SITE_CALLBACK":"https://pr-12.fixture-pages.pages.dev"}',
    REQUIRED_PUBLIC_ENV: '["SITE_API_URL","SITE_CALLBACK"]',
  };
  return { root, env };
}
test('the selected public variables and preview overrides are exported without unrelated settings or secrets', t => {
  const { root, env } = publicEnvironment(t, { API_URL_PROD: 'https://stale.example.com', UNRELATED: 'do-not-export' });
  const result = runStep('wf-build-node.yml', 'Set public build environment', root, { ...env, CLOUDFLARE_API_TOKEN: 'do-not-export' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(root, 'github-env'), 'utf8'), 'SITE_API_URL=https://api.example.com\nSITE_CALLBACK=https://pr-12.fixture-pages.pages.dev\n');
});
test('missing required public values fail before anything is exported', t => {
  const { root, env } = publicEnvironment(t, { API_URL: '' });
  const result = runStep('wf-build-node.yml', 'Set public build environment', root, env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SITE_API_URL/);
  assert.equal(readFileSync(join(root, 'github-env'), 'utf8'), '');
});
test('multiline values and reserved runner variable names cannot be injected', t => {
  for (const patch of [
    { PUBLIC_VARIABLES: '{"API_URL":"https://example.com\\nPRIVATE_TOKEN=oops"}' },
    { PUBLIC_ENV_OVERRIDES: '{"NODE_OPTIONS":"--require=payload"}' },
  ]) {
    const { root, env } = publicEnvironment(t);
    const result = runStep('wf-build-node.yml', 'Set public build environment', root, { ...env, ...patch });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(join(root, 'github-env'), 'utf8'), '');
  }
});
test('semantic release versions stamp the local build manifest without changing the lockfile', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'unchanged lockfile');
  const result = runStep('wf-build-node.yml', 'Set build version', root, { WORKING_DIRECTORY: '.', RELEASE_VERSION: '2.11.0-dev.3', GITHUB_OUTPUT: join(root, 'github-output') });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).version, '2.11.0-dev.3');
  assert.equal(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'), 'unchanged lockfile');
  assert.equal(readFileSync(join(root, 'github-output'), 'utf8'), 'version=2.11.0-dev.3\n');
});
test('invalid generated versions cannot enter a build', t => {
  const root = fixture(t);
  const result = runStep('wf-build-node.yml', 'Set build version', root, { WORKING_DIRECTORY: '.', RELEASE_VERSION: 'version\nBAD=value', GITHUB_OUTPUT: join(root, 'github-output') });
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).version, '2.10.0');
});
function prepare(root, patch = {}) {
  return runStep('wf-deploy-cloudflare-pages.yml', 'Prepare static deployment', root, {
    CONFIG_PATH: 'wrangler.json', DEPLOY_BRANCH: 'pr-12', SOURCE_SHA: 'a'.repeat(40), ...patch,
    GITHUB_OUTPUT: join(root, 'github-output'),
  });
}
test('deployment uses trusted configuration and an isolated artifact output directory', t => {
  const root = fixture(t);
  const result = prepare(root);
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(readFileSync(join(root, '.pages-deploy/wrangler.json')));
  assert.equal(config.name, 'fixture-pages');
  assert.equal(config.pages_build_output_dir, './dist');
  assert.equal(config.compatibility_date, '2026-10-07');
  assert.equal(readFileSync(join(root, 'github-output'), 'utf8'), 'project=fixture-pages\n');
});
test('Pages Functions, Workers, routing files, and hidden assets cannot be uploaded by the static workflow', t => {
  for (const name of ['_worker.js', '_routes.json', '.env', 'functions']) {
    const root = fixture(t);
    writeFileSync(join(root, '.pages-deploy/dist', name), 'forbidden');
    const result = prepare(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /static|hidden/i);
  }
});
test('unsafe configuration paths and branch arguments fail before deployment', t => {
  const root = fixture(t);
  for (const patch of [{ CONFIG_PATH: '../wrangler.json' }, { DEPLOY_BRANCH: 'main --project-name=other' }, { SOURCE_SHA: 'invalid' }]) {
    assert.notEqual(prepare(root, patch).status, 0);
  }
});
test('a missing HTML entry point fails before deployment', t => {
  const root = fixture(t);
  rmSync(join(root, '.pages-deploy/dist/index.html'));
  const result = prepare(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /index.html/);
});
test('oversized static assets are refused before upload', t => {
  const root = fixture(t);
  const path = join(root, '.pages-deploy/dist/too-large.bin');
  writeFileSync(path, '');
  truncateSync(path, 25 * 1024 * 1024 + 1);
  assert.notEqual(prepare(root).status, 0);
});

test('linked asset directories are rejected rather than traversed', t => {
  const root = fixture(t);
  mkdirSync(join(root, 'outside'));
  writeFileSync(join(root, 'outside/private.txt'), 'do not deploy');
  symlinkSync(join(root, 'outside'), join(root, '.pages-deploy/dist/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = prepare(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symlink/i);
});

function routeEvent(t, { eventName = 'push', ref = 'refs/heads/main', event = {}, patch = {}, root = fixture(t) } = {}) {
  writeFileSync(join(root, 'event.json'), JSON.stringify(event));
  const result = runStep('wf-deliver-node-pages.yml', 'Select delivery target', root, {
    GITHUB_EVENT_NAME: eventName, GITHUB_REF: ref, GITHUB_SHA: 'a'.repeat(40),
    GITHUB_REPOSITORY: 'owner/site', GITHUB_EVENT_PATH: join(root, 'event.json'), GITHUB_OUTPUT: join(root, 'github-output'),
    PRODUCTION_BRANCH: 'release/stable', STAGING_BRANCH: 'main', ENVIRONMENT_PREFIX: 'deploy-cf',
    PREVIEW_BRANCH_PREFIXES: 'feat/,fix/', PREVIEW_CALLBACK_VARIABLE: 'SITE_CALLBACK', CONFIG_PATH: 'wrangler.json', ...patch,
  });
  const outputs = Object.fromEntries(readFileSync(join(root, 'github-output'), 'utf8').trim().split('\n').filter(Boolean).map(line => {
    const equals = line.indexOf('=');
    return [line.slice(0, equals), line.slice(equals + 1)];
  }));
  return { result, outputs };
}
test('branch routing selects the configured production and staging environments', t => {
  const production = routeEvent(t, { ref: 'refs/heads/release/stable' });
  assert.equal(production.result.status, 0, production.result.stderr);
  assert.equal(production.outputs['environment-name'], 'deploy-cf-production');
  assert.equal(production.outputs['build-script'], 'build');
  const staging = routeEvent(t, { patch: { STAGING_BRANCH: 'trunk', ENVIRONMENT_PREFIX: 'web' }, ref: 'refs/heads/trunk' });
  assert.equal(staging.result.status, 0, staging.result.stderr);
  assert.equal(staging.outputs['environment-name'], 'web-staging');
  assert.equal(staging.outputs.branch, 'trunk');
});
test('eligible previews use merge commits, trusted base configuration, and generated callback origins', t => {
  for (const head of ['feat/map', 'fix/login']) {
    const event = { number: 12, pull_request: { draft: false, base: { ref: 'release/stable', sha: 'b'.repeat(40) }, head: { ref: head, repo: { full_name: 'owner/site' } } } };
    const { result, outputs } = routeEvent(t, { eventName: 'pull_request', ref: 'refs/pull/12/merge', event });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(outputs.deploy, 'true');
    assert.equal(outputs['source-sha'], 'a'.repeat(40));
    assert.equal(outputs['config-ref'], 'b'.repeat(40));
    assert.equal(outputs['environment-name'], 'deploy-cf-preview');
    assert.equal(JSON.parse(outputs['public-env-overrides']).SITE_CALLBACK, 'https://pr-12.fixture-pages.pages.dev');
  }
});
test('forks, drafts and other PR branches build without deployment or preview callback overrides', t => {
  for (const [head, repo, draft] of [['feat/map', 'someone/fork', false], ['feat/map', 'owner/site', true], ['chore/deps', 'owner/site', false]]) {
    const event = { number: 12, pull_request: { draft, base: { ref: 'main', sha: 'b'.repeat(40) }, head: { ref: head, repo: { full_name: repo } } } };
    const { result, outputs } = routeEvent(t, { eventName: 'pull_request', ref: 'refs/pull/12/merge', event });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(outputs.deploy, 'false');
    assert.equal(outputs['environment-name'], 'deploy-cf-preview');
    assert.equal(outputs['public-env-overrides'], '{}');
  }
});
test('manual deployments refuse unsupported branches and tags from the wrong channel', t => {
  for (const options of [
    { ref: 'refs/heads/feat/map', patch: { RELEASE_TAG: 'v2.10.0' } },
    { ref: 'refs/heads/main', patch: { RELEASE_TAG: 'v2.10.0' } },
    { ref: 'refs/heads/release/stable', patch: { RELEASE_TAG: 'v2.11.0-dev.1' } },
  ]) assert.notEqual(routeEvent(t, { ...options, eventName: 'workflow_dispatch' }).result.status, 0);
});

test('manual redeployment resolves annotated tags and refuses history outside the selected branch', t => {
  const root = fixture(t);
  const git = (...args) => execFileSync('git', ['-c', 'safe.directory=' + root, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Workflow test');
  git('config', 'user.email', 'workflow@example.invalid');
  git('commit', '--allow-empty', '-m', 'feat: original release');
  const released = git('rev-parse', 'HEAD');
  git('tag', '-a', 'v2.11.0-dev.1', '-m', 'Staging release');
  git('tag', '-a', 'v2.10.0', '-m', 'Stable release');
  git('commit', '--allow-empty', '-m', 'fix: later change');
  const current = git('rev-parse', 'HEAD');
  const patch = { GITHUB_SHA: current, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: root };
  for (const [ref, tag, version] of [['main', 'v2.11.0-dev.1', '2.11.0-dev.1'], ['release/stable', 'v2.10.0', '2.10.0']]) {
    writeFileSync(join(root, 'github-output'), '');
    const { result, outputs } = routeEvent(t, { root, eventName: 'workflow_dispatch', ref: 'refs/heads/' + ref, patch: { ...patch, RELEASE_TAG: tag } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(outputs['source-sha'], released);
    assert.equal(outputs['config-ref'], released);
    assert.equal(outputs.version, version);
  }
  git('checkout', '--orphan', 'unrelated');
  git('commit', '--allow-empty', '-m', 'feat: unrelated history');
  git('tag', 'v9.0.0-dev.1');
  writeFileSync(join(root, 'github-output'), '');
  const { result, outputs } = routeEvent(t, { root, eventName: 'workflow_dispatch', patch: { ...patch, RELEASE_TAG: 'v9.0.0-dev.1' } });
  assert.notEqual(result.status, 0);
  assert.deepEqual(outputs, {});
});
