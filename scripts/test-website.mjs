import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Keep the extracted native-corpus research suite separate. These are real
// regression tests used by website delivery; no missing tests are skipped.
const tests = [
  'sceneCatalogStatus.test.mjs',
  'uiLocalization.test.mjs',
  'enemyUiPanel.test.mjs',
  'enemyAnimationInteraction.test.mjs',
  'resourcePanels.test.mjs',
  'stageSpecialSurfaces.test.mjs',
  'stageMainLightCascades.test.mjs',
  'stageParticleBlendState.test.mjs',
  'stageVolumetricLightBeams.test.mjs',
  'performanceRecording.test.mjs',
  'studioFollowup.test.mjs',
  'garmentContacts.test.mjs',
  'garmentSurfaceContact.test.mjs','garmentStabilityV3.test.mjs','garmentRenderCoherence.test.mjs','garmentSafetyRelease.test.mjs','locomotionGenerationFacing.test.mjs',
  'cameraPlaneControl.test.mjs',
  'performanceAudioLane.test.mjs',
  'performanceAudioTimelineBridge.test.mjs',
  'startupGuard.test.mjs',
  'nodeTpsUsability.test.mjs',
  'nativeAtlasRepair.test.mjs',
  'finalViewerUsability.test.mjs',
  'jumpArmKinematics.test.mjs',
  'poseSnapshotPlayback.test.mjs',
  'poseWorkspace.test.mjs',
  'workspaceLifecycle.test.mjs',
  'movingLandingContinuity.test.mjs',
  'entryLandingRegression.test.mjs',
  'jumpStyleRollback.test.mjs',
  'viewportBranchesTouch.test.mjs',
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
  'stageSelectorReady.test.mjs',
]
for (const file of tests) {
  if (!fs.existsSync(path.join(root, file))) throw new Error('Required website regression is missing: ' + file)
}
const child = spawn(process.execPath, ['--test', ...tests], {cwd:root,stdio:'inherit',windowsHide:true})
child.on('error', error => {console.error(error.message);process.exitCode=1})
child.on('exit', (code, signal) => {process.exitCode=code ?? 1; if (signal) console.error('Website regression terminated: ' + signal)})
