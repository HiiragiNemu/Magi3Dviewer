import './style.css'
import './polyfills'
import { setupViewer } from './viewer'
import { installLocalization } from './viewer/localization/zhCN'
import { installOfficialStageTextureResolver } from './viewer/stageTextureResolver'
import { installOfficialStageAlphaCutoutFixes } from './viewer/stageAlphaCutoutFixes'
import { setupStageSelector } from './viewer/stages'

installOfficialStageTextureResolver()
installLocalization()
setupViewer()
installOfficialStageAlphaCutoutFixes()
void setupStageSelector()
