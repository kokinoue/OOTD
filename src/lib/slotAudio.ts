// 俺スロの効果音とボーナスBGM。音源ファイルは持たず、Web Audio で毎回合成する。
// AudioContext はユーザー操作（レバー）で初めて作るので、自動再生制限に触れない。

export const SOUND_KEY = 'slot.sound'

type ToneOptions = {
  type?: OscillatorType
  volume?: number
  /** 終了時の周波数倍率（1 より大きいと上がり、小さいと下がる） */
  slide?: number
  /** 何秒後に鳴らすか */
  delay?: number
}

export type SlotSound =
  | 'lever'
  | 'stop'
  | 'replay'
  | 'win'
  | 'bigwin'
  | 'coin'
  | 'tenpai'
  | 'lamp'
  | 'bonus'
  | 'bonusEnd'
  | 'refill'
  | 'move'

// ボーナスBGM: 8分音符16個で1ループ（C メジャーの上がり下がり）。0 は休符
const BGM_LEAD = [523, 659, 784, 1047, 784, 659, 587, 698, 880, 1175, 880, 698, 659, 784, 988, 784]
const BGM_BASS = [131, 0, 131, 0, 147, 0, 147, 0, 175, 0, 175, 0, 196, 0, 196, 0]
const BGM_STEP = 0.14 // 1音の長さ（秒）

export function createSlotAudio() {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let muted = false
  try {
    muted = localStorage.getItem(SOUND_KEY) === 'off'
  } catch {
    // localStorage が使えない環境では音ありで始める
  }

  let bgmTimer: number | undefined
  let bgmStep = 0
  let bgmNext = 0

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
    if (muted) return
    const ac = context()
    const at = ac.currentTime + (opts.delay ?? 0)
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = opts.type ?? 'square'
    osc.frequency.setValueAtTime(freq, at)
    if (opts.slide && opts.slide !== 1) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * opts.slide), at + duration)
    }
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(opts.volume ?? 0.04, at + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    osc.connect(gain).connect(master!)
    osc.start(at)
    osc.stop(at + duration + 0.02)
  }

  // リールの「カタッ」という機械音は、短いノイズをローパスに通して作る
  const noise = (duration: number, volume: number, cutoff: number, delay = 0) => {
    if (muted) return
    const ac = context()
    const at = ac.currentTime + delay
    const length = Math.max(1, Math.floor(ac.sampleRate * duration))
    const buffer = ac.createBuffer(1, length, ac.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length)
    const src = ac.createBufferSource()
    src.buffer = buffer
    const filter = ac.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = cutoff
    const gain = ac.createGain()
    gain.gain.value = volume
    src.connect(filter).connect(gain).connect(master!)
    src.start(at)
  }

  const play = (kind: SlotSound, amount = 0) => {
    if (muted) return
    switch (kind) {
      case 'lever':
        noise(0.09, 0.22, 900)
        tone(150, 0.12, { type: 'triangle', volume: 0.09, slide: 0.5 })
        tone(300, 0.2, { type: 'sawtooth', volume: 0.012, slide: 2.4, delay: 0.05 })
        break
      case 'stop':
        noise(0.05, 0.3, 1400)
        tone(170, 0.06, { type: 'square', volume: 0.04, slide: 0.55 })
        break
      case 'replay':
        tone(880, 0.09, { volume: 0.035 })
        tone(1175, 0.14, { volume: 0.035, delay: 0.1 })
        break
      case 'win':
        // 払い出し枚数が多いほど長く上がる
        for (let i = 0; i < Math.min(6, 2 + Math.floor(amount / 3)); i++) {
          tone(660 * 2 ** (i / 6), 0.1, { volume: 0.04, delay: i * 0.07 })
        }
        break
      case 'bigwin':
        ;[784, 988, 1175, 1568].forEach((f, i) =>
          tone(f, 0.16, { type: 'triangle', volume: 0.09, delay: i * 0.08 }),
        )
        break
      case 'coin':
        tone(amount % 2 === 0 ? 1568 : 1865, 0.045, { type: 'triangle', volume: 0.05 })
        break
      case 'tenpai':
        for (let i = 0; i < 6; i++) {
          tone(440 * 2 ** (i / 12), 0.07, { type: 'sawtooth', volume: 0.022, delay: i * 0.07 })
        }
        break
      case 'lamp':
        // 告知ランプ: 下から一気に駆け上がって、高い和音が残る
        tone(520, 0.22, { type: 'sawtooth', volume: 0.05, slide: 4 })
        ;[1568, 1976, 2349, 3136].forEach((f, i) =>
          tone(f, 0.7, { type: 'triangle', volume: 0.07, delay: 0.2 + i * 0.03 }),
        )
        break
      case 'bonus': {
        const notes = [523, 523, 659, 784, 1047, 784, 1047, 1319]
        const lengths = [0.1, 0.1, 0.1, 0.1, 0.2, 0.1, 0.1, 0.5]
        let at = 0
        notes.forEach((f, i) => {
          tone(f, lengths[i]! + 0.06, { volume: 0.05, delay: at })
          tone(f / 2, lengths[i]! + 0.06, { type: 'triangle', volume: 0.08, delay: at })
          at += lengths[i]!
        })
        break
      }
      case 'bonusEnd':
        ;[1047, 784, 659, 523].forEach((f, i) =>
          tone(f, 0.2, { type: 'triangle', volume: 0.08, delay: i * 0.13 }),
        )
        tone(262, 0.6, { type: 'triangle', volume: 0.09, delay: 0.52 })
        break
      case 'refill':
        for (let i = 0; i < 7; i++) {
          tone(1300 + (i % 3) * 260, 0.05, { type: 'triangle', volume: 0.045, delay: i * 0.045 })
        }
        break
      case 'move':
        tone(392, 0.1, { type: 'triangle', volume: 0.07 })
        tone(587, 0.16, { type: 'triangle', volume: 0.07, delay: 0.1 })
        break
    }
  }

  // BGM は少し先の音までを定期的に予約していく（タイマーの揺れでリズムが崩れないように）
  const scheduleBgm = () => {
    if (!ctx || muted) return
    while (bgmNext < ctx.currentTime + 0.3) {
      const delay = Math.max(0, bgmNext - ctx.currentTime)
      const i = bgmStep % BGM_LEAD.length
      tone(BGM_LEAD[i]!, BGM_STEP * 0.9, { volume: 0.022, delay })
      if (BGM_BASS[i]) tone(BGM_BASS[i]!, BGM_STEP * 1.8, { type: 'triangle', volume: 0.07, delay })
      bgmStep++
      bgmNext += BGM_STEP
    }
  }

  const stopBgm = () => {
    window.clearInterval(bgmTimer)
    bgmTimer = undefined
  }

  const startBgm = (delay = 0) => {
    stopBgm()
    if (muted) return
    const ac = context()
    bgmStep = 0
    bgmNext = ac.currentTime + delay
    bgmTimer = window.setInterval(scheduleBgm, 100)
  }

  return {
    play,
    /** ユーザー操作の中で呼ぶと、AudioContext を作って再生可能な状態にする */
    unlock: () => {
      if (!muted) context()
    },
    startBgm,
    stopBgm,
    /** BGM が止まっていたら鳴らす（ボーナス中に開き直した・消音を解いた後の復帰用） */
    ensureBgm: () => {
      if (bgmTimer === undefined) startBgm()
    },
    /** 音のオン・オフを切り替え、切り替え後に消音かどうかを返す */
    toggle: () => {
      muted = !muted
      try {
        localStorage.setItem(SOUND_KEY, muted ? 'off' : 'on')
      } catch {
        // 保存できなくても、このセッション中の切り替えは効く
      }
      if (muted) stopBgm()
      else play('replay')
      return muted
    },
    muted: () => muted,
    dispose: () => {
      stopBgm()
      void ctx?.close()
      ctx = null
    },
  }
}

export type SlotAudio = ReturnType<typeof createSlotAudio>
