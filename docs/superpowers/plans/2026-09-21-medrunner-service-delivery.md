# Medrunner Service Delivery Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small, reusable GitHub Actions delivery platform that tests Medrunner services, produces semantic GitHub releases, back-propagates stable tagged history to `main`, and publishes Dockerfile-built GHCR images.

**Architecture:** Caller repositories own event triggers, image names, and protected environments.
They call typed .NET or Node test workflows, a generic Dockerfile verification workflow, the semantic-release workflow, and finally the generic GHCR publisher.
The release workflow owns the tag-derived version and invokes the existing C# PR transport only for a stable branch that is not already reachable from `main`.

**Tech Stack:** GitHub Actions reusable workflows, semantic-release 25.0.9, Node 24, .NET 10, Docker Buildx, GHCR, `act` 0.2.89, Docker 29.5.3, and the existing C# `release-backpropagation` composite action.

**Spec:** [../specs/2026-09-21-medrunner-service-delivery-design.md](../specs/2026-09-21-medrunner-service-delivery-design.md)

## Global Constraints

- Limit implementation changes to `D:\Git\github\medrunner-services\infra-metarepository\ci`.
- Do not modify the user-owned API, MED bot, or MOD bot worktrees under `D:\Git\github\medrunner-services\infra-aspire\ref`.
- Preserve the existing untracked `.gitignore`, `release.config.cjs`, and `renovate.jsonc` files.
- Do not use Python orchestration.
- Keep every application publication Dockerfile-based.
- Set top-level `permissions: {}` in every reusable workflow and grant minimal permissions at job level.
- Support `runs-on`, `runs-on-json`, and `runs-on-self-hosted` on every public reusable workflow.
- Use the protected `release` environment for semantic releases and stable back-propagation.
- Use the protected `publish-ghcr` environment for GHCR publication.
- Reserve `publish-gh-npm` and `publish-npm` as the standard environments for future private GitHub npm and public npm workflows.
- Use `main` for `dev` prereleases, `release/rc` for `rc` prereleases, and `release/stable` for stable releases.
- Publish immutable `vX.Y.Z[-suffix]` and `X.Y.Z[-suffix]` image tags, plus `<channel>` and `<channel>-latest` aliases.
- Publish unqualified `latest` only for the `stable` channel.
- Build a publishing artifact from semantic-release's immutable `new-tag`, not the moving branch ref.
- Do not commit or publish during implementation unless the user explicitly asks.

## Review Focus

1. A `release/stable` tag must be checked out exactly before GHCR build, so a branch advance cannot publish different source.
   Task 4 owns the `release-tag` checkout and static fixture validation.
2. A semantic-release no-op must not invoke the publisher or create a back-propagation PR.
   Task 5 owns its output conditions and no-op fixture assertions.
3. A stable commit that is already an ancestor of `main` must skip PR creation successfully.
   Task 5 owns the `git merge-base --is-ancestor` preflight and its local Git fixture.
4. A Dockerfile that mounts `NODE_AUTH_TOKEN` must receive it as a BuildKit secret rather than a Docker build argument.
   Task 4 owns the private-Dockerfile fixture and `act` invocation.
5. A fork pull request must not receive an npm or PR-approval secret.
   Tasks 3 and 5 own explicit secret declarations, `permissions: {}`, and actionlint fixtures that contain no secret inheritance.

---

## File Structure

- `configs/semantic-release-service.cjs` is the immutable service release plugin policy.
- `.github/workflows/wf-test-dotnet.yml` runs caller-selected .NET restore, build, test, and optional PostgreSQL integration tests.
- `.github/workflows/wf-test-node.yml` runs npm installation plus selected build, lint, Prettier, and test scripts.
- `.github/workflows/wf-verify-container.yml` proves a caller Dockerfile builds without publishing.
- `.github/workflows/wf-publish-container.yml` checks out a semantic tag and publishes generic GHCR images.
- `.github/workflows/wf-release-semantic.yml` runs tag-only semantic-release and invokes stable back-propagation as a step in its `release` job.
- `.github/actions/release-backpropagation/` contains the established PR transport without behavior changes.
- `.github/workflows/release.yml` releases this CI platform using the pre-existing root `release.config.cjs` after its workflow contract checks pass.
- `tests/fixtures/mock-projects/` holds minimal Node and .NET projects with public and BuildKit-secret Dockerfiles.
- `tests/fixtures/workflow-contract/` holds local reusable-workflow callers that `act` can execute without real package or GitHub credentials.
- `tests/fixtures/git/` holds a deterministic tagged release-history fixture for back-propagation reachability checks.
- `docs/workflow-catalog.md` documents the public workflow API, permissions, side effects, environments, and release graph.
- `docs/consumer-workflows.md` gives API, MED, and MOD caller workflows plus the standard environment contract.

### Task 1: Create Local Contract Fixtures And Test Assets

**Files:**
- Create: `tests/fixtures/mock-projects/node/package.json`
- Create: `tests/fixtures/mock-projects/node/package-lock.json`
- Create: `tests/fixtures/mock-projects/node/Dockerfile`
- Create: `tests/fixtures/mock-projects/node/Dockerfile.private-npm`
- Create: `tests/fixtures/mock-projects/dotnet/Mock.Container.App/Mock.Container.App.csproj`
- Create: `tests/fixtures/mock-projects/dotnet/Mock.Container.App/Program.cs`
- Create: `tests/fixtures/mock-projects/dotnet/Mock.Container.App.Tests/Mock.Container.App.Tests.csproj`
- Create: `tests/fixtures/mock-projects/dotnet/Mock.Container.App.Tests/PostgresReachabilityTests.cs`
- Create: `tests/fixtures/mock-projects/dotnet/Dockerfile`
- Create: `tests/fixtures/workflow-contract/node-local.yml`
- Create: `tests/fixtures/workflow-contract/dotnet-local.yml`
- Create: `tests/fixtures/workflow-contract/container-public-local.yml`
- Create: `tests/fixtures/workflow-contract/container-private-local.yml`
- Create: `tests/fixtures/workflow-contract/release-stable-local.yml`
- Create: `tests/fixtures/events/workflow_dispatch.json`
- Create: `tests/fixtures/git/release-stable-reachable.sh`
- Create: `tests/fixtures/git/release-stable-needs-backprop.sh`

**Interfaces:**
- Consumes: Local reusable workflows at `.github/workflows/wf-*.yml`.
- Produces: Deterministic `act` callers for Tasks 2 through 5 and real Git ancestry fixtures for stable back-propagation preflight.

- [ ] **Step 1: Add a zero-dependency Node fixture and two Dockerfiles.**

```json
{
  "name": "workflow-contract-node",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "build": "node -e \"process.stdout.write('build ok\\n')\"",
    "lint": "node -e \"process.stdout.write('lint ok\\n')\"",
    "prettier": "node -e \"process.stdout.write('prettier ok\\n')\"",
    "test": "node -e \"process.stdout.write('test ok\\n')\""
  }
}
```

```json
{
  "name": "workflow-contract-node",
  "version": "0.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "workflow-contract-node",
      "version": "0.0.0"
    }
  }
}
```

```dockerfile
# tests/fixtures/mock-projects/node/Dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
CMD ["node", "-e", "process.stdout.write('container ok\\n')"]
```

```dockerfile
# tests/fixtures/mock-projects/node/Dockerfile.private-npm
# syntax=docker/dockerfile:1
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=NODE_AUTH_TOKEN,env=NODE_AUTH_TOKEN,required=true \
    test -n "$NODE_AUTH_TOKEN" && npm ci
COPY . .
RUN npm run build
CMD ["node", "-e", "process.stdout.write('private container ok\\n')"]
```

- [ ] **Step 2: Add a minimal .NET 10 application and a real PostgreSQL TCP test.**

```xml
<!-- Mock.Container.App.csproj -->
<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
</Project>
```

```csharp
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
app.MapGet("/", () => Results.Ok("fixture"));
app.Run();
```

```xml
<!-- Mock.Container.App.Tests.csproj -->
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <IsPackable>false</IsPackable>
    <IsTestProject>true</IsTestProject>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="18.0.1" />
    <PackageReference Include="xunit" Version="2.9.3" />
    <PackageReference Include="xunit.runner.visualstudio" Version="2.8.2" PrivateAssets="all" />
  </ItemGroup>
</Project>
```

```csharp
using System.Net.Sockets;
using Xunit;

public sealed class PostgresReachabilityTests
{
    [Fact]
    public async Task PostgresServiceIsReachable()
    {
        var host = Environment.GetEnvironmentVariable("POSTGRES_HOST");
        var port = int.Parse(Environment.GetEnvironmentVariable("POSTGRES_PORT") ?? "0");
        Assert.Equal("127.0.0.1", host);

        using var client = new TcpClient();
        await client.ConnectAsync(host!, port);
        Assert.True(client.Connected);
    }
}
```

```dockerfile
# tests/fixtures/mock-projects/dotnet/Dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src
COPY Mock.Container.App/Mock.Container.App.csproj Mock.Container.App/
RUN dotnet restore Mock.Container.App/Mock.Container.App.csproj
COPY Mock.Container.App Mock.Container.App
RUN dotnet publish Mock.Container.App/Mock.Container.App.csproj -c Release -o /out

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine
WORKDIR /app
COPY --from=build /out .
ENTRYPOINT ["dotnet", "Mock.Container.App.dll"]
```

- [ ] **Step 3: Add local consumer fixtures with no inherited secrets.**

```yaml
# tests/fixtures/workflow-contract/container-private-local.yml
name: Private Dockerfile fixture

on:
  workflow_dispatch:

permissions: {}

jobs:
  verify:
    uses: ./.github/workflows/wf-verify-container.yml
    permissions:
      contents: read
      packages: read
    with:
      context: tests/fixtures/mock-projects/node
      dockerfile: tests/fixtures/mock-projects/node/Dockerfile.private-npm
    secrets:
      NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
```

Create the Node fixture with `node-version: 24.x`, `working-directory: tests/fixtures/mock-projects/node`, and all four script booleans enabled.

Create the .NET fixture with `target: tests/fixtures/mock-projects/dotnet/Mock.Container.App.Tests/Mock.Container.App.Tests.csproj`, `dotnet-version: 10.0.x`, `postgres-enabled: true`, `postgres-image: postgres:17.4`, and `postgres-host-port: 55432`.

Create the public Docker fixture with the public Dockerfile and no `secrets:` block.

Create the release fixture as a syntax-only caller with a `release` job that passes the standard `branches-json`, `enable-backpropagation: true`, `release-ref-name: release/stable`, and `default-branch: main`.

Create `tests/fixtures/events/workflow_dispatch.json` with exactly `{}`.

- [ ] **Step 4: Add deterministic Git fixture setup scripts.**

```bash
#!/usr/bin/env bash
set -euo pipefail
worktree="$(mktemp -d)"
trap 'rm -rf "$worktree"' EXIT
git -C "$worktree" init --initial-branch=main
git -C "$worktree" config user.name fixture
git -C "$worktree" config user.email fixture@example.invalid
printf 'base\n' > "$worktree/version.txt"
git -C "$worktree" add version.txt
git -C "$worktree" commit -m 'feat: base'
git -C "$worktree" switch -c release/stable
printf 'stable\n' >> "$worktree/version.txt"
git -C "$worktree" commit -am 'feat: stable release'
git -C "$worktree" tag v1.0.0
git -C "$worktree" switch main
git -C "$worktree" merge --no-ff release/stable -m 'merge stable release'
git -C "$worktree" merge-base --is-ancestor release/stable main
git -C "$worktree" describe --tags --abbrev=0 HEAD
```

Make the second script identical through tagging, but omit the final merge and assert `git merge-base --is-ancestor release/stable main` exits with status `1`.

- [ ] **Step 5: Run the fixtures before the workflows exist.**

Run: `rtk act -P ubuntu-latest=catthehacker/ubuntu:act-latest -W tests/fixtures/workflow-contract/node-local.yml workflow_dispatch -e tests/fixtures/events/workflow_dispatch.json --container-architecture linux/amd64`

Expected: FAIL because `wf-test-node.yml` does not exist yet.

Run: `rtk bash tests/fixtures/git/release-stable-reachable.sh && rtk bash tests/fixtures/git/release-stable-needs-backprop.sh`

Expected: PASS with the first fixture resolving `v1.0.0` and the second proving the non-ancestor condition.

- [ ] **Step 6: Do not commit.**

Keep all changes uncommitted because the user has not authorized commits.

### Task 2: Implement Typed .NET And Node Test Workflows

**Files:**
- Create: `.github/workflows/wf-test-dotnet.yml`
- Create: `.github/workflows/wf-test-node.yml`
- Modify: `tests/fixtures/workflow-contract/dotnet-local.yml`
- Modify: `tests/fixtures/workflow-contract/node-local.yml`

**Interfaces:**
- Consumes: The mock projects and local fixtures from Task 1.
- Produces: `workflow_call` contracts used by the API and bot caller templates in Task 6.

- [ ] **Step 1: Define the .NET workflow call contract.**

```yaml
on:
  workflow_call:
    inputs:
      runs-on: { type: string, default: ubuntu-latest }
      runs-on-json: { type: string, default: "" }
      runs-on-self-hosted: { type: boolean, default: false }
      dotnet-version: { type: string, default: 10.0.x }
      target: { type: string, required: true }
      configuration: { type: string, default: Release }
      locked-mode: { type: boolean, default: false }
      postgres-enabled: { type: boolean, default: false }
      postgres-image: { type: string, default: postgres:17.4 }
      postgres-host-port: { type: number, default: 5432 }
      timeout-minutes: { type: number, default: 30 }
```

Use this runner expression in every job in this plan that selects a runner:

```yaml
runs-on: ${{ fromJSON(inputs.runs-on-json || format('[{0}]', toJSON(inputs.runs-on || 'ubuntu-latest'))) }}
```

Use top-level `permissions: {}`.

Create two mutually exclusive jobs named `test` and `test-postgres`.

Set `test.if` to `${{ !inputs.postgres-enabled }}` and `test-postgres.if` to `${{ inputs.postgres-enabled }}`.

Use `actions/checkout@v7` with `persist-credentials: false`, `actions/setup-dotnet@v6`, `dotnet restore ${{ inputs.target }}` with `--locked-mode` only when requested, `dotnet build ... --no-restore`, and `dotnet test ... --no-build`.

- [ ] **Step 2: Add the PostgreSQL job service and exact test environment.**

```yaml
services:
  postgres:
    image: ${{ inputs.postgres-image }}
    env:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: medrunner-test
    options: >-
      --health-cmd "pg_isready -U postgres -d medrunner-test"
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
    ports:
      - "${{ inputs.postgres-host-port }}:5432"
```

Pass `POSTGRES_HOST=127.0.0.1`, `POSTGRES_PORT=${{ inputs.postgres-host-port }}`, `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD=postgres`, and `POSTGRES_DB=medrunner-test` only to the test step.

Write a runner and command summary to `$GITHUB_STEP_SUMMARY` in both jobs.

- [ ] **Step 3: Define the Node workflow call contract and private GitHub Packages setup.**

```yaml
on:
  workflow_call:
    inputs:
      runs-on: { type: string, default: ubuntu-latest }
      runs-on-json: { type: string, default: "" }
      runs-on-self-hosted: { type: boolean, default: false }
      node-version: { type: string, default: 24.x }
      working-directory: { type: string, default: . }
      npm-scope: { type: string, default: "@medrunner-services" }
      private-packages: { type: boolean, default: false }
      run-build: { type: boolean, default: true }
      run-lint: { type: boolean, default: true }
      run-prettier: { type: boolean, default: true }
      run-test: { type: boolean, default: true }
```

Use `actions/checkout@v7` with `persist-credentials: false`.

Use `actions/setup-node@v7` with `registry-url: https://npm.pkg.github.com` and `scope: ${{ inputs.npm-scope }}` only when `private-packages` is true.

Run `npm ci` with `NODE_AUTH_TOKEN: ${{ github.token }}` only when private packages are enabled.

Run the selected `npm run build`, `npm run lint`, `npm run prettier`, and `npm test` commands in that order.

- [ ] **Step 4: Run the public workflow fixtures through Docker-backed `act`.**

Run: `rtk act -P ubuntu-latest=catthehacker/ubuntu:act-latest -W tests/fixtures/workflow-contract/node-local.yml workflow_dispatch -e tests/fixtures/events/workflow_dispatch.json --container-architecture linux/amd64`

Expected: PASS after `npm ci`, build, lint, Prettier, and test all complete.

Run: `rtk act -P ubuntu-latest=catthehacker/ubuntu:act-latest -W tests/fixtures/workflow-contract/dotnet-local.yml workflow_dispatch -e tests/fixtures/events/workflow_dispatch.json --container-architecture linux/amd64`

Expected: PASS after PostgreSQL becomes healthy and the TCP test connects to the mapped service port.

- [ ] **Step 5: Run workflow syntax validation.**

Run: `rtk docker run --rm -v "${PWD}:/repo" -w /repo rhysd/actionlint:1.7.12`

Expected: PASS with no schema or expression errors in either workflow or fixture.

- [ ] **Step 6: Do not commit.**

Keep all changes uncommitted because the user has not authorized commits.

### Task 3: Implement Generic Dockerfile Verification

**Files:**
- Create: `.github/workflows/wf-verify-container.yml`
- Modify: `tests/fixtures/workflow-contract/container-public-local.yml`
- Modify: `tests/fixtures/workflow-contract/container-private-local.yml`

**Interfaces:**
- Consumes: `context`, `dockerfile`, `NODE_AUTH_TOKEN`, and the common runner inputs.
- Produces: A build-only Dockerfile verification result, an image digest summary when available, and no registry mutation.

- [ ] **Step 1: Define the build-only workflow contract.**

```yaml
on:
  workflow_call:
    inputs:
      runs-on: { type: string, default: ubuntu-latest }
      runs-on-json: { type: string, default: "" }
      runs-on-self-hosted: { type: boolean, default: false }
      context: { type: string, default: . }
      dockerfile: { type: string, default: Dockerfile }
      timeout-minutes: { type: number, default: 30 }
    secrets:
      NODE_AUTH_TOKEN:
        required: false
```

Use top-level `permissions: {}` and grant `contents: read` at job level.

Use `actions/checkout@v7`, `docker/setup-buildx-action@v4`, and `docker/build-push-action@v7` with `push: false`.

Set `NODE_AUTH_TOKEN` to `${{ secrets.NODE_AUTH_TOKEN || github.token }}` and pass it only through `secret-envs: NODE_AUTH_TOKEN=NODE_AUTH_TOKEN`.

Do not set Docker `build-args` for the token.

- [ ] **Step 2: Add input and runner diagnostics.**

Reject a context or Dockerfile path beginning with `/` or containing `..`.

Record the runner labels, Docker version, Buildx version, context path, and Dockerfile path in `$GITHUB_STEP_SUMMARY`.

When `runs-on-self-hosted` is true, record Docker socket availability, disk free space, and Buildx availability before the build.

- [ ] **Step 3: Exercise both secret paths.**

Run: `rtk act -P ubuntu-latest=catthehacker/ubuntu:act-latest -W tests/fixtures/workflow-contract/container-public-local.yml workflow_dispatch -e tests/fixtures/events/workflow_dispatch.json --container-architecture linux/amd64`

Expected: PASS without any named secret.

Run: `rtk act -P ubuntu-latest=catthehacker/ubuntu:act-latest -W tests/fixtures/workflow-contract/container-private-local.yml workflow_dispatch -e tests/fixtures/events/workflow_dispatch.json --container-architecture linux/amd64 --secret NODE_AUTH_TOKEN=fixture-token`

Expected: PASS only because the Dockerfile receives `NODE_AUTH_TOKEN` through a required BuildKit secret mount.

- [ ] **Step 4: Run workflow syntax validation.**

Run: `rtk docker run --rm -v "${PWD}:/repo" -w /repo rhysd/actionlint:1.7.12`

Expected: PASS with valid reusable-workflow syntax.

- [ ] **Step 5: Do not commit.**

Keep all changes uncommitted because the user has not authorized commits.

### Task 4: Implement Tag-Pinned GHCR Publication

**Files:**
- Create: `.github/workflows/wf-publish-container.yml`
- Create: `tests/fixtures/workflow-contract/container-publish-local.yml`
- Modify: `tests/fixtures/workflow-contract/container-public-local.yml`

**Interfaces:**
- Consumes: `image`, `context`, `dockerfile`, `version`, `release-tag`, `channel`, `environment-name`, optional `NODE_AUTH_TOKEN`, and common runner inputs.
- Produces: `image-digest`, `image-reference`, immutable image tags, moving channel aliases, and an OCI summary.

- [ ] **Step 1: Define the publish workflow contract.**

```yaml
on:
  workflow_call:
    inputs:
      runs-on: { type: string, default: ubuntu-latest }
      runs-on-json: { type: string, default: "" }
      runs-on-self-hosted: { type: boolean, default: false }
      environment-name: { type: string, default: publish-ghcr }
      image: { type: string, required: true }
      context: { type: string, default: . }
      dockerfile: { type: string, default: Dockerfile }
      version: { type: string, required: true }
      release-tag: { type: string, required: true }
      channel: { type: string, required: true }
      version-build-arg-name: { type: string, default: VERSION }
    secrets:
      NODE_AUTH_TOKEN:
        required: false
    outputs:
      image-digest:
        value: ${{ jobs.publish.outputs.image-digest }}
      image-reference:
        value: ${{ jobs.publish.outputs.image-reference }}
```

Use top-level `permissions: {}`.

Grant `contents: read` and `packages: write` at job level.

Bind the job to `${{ inputs.environment-name }}`.

- [ ] **Step 2: Build the exact semantic-release source and emit all channel tags.**

```yaml
- uses: actions/checkout@v7
  with:
    ref: ${{ inputs.release-tag }}
    fetch-depth: 0
    persist-credentials: false

- uses: docker/metadata-action@v6
  id: metadata
  with:
    images: ${{ inputs.image }}
    tags: |
      type=raw,value=v${{ inputs.version }}
      type=raw,value=${{ inputs.version }}
      type=raw,value=${{ inputs.channel }}
      type=raw,value=${{ inputs.channel }}-latest
      type=raw,value=latest,enable=${{ inputs.channel == 'stable' }}
```

Validate that `version` is bare SemVer with an optional `-dev.N` or `-rc.N` prerelease suffix.

Validate that `release-tag` is exactly `v${version}` and `channel` is one of `dev`, `rc`, or `stable`.

For `1.2.3-dev.1`, emit `v1.2.3-dev.1`, `1.2.3-dev.1`, `dev`, and `dev-latest` only.

For `1.2.3-rc.1`, emit `v1.2.3-rc.1`, `1.2.3-rc.1`, `rc`, and `rc-latest` only.

For `1.2.3`, emit `v1.2.3`, `1.2.3`, `stable`, `stable-latest`, and unqualified `latest`.

Pass `${{ inputs.version-build-arg-name }}=${{ inputs.version }}` as the sole generated non-secret Docker build argument after validating the build-arg name against `^[A-Z_][A-Z0-9_]*$`.

Pass `NODE_AUTH_TOKEN` only as the BuildKit `secret-envs` input.

Use `docker/login-action@v4` with `registry: ghcr.io`, `username: ${{ github.actor }}`, and `password: ${{ github.token }}`.

Use `docker/build-push-action@v7` with `push: true`, the metadata tags and labels, and the checked-out Docker context.

- [ ] **Step 3: Add digest outputs and a publication summary.**

Set `image-digest` from `steps.build.outputs.digest`.

Set `image-reference` to `${{ inputs.image }}@${{ steps.build.outputs.digest }}`.

Write the release tag, version, channel, immutable digest reference, and all mutable aliases to `$GITHUB_STEP_SUMMARY`.

- [ ] **Step 4: Add a syntax-only publish caller and verify tag input validation.**

```yaml
name: GHCR publish contract fixture

on:
  workflow_dispatch:

permissions: {}

jobs:
  publish:
    uses: ./.github/workflows/wf-publish-container.yml
    permissions:
      contents: read
      packages: write
    with:
      image: ghcr.io/medrunner-services/workflow-contract
      version: 1.2.3-dev.1
      release-tag: v1.2.3-dev.1
      channel: dev
      environment-name: publish-ghcr
```

Run: `rtk docker run --rm -v "${PWD}:/repo" -w /repo rhysd/actionlint:1.7.12`

Expected: PASS without a registry login or publication.

- [ ] **Step 5: Do not run the publish fixture through `act`.**

`wf-publish-container.yml` deliberately requires real GHCR credentials and a protected `publish-ghcr` environment.

The public and private build-only fixtures from Task 3 remain the Docker-backed local validation for the identical Dockerfile and BuildKit-secret paths.

- [ ] **Step 6: Do not commit.**

Keep all changes uncommitted because the user has not authorized commits.

### Task 5: Implement Semantic Release And In-Job Stable Back-Propagation

**Files:**
- Create: `configs/semantic-release-service.cjs`
- Create: `.github/workflows/wf-release-semantic.yml`
- Create: `.github/actions/release-backpropagation/action.yml`
- Create: `.github/actions/release-backpropagation/run-backpropagation.cs`
- Create: `.github/actions/release-backpropagation/Directory.Build.props`
- Modify: `tests/fixtures/workflow-contract/release-stable-local.yml`

**Interfaces:**
- Consumes: The standard branch policy, caller Git history, optional `PR_AUTOMATION_PAT`, and Git fixture reachability behavior from Task 1.
- Produces: `release-published`, `new-version`, `new-tag`, `new-channel`, `backprop-pr-url`, and `backprop-pr-number` for the publisher and operational summaries.

- [ ] **Step 1: Create the service semantic-release base configuration.**

```js
module.exports = {
  tagFormat: "v${version}",
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/github",
  ],
};
```

Do not add `@semantic-release/npm`, `@semantic-release/git`, or `@semantic-release/exec`.

- [ ] **Step 2: Copy the established C# PR transport without behavior changes.**

Copy these exact source files from the reference platform into the target paths:

```text
D:\Git\github\ArkanisCorporation\ci\.github\actions\release-backpropagation\action.yml
D:\Git\github\ArkanisCorporation\ci\.github\actions\release-backpropagation\run-backpropagation.cs
D:\Git\github\ArkanisCorporation\ci\.github\actions\release-backpropagation\Directory.Build.props
```

Keep its inputs `new-version`, `release-ref-name`, `default-branch`, `labels`, `auto-merge`, `merge-method`, and `approve` unchanged.

Keep its outputs `pr-url` and `pr-number` unchanged.

Keep its `GH_TOKEN` usage for PR creation and auto-merge and `PR_AUTOMATION_PAT` usage only for optional approval unchanged.

- [ ] **Step 3: Define the semantic release and back-propagation contract.**

```yaml
on:
  workflow_call:
    inputs:
      runs-on: { type: string, default: ubuntu-latest }
      runs-on-json: { type: string, default: "" }
      runs-on-self-hosted: { type: boolean, default: false }
      environment-name: { type: string, default: release }
      node-version: { type: string, default: 24.x }
      semantic-release-version: { type: string, default: 25.0.9 }
      branches-json:
        type: string
        default: >-
          [{"name":"release/stable","channel":"stable"},{"name":"release/rc","channel":"rc","prerelease":"rc"},{"name":"main","channel":"dev","prerelease":"dev"}]
      enable-backpropagation: { type: boolean, default: true }
      release-ref-name: { type: string, default: release/stable }
      default-branch: { type: string, default: main }
      backpropagation-auto-merge: { type: boolean, default: true }
      backpropagation-approve: { type: boolean, default: true }
    secrets:
      PR_AUTOMATION_PAT:
        required: false
```

Expose the six outputs listed in this task's interface.

Set top-level `permissions: {}`.

Set job permissions to `contents: write`, `issues: write`, and `pull-requests: write` because semantic-release creates the release and the conditional stable path can create a PR.

Set the job environment to `${{ inputs.environment-name }}` and serialize it with `release-semantic-${{ github.repository }}-${{ inputs.environment-name }}`.

- [ ] **Step 4: Use the exact workflow source for both the base config and local composite action.**

```yaml
- name: Checkout platform release assets
  uses: actions/checkout@v7
  with:
    repository: ${{ fromJSON(toJSON(job)).workflow_repository }}
    ref: ${{ fromJSON(toJSON(job)).workflow_sha }}
    path: .ci/medrunner-services-ci
    persist-credentials: false
    sparse-checkout: |
      configs/semantic-release-service.cjs
      .github/actions/release-backpropagation
    sparse-checkout-cone-mode: false
```

Run `cycjimmy/semantic-release-action@v6.0.0` with `semantic_version: ${{ inputs.semantic-release-version }}`, `branches: ${{ inputs.branches-json }}`, `extends: .ci/medrunner-services-ci/configs/semantic-release-service.cjs`, `ci: true`, and `dry_run: false`.

Before semantic-release, reject caller release configuration files or package metadata that declares `@semantic-release/exec`, `@semantic-release/npm`, `@semantic-release/git`, or a `semanticRelease` property.

This makes the shared tag-only policy authoritative instead of allowing a caller to add a hidden publish or source-mutation step.

- [ ] **Step 5: Add the stable reachability preflight and invoke the copied action conditionally.**

```bash
git fetch --no-tags origin \
  "+refs/heads/${RELEASE_REF_NAME}:refs/remotes/origin/${RELEASE_REF_NAME}" \
  "+refs/heads/${DEFAULT_BRANCH}:refs/remotes/origin/${DEFAULT_BRANCH}"

if git merge-base --is-ancestor "origin/${RELEASE_REF_NAME}" "origin/${DEFAULT_BRANCH}"; then
  echo "needed=false" >> "$GITHUB_OUTPUT"
  echo "reason=release history is already reachable from ${DEFAULT_BRANCH}" >> "$GITHUB_OUTPUT"
else
  echo "needed=true" >> "$GITHUB_OUTPUT"
  echo "reason=release history must be back-propagated" >> "$GITHUB_OUTPUT"
fi
```

Run this step only when `new_release_published` is `true`, `new_release_channel` is `stable`, and `enable-backpropagation` is true.

Run the copied composite action only when its `needed` output is `true`.

Pass `new-version` from semantic-release, `release-ref-name`, `default-branch`, `backpropagation-auto-merge`, and `backpropagation-approve` through unchanged.

Set `GH_TOKEN: ${{ github.token }}` and `PR_AUTOMATION_PAT: ${{ secrets.PR_AUTOMATION_PAT }}` only on the action step.

Write release, channel, tag, no-op, reachability, and PR outputs to `$GITHUB_STEP_SUMMARY`.

- [ ] **Step 6: Validate syntax and the two deterministic Git preflight paths.**

Run: `rtk bash tests/fixtures/git/release-stable-reachable.sh`

Expected: PASS with `git describe --tags --abbrev=0 HEAD` returning `v1.0.0` and no back-propagation required.

Run: `rtk bash tests/fixtures/git/release-stable-needs-backprop.sh`

Expected: PASS only when the release tip is not an ancestor of `main`.

Run: `rtk docker run --rm -v "${PWD}:/repo" -w /repo rhysd/actionlint:1.7.12`

Expected: PASS without a live GitHub release, PR creation, approval, or auto-merge.

- [ ] **Step 7: Do not commit.**

Keep all changes uncommitted because the user has not authorized commits.

### Task 6: Add Platform Release And Complete Consumer Documentation

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `docs/workflow-catalog.md`
- Create: `docs/consumer-workflows.md`
- Modify: `README.md`
- Modify: `tests/fixtures/workflow-contract/release-stable-local.yml`

**Interfaces:**
- Consumes: The public reusable workflows from Tasks 2 through 5 and the existing root `release.config.cjs`.
- Produces: A releasable `v1` CI platform reference and copy-ready service callers that only use published platform major tags.

- [ ] **Step 1: Add the CI platform's own release workflow.**

```yaml
name: Release CI platform

on:
  pull_request:
  push:
    branches: [main]

permissions: {}

jobs:
  lint:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - run: docker run --rm -v "$GITHUB_WORKSPACE:/repo" -w /repo rhysd/actionlint:1.7.12
        shell: bash
  release:
    if: github.event_name == 'push'
    needs: lint
    runs-on: ubuntu-latest
    environment: release
    permissions:
      contents: write
      issues: write
      pull-requests: write
```

In `release`, check out full history with `persist-credentials: false` and run `cycjimmy/semantic-release-action@v6.0.0` against the existing root `release.config.cjs`.

Install `semantic-release-major-tag@0.3.2` through the action's `extra_plugins` input.

Do not call `wf-release-semantic.yml` from this job because platform releases use their existing mutable-major-tag plugin rather than the service tag-only configuration.

- [ ] **Step 2: Document the reusable workflow catalog.**

Create one table with these exact columns: Workflow, Purpose, Inputs, Secrets, Outputs, Job Permissions, Environment, Side Effects, and Consumer Reference.

Document `wf-test-dotnet.yml`, `wf-test-node.yml`, `wf-verify-container.yml`, `wf-release-semantic.yml`, and `wf-publish-container.yml`.

Include the Test to Release to Publish Mermaid graph and explicitly show the stable-only back-propagation step inside the `release` job.

Document that `release`, `publish-ghcr`, `publish-gh-npm`, and `publish-npm` are organization-standard environment names.

- [ ] **Step 3: Add exact API and bot caller templates.**

Use this trigger in all three templates:

```yaml
on:
  pull_request:
    branches: [main, release/rc, release/stable]
  push:
    branches: [main, release/rc, release/stable]

permissions: {}
```

The API template calls `wf-test-dotnet.yml@v1` with `target: MedrunnerApi.sln`, `dotnet-version: 10.0.x`, `locked-mode: false`, and PostgreSQL 17.4.

The MED template calls `wf-test-node.yml@v1` with Node 24, `private-packages: true`, and all four scripts enabled.

The MOD template calls `wf-test-node.yml@v1` with Node 22, `private-packages: true`, and all four scripts enabled.

Each template calls `wf-verify-container.yml@v1` after its test job.

Each push-only release job calls `wf-release-semantic.yml@v1` in the `release` environment.

Each publish job requires `needs.release.outputs.release-published == 'true'` and calls `wf-publish-container.yml@v1` in `publish-ghcr`.

Set image names to `ghcr.io/medrunner-services/backend-api`, `ghcr.io/medrunner-services/bot-med`, and `ghcr.io/medrunner-services/bot-mod`.

Pass the release workflow's `new-version`, `new-tag`, and `new-channel` outputs directly to the publisher.

- [ ] **Step 4: Document the tag-derived build version contract.**

State that every publish build checks out `new-tag`.

State that Dockerfiles may consume `ARG VERSION` to stamp binary metadata from semantic-release without committing a version file.

Show this API Dockerfile adaptation as documentation only:

```dockerfile
ARG VERSION
RUN dotnet publish "MedrunnerApi.csproj" -c Release -p:Version="$VERSION" -o /app/publish
```

State that service repository changes are not part of this CI-platform implementation.

- [ ] **Step 5: Validate documentation references and platform workflow syntax.**

Run: `rtk docker run --rm -v "${PWD}:/repo" -w /repo rhysd/actionlint:1.7.12`

Expected: PASS for all public workflows, the platform release workflow, and all caller fixtures.

Read the workflow catalog table and each API, MED, and MOD template as one review surface.

Confirm the documented input names, secret names, permissions, environments, outputs, and `@v1` references match the public workflow contracts.

- [ ] **Step 6: Do not commit.**

Keep all changes uncommitted because the user has not authorized commits.

### Task 7: Run The Final Local Verification Set And Record Results

**Files:**
- Modify: `README.md`
- Modify: `docs/workflow-catalog.md`

**Interfaces:**
- Consumes: All workflow and fixture contracts from Tasks 1 through 6.
- Produces: A concise, reproducible local validation section with no external GitHub, registry, npm, or PR mutation.

- [ ] **Step 1: Run the complete static validation command.**

Run: `rtk docker run --rm -v "${PWD}:/repo" -w /repo rhysd/actionlint:1.7.12`

Expected: PASS with every workflow and fixture parsed.

- [ ] **Step 2: Run the Docker-backed `act` smoke suite.**

```powershell
rtk act -P ubuntu-latest=catthehacker/ubuntu:act-latest -W tests/fixtures/workflow-contract/node-local.yml workflow_dispatch -e tests/fixtures/events/workflow_dispatch.json --container-architecture linux/amd64
rtk act -P ubuntu-latest=catthehacker/ubuntu:act-latest -W tests/fixtures/workflow-contract/dotnet-local.yml workflow_dispatch -e tests/fixtures/events/workflow_dispatch.json --container-architecture linux/amd64
rtk act -P ubuntu-latest=catthehacker/ubuntu:act-latest -W tests/fixtures/workflow-contract/container-public-local.yml workflow_dispatch -e tests/fixtures/events/workflow_dispatch.json --container-architecture linux/amd64
rtk act -P ubuntu-latest=catthehacker/ubuntu:act-latest -W tests/fixtures/workflow-contract/container-private-local.yml workflow_dispatch -e tests/fixtures/events/workflow_dispatch.json --container-architecture linux/amd64 --secret NODE_AUTH_TOKEN=fixture-token
```

Expected: all four commands PASS.

- [ ] **Step 3: Run the stable-tag ancestry checks.**

Run: `rtk bash tests/fixtures/git/release-stable-reachable.sh && rtk bash tests/fixtures/git/release-stable-needs-backprop.sh`

Expected: PASS with both the reachable no-op and non-reachable PR-required cases proven.

- [ ] **Step 4: Check repository cleanliness without removing user work.**

Run: `rtk git diff --check`

Expected: PASS with no whitespace errors.

Run: `rtk git status --short`

Expected: only the planned CI-platform files plus the pre-existing user-untracked `.gitignore`, `release.config.cjs`, and `renovate.jsonc` appear.

- [ ] **Step 5: Record exact commands and outcomes in the README validation section.**

Document that `act` verifies Test and Dockerfile build paths only.

Document that semantic release, GHCR publish, protected environments, PR creation, approval, and auto-merge are intentionally not executed locally.

- [ ] **Step 6: Do not commit.**

Keep all changes uncommitted because the user has not authorized commits.
