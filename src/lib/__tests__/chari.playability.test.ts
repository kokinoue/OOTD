import { describe, expect, it } from 'vitest'
import {
  GRAV,
  PLAYER_H,
  createRun,
  motionSpeedFor,
  step,
  surfaceAt,
  type Run,
} from '../chari'

function needsJump(run: Run): boolean {
  const p = run.player
  const motionSpeed = motionSpeedFor(run)
  const look = motionSpeed * 0.085 + 24
  const platform = run.platforms.find((item) => item.id === p.platformId)
  if (platform && platform.x + platform.w - p.x <= look) return true
  const roadNow = surfaceAt(run, p.x)
  const roadAhead = surfaceAt(run, p.x + look)
  if (roadNow != null && roadAhead == null) return true
  return run.obstacles.some(
    (o) =>
      o.kind !== 'ramp' &&
      o.kind !== 'bird' &&
      o.x - (p.x + 15) >= 0 &&
      o.x - (p.x + 15) <=
        (o.kind === 'truck'
          ? motionSpeed * 0.55
          : o.kind === 'crossing'
            ? motionSpeed * 0.72
            : o.kind === 'signal' || o.kind === 'students'
              ? motionSpeed * 0.58
              : o.kind === 'commuter'
                ? motionSpeed * 0.58
            : look),
  )
}

function landingUnsafe(run: Run): boolean {
  const p = run.player
  const startedOverGap = surfaceAt(run, p.x) == null
  let x = p.x
  let y = p.y
  let vy = p.vy
  const dt = 1 / 60
  for (let i = 0; i < 72; i++) {
    const previousY = y
    x += motionSpeedFor(run, x) * dt
    vy += GRAV * dt
    y += vy * dt
    const road = surfaceAt(run, x)
    if (road != null && vy > 0 && y >= road) {
      if (startedOverGap && previousY > road) return true
      const blocked = run.obstacles.some(
        (o) => o.kind !== 'ramp' && x + 15 > o.x && x - 15 < o.x + o.w && road - PLAYER_H < o.y + o.h,
      )
      return blocked
    }
  }
  return startedOverGap && surfaceAt(run, x) == null
}

function overAirGap(run: Run): boolean {
  const x = run.player.x
  return run.segments.some(
    (s) => s.airGap && x >= s.x - s.gapBefore && x < s.x,
  )
}

function shouldAirJumpGap(run: Run): boolean {
  const p = run.player
  const gap = run.segments.find(
    (s) => s.airGap && p.x >= s.x - s.gapBefore && p.x < s.x,
  )
  if (!gap || p.vy <= 80) return false
  const progress = (p.x - (gap.x - gap.gapBefore)) / gap.gapBefore
  return p.y >= gap.y - 45 || progress >= 0.28
}

function needsAirJumpForTruck(run: Run): boolean {
  const p = run.player
  return run.obstacles.some(
    (o) =>
      o.kind === 'truck' &&
      o.x - (p.x + 15) >= 0 &&
      o.x - (p.x + 15) <= motionSpeedFor(run) * 0.42,
  )
}

function needsAirJumpForBarrier(run: Run): boolean {
  const p = run.player
  return run.obstacles.some(
    (o) =>
      (o.kind === 'crossing' ||
        o.kind === 'signal' ||
        o.kind === 'students' ||
        o.kind === 'commuter') &&
      o.x - (p.x + 15) >= 0 &&
      o.x - (p.x + 15) <= motionSpeedFor(run) * 0.24,
  )
}

function needsAirJumpForObstacle(run: Run): boolean {
  const p = run.player
  return run.obstacles.some(
    (o) =>
      o.kind !== 'bird' &&
      o.kind !== 'ramp' &&
      o.x - (p.x + 15) >= 0 &&
      o.x - (p.x + 15) <= motionSpeedFor(run) * 0.38,
  )
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
            ((run.player.vy > -40 &&
              (needsAirJumpForTruck(run) ||
                needsAirJumpForBarrier(run) ||
                needsAirJumpForObstacle(run))) ||
              (overAirGap(run)
                ? shouldAirJumpGap(run)
                : run.player.vy > 80 && landingUnsafe(run)))
          ) {
            jumpPressed = true
            jumpHeldFrames = overAirGap(run) ? 22 : 14
          }
          const jumpHeld = jumpHeldFrames-- > 0
          step(run, { jumpPressed, jumpHeld }, 1 / 60)
          if (frame % 6 === 0) {
            trace.push(
              `${frame}:${Math.round(run.player.x)},${Math.round(run.player.y)},${Math.round(run.player.vy)},road${Math.round(surfaceAt(run, run.player.x) ?? -1)},${run.player.grounded ? 'g' : 'a'},${jumpPressed ? 'J' : '-'},${run.player.airJumpUsed ? 'U' : '-'}`,
            )
            if (trace.length > 12) trace.shift()
          }
        }
        logs.push(
          `${seed}:${Math.floor(run.distance / 30)}m/${Math.round(run.speed)}pxs/${run.coinsTaken}coin`,
        )
        const nearby = run.segments
          .filter((s) => s.x + s.w > run.player.x - 1200 && s.x < run.player.x + 1200)
          .map(
            (s) =>
              `${Math.round(s.x)}-${Math.round(s.x + s.w)}@${Math.round(s.y)}>${Math.round(s.endY ?? s.y)}/gap${Math.round(s.gapBefore)}`,
          )
        const nearbyObstacles = run.obstacles
          .filter((o) => o.x + o.w > run.player.x - 300 && o.x < run.player.x + 300)
          .map((o) => `${o.kind}@${Math.round(o.x)},${Math.round(o.y)}`)
        expect(
          run.status,
          `seed ${seed}: ${run.overReason}, ${logs.at(-1)} [${trace.join(' ')}] roads=${nearby.join(',')} obstacles=${nearbyObstacles.join(',')}`,
        ).toBe('playing')
      }
      console.info(`[chari bot] ${logs.join(' ')}`)
    },
    30_000,
  )
})
