# Android startup incident — diagnostic rollout, not a confirmed handset fix

## Status

**The user's Android-specific fault remains unresolved.** The supplied screenshot shows the original untranslated startup shell with no populated model selector. That observation does not identify a network, JavaScript, memory, GPU, or browser-version cause by itself. Do not describe this rollout as an Android compatibility fix or close the incident without evidence from the failing handset.

Published application revision: `3b72a3d662b855bdb2fa0f76bd83449dcf3dbb14`.
Cloudflare Pages deployment: `8ca5e5f0`, existing `magius3dviewer` project, production channel `main`.
Git branch remains `magius3dviewer`; previous application revision is `bcfb1e8c40f90926c3101a6d4e05449081ef75cb`.

Formal root HTML SHA-256: `dd5aa0f2cd239f0b76e9cf3cdf19352c7a2b85694972f12bce05e5b7808e49d0`. Root HTML matches the built file byte-for-byte and `/site-version.json` reports the expected revision.

## Confirmed startup handling defect

The main entry statically imports the Viewer graph before invoking localization. A module request failure, module evaluation exception, or WebGL renderer-construction failure can therefore occur before normal UI/error handling exists, leaving the static English loading text indefinitely. The new independent classic ES5 script executes during HTML parsing, before deferred module evaluation; it observes startup resource failures and exceptions without depending on the application graph.

The script displays actual errors, the build revision, the browser user agent, and a bounded local diagnostic. A start taking more than 20 seconds is explicitly reported as still pending, not falsely classified as a failure. The user can retry by reloading or copy the diagnostic. Successful application initialization stops the watchdog and removes its panel.

There is no telemetry, automatic reload, local-storage deletion, cache clearing, rendering fallback, or changes to saved poses. The completed Viewer module remains the exact same hashed `viewer-runtime-0_1ZzwWy.js` as the previous deployment. All model/atlas, native gait, jump, node and TPS feature sources are unchanged. Only the independent startup reporter, two lifecycle signals, Vite injection and their tests are added.

## What was actually tested

- Original production HTML and revision agreed; no mixed deployment was observed.
- A real Android 15 **x86_64 emulator** running Chrome `154.0.8037.57` loaded model `100107`, both before this change and on the published diagnostic revision with browser cache disabled. No page exceptions were observed. This is not the user's physical Android/ARM phone.
- A genuine Chrome for Testing `120.0.6099.109` desktop engine loaded the original build. It is not an Android 120 test.
- Current desktop Chromium with reduced V8 stack budgets of 984, 864, 512 and 256 KiB still initialized the original build; these experiments did not reproduce the reported fault.
- Website regression gate: **431 passed, 0 failed, 0 skipped**, including 13 new startup tests. TypeScript and `npm run build:deploy` passed. This does not mean every historical research/corpus test is green.
- Local and formal-domain browser acceptance both passed four groups: normal startup; actual module-download abort with visible failure and explicit retry preserving storage; actual WebGL-context-construction failure visible before the main entry; delayed module request reported as pending and completing without a reload.
- No physical iOS device or the user's failing phone was tested in this turn. The unchanged Viewer runtime is not a substitute for that missing verification.

## Continuation

Obtain the diagnostic from the **same failing Android browser** after refreshing the original formal URL. If it still does not initialize, the standalone panel should show an actual error or pending state and include the browser version automatically. Ask for the panel's “复制诊断信息” output, not a reinstall or a blanket storage reset. If even the independent panel never appears, record that fact and the browser version; do not invent a successful recovery.

`node scripts/site-smoke-startup.mjs` exercises the built or published site. Set `MAGIUS_SITE_URL`, `MAGIUS_EVIDENCE_DIR` and `MAGIUS_EXPECTED_REVISION` as needed. Evidence retained beside this report includes the formal HTTP verification, formal injected-failure results and actual Android-emulator startup state/screenshot. Larger browser downloads and temporary probes remain local under `artifacts/android-startup/` and are not committed.
