// 四季通勤の音。素材ファイルは使わず、BGM・環境音・効果音をすべて WebAudio で合成する。
//
// ・BGM: 季節ごとにキー・テンポ・コード進行を変えた、エレピ風のアルペジオ（毎小節ゆらぎを入れて飽きにくくする）
// ・環境音: 雨、風、夏のセミ、秋の虫、春の鳥。季節・時刻・空模様で混ぜ具合が変わる
// ・AudioContext はユーザー操作（unlock）で初めて起動するので、自動再生制限に抵触しない

import type { ShikiSeason } from './shiki'
import type { Sky } from './weather'

export type Sfx =
  | 'tap'
  | 'pick'
  | 'unpick'
  | 'go'
  | 'comfy'
  | 'soso'
  | 'bad'
  | 'wet'
  | 'sync'
  | 'perk'
  | 'season'
  | 'fail'
  | 'clear'

export type Ambience = { season: ShikiSeason; sky: Sky; precip: number; hour: number }

export type ShikiAudio = {
  unlock: () => void
  toggle: () => boolean
  muted: () => boolean
  setAmbience: (a: Ambience) => void
  sfx: (kind: Sfx) => void
  close: () => void
}

const SOUND_KEY = 'shiki.sound'
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12)

// コードは [ベース, 構成音...]（MIDIノート番号）
const SONGS: Record<ShikiSeason, { bpm: number; chords: number[][]; scale: number[]; wave: OscillatorType }> = {
  spring: {
    bpm: 84,
    chords: [
      [48, 60, 64, 67, 71],
      [45, 57, 60, 64, 67],
      [41, 57, 60, 65, 69],
      [43, 59, 62, 67, 69],
    ],
    scale: [72, 74, 76, 79, 81, 84],
    wave: 'sine',
  },
  summer: {
    bpm: 98,
    chords: [
      [41, 60, 65, 69, 72],
      [43, 59, 62, 67, 71],
      [40, 59, 64, 67, 71],
      [45, 60, 64, 69, 72],
    ],
    scale: [72, 74, 77, 79, 81, 84],
    wave: 'triangle',
  },
  autumn: {
    bpm: 76,
    chords: [
      [38, 57, 60, 65, 69],
      [43, 59, 62, 65, 71],
      [36, 55, 60, 64, 67],
      [45, 57, 60, 64, 67],
    ],
    scale: [69, 72, 74, 76, 79, 81],
    wave: 'sine',
  },
  winter: {
    bpm: 66,
    chords: [
      [45, 57, 60, 64, 71],
      [41, 57, 60, 65, 69],
      [36, 55, 60, 64, 67],
      [40, 55, 59, 64, 67],
    ],
    scale: [76, 79, 81, 84, 88, 91],
    wave: 'sine',
  },
}
const ARP = [1, 3, 2, 4, 3, 2, 4, 3]

export function createShikiAudio(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): ShikiAudio {
  let ctx: AudioContext | null = null
  let muted = false
  try {
    muted = storage.getItem(SOUND_KEY) === 'off'
  } catch {
    // 保存を読めなくても鳴らせる
  }

  type Graph = {
    master: GainNode
    music: GainNode
    musicFilter: BiquadFilterNode
    sfx: GainNode
    rain: GainNode
    wind: GainNode
    cicada: GainNode
    noise: AudioBuffer
  }
  let graph: Graph | null = null
  let amb: Ambience = { season: 'spring', sky: 'sunny', precip: 0, hour: 8 }
  let timer: number | null = null
  let nextStep = 0
  let step = 0
  let seed = 1
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }

  const build = (ac: AudioContext): Graph => {
    const master = ac.createGain()
    master.gain.value = muted ? 0 : 0.9
    const limiter = ac.createDynamicsCompressor()
    limiter.threshold.value = -14
    limiter.ratio.value = 6
    master.connect(limiter).connect(ac.destination)

    const musicFilter = ac.createBiquadFilter()
    musicFilter.type = 'lowpass'
    musicFilter.frequency.value = 3600
    const music = ac.createGain()
    music.gain.value = 0.34
    music.connect(musicFilter).connect(master)
    const sfx = ac.createGain()
    sfx.gain.value = 0.5
    sfx.connect(master)

    const noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const loop = () => {
      const src = ac.createBufferSource()
      src.buffer = noise
      src.loop = true
      src.start()
      return src
    }

    // 雨: 高域寄りのノイズ
    const rain = ac.createGain()
    rain.gain.value = 0
    const rainHp = ac.createBiquadFilter()
    rainHp.type = 'highpass'
    rainHp.frequency.value = 1100
    const rainLp = ac.createBiquadFilter()
    rainLp.type = 'lowpass'
    rainLp.frequency.value = 7200
    loop().connect(rainHp).connect(rainLp).connect(rain).connect(master)

    // 風: 低域のノイズをゆっくり揺らす
    const wind = ac.createGain()
    wind.gain.value = 0
    const windLp = ac.createBiquadFilter()
    windLp.type = 'bandpass'
    windLp.frequency.value = 320
    windLp.Q.value = 0.6
    const windLfo = ac.createOscillator()
    windLfo.frequency.value = 0.13
    const windDepth = ac.createGain()
    windDepth.gain.value = 180
    windLfo.connect(windDepth).connect(windLp.frequency)
    windLfo.start()
    loop().connect(windLp).connect(wind).connect(master)

    // セミ: 細い帯域のノイズを55Hzで刻み、ゆっくりうねらせる
    const cicada = ac.createGain()
    cicada.gain.value = 0
    const cicBp = ac.createBiquadFilter()
    cicBp.type = 'bandpass'
    cicBp.frequency.value = 4700
    cicBp.Q.value = 14
    const cicAm = ac.createGain()
    cicAm.gain.value = 0.5
    const cicLfo = ac.createOscillator()
    cicLfo.type = 'square'
    cicLfo.frequency.value = 55
    const cicDepth = ac.createGain()
    cicDepth.gain.value = 0.5
    cicLfo.connect(cicDepth).connect(cicAm.gain)
    cicLfo.start()
    const cicSwell = ac.createGain()
    cicSwell.gain.value = 0.6
    const swellLfo = ac.createOscillator()
    swellLfo.frequency.value = 0.21
    const swellDepth = ac.createGain()
    swellDepth.gain.value = 0.4
    swellLfo.connect(swellDepth).connect(cicSwell.gain)
    swellLfo.start()
    loop().connect(cicBp).connect(cicAm).connect(cicSwell).connect(cicada).connect(master)

    return { master, music, musicFilter, sfx, rain, wind, cicada, noise }
  }

  /** 減衰する1音。partial を足すとベルっぽくなる */
  const note = (
    out: AudioNode,
    freq: number,
    at: number,
    dur: number,
    gain: number,
    type: OscillatorType = 'sine',
    partial = 0,
  ) => {
    if (!ctx) return
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(gain, at + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    g.connect(out)
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, at)
    osc.connect(g)
    osc.start(at)
    osc.stop(at + dur + 0.05)
    if (partial > 0) {
      const p = ctx.createOscillator()
      const pg = ctx.createGain()
      pg.gain.value = partial
      p.frequency.setValueAtTime(freq * 3.01, at)
      p.connect(pg).connect(g)
      p.start(at)
      p.stop(at + dur + 0.05)
    }
  }

  const sweep = (out: AudioNode, from: number, to: number, at: number, dur: number, gain: number, type: OscillatorType = 'sine') => {
    if (!ctx) return
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(gain, at + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    g.connect(out)
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(from, at)
    osc.frequency.exponentialRampToValueAtTime(to, at + dur)
    osc.connect(g)
    osc.start(at)
    osc.stop(at + dur + 0.05)
  }

  const burst = (out: AudioNode, at: number, dur: number, gain: number, freq: number, q = 1) => {
    if (!ctx || !graph) return
    const src = ctx.createBufferSource()
    src.buffer = graph.noise
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.setValueAtTime(freq, at)
    bp.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(gain, at + dur * 0.3)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    src.connect(bp).connect(g).connect(out)
    src.start(at, Math.random())
    src.stop(at + dur + 0.05)
  }

  const scheduleStep = (at: number) => {
    if (!ctx || !graph) return
    const song = SONGS[amb.season]
    const chord = song.chords[Math.floor(step / 8) % song.chords.length]
    const s = step % 8
    const evening = amb.hour >= 17 || amb.hour < 6
    const rainy = amb.precip > 0.2
    const beat = 60 / song.bpm / 2
    const bell = amb.season === 'winter' ? 0.18 : 0
    if (s === 0) {
      note(graph.music, midi(chord[0]), at, beat * 7, 0.5, 'triangle')
      // うっすら鳴りつづける和音
      for (const n of chord.slice(1, 4)) note(graph.music, midi(n), at, beat * 8, 0.05, 'triangle')
    }
    if (s === 4 && !evening) note(graph.music, midi(chord[0] + 12), at, beat * 3, 0.22, 'triangle')
    const density = evening ? 0.55 : rainy ? 0.7 : 0.88
    if (random() < density) {
      note(graph.music, midi(chord[ARP[s]] + (s === 6 && random() < 0.4 ? 12 : 0)), at, beat * 2.6, 0.26, song.wave, bell)
    }
    if ((s === 2 || s === 5 || s === 7) && random() < (evening ? 0.2 : 0.38)) {
      const n = song.scale[Math.floor(random() * song.scale.length)]
      note(graph.music, midi(n), at + beat * 0.5 * (random() < 0.3 ? 1 : 0), beat * 3.2, 0.16, 'sine', bell + 0.06)
    }

    // 生きものの声は環境音側へ
    const day = amb.hour >= 6 && amb.hour < 17
    if (!rainy && amb.season === 'spring' && day && random() < 0.07) {
      const base = 2400 + random() * 900
      for (let i = 0; i < 3; i++) sweep(graph.master, base, base * 1.35, at + i * 0.11, 0.08, 0.03)
    }
    if (!rainy && (amb.season === 'autumn' || (amb.season === 'summer' && evening)) && random() < (evening ? 0.3 : 0.1)) {
      for (let i = 0; i < 4; i++) note(graph.master, 4200 + random() * 60, at + i * 0.07, 0.05, 0.018)
    }
    step++
  }

  const tick = () => {
    if (!ctx || !graph || ctx.state !== 'running') return
    const song = SONGS[amb.season]
    const beat = (60 / song.bpm / 2) * (amb.precip > 0.2 ? 1.07 : 1)
    if (nextStep < ctx.currentTime) nextStep = ctx.currentTime + 0.05
    while (nextStep < ctx.currentTime + 0.35) {
      scheduleStep(nextStep)
      nextStep += beat
    }
  }

  const applyAmbience = () => {
    if (!ctx || !graph) return
    const t = ctx.currentTime
    const rainy = amb.sky === 'rain' ? amb.precip : 0
    const day = amb.hour >= 6 && amb.hour < 17.5
    const ramp = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, 0.8)
    ramp(graph.rain.gain, rainy * 0.16)
    ramp(graph.wind.gain, amb.season === 'winter' ? 0.16 : amb.sky === 'snow' ? 0.14 : 0.05 + rainy * 0.06)
    ramp(graph.cicada.gain, amb.season === 'summer' && day && rainy < 0.2 ? 0.05 : 0)
    ramp(graph.musicFilter.frequency, rainy > 0.2 ? 1500 : day ? 3800 : 2400)
  }

  const ensure = () => {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
      graph = build(ctx)
      applyAmbience()
      timer = window.setInterval(tick, 100)
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  }

  return {
    unlock: () => {
      if (!muted) ensure()
    },
    toggle: () => {
      muted = !muted
      try {
        storage.setItem(SOUND_KEY, muted ? 'off' : 'on')
      } catch {
        // 保存できなくても切り替えはできる
      }
      if (!muted) ensure()
      if (ctx && graph) graph.master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.05)
      return muted
    },
    muted: () => muted,
    setAmbience: (a) => {
      amb = a
      applyAmbience()
    },
    sfx: (kind) => {
      if (muted) return
      const ac = ensure()
      if (!ac || !graph) return
      const out = graph.sfx
      const t = ac.currentTime + 0.01
      const seq = (notes: number[], gap: number, dur: number, gain: number, type: OscillatorType = 'sine', partial = 0) =>
        notes.forEach((n, i) => note(out, midi(n), t + i * gap, dur, gain, type, partial))
      switch (kind) {
        case 'tap':
          note(out, midi(84), t, 0.07, 0.18, 'triangle')
          break
        case 'pick':
          seq([76, 83], 0.05, 0.12, 0.22, 'triangle')
          break
        case 'unpick':
          seq([79, 72], 0.05, 0.1, 0.16, 'triangle')
          break
        case 'go':
          seq([67, 72, 79], 0.09, 0.3, 0.3, 'triangle')
          burst(out, t, 0.35, 0.12, 2400, 0.8)
          break
        case 'comfy':
          seq([72, 76, 79, 84, 88], 0.08, 0.6, 0.26, 'sine', 0.15)
          break
        case 'soso':
          seq([72, 74], 0.14, 0.35, 0.22, 'triangle')
          break
        case 'bad':
          seq([63, 58, 51], 0.15, 0.5, 0.3, 'sawtooth')
          break
        case 'wet':
          for (let i = 0; i < 4; i++) sweep(out, 1500 - i * 150, 500, t + i * 0.09, 0.12, 0.14)
          break
        case 'sync':
          seq([84, 88, 91, 96, 100, 103], 0.055, 0.7, 0.2, 'sine', 0.2)
          break
        case 'perk':
          seq([60, 64, 67, 72, 76], 0.07, 0.8, 0.26, 'triangle', 0.1)
          break
        case 'season':
          burst(out, t, 1.3, 0.22, 900, 0.5)
          seq([60, 67, 74, 79], 0.16, 1.2, 0.2, 'sine', 0.12)
          break
        case 'fail':
          seq([67, 63, 60, 55, 48], 0.2, 0.8, 0.3, 'triangle')
          break
        case 'clear':
          seq([72, 76, 79, 84, 79, 84, 88, 91], 0.11, 0.9, 0.28, 'triangle', 0.14)
          break
      }
    },
    close: () => {
      if (timer != null) window.clearInterval(timer)
      timer = null
      void ctx?.close()
      ctx = null
      graph = null
    },
  }
}
