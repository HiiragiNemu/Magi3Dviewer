import type { JumpMode, JumpPhase } from './jumpStyle'

export interface JumpArmAngles {
    /** Sagittal angle in degrees from relaxed downward, positive forward. */
    upper: number
    /** Elbow flexion relative to the upper arm, always forward. */
    elbow: number
    /** Wrist deviation from the forearm; not a borrowed running-wrist curve. */
    wrist: number
    outward: number
}
export interface JumpArmPose { left: JumpArmAngles; right: JumpArmAngles; fingerStrength: number }
const smooth=(value:number)=>{const x=Math.min(1,Math.max(0,value));return x*x*(3-2*x)}
const blend=(a:JumpArmAngles,b:JumpArmAngles,t:number):JumpArmAngles=>({upper:a.upper+(b.upper-a.upper)*t,elbow:a.elbow+(b.elbow-a.elbow)*t,wrist:a.wrist+(b.wrist-a.wrist)*t,outward:a.outward+(b.outward-a.outward)*t})
const arm=(upper:number,elbow:number,outward=5):JumpArmAngles=>({upper,elbow,wrist:-3,outward})
/** Three deliberately different, bounded arm paths on each character's own
 * measured body axes. Angles are rotations only; no IK reach or bone stretch.
 * Standing uses a relaxed bilateral swing, not a frozen running-paw sample. */
export function naturalJumpArmPose(ratio:number,phase:JumpPhase,mode:JumpMode):JumpArmPose {
    const t=Number.isFinite(ratio)?Math.min(1,Math.max(0,ratio)):0
    const standing=mode==='standing',running=mode==='running'
    const start:JumpArmPose=standing
        ?{left:arm(4,12,7),right:arm(4,12,7),fingerStrength:.3}
        :running?{left:arm(10,65),right:arm(-8,68),fingerStrength:.55}
        :{left:arm(6,24),right:arm(-5,27),fingerStrength:.35}
    const back:JumpArmPose=standing
        ?{left:arm(-20,16,7),right:arm(-20,16,7),fingerStrength:.3}
        :running?{left:arm(-14,65),right:arm(16,68),fingerStrength:.55}
        :{left:arm(-10,27),right:arm(10,28),fingerStrength:.35}
    const lift:JumpArmPose=standing
        ?{left:arm(36,24,7),right:arm(36,24,7),fingerStrength:.3}
        :running?{left:arm(32,69),right:arm(-28,72),fingerStrength:.55}
        :{left:arm(17,32),right:arm(-13,36),fingerStrength:.35}
    const airborne:JumpArmPose=standing
        ?{left:arm(19,22,8),right:arm(19,22,8),fingerStrength:.3}
        :running?{left:arm(25,65),right:arm(-22,68),fingerStrength:.55}
        :{left:arm(13,29),right:arm(-10,33),fingerStrength:.35}
    let from=start,to=back,weight=0
    if(phase==='takeoff'){
        if(t<.28)weight=smooth(t/.28)
        else{from=back;to=lift;weight=smooth((t-.28)/.72)}
    }else if(phase==='airborne'){
        from=lift;to=airborne;weight=Math.sin(Math.PI*t)**2
    }else{from=lift;to=start;weight=smooth(t)}
    return{left:blend(from.left,to.left,weight),right:blend(from.right,to.right,weight),fingerStrength:from.fingerStrength}
}
/** Reference +X = left, +Y = up, +Z = forward. */
export function jumpArmDirection(pitch:number,outward:number,side:'L'|'R'):readonly[number,number,number] {
    const p=pitch*Math.PI/180,o=outward*Math.PI/180
    return [(side==='L'?1:-1)*Math.sin(o),-Math.cos(p)*Math.cos(o),Math.sin(p)*Math.cos(o)]
}
