import './style.css'
import './polyfills'
import { setupViewer } from './viewer'
import { installOfficialStageTextureResolver } from './viewer/stageTextureResolver'
import { setupStageSelector } from './viewer/stages'

installOfficialStageTextureResolver()
setupViewer()
void setupStageSelector()
