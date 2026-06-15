import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Data } from '../lib/useData'
import { outfits, thumb } from '../lib/useData'
import type { Outfit } from '../types'

// 出勤服 神経衰弱
// ・場札は出勤服。2枚めくって「同じアイテム」の数だけ得点（jacketもpantsも同じなら +2pt）。
// ・通常の神経衰弱と違い、当たっても外れてもターンは次の人へ回る。
// ・一致が出たカードは獲得（場から取り除く＝その場に伏せたまま claimed 表示）。
// ・場札は毎ゲーム 52 枚を全出勤服からランダムに選ぶ。プレイヤーは 1〜4 人。

const BOARD_SIZE = 52
const RESOLVE_MS = 1900 // 2枚めくってから結果を見せる時間（「つぎへ」で短縮可）
const PLAYER_COLORS = ['#3b5bdb', '#c0392b', '#0b8457', '#b8860b'] // 藍 / 朱 / 緑 / 山吹

type CardStatus = 'down' | 'up' | 'taken'
type Phase = 'setup' | 'playing' | 'finished'

type GameCard = {
  key: string // outfit.key（場札はすべて別コーデなので一意）
  outfit: Outfit
  items: string[] // 解決済みアイテムID（表示用）
  itemSet: Set<string> // 一致判定用
  status: CardStatus
  owner: number | null // 獲得したプレイヤーの index
  rot: number // 散らばり演出の回転(deg)
  dx: number // 同・微オフセット(px)
  dy: number
}

const rand = (min: number, max: number) => min + Math.random() * (max - min)

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 伏せ札の中に「1つでも同じアイテムを共有する2枚」が残っているか */
function hasMatch(down: GameCard[]): boolean {
  for (let i = 0; i < down.length; i++) {
    for (let j = i + 1; j < down.length; j++) {
      for (const id of down[i].itemSet) {
        if (down[j].itemSet.has(id)) return true
      }
    }
  }
  return false
}

export default function MemoryGameView({ data }: { data: Data }) {
  // 画像とアイテムが揃っているコーデだけを場札の候補にする
  const pool = useMemo(
    () =>
      outfits.filter(
        (o) => o.images[0]?.url && (data.outfitItemIds.get(o.key)?.size ?? 0) > 0,
      ),
    [data],
  )

  const [phase, setPhase] = useState<Phase>('setup')
  const [numPlayers, setNumPlayers] = useState(2)
  const [cards, setCards] = useState<GameCard[]>([])
  const [scores, setScores] = useState<number[]>([])
  const [current, setCurrent] = useState(0)
  const [selected, setSelected] = useState<string[]>([]) // めくり中のカードkey（最大2）
  const [locked, setLocked] = useState(false) // 結果表示中は操作不可
  const [turnCount, setTurnCount] = useState(0)

  const timer = useRef<number | null>(null)
  const pending = useRef<
    null | { aKey: string; bKey: string; miss: boolean; points: number; player: number }
  >(null)

  const cardByKey = useMemo(() => new Map(cards.map((c) => [c.key, c])), [cards])

  const clearTimer = () => {
    if (timer.current != null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }
  useEffect(() => () => clearTimer(), [])

  const deal = useCallback((): GameCard[] => {
    const chosen = shuffle(pool).slice(0, Math.min(BOARD_SIZE, pool.length))
    return chosen.map((o) => {
      const set = data.outfitItemIds.get(o.key) ?? new Set<string>()
      return {
        key: o.key,
        outfit: o,
        items: [...set],
        itemSet: set,
        status: 'down' as CardStatus,
        owner: null,
        rot: rand(-6.5, 6.5),
        dx: rand(-5, 5),
        dy: rand(-5, 5),
      }
    })
  }, [pool, data])

  const startGame = useCallback(
    (n: number) => {
      clearTimer()
      pending.current = null
      setNumPlayers(n)
      setCards(deal())
      setScores(Array.from({ length: n }, () => 0))
      setCurrent(0)
      setSelected([])
      setLocked(false)
      setTurnCount(0)
      setPhase('playing')
    },
    [deal],
  )

  // 2枚めくり終わった結果を場に反映してターンを次へ
  const commit = useCallback(() => {
    const p = pending.current
    if (!p) return
    pending.current = null
    clearTimer()
    setCards((cs) =>
      cs.map((c) => {
        if (c.key !== p.aKey && c.key !== p.bKey) return c
        return p.miss
          ? { ...c, status: 'down' as CardStatus }
          : { ...c, status: 'taken' as CardStatus, owner: p.player }
      }),
    )
    if (!p.miss) {
      setScores((s) => s.map((v, i) => (i === p.player ? v + p.points : v)))
    }
    setSelected([])
    setLocked(false)
    setCurrent((c) => (numPlayers ? (c + 1) % numPlayers : 0))
    setTurnCount((t) => t + 1)
  }, [numPlayers])

  const flip = useCallback(
    (cardKey: string) => {
      if (locked || selected.length >= 2) return
      const card = cardByKey.get(cardKey)
      if (!card || card.status !== 'down' || selected.includes(cardKey)) return

      const next = [...selected, cardKey]
      setCards((cs) => cs.map((c) => (c.key === cardKey ? { ...c, status: 'up' } : c)))
      setSelected(next)

      if (next.length === 2) {
        const a = cardByKey.get(next[0])!
        const b = cardByKey.get(next[1])!
        let points = 0
        for (const id of a.itemSet) if (b.itemSet.has(id)) points++
        pending.current = {
          aKey: next[0],
          bKey: next[1],
          miss: points === 0,
          points,
          player: current,
        }
        setLocked(true)
        clearTimer()
        timer.current = window.setTimeout(commit, RESOLVE_MS)
      }
    },
    [locked, selected, cardByKey, current, commit],
  )

  // 終了判定: 場が尽きる or これ以上一致を出せる組がない
  useEffect(() => {
    if (phase !== 'playing' || locked || selected.length > 0) return
    const down = cards.filter((c) => c.status === 'down')
    if (down.length < 2 || !hasMatch(down)) setPhase('finished')
  }, [cards, phase, locked, selected])

  // ----- 派生値 -----
  const sel = selected.map((k) => cardByKey.get(k)).filter(Boolean) as GameCard[]
  const matchedSet = useMemo(() => {
    if (sel.length < 2) return new Set<string>()
    const s = new Set<string>()
    for (const id of sel[0].itemSet) if (sel[1].itemSet.has(id)) s.add(id)
    return s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, cardByKey])
  const remaining = cards.filter((c) => c.status !== 'taken').length
  const resolved = sel.length === 2

  const ranking = useMemo(
    () =>
      scores
        .map((s, i) => ({ i, s }))
        .sort((a, b) => b.s - a.s || a.i - b.i),
    [scores],
  )
  const topScore = ranking[0]?.s ?? 0
  const winners = ranking.filter((r) => r.s === topScore).map((r) => r.i)

  // アイテムIDを表示用 {cat,label} に
  const itemInfo = (id: string) => {
    const it = data.itemMap.get(id)
    return {
      cat: it?.category ?? id.split('|')[0] ?? '',
      label: it?.label ?? id.split('|')[1] ?? id,
    }
  }

  const renderItemChips = (card: GameCard) =>
    [...card.items]
      .map((id) => ({ id, ...itemInfo(id) }))
      .sort((a, b) => a.cat.localeCompare(b.cat))
      .map(({ id, cat, label }) => (
        <span key={id} className={'g-chip' + (matchedSet.has(id) ? ' matched' : '')}>
          <span className="g-chip-cat">{cat}</span>
          {label}
        </span>
      ))

  // ---------------- setup ----------------
  if (phase === 'setup') {
    return (
      <main className="g-setup">
        <div className="g-setup-card">
          <h2 className="g-setup-title jp">出勤服 神経衰弱</h2>
          <p className="g-setup-lead jp">
            場札は {Math.min(BOARD_SIZE, pool.length)} 枚の出勤服。2枚めくって、
            <b>同じアイテム</b>（同じブランドの一着）があれば、その数だけ得点。
          </p>
          <ul className="g-rules jp">
            <li>
              jacket も pants も同じなら <b className="g-pt">＋2pt</b>
            </li>
            <li>当たっても外れても、ターンは次の人へ交代</li>
            <li>一致した2枚は獲得して場から外す</li>
            <li>場が尽きたら終了 — 合計得点が最大の人が勝ち</li>
          </ul>

          <div className="g-setup-row">
            <span className="g-setup-label jp">プレイヤー人数</span>
            <div className="g-num-pick">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  className={'chip' + (numPlayers === n ? ' active' : '')}
                  onClick={() => setNumPlayers(n)}
                >
                  <span className="mono">{n}</span>
                  <span className="jp">人</span>
                </button>
              ))}
            </div>
          </div>

          <button className="g-start jp" onClick={() => startGame(numPlayers)}>
            ゲーム開始
          </button>
        </div>
      </main>
    )
  }

  // ---------------- finished ----------------
  if (phase === 'finished') {
    const solo = numPlayers === 1
    return (
      <main className="g-finished">
        <div className="g-setup-card">
          <h2 className="g-setup-title jp">{solo ? 'クリア！' : '結果発表'}</h2>
          {!solo && (
            <p className="g-winner jp">
              {winners.length > 1 ? (
                <>
                  {winners.map((i) => `プレイヤー${i + 1}`).join(' · ')} の引き分け！
                </>
              ) : (
                <>
                  <b style={{ color: PLAYER_COLORS[winners[0]] }}>
                    プレイヤー{winners[0] + 1}
                  </b>{' '}
                  の勝ち！
                </>
              )}
            </p>
          )}
          <ol className="g-result-list">
            {ranking.map((r, rank) => (
              <li key={r.i} className={'g-result-row' + (r.s === topScore ? ' top' : '')}>
                <span className="g-result-rank mono">{rank + 1}</span>
                <span className="g-dot" style={{ background: PLAYER_COLORS[r.i] }} />
                <span className="g-result-name jp">プレイヤー{r.i + 1}</span>
                <span className="g-result-score mono">
                  {r.s}
                  <span className="g-pt-unit"> pt</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="g-finished-actions">
            <button className="g-start jp" onClick={() => startGame(numPlayers)}>
              もう一度（{numPlayers}人）
            </button>
            <button className="chip jp" onClick={() => setPhase('setup')}>
              人数を変える
            </button>
          </div>
        </div>
      </main>
    )
  }

  // ---------------- playing ----------------
  return (
    <main className="g-play">
      {/* スコアボード */}
      <div className="g-scoreboard">
        {scores.map((s, i) => (
          <div
            key={i}
            className={'g-score' + (i === current ? ' current' : '')}
            style={{ '--pc': PLAYER_COLORS[i] } as CSSProperties}
          >
            <span className="g-dot" style={{ background: PLAYER_COLORS[i] }} />
            <span className="g-score-name jp">P{i + 1}</span>
            <span className="g-score-val mono">{s}</span>
            {i === current && <span className="g-turn-tag jp">の番</span>}
          </div>
        ))}
        <div className="g-remaining jp">
          残り <span className="mono">{remaining}</span> 枚
        </div>
      </div>

      {/* ステージ: めくった2枚を大きく見せ、一致アイテムを強調 */}
      <div className={'g-stage' + (resolved ? (matchedSet.size > 0 ? ' hit' : ' miss') : '')}>
        <div className="g-slots">
          {[0, 1].map((slot) => {
            const c = sel[slot]
            return (
              <div className="g-slot" key={slot}>
                {c ? (
                  <>
                    <img
                      className="g-slot-img"
                      src={thumb(c.outfit.images[0].url, 360)}
                      alt={c.outfit.title}
                    />
                    <div className="g-slot-items">{renderItemChips(c)}</div>
                  </>
                ) : (
                  <div className="g-slot-empty jp">
                    {slot === 0 ? 'カードをめくる' : 'もう1枚めくる'}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="g-verdict">
          {!resolved ? (
            <span className="g-verdict-turn jp" style={{ color: PLAYER_COLORS[current] }}>
              プレイヤー{current + 1} の番 — {selected.length}/2 枚
            </span>
          ) : matchedSet.size > 0 ? (
            <>
              <span className="g-verdict-pt">
                <span className="mono">＋{matchedSet.size}</span> pt
              </span>
              <span className="g-verdict-detail jp">
                {[...matchedSet].map((id) => itemInfo(id).cat).join(' · ')} が一致
              </span>
            </>
          ) : (
            <span className="g-verdict-miss jp">一致なし</span>
          )}
          {resolved && (
            <button className="g-next jp" onClick={commit}>
              つぎへ →
            </button>
          )}
        </div>
      </div>

      {/* 場札: 52枚を散らして配置 */}
      <div className="g-board" aria-label="場札">
        {cards.map((c) => (
          <button
            key={c.key}
            className={'g-card ' + c.status}
            style={
              {
                '--rot': `${c.rot}deg`,
                '--dx': `${c.dx}px`,
                '--dy': `${c.dy}px`,
                '--owner': c.owner != null ? PLAYER_COLORS[c.owner] : 'transparent',
              } as CSSProperties
            }
            onClick={() => flip(c.key)}
            disabled={locked || c.status !== 'down'}
            aria-label={c.status === 'down' ? '伏せカード' : c.outfit.title}
          >
            <span className="g-card-inner">
              <span className="g-card-face g-card-back" aria-hidden>
                <span className="g-card-back-motif" />
              </span>
              <span className="g-card-face g-card-front">
                <img
                  src={thumb(c.outfit.images[0].url, 200)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              </span>
            </span>
            {c.status === 'taken' && c.owner != null && (
              <span className="g-claim mono" style={{ background: PLAYER_COLORS[c.owner] }}>
                P{c.owner + 1}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="g-play-foot">
        <button className="chip jp" onClick={() => setPhase('setup')}>
          ゲームをやめる
        </button>
        <span className="g-play-foot-note jp mono">turn {turnCount + 1}</span>
      </div>
    </main>
  )
}
