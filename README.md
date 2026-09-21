# Reusable CI Workflows

This repository contains reusable GHA workflows for Medrunner projects.
The workflows are published as the `v1` contract for API and bot repositories.

See the [workflow catalog](docs/workflow-catalog.md) for permissions, environments, outputs, and side effects.
See the [consumer templates](docs/consumer-workflows.md) for copy-ready API, MED, and MOD caller workflows.

## Local validation

Run static workflow validation:

```powershell
rtk docker run --rm -v "${PWD}:/repo" -w /repo rhysd/actionlint:1.7.12
```

Run the Docker-backed Test and Dockerfile smoke suite:

```powershell
rtk act -P ubuntu-latest=catthehacker/ubuntu:act-latest -W tests/fixtures/workflow-contract/node-local.yml workflow_dispatch -e tests/fixtures/events/workflow_dispatch.json --container-architecture linux/amd64
rtk act -P ubuntu-latest=catthehacker/ubuntu:act-latest -W tests/fixtures/workflow-contract/dotnet-local.yml workflow_dispatch -e tests/fixtures/events/workflow_dispatch.json --container-architecture linux/amd64
rtk act -P ubuntu-latest=catthehacker/ubuntu:act-latest -W tests/fixtures/workflow-contract/container-public-local.yml workflow_dispatch -e tests/fixtures/events/workflow_dispatch.json --container-architecture linux/amd64
rtk act -P ubuntu-latest=catthehacker/ubuntu:act-latest -W tests/fixtures/workflow-contract/container-private-local.yml workflow_dispatch -e tests/fixtures/events/workflow_dispatch.json --container-architecture linux/amd64 --secret NODE_AUTH_TOKEN=fixture-token
```

Run the deterministic stable-tag ancestry checks:

```powershell
rtk bash tests/fixtures/git/release-stable-reachable.sh
rtk bash tests/fixtures/git/release-stable-needs-backprop.sh
```

The complete suite passed locally on 2026-09-21.
`act` verifies Test and Dockerfile build paths only.
Semantic release, protected environments, GHCR publishing, PR creation, approval, and auto-merge intentionally remain outside local execution.
