import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateRelease({ version, tag, channel, registry, manager, directory }) {
  const numeric = '(0|[1-9][0-9]*)';
  const identifier = '(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
  const semver = new RegExp(String.raw`^${numeric}\.${numeric}\.${numeric}(-${identifier}(\.${identifier})*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$`);
  if (!semver.test(version)) throw new Error('Version must be valid SemVer.');
  if (typeof channel !== 'string' || encodeURIComponent(channel || 'latest') !== (channel || 'latest'))
    throw new Error('Channel must be a URI-safe npm dist-tag (or empty for the registry default).');
  if (tag !== `v${version}`) throw new Error('Release tag must equal v<version>.');
  let registryUrl;
  try { registryUrl = new URL(registry); } catch { throw new Error('Registry must be a valid HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(registryUrl.protocol) || registryUrl.username || registryUrl.password || registryUrl.search || registryUrl.hash)
    throw new Error('Registry must be an HTTP(S) URL without embedded credentials, query, or fragment.');
  if (!['npm', 'pnpm'].includes(manager)) throw new Error('Use npm or pnpm.');
  if (!directory || directory.startsWith('/') || directory.includes('..') || directory.includes('\\'))
    throw new Error('Use a repository-relative project directory.');
}

export function prepareManifest(manifest, { version, channel, registry }) {
  if (manifest.private) throw new Error('Cannot publish a private package.');
  if (!/^(@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(manifest.name ?? ''))
    throw new Error('Invalid package name.');
  // The caller-selected channel takes precedence over source publication defaults.
  const publishConfig = { ...manifest.publishConfig, registry, tag: channel || 'latest' };
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
