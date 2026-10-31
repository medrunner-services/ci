# Package delivery

```mermaid
flowchart LR
  Config[Caller release configuration] --> Release[Shared semantic-release runner]
  Release --> Publish[Shared publisher: immutable release tag]
  Channels[Caller channels and aliases] --> Publish
  Publish --> Registry[Selected registry]
```

The caller owns branches, maintenance ranges, channels, prerelease suffixes, and release plugins.
The shared release workflow runs that configuration without overriding its branch definitions or enforcing a release-channel policy.

Pass new-version, new-tag, and new-channel to the publishing job when release-published is true.
The package publisher checks out that tag, performs a frozen npm/pnpm install, stamps the package version, builds, and publishes in the same workflow run.

Any npm-compatible channel is supported, with any valid SemVer version; the publisher does not pair channel names with prerelease identifiers or impose maintenance ranges.
An empty semantic-release channel uses the registry default latest tag; the registry/npm client validates additional registry-specific rules.

The publisher checks version syntax, the v<version> source-tag contract, npm tag URI safety, project paths, manager support, publishable package metadata, and registry URL syntax.
The caller-selected registry/channel replace source publishConfig defaults in the publication artifact.

GitHub Packages uses the caller GITHUB_TOKEN and the publish-gh-npm environment.
Public npm uses publish-npm, with an existing NPM_TOKEN or an already-configured trusted publisher; other HTTP(S) npm registries can use NPM_TOKEN and a caller-selected environment.

Container publication accepts any valid OCI channel tag and either a release or prerelease version.
It publishes the version tags and selected channel, with no automatic latest or channel-latest aliases; callers request any additional aliases with the comma-separated additional-tags input.

Maintenance range enforcement belongs to semantic-release and the downstream configuration.
For prefixed maintenance names such as release/1.2.x, that repository must provide the explicit range 1.2.x; this platform does not discover or rename maintenance branches.

Backpropagation is optional and keyed to the caller-configured release-ref-name, not a reserved channel name.
Approval and auto-merge remain separately configurable.

Consumers reference the shared workflows through floating @v1.
Merge and release platform changes before callers rely on new inputs such as additional-tags; promoting main to stable carries the unified workflow without a separate stable-sync PR.

## Unattended stable backpropagation

```mermaid
flowchart LR
  Release[Stable release] --> Author[PAT identity creates stable-to-main PR]
  Author --> Checks[Automatic PR checks]
  Author --> Review[github-actions bot approves]
  Checks --> Merge[Merge commit after repository requirements]
  Review --> Merge
  Merge --> Main[Main push workflows]
```

For a single stored PAT, supply PR_CREATION_PAT in each caller's release environment and set backpropagation-approve-with-github-token: true.
The PAT creates the PR and requests auto-merge; the job GITHUB_TOKEN is the independent reviewer, so repository Actions settings must allow creating and approving PRs.

The PAT identity needs repository access with Contents read/write and Pull requests read/write, and permission to merge into main under its existing rules.
The PR author and reviewer must be different identities; the alternative existing PR_AUTOMATION_PAT mode remains available for a separate external reviewer.

The creator PAT lets PR checks run automatically and the final merged-main push trigger its normal workflows.
GITHUB_TOKEN-created PRs can require human approval of workflow runs, and GITHUB_TOKEN pushes do not trigger normal push workflows.

Enable repository auto-merge and allow merge commits, since squash/rebase do not preserve the tagged stable commit's ancestry.
Required linear history conflicts with this operation; do not bypass or silently remove it. Required reviews/checks, push restrictions, CODEOWNERS, and environment gates still apply.

The current action applies the ci and automated labels; provision them in the repositories.
Protect the release environment and restrict the PAT to the intended repositories; the workflow never prints credential values.
