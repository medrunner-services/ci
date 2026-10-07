# Node sites and Cloudflare Pages

The CI platform supplies five reusable workflows for standalone site repositories. All delivery logic is inline in workflows; there is no downloaded helper script or dependency on an infrastructure repository.

| Workflow | Contract |
| --- | --- |
| `wf-build-node.yml` | Check out `source-ref`, install a frozen npm/pnpm lockfile, check/test/build, and upload an immutable artifact. Returns `artifact-id`, `artifact-name`, `source-sha`, and `version`. |
| `wf-deploy-cloudflare-pages.yml` | Download an artifact from the current run by ID, verify its digest, validate static assets and trusted Wrangler configuration, check the provisioned project, upload with pinned Wrangler, and smoke-check HTML. Returns `deployed`, `deployment-url`, and `alias-url`. |
| `wf-deliver-node-pages.yml` | Compose verification, semantic release, a build from the release tag, and Pages deployment using the standard Medrunner branch/channel convention. Returns `deployed`, `deployment-url`, `environment-name`, and `version`. |
| `wf-lint-github-actions.yml` | Run actionlint against the caller workflows. |
| `wf-validate-opentofu.yml` | Run fmt, init with a read-only provider lockfile and disabled backend, and validate. Never plan/apply or use Cloudflare credentials. |

Use the individual build/deploy workflows for custom delivery policies. The coordinator is the standard Node 24/pnpm site path: `build`, `build:staging`, `check`, and `test` scripts; `dist` output; `vX.Y.Z` stable tags and `vX.Y.Z-dev.N` staging tags. Its nested workflow calls resolve from the same CI commit. Consumer references use `@v1` after the platform release publishes the new workflows; an immutable CI release tag or SHA can be used instead.

## Public build configuration

The builder requires `environment-name`, reads that environment's `vars` inside a runner step, and maps only the requested public values to shell variables. `public-env-map` is a JSON object such as `{"SITE_API_URL":"API_URL"}`. `required-public-env` is a JSON array such as `["SITE_API_URL"]`. Missing optional values become empty strings. `public-env-overrides` provides literal public values, for example a PR callback origin. Reserved runner variables and multiline values are rejected. These inputs must never contain credentials; browser configuration is public.

For private GitHub Packages, set `private-packages: true`, grant the caller repository package read access, and set `npm-scope` to its package scope. Only dependency installation receives `GITHUB_TOKEN` as `NODE_AUTH_TOKEN`. No Cloudflare or notification secret is referenced by the build workflow.

The builder supports `package-manager: npm` or `pnpm`; the latter reads `packageManager` from package.json. `working-directory`, `artifact-path`, and the package script names are configurable. Empty `check-script`/`test-script` values skip those steps. Give each invocation a distinct `artifact-name` prefix when building multiple artifacts in one run.

Pass a generated semantic `version` for release builds. The builder updates package.json locally after frozen dependency installation and checks, then runs the build so npm/pnpm exposes the new `npm_package_version`. It does not commit the changed manifest or change the dependency lockfile. pnpm's automatic installation before scripts is disabled because dependencies were already installed from the frozen lockfile, and version stamping must not trigger another installation. `source-sha` records the checked-out release commit.

## Static deployment boundary

The deployer requires `environment-name`, `artifact-id`, `source-sha`, `config-ref`, and `branch`. `config-path` defaults to `wrangler.json` and must be strict JSON with `name` and `pages_build_output_dir`. It copies the trusted configuration into an isolated deployment directory and rewrites only the output path to the downloaded artifact directory. Package scripts from the caller are never installed or executed on the deployment runner.

Configure `CLOUDFLARE_API_TOKEN` as a secret in the caller GitHub environment and `CLOUDFLARE_ACCOUNT_ID` as a variable there or at repository/organization scope. Environment secrets are resolved by the runner job; do not forward them or use `secrets: inherit`. The workflow checks that the existing Pages project's production branch matches `production-branch` (default `main`). It never creates a project. `wrangler-version` defaults to `4.148.0` and must be an exact numeric version.

Only static HTML sites are supported. The artifact needs `index.html`; it may not contain symlinks, hidden files, `functions`, `_worker.js`, or `_routes.json`. Assets are limited to 25 MiB each and 20,000 files. Workers/Pages Functions require a different deployment contract. The smoke check expects public HTML; an Access-protected origin requires adapting authentication before enabling Access.

`branch` controls Cloudflare production/preview classification. GitHub environment names independently control variables, secrets, and approval/branch gates. Do not assume a GitHub environment name changes the Cloudflare target.

## Standard versioned delivery

The [caller example](../examples/pages-portal.yml) demonstrates a Vite portal. Customize the public variable map, package scope, and application-specific notification step. Its routing/release/upload implementation is shared through the coordinator.

| Event | GitHub environment | Source and delivery |
| --- | --- | --- |
| Push to `release/stable` | `deploy-cf-production` | Verify, semantic stable release, rebuild from the new tag with its version, deploy to the Pages production branch. |
| Push to `main` | `deploy-cf-staging` | Verify, semantic `dev` prerelease on channel `staging`, rebuild from the new tag, deploy to the stable `main` preview alias. |
| Same-repository, non-draft `feat/*` or `fix/*` PR targeting either branch | `deploy-cf-preview` | Verify/build the merge commit and deploy to `pr-<number>` using trusted target-branch configuration. |
| Other/draft/fork PR | `deploy-cf-preview` | Verify/build with public staging values; no upload to Cloudflare or release. Private package access may be unavailable to forks. |
| Manual dispatch on a delivery branch | Production/staging environment | Redeploy the supplied existing tag after verification; the tag must match the channel and be reachable from the selected branch. |

The coordinator accepts `production-branch`, `staging-branch`, `environment-prefix`, `preview-branch-prefixes`, `preview-callback-variable`, `config-path`, `release-tag`, `private-packages`, `npm-scope`, `public-env-map`, `required-public-env`, and `wrangler-version`. Set `preview-callback-variable` only when the site needs an OAuth callback origin; it overrides that shell variable with `https://pr-<number>.<project>.pages.dev` for eligible previews. Otherwise no preview override is generated.

The caller owns `release.config.mjs` and uses Conventional Commits. Configure stable channel `stable` on the production branch and channel `staging` with prerelease `dev` on the staging branch. The existing `wf-release-semantic.yml` handles releases in the caller's `release` GitHub environment. Stable history backpropagation opens a PR when needed; the coordinator disables automatic approval and auto-merge. Allow Actions to create PRs and use required checks/reviews for those PRs.

Pushes without a releasable commit run verification but do not publish a new Pages deployment. Manual dispatch supplies an existing release tag to retry or roll back a deployment. Configure workflow concurrency to cancel superseded PR runs while letting release runs finish. Initialize release history with the last genuine released tag at its audited commit before migration; package.json alone does not establish a semantic-release baseline.

## GitHub environments and setup

Create `deploy-cf-production`, `deploy-cf-staging`, `deploy-cf-preview`, and `release` in each caller repository. Use unsuffixed public variable and secret names; staging and preview use staging values. Identical public values can live at repository/organization scope. Environments do not inherit values from each other. Check environment and protection-rule availability in the actual repository; consult [GitHub environment availability](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) for documented plan restrictions.

Set selected branch rules: production `release/stable`, staging `main`, preview `refs/pull/*/merge`, and release both delivery branches. PR rules match the merge ref rather than the head branch; the coordinator separately restricts preview eligibility. Leave preview approval/wait gates disabled for automatic validation. All jobs selecting an environment obey its gates.

Provision/import Cloudflare Pages with production branch `release/stable`. Disable native Git builds when GHA owns delivery. Keep each site's Wrangler configuration, optional OpenTofu state/configuration, custom-domain setup, and OAuth/CORS registrations in the caller repository. Staging custom-domain CNAMEs point to `main.<project>.pages.dev`; production points to `<project>.pages.dev`. Register concrete preview callback origins with OAuth providers and staging CORS when login is needed.

## Validation

`npm ci && npm test` executes the real inline Node steps with controlled files and events, covering public mappings, version stamping, static asset checks, target routing, preview restrictions, and manual tag ancestry. It also exercises the stable-reachability shell step against a local authenticated Git server to verify private fetches without persisted credentials. `release.yml` runs these tests before releasing the platform. Run actionlint against all workflows and the caller example as well. These tests do not make GitHub release/PR writes or Cloudflare deployments.
