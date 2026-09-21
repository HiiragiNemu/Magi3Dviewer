# S6 main-only, sealed-artifact website release

## Release contract

The accepted Viewer source is published to **`main`**. The website is a **manual direct upload of the same sealed deployment artifact** to the Cloudflare Pages project **`magius3dviewer`**. Publishing source and uploading the artifact are separate, explicitly approved release actions.

This website process does not require a `magius3dviewer` Git branch, GitHub Pages, a repository-dispatch event, or a GitHub-side rebuild. It does not introduce an automatic build or deploy workflow. Source availability on `main` alone is not evidence that a website deployment or human acceptance succeeded.

<!-- s6-release-contract -->
```json
{
  "sourceBranch": "main",
  "artifactPolicy": "same-sealed-bytes",
  "website": {
    "provider": "cloudflare-pages",
    "project": "magius3dviewer",
    "publication": "manual-direct-upload"
  },
  "githubPages": false,
  "repositoryDispatch": false,
  "rebuildAtDeployment": false,
  "requiredGates": [
    "owners-aligned",
    "technical-gates-passed",
    "human-accepted",
    "release-approved",
    "fresh-predeploy-checked",
    "sealed-bytes-exact"
  ]
}
```

The JSON is a review contract, not an executable authorization or automatic deployment guard.

## Manual sequence

1. **Align released source.** The S6 controller closes exact-path writer claims and joins their release evidence. Preserve the shared dirty tree and retained/rejected baselines. Technical results and final human acceptance remain separate records.
2. **Seal one reviewed artifact.** Only after the current writers align, obtain separately authorized fresh release evidence from the isolated build process. Record the exact source snapshot, deployment directory, file/byte inventory, technical gates and review result. A prior build, including sealed v6, is not silently relabeled as a later source baseline.
3. **Approve the release explicitly.** Obtain human acceptance and the controller's exact release approval for source publication and artifact upload. An old successful test, dispatch receipt, commit status, or historical approval is not approval of a new payload.
4. **Perform a fresh preflight.** Immediately before any approved external mutation, verify the current private repository/account, `main` head, Cloudflare account/project target and active deployment. Record current rollback authorities and the sealed artifact's byte continuity. Historical predeploy heads and version IDs are evidence only; check them afresh at eventual deployment.
5. **Publish the accepted source to `main`.** Follow the approved repository operation and confirm that the published source corresponds to the sealed snapshot. Do not introduce a second website branch or invoke a GitHub rebuild.
6. **Upload those same sealed bytes manually.** Upload the reviewed deployment directory directly to Cloudflare project `magius3dviewer`. Do not rebuild, transform or substitute the payload at deployment time. If the source or artifact differs, hold publication and return to the controller.
7. **Validate and record.** Verify the resulting deployment identity, served content and required runtime paths against that same artifact. Record source publication, artifact upload, post-deployment validation and human acceptance separately. A failure follows the specifically approved, freshly recorded rollback scope; it never justifies modifying another service or release.

## Retired and preserved workflow state

- `.github/workflows/request-deploy.yml` is retired from the active workflow directory. Its former `magius3dviewer`-push trigger dispatched `deploy-magius3dviewer` and reported a misleading protected-main Pages request status. Its original bytes and deletion patch are retained in the verification package.
- `.github/workflows/deploy.yml` is absent from local source authority. Do not restore an old remote copy into the accepted source. Eventual remote reconciliation is a separately approved publication action; this source-only change performs none.
- The two research workflows, `manifest-driven-stage-reconstruction.yml` and `validate-stage-608-chair-alpha-cutout-feature.yml`, remain byte-unchanged. Their own branch references and research/build behavior are outside this website-dispatch change. This contract does not assert that every workflow must avoid branch references or builds.
- Runtime source, package scripts, existing services, sealed builds, Gateway Worker and existing release assets are unchanged by this retirement. No scheduler or recurring automation is added.

## Offline verification

Run `node --test releaseWorkflowContract.test.mjs` from the repository root. Its legacy behavior fixture is `tests/fixtures/s6-release-workflow/request-deploy.retired.yml.txt`: an exact copy of the retired workflow stored as dormant `.txt` data outside the active workflow directory. The test runs from a source-only snapshot without a verification artifact tree. It checks the specific dispatcher retirement, permits unrelated research branch/build behavior, executes legacy behavior with mocks only, and checks the documented manual review contract. Whole-file preservation of the two research workflows and `package.json` is evidence for this retirement atom's verification/replay, not an enduring test that freezes unrelated files. The focused test is not added to package scripts and does not publish source or contact GitHub/Cloudflare.
