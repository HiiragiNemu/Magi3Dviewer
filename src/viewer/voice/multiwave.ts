export const DEMO_LIPSYNC_CONSTANTS = Object.freeze({
    analyserFftSize: 256,
    rmsRelease: 0.6,
    loudnessGate: 0.01,
    gain: 12,
    mouthOpenSensitivityCurve: 5.5,
    mouthOpenSmoothing: 0.97,
    mouthCloseSpeed: 0.9,
    mouthFormPrimaryIntensity: 0.8,
    mouthFormPrimarySpeed: 4.5,
    mouthFormSecondaryIntensity: 0.5,
    mouthFormSecondarySpeed: 12,
    mouthFormConflictClampFactor: 0.3,
    mouthFormNeutralIntensity: 0.4,
    mouthFormAnimationSpeed: 0.9,
    mouthFormReturnSpeed: 0.92,
})

export interface DemoMultiwaveFrame {
    rawRms: number
    rms: number
    hasSound: boolean
    mouthOpen: number
    mouthForm: number
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value))
}

export function calculateTimeDomainRms(pcm: Float32Array): number {
    if (pcm.length === 0) return 0
    let sumOfSquares = 0
    for (let index = 0; index < pcm.length; index++) {
        const sample = pcm[index] ?? 0
        sumOfSquares += sample * sample
    }
    return Math.sqrt(sumOfSquares / pcm.length)
}

export class DemoMultiwaveLipSync {
    private lastRms = 0
    private smoothedMouthOpen = 0
    private smoothedMouthForm = 0
    private phasePrimary = 0
    private phaseSecondary = 0

    reset(baseMouthForm = 0): void {
        this.lastRms = 0
        this.smoothedMouthOpen = 0
        this.smoothedMouthForm = baseMouthForm
        this.phasePrimary = 0
        this.phaseSecondary = 0
    }

    updateFromPcm(
        pcm: Float32Array,
        deltaTimeSeconds: number,
        baseMouthForm = 0,
    ): DemoMultiwaveFrame {
        return this.updateFromRms(
            calculateTimeDomainRms(pcm),
            deltaTimeSeconds,
            baseMouthForm,
        )
    }

    updateFromRms(
        rawRms: number,
        deltaTimeSeconds: number,
        baseMouthForm = 0,
    ): DemoMultiwaveFrame {
        const safeRawRms = Math.max(0, Number.isFinite(rawRms) ? rawRms : 0)
        const safeDelta = Math.max(0, Number.isFinite(deltaTimeSeconds) ? deltaTimeSeconds : 0)
        this.lastRms = Math.max(
            safeRawRms,
            this.lastRms * DEMO_LIPSYNC_CONSTANTS.rmsRelease,
        )

        const hasSound = this.lastRms > DEMO_LIPSYNC_CONSTANTS.loudnessGate
        const normalizedRms = clamp01(this.lastRms * DEMO_LIPSYNC_CONSTANTS.gain)
        const targetMouthOpen = Math.pow(
            normalizedRms,
            DEMO_LIPSYNC_CONSTANTS.mouthOpenSensitivityCurve,
        )

        if (hasSound) {
            this.smoothedMouthOpen =
                this.smoothedMouthOpen * DEMO_LIPSYNC_CONSTANTS.mouthOpenSmoothing
                + targetMouthOpen * (1 - DEMO_LIPSYNC_CONSTANTS.mouthOpenSmoothing)
        } else {
            this.smoothedMouthOpen *= DEMO_LIPSYNC_CONSTANTS.mouthCloseSpeed
        }

        if (hasSound) {
            this.phasePrimary += safeDelta * DEMO_LIPSYNC_CONSTANTS.mouthFormPrimarySpeed
            this.phaseSecondary += safeDelta * DEMO_LIPSYNC_CONSTANTS.mouthFormSecondarySpeed
            const primaryWave = Math.sin(this.phasePrimary)
                * DEMO_LIPSYNC_CONSTANTS.mouthFormPrimaryIntensity
            const secondaryWave = Math.sin(this.phaseSecondary)
                * DEMO_LIPSYNC_CONSTANTS.mouthFormSecondaryIntensity
            const combinedWaveOffset = primaryWave + secondaryWave
            let waveIntensity = 1
            if (Math.abs(baseMouthForm) < 0.1) {
                waveIntensity = DEMO_LIPSYNC_CONSTANTS.mouthFormNeutralIntensity
            } else if (Math.sign(combinedWaveOffset) !== Math.sign(baseMouthForm)) {
                waveIntensity = DEMO_LIPSYNC_CONSTANTS.mouthFormConflictClampFactor
            }
            const targetMouthForm = baseMouthForm
                + combinedWaveOffset * waveIntensity * this.smoothedMouthOpen
            this.smoothedMouthForm =
                this.smoothedMouthForm * DEMO_LIPSYNC_CONSTANTS.mouthFormAnimationSpeed
                + targetMouthForm * (1 - DEMO_LIPSYNC_CONSTANTS.mouthFormAnimationSpeed)
        } else {
            this.phasePrimary = 0
            this.phaseSecondary = 0
            this.smoothedMouthForm =
                this.smoothedMouthForm * DEMO_LIPSYNC_CONSTANTS.mouthFormReturnSpeed
                + baseMouthForm * (1 - DEMO_LIPSYNC_CONSTANTS.mouthFormReturnSpeed)
        }

        return {
            rawRms: safeRawRms,
            rms: this.lastRms,
            hasSound,
            mouthOpen: this.smoothedMouthOpen,
            mouthForm: this.smoothedMouthForm,
        }
    }
}
