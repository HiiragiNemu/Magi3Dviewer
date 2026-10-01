import './polyfills'
import { setupViewer } from './viewer'
import { installLocalization } from './viewer/localization/zhCN'
import { installOfficialStageTextureResolver } from './viewer/stageTextureResolver'
import { installOfficialStageAlphaCutoutFixes } from './viewer/stageAlphaCutoutFixes'
import { setupStageSelector } from './viewer/stages'

installOfficialStageTextureResolver()
installLocalization()
window.dispatchEvent(new CustomEvent('magius:bootstrap-stage', { detail: 'viewer-initializing' }))
setupViewer()
installOfficialStageAlphaCutoutFixes()
void setupStageSelector()
window.dispatchEvent(new Event('magius:bootstrap-ready'))
