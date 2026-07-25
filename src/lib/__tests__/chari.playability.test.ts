import { describe, expect, it } from 'vitest'
import {
  GRAV,
  PLAYER_H,
  createRun,
  speedAt,
  step,
  surfaceAt,
  type Run,
} from '../chari'

function needsJump(run: Run): boolean {
  const p = run.player
  const look = run.speed * 0.085 + 24
  const roadNow = surfaceAt(run, p.x)
  const roadAhead = surfaceAt(run, p.x + look)
  if (roadNow != null && roadAhead == null) return true
  return run.obstacles.some(
    (o) => o.kind !== 'ramp' && o.x - (p.x + 15) >= 0 && o.x - (p.x + 15) <= look,
  )
}

function landingUnsafe(run: Run): boolean {
  const p = run.player
  let x = p.x
  let y = p.y
  let vy = p.vy
  const dt = 1 / 60
  for (let i = 0; i < 72; i++) {
    x += speedAt(x - run.startX) * dt
    vy += GRAV * dt
    y += vy * dt
    const road = surfaceAt(run, x)
    if (road != null && vy > 0 && y >= road) {
      const blocked = run.obstacles.some(
        (o) => o.kind !== 'ramp' && x + 15 > o.x && x - 15 < o.x + o.w && road - PLAYER_H < o.y + o.h,
      )
      return blocked
    }
  }
  return surfaceAt(run, x) == null
}

describe('チャリ通のプレイ可能性', () => {
  it(
    '30シードを自動プレイで90秒走り切れる',
    () => {
      const logs: string[] = []
      for (let seed = 1; seed <= 30; seed++) {
        const run = createRun(seed)
        let jumpHeldFrames = 0
        const trace: string[] = []
        for (let frame = 0; frame < 90 * 60 && run.status === 'playing'; frame++) {
          let jumpPressed = false
          if (run.player.grounded && needsJump(run)) {
            jumpPressed = true
            jumpHeldFrames = 13
          } else if (
            !run.player.grounded &&
            !run.player.airJumpUsed &&
            run.player.vy > 80 &&
            landingUnsafe(run)
          ) {
            jumpPressed = true
            jumpHeldFrames = 10
          }
          const jumpHeld = jumpHeldFrames-- > 0
          step(run, { jumpPressed, jumpHeld, diveHeld: false }, 1 / 60)
          if (frame % 6 === 0) {
            trace.push(
              `${frame}:${Math.round(run.player.x)},${Math.round(run.player.y)},${Math.round(run.player.vy)},${run.player.grounded ? 'g' : 'a'},${jumpPressed ? 'J' : '-'}`,
            )
            if (trace.length > 12) trace.shift()
          }
        }
        logs.push(
          `${seed}:${Math.floor(run.distance / 30)}m/${Math.round(run.speed)}pxs/${run.coinsTaken}coin`,
        )
        const nearby = run.segments
          .filter((s) => s.x + s.w > run.player.x - 1200 && s.x < run.player.x + 1200)
          .map((s) => `${Math.round(s.x)}-${Math.round(s.x + s.w)}@${s.y}/gap${Math.round(s.gapBefore)}`)
        expect(
          run.status,
          `seed ${seed}: ${run.overReason}, ${logs.at(-1)} [${trace.join(' ')}] roads=${nearby.join(',')}`,
        ).toBe('playing')
      }
      console.info(`[chari bot] ${logs.join(' ')}`)
    },
    30_000,
  )
})
