import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';

test('backpropagation checks credentials for the selected approval mode before creating a PR', () => {
  const workflow = parse(readFileSync(new URL('../../.github/workflows/wf-release-semantic.yml', import.meta.url), 'utf8'));
  const script = workflow.jobs.release.steps.find(step => step.name === 'Validate backpropagation credentials').run;
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const run = overrides => execFileSync(bash, ['-c', script], { encoding: 'utf8', stdio: 'pipe', env: {
    ...process.env, APPROVE: 'true', APPROVE_WITH_GITHUB_TOKEN: 'false', PR_CREATION_PAT: '', PR_AUTOMATION_PAT: '', ...overrides,
  }});
  assert.throws(() => run({}), /PR_AUTOMATION_PAT is required/);
  assert.throws(() => run({ APPROVE_WITH_GITHUB_TOKEN: 'true' }), /PR_CREATION_PAT is required/);
  assert.equal(run({ APPROVE_WITH_GITHUB_TOKEN: 'true', PR_CREATION_PAT: 'fixture-author-token' }), '');
  assert.equal(run({ PR_AUTOMATION_PAT: 'fixture-review-token' }), '');
  assert.equal(run({ APPROVE: 'false' }), '');
});
