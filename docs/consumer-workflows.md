# Consumer workflow templates

Copy one template into each service repository as `.github/workflows/ci.yml`.

The called release and publish jobs set their protected environment through `environment-name`.

Do not add an `environment` key to a reusable-workflow caller job.

The callee owns the protected job so its environment gate covers the actual release or publication step.

The templates leave automatic PR approval disabled because it requires a separate `PR_AUTOMATION_PAT` identity.

Set `backpropagation-approve: true` and pass that optional secret only where the organization permits automated approvals.

## API

```yaml
name: CI

on:
  pull_request:
    branches: [main, release/rc, release/stable]
  push:
    branches: [main, release/rc, release/stable]

permissions: {}

jobs:
  test:
    uses: medrunner-services/ci/.github/workflows/wf-test-dotnet.yml@v1
    permissions:
      contents: read
    with:
      target: MedrunnerApi.sln
      dotnet-version: 10.0.x
      locked-mode: false
      postgres-enabled: true
      postgres-image: postgres:17.4

  verify-container:
    needs: test
    uses: medrunner-services/ci/.github/workflows/wf-verify-container.yml@v1
    permissions:
      contents: read
    with:
      context: .
      dockerfile: Dockerfile

  release:
    if: ${{ github.event_name == 'push' }}
    needs: verify-container
    uses: medrunner-services/ci/.github/workflows/wf-release-semantic.yml@v1
    permissions:
      contents: write
      issues: write
      pull-requests: write
    with:
      environment-name: release
      backpropagation-approve: false

  publish:
    if: ${{ github.event_name == 'push' && needs.release.outputs.release-published == 'true' }}
    needs: release
    uses: medrunner-services/ci/.github/workflows/wf-publish-container.yml@v1
    permissions:
      contents: read
      packages: write
    with:
      environment-name: publish-ghcr
      image: ghcr.io/medrunner-services/backend-api
      context: .
      dockerfile: Dockerfile
      version: ${{ needs.release.outputs.new-version }}
      release-tag: ${{ needs.release.outputs.new-tag }}
      channel: ${{ needs.release.outputs.new-channel }}
```

## bot-med

```yaml
name: CI

on:
  pull_request:
    branches: [main, release/rc, release/stable]
  push:
    branches: [main, release/rc, release/stable]

permissions: {}

jobs:
  test:
    uses: medrunner-services/ci/.github/workflows/wf-test-node.yml@v1
    permissions:
      contents: read
      packages: read
    with:
      node-version: 24.x
      private-packages: true
      run-build: true
      run-lint: true
      run-prettier: true
      run-test: true

  verify-container:
    needs: test
    uses: medrunner-services/ci/.github/workflows/wf-verify-container.yml@v1
    permissions:
      contents: read
      packages: read
    with:
      context: .
      dockerfile: Dockerfile

  release:
    if: ${{ github.event_name == 'push' }}
    needs: verify-container
    uses: medrunner-services/ci/.github/workflows/wf-release-semantic.yml@v1
    permissions:
      contents: write
      issues: write
      pull-requests: write
    with:
      environment-name: release
      backpropagation-approve: false

  publish:
    if: ${{ github.event_name == 'push' && needs.release.outputs.release-published == 'true' }}
    needs: release
    uses: medrunner-services/ci/.github/workflows/wf-publish-container.yml@v1
    permissions:
      contents: read
      packages: write
    with:
      environment-name: publish-ghcr
      image: ghcr.io/medrunner-services/bot-med
      context: .
      dockerfile: Dockerfile
      version: ${{ needs.release.outputs.new-version }}
      release-tag: ${{ needs.release.outputs.new-tag }}
      channel: ${{ needs.release.outputs.new-channel }}
```

## bot-mod

```yaml
name: CI

on:
  pull_request:
    branches: [main, release/rc, release/stable]
  push:
    branches: [main, release/rc, release/stable]

permissions: {}

jobs:
  test:
    uses: medrunner-services/ci/.github/workflows/wf-test-node.yml@v1
    permissions:
      contents: read
      packages: read
    with:
      node-version: 22.x
      private-packages: true
      run-build: true
      run-lint: true
      run-prettier: true
      run-test: true

  verify-container:
    needs: test
    uses: medrunner-services/ci/.github/workflows/wf-verify-container.yml@v1
    permissions:
      contents: read
      packages: read
    with:
      context: .
      dockerfile: Dockerfile

  release:
    if: ${{ github.event_name == 'push' }}
    needs: verify-container
    uses: medrunner-services/ci/.github/workflows/wf-release-semantic.yml@v1
    permissions:
      contents: write
      issues: write
      pull-requests: write
    with:
      environment-name: release
      backpropagation-approve: false

  publish:
    if: ${{ github.event_name == 'push' && needs.release.outputs.release-published == 'true' }}
    needs: release
    uses: medrunner-services/ci/.github/workflows/wf-publish-container.yml@v1
    permissions:
      contents: read
      packages: write
    with:
      environment-name: publish-ghcr
      image: ghcr.io/medrunner-services/bot-mod
      context: .
      dockerfile: Dockerfile
      version: ${{ needs.release.outputs.new-version }}
      release-tag: ${{ needs.release.outputs.new-tag }}
      channel: ${{ needs.release.outputs.new-channel }}
```

## Version-derived images

Every publish job passes the release outputs directly to the GHCR workflow.

The publisher checks out `new-tag` before it invokes Docker Buildx.

Consequently, the published image is built from the semantic-release tag instead of the moving release branch head.

Dockerfiles may declare `ARG VERSION` and consume it to stamp binary metadata without committing package or project version files.

Service repository modifications, including the optional Dockerfile `ARG VERSION` adaptation, are outside this CI-platform change.
