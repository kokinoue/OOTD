import { useEffect, useMemo, useRef, useState } from 'react'
import type { Data } from '../lib/useData'
import { fmtDate, outfits, thumb } from '../lib/useData'
import {
  QUESTIONS,
  TRAITS,
  TRAIT_LABEL,
  decodeAnswers,
  encodeAnswers,
  matchOutfit,
  resolveType,
  tallyScores,
  type QuizType,
  type Scores,
} from '../lib/quiz'
import { generateStoryImage } from '../lib/quizShareImage'

// 性格診断「あなたのkokiはこれ！」
// ・8問に答えると5軸スコアが集計され、16タイプのうち1つ + 実データの出勤服1着が決まる。
// ・乱数は使わない（同じ回答なら常に同じ結果）。
//
// URL共有: 結果は #/quiz?a=XXXXXXXX（answers を8桁の数字にエンコード）に載せる。
// useHashRoute（lib/router.ts）の Route/Filters は quiz の `a` パラメータを扱わないため、
// router 経由で書き戻すとクエリが失われる。そのため location.hash の読み書きは
// history.replaceState で直接行い、router の navigate() は一切呼ばない
// （App.tsx 側も quiz 表示中に navigate() を呼ぶのはビュー切り替え時だけなので衝突しない）。

type Phase = 'intro' | 'asking' | 'result'

// スコアをバー表示用に -1〜1 へクランプ正規化（質問側の想定レンジはおおよそ -6〜+6）
const barRatio = (v: number) => Math.max(-1, Math.min(1, v / 6))

const shareTextFor = (type: QuizType) => `私のkokiは『${type.name}（${type.code}）』でした！`

function readAnswersFromLocationHash(): number[] | null {
  const hash = window.location.hash
  const qIndex = hash.indexOf('?')
  if (qIndex === -1) return null
  const params = new URLSearchParams(hash.slice(qIndex + 1))
  const a = params.get('a')
  if (!a) return null
  return decodeAnswers(a)
}

function shareUrlFor(encoded: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}game/quiz/?a=${encoded}`
}

export default function QuizGameView({ data, onBack }: { data: Data; onBack: () => void }) {
  const restored = useMemo(() => readAnswersFromLocationHash(), [])
  const [phase, setPhase] = useState<Phase>(() => (restored ? 'result' : 'intro'))
  const [answers, setAnswers] = useState<number[]>(() => restored ?? [])
  const [step, setStep] = useState(0)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle')
  const [imageStatus, setImageStatus] = useState<'idle' | 'generating' | 'error'>('idle')
  const copyTimer = useRef<number | null>(null)

  // result 表示中は URL に回答を反映し、intro に戻ったら消す。router の navigate() は使わない。
  useEffect(() => {
    if (phase === 'result' && answers.length === QUESTIONS.length) {
      const encoded = encodeAnswers(answers)
      const next = `#/quiz?a=${encoded}`
      if (window.location.hash !== next) history.replaceState(null, '', next)
    } else if (phase === 'intro') {
      const next = '#/quiz'
      if (window.location.hash !== next) history.replaceState(null, '', next)
    }
  }, [phase, answers])

  useEffect(() => {
    return () => {
      if (copyTimer.current != null) window.clearTimeout(copyTimer.current)
    }
  }, [])

  const start = () => {
    setAnswers([])
    setStep(0)
    setImageStatus('idle')
    setCopyStatus('idle')
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

  const encoded = useMemo(
    () => (phase === 'result' && answers.length === QUESTIONS.length ? encodeAnswers(answers) : null),
    [phase, answers],
  )
  const shareUrl = encoded ? shareUrlFor(encoded) : null

  const shareOnX = () => {
    if (!shareUrl || !type) return
    const text = `${shareTextFor(type)} #出勤服アーカイブ`
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`
    window.open(intentUrl, '_blank', 'noopener,noreferrer')
  }

  const copyLink = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopyStatus('copied')
      if (copyTimer.current != null) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopyStatus('idle'), 2000)
    } catch {
      // クリップボード権限がない環境ではコピー操作自体を諦める（UIはidleのまま）
    }
  }

  const shareImage = async () => {
    if (!scores || !type || !resultOutfit) return
    setImageStatus('generating')
    try {
      const blob = await generateStoryImage({ type, scores, outfitKey: resultOutfit.key })
      const fileName = `koki-quiz-${type.code.toLowerCase()}.png`
      const file = new File([blob], fileName, { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'あなたのkokiはこれ！',
          text: shareTextFor(type),
        })
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      }
      setImageStatus('idle')
    } catch (e) {
      // ユーザーがシェアシートをキャンセルした場合はエラー扱いしない
      if (e instanceof Error && e.name === 'AbortError') {
        setImageStatus('idle')
        return
      }
      setImageStatus('error')
    }
  }

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
            <b>4文字コード付きの性格タイプ</b>と、660着以上の出勤服から選ばれた
            <b>ぴったりの一着</b>がわかります。
          </p>
          <ul className="g-rules jp">
            <li>質問は全部で {QUESTIONS.length} 問</li>
            <li>4つの軸から16通りの4文字コードを判定</li>
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
        <div className="g-quiz-type-code mono">{type.code}</div>
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

        <div className="g-quiz-share">
          <h3 className="g-quiz-share-heading jp">結果をシェア</h3>
          <div className="g-quiz-share-actions">
            <button className="chip jp" onClick={shareOnX} disabled={!shareUrl}>
              Xでシェア
            </button>
            <button
              className="chip jp"
              onClick={shareImage}
              disabled={imageStatus === 'generating'}
            >
              {imageStatus === 'generating' ? '画像を作成中…' : '画像でシェア'}
            </button>
            <button className="chip jp" onClick={copyLink} disabled={!shareUrl}>
              {copyStatus === 'copied' ? 'コピーしました' : 'リンクをコピー'}
            </button>
          </div>
          {imageStatus === 'error' && (
            <p className="g-quiz-share-error jp">
              画像の生成に失敗しました。時間をおいてもう一度お試しください。
            </p>
          )}
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
