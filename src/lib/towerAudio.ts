// タワーの効果音。音源ファイルは持たず、Web Audio で毎回合成する（slotAudio と同じ流儀）。
// AudioContext は最初のユーザー操作（回転・落下）で作るので、自動再生制限に触れない。

import { clamp01, settleNoteHz } from './towerFx'

export const TOWER_SOUND_KEY = 'tower.sound'

type ToneOptions = {
  type?: OscillatorType
  volume?: number
  /** 終了時の周波数倍率 */
  slide?: number
  delay?: number
}

export function createTowerAudio() {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let muted = false
  try {
    muted = localStorage.getItem(TOWER_SOUND_KEY) === 'off'
  } catch {
    // localStorage が使えない環境では音ありで始める
  }

  const context = () => {
    if (!ctx) {
      ctx = new AudioContext()
      master = ctx.createGain()
      master.gain.value = 0.9
      master.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  }

  const tone = (freq: number, duration: number, opts: ToneOptions = {}) => {
    const ac = context()
    const at = ac.currentTime + (opts.delay ?? 0)
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = opts.type ?? 'sine'
    osc.frequency.setValueAtTime(freq, at)
    if (opts.slide && opts.slide !== 1) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * opts.slide), at + duration)
    }
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(opts.volume ?? 0.05, at + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    osc.connect(gain).connect(master!)
    osc.start(at)
    osc.stop(at + duration + 0.02)
  }

  // 減衰するノイズをフィルタに通す。cutoffEnd を渡すと周波数が流れる（風切り・崩落）
  const noise = (
    duration: number,
    volume: number,
    cutoff: number,
    opts: { type?: BiquadFilterType; cutoffEnd?: number; delay?: number } = {},
  ) => {
    const ac = context()
    const at = ac.currentTime + (opts.delay ?? 0)
    const length = Math.max(1, Math.floor(ac.sampleRate * duration))
    const buffer = ac.createBuffer(1, length, ac.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length)
    const src = ac.createBufferSource()
    src.buffer = buffer
    const filter = ac.createBiquadFilter()
    filter.type = opts.type ?? 'lowpass'
    filter.frequency.setValueAtTime(cutoff, at)
    if (opts.cutoffEnd) filter.frequency.exponentialRampToValueAtTime(opts.cutoffEnd, at + duration)
    const gain = ac.createGain()
    gain.gain.value = volume
    src.connect(filter).connect(gain).connect(master!)
    src.start(at)
  }

  // 操作が呼び出し元にあるので、未操作のうちは鳴らさない（context を勝手に作らない）
  const ready = () => !muted && (ctx !== null || navigator.userActivation?.hasBeenActive !== false)

  return {
    muted: () => muted,
    toggle: () => {
      muted = !muted
      try {
        localStorage.setItem(TOWER_SOUND_KEY, muted ? 'off' : 'on')
      } catch {
        // 保存できなくても、このセッションでは切り替わる
      }
      if (!muted) tone(880, 0.08, { type: 'triangle', volume: 0.05 })
      return muted
    },
    /** タップで90°回転: 紙をめくるような短いクリック */
    rotate: () => {
      if (!ready()) return
      tone(740, 0.05, { type: 'triangle', volume: 0.05, slide: 1.5 })
      noise(0.03, 0.08, 2600, { type: 'highpass' })
    },
    /** 手を離して落下: 風切り音 */
    drop: () => {
      if (!ready()) return
      noise(0.22, 0.12, 1800, { type: 'bandpass', cutoffEnd: 420 })
    },
    /** 着地・ぶつかり。strength 0..1 で重さが変わる */
    impact: (strength: number) => {
      if (!ready()) return
      const s = clamp01(strength)
      tone(110 - s * 30, 0.12 + s * 0.1, { volume: 0.05 + s * 0.16, slide: 0.5 })
      noise(0.05 + s * 0.05, 0.08 + s * 0.2, 500 + s * 900)
    },
    /** n 体目が静止した: 1体ごとに音階が上がるベル */
    settle: (n: number) => {
      if (!ready()) return
      const f = settleNoteHz(n)
      tone(f, 0.5, { type: 'sine', volume: 0.09 })
      tone(f * 2, 0.3, { type: 'triangle', volume: 0.03 })
      tone(f * 3, 0.16, { type: 'sine', volume: 0.012 })
    },
    /** 5体ごとの節目 */
    milestone: (n: number) => {
      if (!ready()) return
      const f = settleNoteHz(n)
      ;[1, 1.25, 1.5, 2].forEach((r, i) =>
        tone(f * r, 0.22, { type: 'triangle', volume: 0.06, delay: 0.12 + i * 0.07 }),
      )
    },
    /** 自己ベスト更新 */
    best: () => {
      if (!ready()) return
      ;[523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
        tone(f, i === 4 ? 0.6 : 0.16, { type: 'triangle', volume: 0.08, delay: 0.1 + i * 0.09 }),
      )
    },
    /** タワーが揺れたときの軋み */
    creak: () => {
      if (!ready()) return
      tone(92, 0.28, { type: 'sawtooth', volume: 0.018, slide: 1.25 })
      tone(138, 0.2, { type: 'sawtooth', volume: 0.01, slide: 0.85, delay: 0.06 })
    },
    /** 崩落（ゲームオーバー） */
    collapse: () => {
      if (!ready()) return
      noise(1.1, 0.3, 900, { cutoffEnd: 90 })
      tone(220, 0.9, { type: 'triangle', volume: 0.07, slide: 0.25 })
      tone(55, 0.7, { volume: 0.14, slide: 0.6, delay: 0.05 })
    },
    dispose: () => {
      void ctx?.close()
      ctx = null
      master = null
    },
  }
}

export type TowerAudio = ReturnType<typeof createTowerAudio>
