import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateRelease({ version, tag, channel, registry, manager, directory }) {
  const core = '(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)';
  const pattern = channel === 'dev' ? `^${core}-dev\\.(0|[1-9][0-9]*)$` : `^${core}$`;
  if (!['dev', 'stable'].includes(channel) || !new RegExp(pattern).test(version))
    throw new Error('Use a stable SemVer or a dev prerelease matching its channel.');
  if (tag !== `v${version}`) throw new Error('Release tag must equal v<version>.');
  if (!['https://registry.npmjs.org', 'https://npm.pkg.github.com'].includes(registry))
    throw new Error('Unsupported package registry.');
  if (!['npm', 'pnpm'].includes(manager)) throw new Error('Use npm or pnpm.');
  if (!directory || directory.startsWith('/') || directory.includes('..') || directory.includes('\\'))
    throw new Error('Use a repository-relative project directory.');
}

export function prepareManifest(manifest, { version, channel, registry }) {
  if (manifest.private) throw new Error('Cannot publish a private package.');
  if (!/^(@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(manifest.name ?? ''))
    throw new Error('Invalid package name.');
  // An existing publishConfig.tag (often latest) must never promote a dev release.
  const publishConfig = { ...manifest.publishConfig, registry, tag: channel };
  for (const key of Object.keys(publishConfig)) {
    if (key.endsWith(':registry')) delete publishConfig[key];
  }
  return { ...manifest, version, publishConfig };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const release = {
    version: process.env.VERSION, tag: process.env.RELEASE_TAG, channel: process.env.CHANNEL,
    registry: process.env.REGISTRY_URL, manager: process.env.PACKAGE_MANAGER,
    directory: process.env.WORKING_DIRECTORY,
  };
  validateRelease(release);
  const manifestPath = resolve(release.directory, 'package.json');
  const manifest = prepareManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), release);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `package-name=${manifest.name}\n`);
}
