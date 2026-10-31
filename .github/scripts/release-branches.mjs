import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function releaseBranches(names) {
  const maintenance = [...new Set(names)].filter(name => /^release\/(0|[1-9]\d*)(\.(0|[1-9]\d*))?\.x$/.test(name));
  return [
    ...maintenance.sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map(name => ({
      name, range: name.slice('release/'.length), channel: `maintenance-${name.slice('release/'.length)}`,
    })),
    { name: 'release/stable', channel: 'stable' },
    { name: 'release/rc', channel: 'rc', prerelease: 'rc' },
    { name: 'main', channel: 'preview', prerelease: 'dev' },
    { name: 'ci', channel: 'ci', prerelease: 'ci-do-not-use' },
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // checkout with fetch-depth: 0 fetches all remote branch heads, including maintenance lines.
  const refs = execFileSync('git', ['for-each-ref', '--format=%(refname:strip=3)', 'refs/remotes/origin/'], { encoding: 'utf8' });
  appendFileSync(process.env.GITHUB_OUTPUT, `branches=${JSON.stringify(releaseBranches(refs.trim().split('\n')))}\n`);
}
