# Publishing FrameScript

FrameScript 0.1.0 is prepared as a public alpha with three artifacts:

1. `framescript` on npm — compiler API, `framec`, and the language server;
2. `tree-sitter-framescript` on npm — generated grammar and editor queries;
3. `framescript-vscode-<version>.vsix` — VS Code extension.

Package-name availability was checked on 2026-10-06, but a registry name is not reserved until the first successful publication.

## 1. Choose permanent identities

Before publishing, decide:

- the GitHub owner and repository name;
- whether `framescript` is the permanent npm name;
- the Visual Studio Marketplace publisher ID.

If your Marketplace publisher ID is not `framescript`, change `publisher` in `editors/vscode/package.json`. A Marketplace publisher ID cannot casually be replaced after users install the extension.

If either npm name changes, update the corresponding manifest plus the hard-coded identity checks in `scripts/verify-release.mjs` and `.github/workflows/release.yml` before building artifacts.

After creating the GitHub repository, add `repository`, `homepage`, and `bugs` fields to the artifact manifests. These are intentionally not fabricated in the source tree.

The helper updates all three artifact manifests consistently:

```sh
npm run repository:set -- YOUR_ACCOUNT/YOUR_REPOSITORY
```

The repository URL must match the GitHub repository exactly for npm trusted publishing.

## 2. Create and push the Git repository

This workspace is initialized as a Git repository on the `main` branch. From the project root:

```sh
git add .
git commit -m "FrameScript 0.1.0 alpha"
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

Enable GitHub private vulnerability reporting under **Settings → Security → Private vulnerability reporting**.

## 3. Verify release artifacts locally

```sh
npm ci
npm run extension:install
npm run release:verify
npm run release:artifacts -- --pre-release
```

The `release/` directory will contain two npm tarballs, the versioned VSIX, and `SHA256SUMS.txt`. Inspect it before publishing.

Dry-run the compiler publication:

```sh
npm run publish:dry-run
npm publish ./tree-sitter-framescript --dry-run
```

## 4. Claim the npm package names once

Trusted publishers are configured from an existing package's settings, so the first versions must claim the names manually. Create an npm account with two-factor authentication, verify that both names are still available, then publish the already-tested tarballs:

```sh
npm login
npm publish ./release/framescript-0.1.0.tgz --access public --tag next
npm publish ./release/tree-sitter-framescript-0.1.0.tgz --access public --tag next
```

Never publish from an unverified working directory. npm versions are immutable, so correct mistakes by publishing a new version rather than overwriting 0.1.0.

## 5. Configure npm trusted publishing

For each package, add a GitHub Actions trusted publisher using:

- your GitHub organization/user;
- your repository;
- workflow filename: `release.yml`;
- environment: `npm`.
- allowed action: direct `npm publish` (or change the workflow to npm staged publishing).

Create a protected GitHub environment named `npm`, ideally with a required reviewer. The release workflow installs npm 11.19.1 and requests `id-token: write`, so npm can authenticate it through OIDC without a long-lived npm token and attach provenance for a public repository/package.

## 6. Publish GitHub artifacts and later npm versions

Re-run the gate and tag the already-pushed release commit:

```sh
npm run release:verify
git status --short
git tag v0.1.0
git push origin main --tags
```

`git status --short` should print nothing. For later releases, run `npm run version:set -- X.Y.Z`, update the changelog, verify, commit, and then tag that commit.

On GitHub, create a release from `v0.1.0` and mark it as a **pre-release** for the alpha. Publishing that GitHub release triggers `.github/workflows/release.yml`, which verifies everything, skips an npm version that was already claimed manually, packages a pre-release VSIX, and attaches checksummed artifacts. For later versions, the same workflow publishes both npm packages using `next` for pre-releases or `latest` for stable releases.

After inspecting the published alpha, users can install it with:

```sh
npm install --global framescript@next
framec --help
```

## 7. Publish the VS Code extension

Create a publisher at the Visual Studio Marketplace and ensure its ID exactly matches `publisher` in `editors/vscode/package.json`.

For the first release, the simplest secure route is manual upload:

1. Download `framescript-vscode-0.1.0.vsix` from the GitHub release or use the local `release/` copy.
2. Open the Marketplace publisher management page.
3. Select **New extension → Visual Studio Code**.
4. Upload the VSIX. The release-built alpha VSIX already carries pre-release metadata.

Microsoft is retiring global Azure DevOps PATs on 2026-12-01. For durable automation, use the Marketplace's Microsoft Entra workload-identity flow and `vsce publish --azure-credential` rather than introducing a new long-lived PAT secret.

Users can also install the GitHub release directly:

```sh
code --install-extension framescript-vscode-0.1.0.vsix
```

## 8. Promote a stable release

Do not label 0.1.0 production-stable merely because it is publishable. After real projects establish compatibility, publish a non-prerelease GitHub release. The workflow then uses npm's `latest` tag instead of `next`.

Before every release:

- update `CHANGELOG.md`;
- synchronize versions with `npm run version:set`;
- run `npm run release:verify` and `npm run release:artifacts`;
- review dependency and Remotion licensing;
- test the VSIX on a clean VS Code profile;
- render at least one generated project end to end.
