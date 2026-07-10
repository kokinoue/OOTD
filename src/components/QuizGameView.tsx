import { useMemo, useState } from 'react'
import type { Data } from '../lib/useData'
import { fmtDate, outfits, thumb } from '../lib/useData'
import {
  QUESTIONS,
  TRAITS,
  matchOutfit,
  resolveType,
  tallyScores,
  type Scores,
  type Trait,
} from '../lib/quiz'

// 性格診断「あなたのkokiはこれ！」
// ・8問に答えると5軸スコアが集計され、8タイプのうち1つ + 実データの出勤服1着が決まる。
// ・乱数は使わない（同じ回答なら常に同じ結果）。

type Phase = 'intro' | 'asking' | 'result'

const TRAIT_LABEL: Record<Trait, { neg: string; pos: string }> = {
  colorful: { neg: 'モノトーン', pos: 'カラフル' },
  formal: { neg: 'カジュアル', pos: 'きれいめ' },
  adventurous: { neg: '定番派', pos: '冒険派' },
  layered: { neg: '身軽', pos: 'マシマシ' },
  warm: { neg: '寒がり', pos: '暑がり' },
}

// スコアをバー表示用に -1〜1 へクランプ正規化（質問側の想定レンジはおおよそ -6〜+6）
const barRatio = (v: number) => Math.max(-1, Math.min(1, v / 6))

export default function QuizGameView({ data, onBack }: { data: Data; onBack: () => void }) {
  const [phase, setPhase] = useState<Phase>('intro')
  const [answers, setAnswers] = useState<number[]>([])
  const [step, setStep] = useState(0)

  const start = () => {
    setAnswers([])
    setStep(0)
    setPhase('asking')
  }

  const choose = (choiceIndex: number) => {
    const next = [...answers]
    next[step] = choiceIndex
    setAnswers(next)
    if (step + 1 < QUESTIONS.length) {
      setStep(step + 1)
    } else {
      setPhase('result')
    }
  }

  const goPrev = () => {
    if (step === 0) {
      setPhase('intro')
      return
    }
    setStep(step - 1)
  }

  const scores: Scores | null = useMemo(() => {
    if (phase !== 'result') return null
    return tallyScores(answers)
  }, [phase, answers])

  const type = useMemo(() => (scores ? resolveType(scores) : null), [scores])

  const resultOutfit = useMemo(() => {
    if (!scores) return null
    return matchOutfit(scores, outfits, data.itemMap, data.outfitItemIds)
  }, [scores, data])

  // ---------------- intro ----------------
  if (phase === 'intro') {
    return (
      <main className="g-setup">
        <div className="g-setup-card">
          <button className="game-back jp" onClick={onBack}>
            ← ゲームを選ぶ
          </button>
          <h2 className="g-setup-title jp">性格診断 — あなたのkokiはこれ！</h2>
          <p className="g-setup-lead jp">
            服・朝の支度・休日の過ごし方など8つの質問に答えると、
            <b>あなたの性格タイプ</b>と、660着以上の出勤服から選ばれた
            <b>ぴったりの一着</b>がわかります。
          </p>
          <ul className="g-rules jp">
            <li>質問は全部で {QUESTIONS.length} 問</li>
            <li>選択肢をタップするとすぐ次の質問へ</li>
            <li>同じ回答なら、いつでも同じ結果になります</li>
          </ul>
          <button className="g-start jp" onClick={start}>
            はじめる
          </button>
        </div>
      </main>
    )
  }

  // ---------------- asking ----------------
  if (phase === 'asking') {
    const q = QUESTIONS[step]
    const progress = ((step + 1) / QUESTIONS.length) * 100
    return (
      <main className="g-setup">
        <div className="g-setup-card g-quiz-card">
          <button className="game-back jp" onClick={goPrev}>
            ← {step === 0 ? 'ゲームを選ぶ' : '前の質問'}
          </button>
          <div className="g-quiz-progress-row">
            <span className="g-quiz-progress-label mono">
              {step + 1} / {QUESTIONS.length}
            </span>
            <div className="g-quiz-progress-bar">
              <div className="g-quiz-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <h3 className="g-quiz-question jp">{q.text}</h3>
          <div className="g-quiz-choices">
            {q.choices.map((c, i) => (
              <button key={i} className="g-quiz-choice jp" onClick={() => choose(i)}>
                {c.text}
              </button>
            ))}
          </div>
        </div>
      </main>
    )
  }

  // ---------------- result ----------------
  if (!scores || !type || !resultOutfit) return null

  const items = [...(data.outfitItemIds.get(resultOutfit.key) ?? [])]
    .map((id) => data.itemMap.get(id))
    .filter((it): it is NonNullable<typeof it> => Boolean(it))
    .sort((a, b) => a.category.localeCompare(b.category))

  return (
    <main className="g-finished">
      <div className="g-setup-card g-quiz-card">
        <span className="g-quiz-type-tag mono">RESULT</span>
        <h2 className="g-quiz-type-name jp">{type.name}</h2>
        <p className="g-quiz-type-tagline jp">{type.tagline}</p>
        <p className="g-quiz-type-desc jp">{type.description}</p>

        <div className="g-quiz-traits">
          {TRAITS.map((t) => {
            const ratio = barRatio(scores[t])
            const label = TRAIT_LABEL[t]
            return (
              <div className="g-quiz-trait-row" key={t}>
                <span className="g-quiz-trait-label jp">{label.neg}</span>
                <div className="g-quiz-trait-bar">
                  <div className="g-quiz-trait-bar-mid" />
                  <div
                    className={'g-quiz-trait-bar-fill' + (ratio >= 0 ? ' pos' : ' neg')}
                    style={
                      ratio >= 0
                        ? { left: '50%', width: `${ratio * 50}%` }
                        : { left: `${50 + ratio * 50}%`, width: `${-ratio * 50}%` }
                    }
                  />
                </div>
                <span className="g-quiz-trait-label jp">{label.pos}</span>
              </div>
            )
          })}
        </div>

        <h3 className="g-quiz-result-heading jp">あなたのkokiはこれ！</h3>
        <div className="g-quiz-outfit-card">
          <img
            className="g-quiz-outfit-img"
            src={thumb(resultOutfit.images[0].url, 400)}
            alt={resultOutfit.title}
          />
          <div className="g-quiz-outfit-body">
            <div className="g-quiz-outfit-title jp">{resultOutfit.title}</div>
            <div className="g-quiz-outfit-date mono">{fmtDate(resultOutfit.date)}</div>
            <div className="g-quiz-outfit-items">
              {items.map((it) => (
                <span className="g-chip" key={it.id}>
                  <span className="g-chip-cat">{it.category}</span>
                  <span className="g-chip-label">{it.label}</span>
                </span>
              ))}
            </div>
            <a
              className="g-quiz-outfit-link jp"
              href={resultOutfit.noteUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              noteで見る →
            </a>
          </div>
        </div>

        <div className="g-finished-actions">
          <button className="g-start jp" onClick={start}>
            もう一度診断する
          </button>
          <button className="chip jp" onClick={onBack}>
            ゲームを選ぶ
          </button>
        </div>
      </div>
    </main>
  )
}
