import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { parse } from 'yaml';

test('stable reachability authenticates private Git fetches without persisting credentials', async t => {
  const root = mkdtempSync(join(tmpdir(), 'release-workflow-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const remote = join(root, 'remote.git');
  mkdirSync(source);
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'safe.directory=' + cwd, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(root, 'init', '--bare', remote);
  git(source, 'init', '--initial-branch=main');
  git(source, 'config', 'user.name', 'Workflow test');
  git(source, 'config', 'user.email', 'workflow@example.invalid');
  git(source, 'commit', '--allow-empty', '-m', 'feat: first release');
  git(source, 'branch', 'release/stable');
  git(source, 'push', remote, 'main', 'release/stable');
  git(remote, 'update-server-info');

  const token = 'fixture-token-for-private-fetch';
  const authorization = 'Basic ' + Buffer.from('x-access-token:' + token).toString('base64');
  let authenticatedRequests = 0;
  const server = createServer((request, response) => {
    if (request.headers.authorization !== authorization) {
      response.writeHead(401, { 'www-authenticate': 'Basic realm="private-git"' });
      response.end();
      return;
    }
    authenticatedRequests++;
    const path = resolve(remote, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!path.startsWith(remote + sep) || !existsSync(path)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end(readFileSync(path));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  git(source, 'remote', 'add', 'origin', 'http://127.0.0.1:' + server.address().port);
  const before = readFileSync(join(source, '.git/config'), 'utf8');
  const run = promisify(execFile);
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: source };
  await assert.rejects(run('git', ['-c', 'credential.helper=', 'fetch', 'origin'], { cwd: source, env }), /terminal prompts disabled|Authentication failed/);

  const workflow = parse(readFileSync(new URL('../../.github/workflows/wf-release-semantic.yml', import.meta.url), 'utf8'));
  const step = workflow.jobs.release.steps.find(step => step.name === 'Check stable release reachability');
  const output = join(root, 'output');
  writeFileSync(output, '');
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  await run(bash, ['-c', step.run], {
    cwd: source,
    env: { ...env, GH_TOKEN: token, RELEASE_REF_NAME: 'release/stable', DEFAULT_BRANCH: 'main', GITHUB_OUTPUT: output.replaceAll('\\', '/') },
  });
  assert.ok(authenticatedRequests > 0);
  assert.match(readFileSync(output, 'utf8'), /needed=false/);
  assert.equal(git(source, 'rev-parse', 'origin/release/stable'), git(source, 'rev-parse', 'HEAD'));
  assert.equal(readFileSync(join(source, '.git/config'), 'utf8'), before);
});
