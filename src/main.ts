import './style.css'
import './polyfills'
import { setupViewer } from './viewer'
import { installZhCnUi } from './viewer/localization/zhCN'
import { installOfficialStageTextureResolver } from './viewer/stageTextureResolver'
import { setupStageSelector } from './viewer/stages'

installOfficialStageTextureResolver()
installZhCnUi()
setupViewer()
void setupStageSelector()
