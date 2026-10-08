# Node sites and Cloudflare Pages

Site callers use the existing `wf-test-node.yml` and `wf-release-semantic.yml`, plus one new `wf-deploy-cloudflare-pages.yml` for build/upload. Production logic is inline in GHA. There is no coordinator, artifact transfer, provisioning workflow, or downloaded helper script.

See the [portal caller example](../examples/pages-portal.yml). Keep branch selection and application-specific notifications in the caller.

## Flow

| Event | Jobs |
| --- | --- |
| PR into `main` or `release/stable` | Node validation only. |
| Push to `main` | Semantic prerelease when needed → staging build/upload. |
| Push to `release/stable` | Semantic stable release when needed → production build/upload. |

Protect both delivery branches and require PR validation. GitHub environments select values; leave reviewer/wait gates disabled when merged PRs are the approval boundary. No feature-branch deployments are configured.

The Node test workflow remains backward compatible: npm by default, existing script flags and runner options unchanged. New `package-manager: pnpm` reads the caller's declared pnpm version. `lint-script: check` can include type checks, `build-script` selects production/staging build, and `run-prettier: false` skips repositories without that script. Both managers use frozen installs; only private package installation receives `GITHUB_TOKEN`.

## Pages build/deploy contract

Required input: `environment-name`.

Optional inputs: `branch` (triggering branch), `production-branch` (`main`), `source-ref` (triggering commit), `version`, `node-version` (`24.x`), `package-manager` (`pnpm`), `working-directory` (`.`), `private-packages` (`false`), `npm-scope` (`@medrunner-services`), `build-script` (`build`), `public-env-map` (`{}`), `required-public-env` (`[]`), and `wrangler-version` (`4.148.0`).

Outputs: `deployment-url`, `alias-url`, and `version`.

The single job checks out the source, installs locked dependencies, maps public variables, stamps the build version, builds, then uploads with `cloudflare/wrangler-action@v4`. Wrangler installs into a temporary tool directory so its npm installation cannot reinstall private application dependencies; it reads the app's Wrangler config and uploads its build output directly. The job skips pull-request events. It grants `contents: read` and `packages: read`; Cloudflare credentials are referenced only by the upload action.

The caller provides `source-ref: new-tag || github.sha` and `version: new-version` from semantic release. Every merge deploys, including commits that do not create a new version. Without a supplied version, the deployer finds the nearest reachable `v*` release tag; production excludes prerelease tags. Without any tag it uses package.json. Version stamping occurs after frozen dependency installation, modifies no lockfile, and is never committed. pnpm's implicit installation before scripts is disabled.

`wrangler.json` belongs to the caller and supplies the project name and output directory. Wrangler uses `--cwd` to discover it in `working-directory`; Pages does not accept custom `--config` paths. The command explicitly supplies the deployment branch; Cloudflare's production branch must be configured separately. The uploader does not create or reconfigure Cloudflare projects.

## Environment values

Create `deploy-cf-production`, `deploy-cf-staging`, and `release` in each caller. Set unsuffixed public variables and secrets in the selected environment. Values identical everywhere may be repository/organization variables. Environments do not inherit values from each other.

`public-env-map` is JSON mapping shell build names to GitHub variables, e.g. `{"VITE_API_URL":"API_URL"}`. It resolves inside the selected job, not in caller inputs. `required-public-env` lists names that must be nonempty. Optional missing values become empty strings. Multiline values and reserved runner names are rejected. Browser variables are public.

Set `CLOUDFLARE_API_TOKEN` as an environment secret and `CLOUDFLARE_ACCOUNT_ID` as a variable. Do not forward environment secrets or use `secrets: inherit`. For private GitHub Packages, enable `private-packages`, set the scope, and grant the caller repository Actions read access to the package.

The `release` environment needs no manual GitHub token. Caller-owned `release.config.mjs` defines stable and staging channels. Stable backpropagation can open a PR, with automatic approval/merge disabled in the example; allow Actions PR creation if using it.

## Cloudflare setup

Keep one existing Pages project per portal. Set production branch to `release/stable`; deploy `main` as the fixed staging alias. Create new projects using Direct Upload. Disable automatic Git builds for existing Git-connected projects. No Cloudflare build variables or build command are needed when GHA builds the site.

Configure domains through the dashboard. Production CNAMEs point to `<project>.pages.dev`; staging CNAMEs point to `main.<project>.pages.dev`. Add the custom domain in Pages first; staging branch aliases require proxied Cloudflare DNS. Register the fixed target origins and OAuth callback paths with the corresponding API/authentication providers.

See official [Direct Upload/production branch instructions](https://developers.cloudflare.com/pages/get-started/direct-upload/), [GHA credential setup](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/), and [branch custom domains](https://developers.cloudflare.com/pages/how-to/custom-branch-aliases/).

Release this CI change before consumer `@v1` references it, or use an immutable released tag/SHA. Audit release history and seed only a genuine previously released baseline tag at its audited commit before enabling semantic release; package.json does not establish release history.

## Validation

`npm ci && npm test` exercises the actual inline public-variable/version steps and private stable-reachability fetch. Cases include missing configuration, injection rejection, frozen lockfile preservation, and version fallback on nonrelease merges. Run full actionlint/ShellCheck against all workflows and the caller example. These checks do not publish releases or deploy to Cloudflare.
