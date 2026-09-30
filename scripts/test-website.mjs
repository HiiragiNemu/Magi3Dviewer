import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Keep the extracted native-corpus research suite separate. These are real
// regression tests used by website delivery; no missing tests are skipped.
const tests = [
  'tpsTouchControls.test.mjs',
  'tpsLandingContact.test.mjs',
  'characterLoadLifecycle.test.mjs',
  'stageGlobalCommit.test.mjs',
  'nonBattleCharacterRuntime.test.mjs',
  'archiveRobustness.test.mjs',
  'deploymentTarget.test.mjs',
  'enemyLoadFailureLifecycle.test.mjs',
  'viewerTpsCameraContinuity.test.mjs',
  'viewerTpsCameraResponse.test.mjs',
  'viewerTpsExit.test.mjs',
  'viewportEditing.test.mjs',
  'directPoseManipulation.test.mjs',
  'viewerSelectionEditing.test.mjs',
  'performanceChainIK.test.mjs',
  'bundledStageDelivery.test.mjs',
  'prepareGitHubPages.test.mjs',
  'immutableSourceDelivery.test.mjs',
  'runtimeProductDelivery.test.mjs',
  'siteStageDelivery.test.mjs',
  'runtimeProductGateway.test.mjs',
]
for (const file of tests) {
  if (!fs.existsSync(path.join(root, file))) throw new Error('Required website regression is missing: ' + file)
}
const child = spawn(process.execPath, ['--test', ...tests], {cwd:root,stdio:'inherit',windowsHide:true})
child.on('error', error => {console.error(error.message);process.exitCode=1})
child.on('exit', (code, signal) => {process.exitCode=code ?? 1; if (signal) console.error('Website regression terminated: ' + signal)})
