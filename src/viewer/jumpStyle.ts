export type JumpStyle = 'classic' | 'expressive'
export type JumpPhase = 'takeoff' | 'airborne' | 'land'
export type JumpMode = 'standing' | 'walking' | 'running'
export const JUMP_STYLE_KEY = 'magius.jump-style.v1'
export function isJumpStyle(value: unknown): value is JumpStyle { return value === 'classic' || value === 'expressive' }
const smooth = (x:number) => {const t=Math.min(1,Math.max(0,x));return t*t*(3-2*t)}
const wrap = (x:number) => ((x%1)+1)%1
/** Phase-space paths through existing accepted donor arm curves; no translation,
 * scale, new root trajectory or foreign bone binding is introduced. */
export function expressiveJumpArmSample(ratio:number,phase:JumpPhase,mode:JumpMode) {
    const t=Number.isFinite(ratio)?Math.max(0,Math.min(1,ratio)):0
    const moving=mode==='running'?1:mode==='walking'?.5:0
    const launchStart=mode==='standing'?.50:.06
    const backswing=mode==='standing'?.73:mode==='walking'?.14:.12
    // Standing coordinates a backswing then a bilateral forward lift. Moving
    // jumps keep a lead/trail arm split instead of the old both-arms-back pose.
    const lift=mode==='standing'?1.22:mode==='walking'?.24:.27
    const takeoff=t<.28?launchStart+(backswing-launchStart)*smooth(t/.28):backswing+(lift-backswing)*smooth((t-.28)/.72)
    const recovered=mode==='standing'?1.50:mode==='walking'?.54:.56
    const sample=phase==='takeoff'?takeoff:phase==='airborne'?lift+(.025+.01*moving)*Math.sin(t*2*Math.PI):lift+(recovered-lift)*smooth(t)
    const separation=mode==='standing'?.5:mode==='walking'?.25:0
    return {left:wrap(sample),right:wrap(sample+separation),strength:1}
}
export function expressiveJumpName(classic:string) { return classic.replace(/_(SE|L)$/,'_ExpressiveV1_$1') }
export function readJumpStyle(storage?:Pick<Storage,'getItem'>):JumpStyle {
    try {const value=storage?.getItem(JUMP_STYLE_KEY);if(isJumpStyle(value))return value}catch{}
    return 'expressive'
}
