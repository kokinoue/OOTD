// 着戦の効果音とBGM。音源ファイルは持たず、Web Audio でその場で合成する。
import type { ClashEvent } from './clash'

const SOUND_KEY = 'clash.sound'

const readMuted = () => {
  try {
    return localStorage.getItem(SOUND_KEY) === 'off'
  } catch {
    return false
  }
}

export type ClashCue = 'finish' | 'lethal' | 'win' | 'lose' | 'select' | 'count'

export function createClashAudio() {
  let context: AudioContext | null = null
  let master: GainNode | null = null
  let muted = readMuted()
  let musicTimer: number | null = null
  let beat = 0

  const getContext = () => {
    if (!context || context.state === 'closed') {
      context = new AudioContext()
      // 音が重なっても割れないよう、まとめて軽くつぶす。
      const compressor = context.createDynamicsCompressor()
      compressor.threshold.value = -18
      compressor.ratio.value = 6
      master = context.createGain()
      master.gain.value = 0.9
      master.connect(compressor).connect(context.destination)
    }
    if (context.state === 'suspended') void context.resume()
    return context
  }

  const tone = (
    frequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    slide = 1,
    delay = 0,
  ) => {
    if (muted) return
    const audio = getContext()
    const at = audio.currentTime + delay
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, at)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(32, frequency * slide), at + duration)
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    oscillator.connect(gain).connect(master!)
    oscillator.start(at)
    oscillator.stop(at + duration + 0.03)
  }

  const noise = (duration: number, volume: number, cutoff = 500, type: BiquadFilterType = 'highpass', delay = 0) => {
    if (muted) return
    const audio = getContext()
    const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * duration), audio.sampleRate)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < channel.length; i++) {
      channel[i] = (Math.random() * 2 - 1) * (1 - i / channel.length)
    }
    const source = audio.createBufferSource()
    const filter = audio.createBiquadFilter()
    const gain = audio.createGain()
    source.buffer = buffer
    filter.type = type
    filter.frequency.value = cutoff
    gain.gain.value = volume
    source.connect(filter).connect(gain).connect(master!)
    source.start(audio.currentTime + delay)
  }

  const stopMusic = () => {
    if (musicTimer != null) window.clearInterval(musicTimer)
    musicTimer = null
  }

  const startMusic = () => {
    if (muted || musicTimer != null || !context) return
    // 16分で刻むベースと、裏拍のハット、2小節ごとに動くリード。
    const bass = [55, 55, 65.4, 55, 73.4, 55, 65.4, 82.4]
    const lead = [330, 0, 392, 440, 0, 494, 440, 392, 330, 0, 523, 494, 0, 440, 392, 0]
    const tick = () => {
      const step = beat % 16
      if (step % 2 === 0) tone(bass[(beat / 2) % bass.length | 0] * 2, 0.2, 'sawtooth', 0.012, 0.86)
      if (step % 4 === 0) {
        tone(120, 0.12, 'sine', 0.05, 0.36)
      }
      if (step % 4 === 2) noise(0.05, 0.012, 5200)
      if (step === 4 || step === 12) noise(0.11, 0.02, 1700, 'bandpass')
      const note = lead[step]
      if (note && (beat >> 4) % 2 === 1) tone(note, 0.16, 'triangle', 0.011, 1.01)
      beat += 1
    }
    tick()
    musicTimer = window.setInterval(tick, 132)
  }

  return {
    unlock: () => {
      getContext()
      startMusic()
    },
    isMuted: () => muted,
    toggle: () => {
      muted = !muted
      try {
        localStorage.setItem(SOUND_KEY, muted ? 'off' : 'on')
      } catch {
        // 保存できなくても、この場の切り替えは効かせる。
      }
      if (muted) stopMusic()
      else {
        getContext()
        tone(660, 0.1, 'sine', 0.04, 1.35)
        startMusic()
      }
      return muted
    },
    pauseMusic: stopMusic,
    resumeMusic: startMusic,
    cue: (cue: ClashCue) => {
      if (cue === 'finish') {
        tone(58, 0.9, 'sawtooth', 0.09, 0.4)
        tone(880, 0.7, 'square', 0.03, 0.25, 0.02)
        noise(0.5, 0.09, 260, 'lowpass')
        noise(0.35, 0.05, 3000)
      } else if (cue === 'lethal') {
        tone(1320, 0.26, 'square', 0.03, 0.32)
        noise(0.2, 0.05, 2400)
      } else if (cue === 'win') {
        ;[392, 494, 587, 784, 988].forEach((frequency, index) =>
          tone(frequency, 0.5, 'triangle', 0.034, 1.02, index * 0.1),
        )
      } else if (cue === 'lose') {
        ;[330, 277, 220].forEach((frequency, index) =>
          tone(frequency, 0.6, 'sawtooth', 0.026, 0.7, index * 0.16),
        )
      } else if (cue === 'select') {
        tone(740, 0.07, 'triangle', 0.03, 1.3)
      } else if (cue === 'count') {
        tone(440, 0.12, 'square', 0.024, 1)
      }
    },
    play: (event: ClashEvent) => {
      if (event.type === 'go') {
        ;[330, 440, 660].forEach((frequency, index) =>
          tone(frequency, 0.25, 'square', 0.028, 1.08, index * 0.08),
        )
      } else if (event.type === 'jump' || event.type === 'airJump') {
        tone(event.type === 'jump' ? 210 : 330, 0.12, 'triangle', 0.018, 1.8)
      } else if (event.type === 'land') {
        noise(0.05, 0.02, 300, 'lowpass')
      } else if (event.type === 'attack') {
        const heavy = event.kind === 'smash' || event.kind === 'burst' || event.kind === 'airDown'
        noise(heavy ? 0.16 : 0.09, heavy ? 0.03 : 0.018, heavy ? 900 : 1800, 'bandpass')
        if (event.kind === 'burst') tone(180, 0.3, 'sawtooth', 0.02, 2.4)
        if (event.kind === 'recovery') tone(260, 0.3, 'triangle', 0.022, 2.6)
      } else if (event.type === 'projectile') {
        if (event.kind === 'frost') tone(1200, 0.28, 'sine', 0.02, 0.5)
        else if (event.kind === 'leaf') tone(520, 0.2, 'triangle', 0.022, 1.7)
        else tone(700, 0.16, 'sine', 0.02, 1.5)
      } else if (event.type === 'hit') {
        const weight = Math.min(1, event.power / 900)
        tone(Math.max(48, 170 - event.power * 0.09), 0.14 + weight * 0.1, 'square', 0.03 + weight * 0.03, 0.42)
        noise(0.07 + weight * 0.08, 0.03 + weight * 0.05, 700 - weight * 350, 'lowpass')
        noise(0.05, 0.02 + weight * 0.02, 3200)
        if (event.combo >= 2) tone(520 + Math.min(8, event.combo) * 70, 0.09, 'triangle', 0.022, 1.2, 0.03)
      } else if (event.type === 'shield') {
        tone(520, 0.13, 'sine', 0.025, 0.55)
      } else if (event.type === 'parry') {
        tone(1568, 0.28, 'triangle', 0.045, 1)
        tone(2093, 0.34, 'sine', 0.03, 1, 0.04)
        noise(0.06, 0.03, 5000)
      } else if (event.type === 'shieldBreak') {
        tone(220, 0.5, 'sawtooth', 0.034, 0.17)
        noise(0.25, 0.045)
      } else if (event.type === 'dodge') {
        noise(0.12, 0.016, 2400, 'bandpass')
      } else if (event.type === 'ledge') {
        tone(880, 0.05, 'square', 0.014, 0.8)
      } else if (event.type === 'bounce') {
        tone(90, 0.16, 'sine', 0.05, 0.5)
        noise(0.08, 0.03, 400, 'lowpass')
      } else if (event.type === 'ko') {
        tone(70, 0.55, 'sawtooth', 0.055, 4.8)
        noise(0.34, 0.07, 1200, 'bandpass')
        tone(1760, 0.5, 'sine', 0.02, 0.2, 0.05)
      } else if (event.type === 'respawn') {
        tone(523, 0.2, 'sine', 0.018, 1.5)
      }
    },
    close: () => {
      stopMusic()
      void context?.close()
    },
  }
}

export type ClashAudio = ReturnType<typeof createClashAudio>
