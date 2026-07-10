import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Data } from '../lib/useData'
import { outfits, thumb } from '../lib/useData'
import hairJson from '../data/hair.json'
import GameShareButton from './GameShareButton'
import type { HairFile } from '../types'
import {
  ABILITY_INFO,
  applyAction,
  buildAutoDeck,
  buildLevelScale,
  canChangePos,
  canSummon,
  cpuNextAction,
  createGame,
  deriveMonster,
  ensureUniqueNames,
  isMonster,
  materializeDeck,
  MONSTER_COUNT,
  DECK_SIZE,
  SEASON_COLOR,
  SEASON_LABEL,
  tributesNeeded,
  type BattleFlash,
  type Card,
  type GameState,
  type ItemInfo,
  type MonsterCard,
  type MonsterTemplate,
  type Orientation,
  type Season,
  type Side,
} from '../lib/duel'

// 髪まわりタグ（帽子・髪色）はカード名の素材に使う。manual が auto を上書き。
const hairFile = hairJson as HairFile
const hairOf = (key: string) => hairFile.manual[key] ?? hairFile.auto[key]

const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter']
const SPELL_TRAP_COUNT = DECK_SIZE - MONSTER_COUNT
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const prefersReduced = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// 攻撃モーション中の演出
type Lunge = { side: Side; zone: number } | null
type Fx = {
  id: number
  shake: boolean
  dmg: number
  dmgTo: Side | null
  struckSide: Side | null
  struckZone: number | null
} | null
type Banner = { id: number; text: string; tone: 'you' | 'cpu' | 'battle' } | null
type Cutin = { id: number; card: MonsterCard; side: Side } | null
type Clash = { id: number; flash: BattleFlash } | null
type Inspect = { card: Card; side: Side; zone: number | null } | null

type Phase = 'setup' | 'deck' | 'playing'

type UIMode =
  | { kind: 'idle' }
  | { kind: 'handMenu'; handIndex: number }
  | { kind: 'tribute'; handIndex: number; orientation: Orientation; faceDown: boolean; need: number; chosen: number[] }
  | { kind: 'spellTarget'; handIndex: number; effect: 'reward' | 'layering' }
  | { kind: 'layeringSeason'; handIndex: number; targetZone: number }
  | { kind: 'attackFrom'; zone: number }

// ---------------------------------------------------------------------------
// 戦績（連勝モード）— localStorage に永続化
// ---------------------------------------------------------------------------
type DuelStats = { streak: number; best: number; wins: number; losses: number }
const STATS_KEY = 'ootd-duel-stats-v1'
function loadStats(): DuelStats {
  try {
    const s = JSON.parse(localStorage.getItem(STATS_KEY) ?? '') as DuelStats
    if (typeof s?.streak === 'number') return { streak: s.streak, best: s.best ?? 0, wins: s.wins ?? 0, losses: s.losses ?? 0 }
  } catch {
    /* 初回 */
  }
  return { streak: 0, best: 0, wins: 0, losses: 0 }
}
function saveStats(s: DuelStats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(s))
  } catch {
    /* private mode 等 */
  }
}

// LPをカウントアップ/ダウンでなめらかに見せる
function useCountUp(value: number): number {
  const [disp, setDisp] = useState(value)
  const fromRef = useRef(value)
  useEffect(() => {
    const from = fromRef.current
    if (from === value) return
    fromRef.current = value
    if (prefersReduced()) {
      setDisp(value)
      return
    }
    const t0 = performance.now()
    const dur = 550
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur)
      const e = 1 - Math.pow(1 - k, 3)
      setDisp(Math.round(from + (value - from) * e))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return disp
}

// 出勤服 → モンスターテンプレートのプールを作る
function buildPool(data: Data): MonsterTemplate[] {
  // 対象コーデ（画像＋アイテムあり）を集める
  const eligible = outfits.filter((o) => o.images[0]?.url && (data.outfitItemIds.get(o.key)?.size ?? 0) > 0)
  // ★レベルは母集団のスキ数ランクで決める
  const scale = buildLevelScale(eligible.map((o) => ({ key: o.key, like: o.like })))
  const out: MonsterTemplate[] = []
  for (const o of eligible) {
    const ids = data.outfitItemIds.get(o.key)!
    const items: ItemInfo[] = [...ids].map((id) => {
      const it = data.itemMap.get(id)
      return {
        category: it?.category ?? id.split('|')[0] ?? 'other',
        count: it?.count ?? 1,
        color: it?.color,
      }
    })
    const hair = hairOf(o.key)
    out.push(deriveMonster(o, items, { level: scale.get(o.key), hat: hair?.hat, hairColor: hair?.color }))
  }
  ensureUniqueNames(out)
  return out
}

// ---------------------------------------------------------------------------
// カード描画
// ---------------------------------------------------------------------------
function LevelStars({ level }: { level: number }) {
  return (
    <span className="d-stars" aria-label={`レベル${level}`}>
      {'★'.repeat(level)}
    </span>
  )
}

function CardView({
  card,
  faceDown = false,
  orientation = 'attack',
  atkBuff = 0,
  season,
  size = 'md',
  onClick,
  className = '',
  disabled = false,
  compact = false,
}: {
  card: Card
  faceDown?: boolean
  orientation?: Orientation
  atkBuff?: number
  season?: Season
  size?: 'sm' | 'md' | 'lg'
  onClick?: () => void
  className?: string
  disabled?: boolean
  compact?: boolean
}) {
  const cls = `d-card d-card-${size}${orientation === 'defense' ? ' def' : ''}${onClick ? ' clickable' : ''} ${className}`
  if (faceDown) {
    return (
      <button type="button" className={cls + ' back'} onClick={onClick} disabled={disabled || !onClick} aria-label="伏せカード">
        <span className="d-card-back-motif" />
      </button>
    )
  }
  if (!isMonster(card)) {
    const kindCls = card.kind === 'spell' ? 'spell' : 'trap'
    return (
      <button type="button" className={`${cls} st ${kindCls}`} onClick={onClick} disabled={disabled || !onClick}>
        <span className="d-card-name jp">{card.name}</span>
        <span className="d-st-kind jp">{card.kind === 'spell' ? '魔法' : '罠'}</span>
        <span className="d-st-icon">{card.kind === 'spell' ? '✦' : '✧'}</span>
        {!compact && <span className="d-st-text jp">{card.text}</span>}
      </button>
    )
  }
  const sea = season ?? card.season
  const eff = Math.max(0, card.atk + atkBuff)
  const abil = ABILITY_INFO[card.ability]
  return (
    <button
      type="button"
      className={`${cls} monster`}
      onClick={onClick}
      disabled={disabled || !onClick}
      style={{ '--sea': SEASON_COLOR[sea] } as CSSProperties}
    >
      <span className="d-card-top">
        <span className="d-card-name jp">{card.name}</span>
        <span className="d-attr jp" title={SEASON_LABEL[sea] + '属性'}>
          {SEASON_LABEL[sea]}
        </span>
      </span>
      {!compact && <LevelStars level={card.level} />}
      <span className="d-card-art">
        <img src={thumb(card.img, size === 'lg' ? 360 : 200)} alt="" loading="lazy" decoding="async" />
        {compact && (
          <span className="d-ability-mini jp" title={`【${abil.name}】${abil.text}`}>
            {abil.name[0]}
          </span>
        )}
      </span>
      {!compact && (
        <span className="d-card-race jp">
          【{card.race}／{SEASON_LABEL[sea]}】<span className="d-ability jp">{abil.name}</span>
        </span>
      )}
      {compact ? (
        <span className="d-card-stats mono compact">
          <span className="d-atk">
            <b>{eff}</b>
            {atkBuff > 0 && <span className="d-buff">↑</span>}
            {atkBuff < 0 && <span className="d-debuff">↓</span>}
          </span>
          <span className="d-sep">/</span>
          <span className="d-def">
            <b>{card.def}</b>
          </span>
        </span>
      ) : (
        <span className="d-card-stats mono">
          <span className="d-atk">
            <i>ATK</i> <b>{eff}</b>
            {atkBuff > 0 && <span className="d-buff">↑</span>}
            {atkBuff < 0 && <span className="d-debuff">↓</span>}
          </span>
          <span className="d-def">
            <i>DEF</i> <b>{card.def}</b>
          </span>
        </span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------
export default function DuelGameView({ data, onBack }: { data: Data; onBack: () => void }) {
  const pool = useMemo(() => buildPool(data), [data])
  const [phase, setPhase] = useState<Phase>('setup')
  const [deckMonsters, setDeckMonsters] = useState<MonsterTemplate[]>(() => buildAutoDeck(pool))
  const [game, setGame] = useState<GameState | null>(null)
  const [ui, setUi] = useState<UIMode>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [stats, setStats] = useState<DuelStats>(loadStats)

  // ---- 演出用の状態 ----
  const [lunge, setLunge] = useState<Lunge>(null) // 突進中のモンスター
  const [fx, setFx] = useState<Fx>(null) // 着弾エフェクト（揺れ・被ダメ数字）
  const [banner, setBanner] = useState<Banner>(null) // ターン/フェイズの大バナー
  const [cutin, setCutin] = useState<Cutin>(null) // 大型召喚のカットイン
  const [clash, setClash] = useState<Clash>(null) // 戦闘のVSカットイン
  const [inspect, setInspect] = useState<Inspect>(null) // カード拡大表示
  const [animating, setAnimating] = useState(false) // 攻撃モーション中は操作ロック

  const gameRef = useRef<GameState | null>(null)
  const busyRef = useRef(false)
  const animatingRef = useRef(false)
  const recordedRef = useRef(false) // この対戦の勝敗を戦績に記録済みか
  const fxSeq = useRef(0)
  const bannerSeq = useRef(0)
  const cutinSeq = useRef(0)
  const clashSeq = useRef(0)
  const prevRef = useRef<{ turn: Side; phase: GameState['phase']; turnNo: number } | null>(null)

  const commit = useCallback((s: GameState) => {
    gameRef.current = s
    setGame(s)
  }, [])

  const act = useCallback(
    (action: Parameters<typeof applyAction>[1]) => {
      const cur = gameRef.current
      if (!cur) return
      commit(applyAction(cur, action))
    },
    [commit],
  )

  // ---- 大型召喚カットイン ----
  const showCutin = useCallback((card: MonsterCard, side: Side) => {
    if (prefersReduced()) return
    const id = ++cutinSeq.current
    setCutin({ id, card, side })
    setTimeout(() => setCutin((c) => (c && c.id === id ? null : c)), 1250)
  }, [])

  // ---- CPUターンの自動進行 ----
  const runCpuTurn = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    const reduce = prefersReduced()
    let guard = 0
    while (guard++ < 100) {
      const s = gameRef.current
      if (!s || s.winner !== null || s.turn !== 1) break
      const action = cpuNextAction(s, 1)
      if (!action) break
      if (action.type === 'attack') {
        // 突進 → 着弾（解決）→ VSカットインを見せる
        setLunge({ side: 1, zone: action.attackerZone })
        await sleep(reduce ? 0 : 360)
        setLunge(null)
        commit(applyAction(gameRef.current!, action))
        await sleep(reduce ? 60 : 900)
      } else if (action.type === 'summon') {
        const card = s.sides[1].hand[action.handIndex]
        await sleep(reduce ? 60 : 700)
        commit(applyAction(gameRef.current!, action))
        if (card && isMonster(card) && card.level >= 7 && !reduce) {
          showCutin(card, 1)
          await sleep(1150)
        }
      } else {
        await sleep(reduce ? 60 : action.type === 'endTurn' ? 500 : 700)
        commit(applyAction(gameRef.current!, action))
      }
      if (gameRef.current!.winner !== null) break
      if (action.type === 'endTurn') break
    }
    busyRef.current = false
    setBusy(false)
  }, [commit, showCutin])

  useEffect(() => {
    if (phase === 'playing' && game && game.turn === 1 && game.winner === null && !busyRef.current) {
      void runCpuTurn()
    }
  }, [phase, game, runCpuTurn])

  // ---- 戦闘解決（flash）→ 着弾エフェクト＋VSカットイン ----
  const flashFx = game?.flash
  useEffect(() => {
    if (!flashFx) return
    const id = ++fxSeq.current
    const struckSide: Side | null = flashFx.targetZone != null ? (flashFx.attackerSide === 0 ? 1 : 0) : null
    setFx({
      id,
      shake: flashFx.damage > 0 || flashFx.result === 'direct',
      dmg: flashFx.damage,
      dmgTo: flashFx.damageTo,
      struckSide,
      struckZone: flashFx.targetZone,
    })
    const t = setTimeout(() => setFx((cur) => (cur && cur.id === id ? null : cur)), 850)
    // VSカットイン（戦闘・ダイレクト・罠すべて。控えめ設定では出さない）
    let t2: ReturnType<typeof setTimeout> | undefined
    if (!prefersReduced()) {
      const cid = ++clashSeq.current
      setClash({ id: cid, flash: flashFx })
      t2 = setTimeout(() => setClash((c) => (c && c.id === cid ? null : c)), 980)
    }
    return () => {
      clearTimeout(t)
      if (t2) clearTimeout(t2)
    }
  }, [flashFx])

  // ---- ターン/フェイズの切り替わりで大バナーを一瞬出す ----
  useEffect(() => {
    if (!game || game.winner !== null) {
      prevRef.current = game ? { turn: game.turn, phase: game.phase, turnNo: game.turnNo } : null
      return
    }
    const prev = prevRef.current
    const cur = { turn: game.turn, phase: game.phase, turnNo: game.turnNo }
    prevRef.current = cur
    if (!prev) return
    let text = ''
    let tone: 'you' | 'cpu' | 'battle' = 'you'
    if (prev.turnNo !== cur.turnNo || prev.turn !== cur.turn) {
      text = cur.turn === 0 ? 'あなたのターン' : 'CPのターン'
      tone = cur.turn === 0 ? 'you' : 'cpu'
    } else if (prev.phase !== cur.phase && cur.phase === 'battle') {
      text = 'バトル！'
      tone = 'battle'
    }
    if (!text) return
    const id = ++bannerSeq.current
    setBanner({ id, text, tone })
    const t = setTimeout(() => setBanner((b) => (b && b.id === id ? null : b)), 950)
    return () => clearTimeout(t)
  }, [game])

  // ---- 勝敗確定 → 戦績（連勝）を1回だけ記録 ----
  useEffect(() => {
    if (!game || game.winner === null || recordedRef.current) return
    recordedRef.current = true
    setStats((prev) => {
      const next: DuelStats =
        game.winner === 0
          ? { streak: prev.streak + 1, best: Math.max(prev.best, prev.streak + 1), wins: prev.wins + 1, losses: prev.losses }
          : { streak: 0, best: prev.best, wins: prev.wins, losses: prev.losses + 1 }
      saveStats(next)
      return next
    })
  }, [game])

  // ---- ゲーム開始（連勝数に応じてCPUデッキが強くなる） ----
  const startDuel = useCallback(() => {
    const monsters = deckMonsters.length >= MONSTER_COUNT ? deckMonsters.slice(0, MONSTER_COUNT) : buildAutoDeck(pool)
    const playerDeck = materializeDeck(monsters, 0)
    const cpuDeck = materializeDeck(buildAutoDeck(pool, loadStats().streak), 1)
    const g = createGame(playerDeck, cpuDeck)
    recordedRef.current = false
    commit(g)
    setUi({ kind: 'idle' })
    setInspect(null)
    setPhase('playing')
  }, [deckMonsters, pool, commit])

  const rerollDeck = useCallback(() => setDeckMonsters(buildAutoDeck(pool)), [pool])
  const rerollCard = useCallback(
    (index: number) => {
      setDeckMonsters((prev) => {
        const have = new Set(prev.map((m) => m.outfitKey))
        const pick = pool.filter((m) => !have.has(m.outfitKey))
        if (!pick.length) return prev
        const next = prev.slice()
        next[index] = pick[Math.floor(Math.random() * pick.length)]
        return next
      })
    },
    [pool],
  )

  // ---- LPカウントアップ（playing 以外でも hooks は同順で呼ぶ） ----
  const youLp = useCountUp(game?.sides[0].lp ?? 8000)
  const cpuLp = useCountUp(game?.sides[1].lp ?? 8000)

  // ===================== setup =====================
  if (phase === 'setup') {
    const sCount = deckMonsters.reduce(
      (acc, m) => ((acc[m.season] = (acc[m.season] ?? 0) + 1), acc),
      {} as Record<Season, number>,
    )
    const avgAtk = Math.round(deckMonsters.reduce((s, m) => s + m.atk, 0) / Math.max(1, deckMonsters.length))
    const bombs = deckMonsters.filter((m) => m.level >= 7).length
    return (
      <main className="d-setup">
        <div className="d-setup-card">
          <div className="game-nav">
            <button className="game-back jp" onClick={onBack}>
              ← ゲームを選ぶ
            </button>
            <GameShareButton game="duel" title="デュエル" />
          </div>
          <h2 className="d-setup-title jp">出勤服デュエル</h2>
          <p className="d-setup-lead jp">
            出勤服1着が1体のモンスター。<b>スキ数の人気順でレベル（★）と攻撃力</b>、<b>着用回数＝守備力</b>、<b>季節＝属性</b>。
            40枚デッキを引き合い、ライフ <span className="mono">8000</span> を先に削りきったほうが勝ち。
          </p>
          <ul className="d-rules jp">
            <li>毎ターン1ドロー → 召喚 → バトル（先攻1ターン目はドロー・バトルなし）</li>
            <li>レベル5・6は1体、7・8は2体を<b>リリース</b>して召喚（アドバンス召喚）</li>
            <li>攻撃表示は殴り合い、守備表示は守り。<b>表示形式は1ターン1回変更できる</b></li>
            <li>
              季節は巡る — <b>春→夏→秋→冬→春</b> の向きに相性○（攻撃力 <span className="mono">+500</span>）
            </li>
            <li>
              種族ごとに固有アビリティ — 戦衣<b>【貫通】</b>・織衣<b>【連携】</b>・脚装<b>【疾走】</b>・踏破<b>【重装】</b>・装具<b>【道連れ】</b>
            </li>
            <li>魔法・罠も{SPELL_TRAP_COUNT}枚（ご褒美コーデ／大掃除／ゲリラ豪雨／虫食い ほか）</li>
          </ul>

          <div className="d-deck-stat">
            <span className="jp">あなたのデッキ <span className="mono">40</span> 枚</span>
            <span className="d-deck-seasons">
              {SEASONS.map((s) => (
                <span key={s} className="d-seasontag" style={{ '--sea': SEASON_COLOR[s] } as CSSProperties}>
                  {SEASON_LABEL[s]} <span className="mono">{sCount[s] ?? 0}</span>
                </span>
              ))}
            </span>
            <span className="jp d-deck-sub">
              平均ATK <span className="mono">{avgAtk}</span> ・ 大型 <span className="mono">{bombs}</span> ・ 魔法罠{' '}
              <span className="mono">{SPELL_TRAP_COUNT}</span>
            </span>
          </div>

          {(stats.wins > 0 || stats.losses > 0) && (
            <div className="d-record jp">
              <span>
                通算 <span className="mono">{stats.wins}</span>勝<span className="mono">{stats.losses}</span>敗 ・ 最高連勝{' '}
                <span className="mono">{stats.best}</span>
              </span>
              {stats.streak > 0 && (
                <span className="d-streak">
                  連勝中 <span className="mono">{stats.streak}</span> — 相手が強化されている
                </span>
              )}
            </div>
          )}

          <button className="d-start jp" onClick={startDuel}>
            決闘開始
          </button>
          <div className="d-setup-actions">
            <button className="chip jp" onClick={() => setPhase('deck')}>
              デッキを見る・編集
            </button>
            <button className="chip jp" onClick={rerollDeck}>
              おまかせで引き直す
            </button>
          </div>
        </div>
      </main>
    )
  }

  // ===================== deck editor =====================
  if (phase === 'deck') {
    return (
      <main className="d-deckedit">
        <div className="d-deckedit-head">
          <div>
            <h2 className="d-setup-title jp">デッキ編集</h2>
            <p className="jp d-deck-sub">
              モンスター <span className="mono">{deckMonsters.length}</span> 枚 ＋ 魔法・罠 <span className="mono">{SPELL_TRAP_COUNT}</span>{' '}
              枚（固定）。気に入らないカードは「引き直す」で交換。
            </p>
          </div>
          <div className="d-deckedit-actions">
            <button className="chip jp" onClick={rerollDeck}>
              全部おまかせ
            </button>
            <button className="d-start sm jp" onClick={startDuel}>
              この40枚で対戦
            </button>
            <button className="chip jp" onClick={() => setPhase('setup')}>
              戻る
            </button>
          </div>
        </div>
        <div className="d-deck-grid">
          {deckMonsters.map((m, i) => (
            <div className="d-deck-cell" key={m.outfitKey + i}>
              <CardView card={{ ...m, uid: 'edit' + i }} size="sm" onClick={() => setInspect({ card: { ...m, uid: 'edit' + i }, side: 0, zone: null })} />
              <button className="d-reroll jp" onClick={() => rerollCard(i)}>
                引き直す
              </button>
            </div>
          ))}
        </div>
        {inspect && <InspectModal inspect={inspect} onClose={() => setInspect(null)} />}
      </main>
    )
  }

  // ===================== playing =====================
  if (!game) return null
  const you = game.sides[0]
  const cpu = game.sides[1]
  const myTurn = game.turn === 0 && game.winner === null && !busy && !animating
  const inMain = game.phase === 'main'
  const inBattle = game.phase === 'battle'

  // ---- プレイヤー操作ハンドラ ----
  const onHandClick = (handIndex: number) => {
    if (!myTurn || !inMain) {
      // 手番外・バトル中でもカードは拡大で確認できる
      const c = you.hand[handIndex]
      if (c) setInspect({ card: c, side: 0, zone: null })
      return
    }
    setUi({ kind: 'handMenu', handIndex })
  }

  // 攻撃: 突進モーション → 解決（着弾＋VSカットインは flash 監視の useEffect が出す）
  const performAttack = async (attackerZone: number, targetZone: number | null) => {
    if (animatingRef.current) return
    animatingRef.current = true
    setAnimating(true)
    setUi({ kind: 'idle' })
    const reduce = prefersReduced()
    setLunge({ side: 0, zone: attackerZone })
    await sleep(reduce ? 0 : 340)
    setLunge(null)
    act({ type: 'attack', side: 0, attackerZone, targetZone })
    await sleep(reduce ? 0 : 620)
    animatingRef.current = false
    setAnimating(false)
  }

  const closeMenu = () => setUi({ kind: 'idle' })

  const doSummon = (handIndex: number, orientation: Orientation, faceDown: boolean) => {
    const card = you.hand[handIndex]
    if (!card || !isMonster(card)) return
    const need = tributesNeeded(card.level)
    if (need > 0) {
      setUi({ kind: 'tribute', handIndex, orientation, faceDown, need, chosen: [] })
    } else {
      act({ type: 'summon', side: 0, handIndex, orientation, faceDown, tributes: [] })
      closeMenu()
    }
  }

  const toggleTribute = (zone: number) => {
    setUi((u) => {
      if (u.kind !== 'tribute') return u
      const has = u.chosen.includes(zone)
      let chosen = has ? u.chosen.filter((z) => z !== zone) : [...u.chosen, zone]
      if (chosen.length > u.need) chosen = chosen.slice(chosen.length - u.need)
      return { ...u, chosen }
    })
  }
  const confirmTribute = () => {
    if (ui.kind !== 'tribute' || ui.chosen.length !== ui.need) return
    const card = you.hand[ui.handIndex]
    act({ type: 'summon', side: 0, handIndex: ui.handIndex, orientation: ui.orientation, faceDown: ui.faceDown, tributes: ui.chosen })
    if (card && isMonster(card) && card.level >= 7 && !ui.faceDown) showCutin(card, 0)
    closeMenu()
  }

  const onFieldClick = (side: Side, zone: number) => {
    const slot = game.sides[side].field[zone]
    // リリース選択
    if (ui.kind === 'tribute' && side === 0) {
      if (slot) toggleTribute(zone)
      return
    }
    // 魔法の対象（自分モンスター）
    if (ui.kind === 'spellTarget' && side === 0 && slot) {
      if (ui.effect === 'reward') {
        act({ type: 'spell', side: 0, handIndex: ui.handIndex, targetZone: zone })
        closeMenu()
      } else {
        setUi({ kind: 'layeringSeason', handIndex: ui.handIndex, targetZone: zone })
      }
      return
    }
    // 攻撃対象（敵モンスター）
    if (ui.kind === 'attackFrom' && side === 1 && slot) {
      void performAttack(ui.zone, zone)
      return
    }
    // 攻撃宣言（自分の攻撃表示モンスターを選ぶ）
    if (myTurn && inBattle && side === 0 && slot && slot.orientation === 'attack' && !slot.faceDown && !slot.hasAttacked) {
      setUi({ kind: 'attackFrom', zone })
      return
    }
    // それ以外のクリックは拡大表示（裏側の敵カードは見えない）
    if (ui.kind === 'idle' && slot && !(side === 1 && slot.faceDown)) {
      setInspect({ card: slot.card, side, zone })
    }
  }

  const directAttack = () => {
    if (ui.kind !== 'attackFrom') return
    void performAttack(ui.zone, null)
  }

  const endTurn = () => {
    setUi({ kind: 'idle' })
    act({ type: 'endTurn', side: 0 })
  }
  const toBattle = () => {
    setUi({ kind: 'idle' })
    act({ type: 'toBattle', side: 0 })
  }

  // ---- おまかせ行動: AIが次の一手を1つ実行（迷ったら連打でOK） ----
  const autoPlay = async () => {
    if (!myTurn) return
    setUi({ kind: 'idle' })
    const s0 = gameRef.current!
    const a = cpuNextAction(s0, 0)
    if (!a) {
      act({ type: 'endTurn', side: 0 })
      return
    }
    if (a.type === 'attack') {
      await performAttack(a.attackerZone, a.targetZone)
      return
    }
    if (a.type === 'summon') {
      const card = s0.sides[0].hand[a.handIndex]
      act(a)
      if (card && isMonster(card) && card.level >= 7 && !a.faceDown) showCutin(card, 0)
      return
    }
    act(a)
  }

  const enemyHasMonster = cpu.field.some((f) => f)
  const menuCard = ui.kind === 'handMenu' ? you.hand[ui.handIndex] : null
  const flash = game.flash

  const lpPct = (lp: number) => Math.max(0, Math.min(100, (lp / 8000) * 100))
  const lowYou = you.lp <= 2000
  const lowCpu = cpu.lp <= 2000

  return (
    <main className={'d-play' + (fx?.shake ? ' shaking' : '')}>
      {/* ターン/フェイズの大バナー */}
      {banner && (
        <div className={'d-banner ' + banner.tone} key={banner.id}>
          <span className="jp">{banner.text}</span>
        </div>
      )}
      {/* 大型召喚カットイン */}
      {cutin && (
        <div className={'d-cutin ' + (cutin.side === 0 ? 'you' : 'cpu')} key={'cut' + cutin.id} aria-hidden>
          <div className="d-cutin-beam" />
          <div className="d-cutin-body">
            <span className="d-cutin-art" style={{ '--sea': SEASON_COLOR[cutin.card.season] } as CSSProperties}>
              <img src={thumb(cutin.card.img, 360)} alt="" />
            </span>
            <span className="d-cutin-label jp">{cutin.side === 0 ? 'アドバンス召喚！' : 'CPのアドバンス召喚'}</span>
            <span className="d-cutin-name jp">{cutin.card.name}</span>
            <span className="d-cutin-stats mono">
              ★{cutin.card.level} ／ ATK {cutin.card.atk}
            </span>
          </div>
        </div>
      )}
      {/* 戦闘のVSカットイン */}
      {clash && <ClashOverlay key={'cl' + clash.id} flash={clash.flash} />}
      {/* 被ダメージのフラッシュ（受けた側を赤く光らせる） */}
      {fx && fx.dmgTo != null && (
        <div className={'d-hit-overlay ' + (fx.dmgTo === 0 ? 'you' : 'cpu')} key={'ov' + fx.id} />
      )}
      {/* 飛び出すダメージ数値 */}
      {fx && fx.dmg > 0 && fx.dmgTo != null && (
        <div className={'d-dmg-float ' + (fx.dmgTo === 0 ? 'bottom' : 'top')} key={'dm' + fx.id}>
          −{fx.dmg}
        </div>
      )}

      {/* ===== 相手（CP） ===== */}
      <section className={'d-side cpu' + (game.turn === 1 ? ' active' : '')}>
        <div className="d-side-head">
          <span className="d-side-name jp">CP</span>
          <div className="d-lp">
            <div className="d-lp-bar">
              <span className={'d-lp-fill cpu' + (lowCpu ? ' low' : '')} style={{ width: lpPct(cpu.lp) + '%' }} />
            </div>
            <span className={'d-lp-num mono' + (lowCpu ? ' low' : '')}>{cpuLp}</span>
          </div>
          {stats.streak > 0 && <span className="d-streak-mini jp mono">強化Lv{Math.min(8, stats.streak)}</span>}
          <span className="d-counts jp mono">手{cpu.hand.length}・山{cpu.deck.length}・墓{cpu.graveyard.length}</span>
        </div>
        {/* 相手の手札（裏） */}
        <div className="d-enemy-hand" aria-hidden>
          {cpu.hand.map((c) => (
            <span className="d-mini-back" key={c.uid} />
          ))}
        </div>
        <div className="d-back-row">
          {cpu.back.map((b, z) => (
            <div className="d-zone back" key={z}>
              {b && <CardView card={b.card} faceDown size="sm" compact />}
            </div>
          ))}
        </div>
        <div className="d-field">
          {cpu.field.map((slot, z) => {
            const targetable = ui.kind === 'attackFrom' && !!slot
            const struck = fx?.struckSide === 1 && fx?.struckZone === z
            const lungeHere = lunge?.side === 1 && lunge.zone === z
            const inspectable = ui.kind === 'idle' && !!slot && !slot.faceDown
            return (
              <div
                className={'d-zone' + (targetable ? ' targetable' : '') + (struck ? ' struck' : '')}
                key={z}
                onClick={() => onFieldClick(1, z)}
                role={targetable || inspectable ? 'button' : undefined}
              >
                {slot && (
                  <CardView
                    key={slot.card.uid}
                    card={slot.card}
                    faceDown={slot.faceDown}
                    orientation={slot.orientation}
                    atkBuff={slot.atkBuff}
                    season={slot.season}
                    size="sm"
                    compact
                    className={'d-onfield' + (lungeHere ? ' lunge-down' : '')}
                  />
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ===== センター（フェイズ／戦闘結果） ===== */}
      <section className="d-center">
        <div className="d-turnbar jp">
          {game.winner === null ? (
            <>
              <span className={'d-turn-who' + (game.turn === 0 ? ' you' : '')}>
                {game.turn === 0 ? 'あなたのターン' : 'CPのターン'}
              </span>
              <span className="d-turn-phase">{inMain ? 'メインフェイズ' : 'バトルフェイズ'} ・ T{game.turnNo}</span>
              {stats.streak > 0 && <span className="d-streak-mini jp mono">連勝{stats.streak}</span>}
              {busy && <span className="d-thinking jp">CPが思考中…</span>}
            </>
          ) : (
            <span className="d-turn-who you">{game.winner === 0 ? 'あなたの勝ち！' : 'CPの勝ち…'}</span>
          )}
        </div>

        {flash && (
          <div className={'d-flash ' + flash.result}>
            <span className="jp d-flash-line">
              <b>{flash.attacker}</b>
              {flash.result === 'direct' ? (
                <> がダイレクトアタック</>
              ) : flash.result === 'negate' || flash.result === 'bounce' ? (
                <> の攻撃は{flash.trap ? `「${flash.trap}」で` : ''}防がれた</>
              ) : (
                <>
                  {' '}
                  <span className="mono">{flash.atkValue}</span>
                  {flash.matchup === 1 && <span className="d-good">相性○</span>}
                  {flash.matchup === -1 && <span className="d-bad">相性×</span>}
                  {' → '}
                  <b>{flash.target}</b> <span className="mono">{flash.defValue}</span>
                </>
              )}
            </span>
            {flash.damage > 0 && (
              <span className="d-flash-dmg jp">
                {flash.damageTo === 0 ? 'あなた' : 'CP'} に <span className="mono">{flash.damage}</span> ダメージ
              </span>
            )}
            {flash.abilityNotes?.map((n, i) => (
              <span key={i} className="d-flash-abil jp">
                {n}
              </span>
            ))}
            {(flash.result === 'destroy-target' || flash.result === 'both') && <span className="d-flash-tag jp">破壊！</span>}
            {flash.result === 'recoil' && <span className="d-flash-tag jp">守備に阻まれた</span>}
          </div>
        )}

        {!flash && myTurn && (
          <div className="d-hint jp">
            {ui.kind === 'tribute' && `リリースするモンスターを ${ui.chosen.length}/${ui.need} 体えらぶ`}
            {ui.kind === 'spellTarget' && '対象の自分モンスターをえらぶ'}
            {ui.kind === 'layeringSeason' && '変更する季節をえらぶ'}
            {ui.kind === 'attackFrom' && (enemyHasMonster ? '攻撃する相手をえらぶ' : 'ダイレクトアタックできる')}
            {ui.kind === 'idle' && inMain && '手札をタップして召喚／発動。場のカードはタップで詳細'}
            {ui.kind === 'idle' && inBattle && '自分の攻撃表示モンスターをタップ'}
            {ui.kind === 'handMenu' && '行動をえらぶ'}
          </div>
        )}

        {/* フェイズ操作 */}
        {myTurn && (
          <div className="d-phasebar">
            {ui.kind === 'attackFrom' && !enemyHasMonster && (
              <button className="d-act jp" onClick={directAttack}>
                ダイレクトアタック！
              </button>
            )}
            {ui.kind === 'attackFrom' && (
              <button className="chip jp" onClick={() => setUi({ kind: 'idle' })}>
                攻撃やめる
              </button>
            )}
            {ui.kind === 'idle' && inMain && game.turnNo > 1 && (
              <button className="d-act jp" onClick={toBattle}>
                バトルへ
              </button>
            )}
            {ui.kind === 'idle' && (
              <button className="chip jp d-auto" onClick={() => void autoPlay()} title="AIが次の一手を代わりに実行">
                おまかせ行動
              </button>
            )}
            {ui.kind === 'idle' && (
              <button className="chip jp" onClick={endTurn}>
                ターン終了
              </button>
            )}
          </div>
        )}
      </section>

      {/* ===== 自分 ===== */}
      <section className={'d-side you' + (game.turn === 0 ? ' active' : '')}>
        <div className="d-field">
          {you.field.map((slot, z) => {
            const tributeSel = ui.kind === 'tribute' && ui.chosen.includes(z)
            const tributable = ui.kind === 'tribute' && !!slot
            const spellTargetable = ui.kind === 'spellTarget' && !!slot
            const attackReady = myTurn && inBattle && !!slot && slot.orientation === 'attack' && !slot.faceDown && !slot.hasAttacked
            const attacking = ui.kind === 'attackFrom' && ui.zone === z
            const struck = fx?.struckSide === 0 && fx?.struckZone === z
            const lungeHere = lunge?.side === 0 && lunge.zone === z
            return (
              <div
                className={
                  'd-zone' +
                  (tributable || spellTargetable ? ' targetable' : '') +
                  (tributeSel ? ' selected' : '') +
                  (attackReady ? ' ready' : '') +
                  (attacking ? ' attacking' : '') +
                  (struck ? ' struck' : '')
                }
                key={z}
                onClick={() => onFieldClick(0, z)}
                role={tributable || spellTargetable || attackReady || !!slot ? 'button' : undefined}
              >
                {slot && (
                  <CardView
                    key={slot.card.uid}
                    card={slot.card}
                    faceDown={slot.faceDown}
                    orientation={slot.orientation}
                    atkBuff={slot.atkBuff}
                    season={slot.season}
                    size="sm"
                    compact
                    className={'d-onfield' + (lungeHere ? ' lunge-up' : '')}
                  />
                )}
                {slot?.hasAttacked && <span className="d-tapped jp">攻撃済</span>}
              </div>
            )
          })}
        </div>
        <div className="d-back-row">
          {you.back.map((b, z) => (
            <div className="d-zone back" key={z}>
              {b && <CardView card={b.card} faceDown size="sm" compact onClick={() => setInspect({ card: b.card, side: 0, zone: null })} />}
            </div>
          ))}
        </div>
        <div className="d-side-head">
          <span className="d-side-name jp">あなた</span>
          <div className="d-lp">
            <div className="d-lp-bar">
              <span className={'d-lp-fill you' + (lowYou ? ' low' : '')} style={{ width: lpPct(you.lp) + '%' }} />
            </div>
            <span className={'d-lp-num mono' + (lowYou ? ' low' : '')}>{youLp}</span>
          </div>
          <span className="d-counts jp mono">山{you.deck.length}・墓{you.graveyard.length}</span>
        </div>
      </section>

      {/* ===== 手札 ===== */}
      <section className="d-hand-wrap">
        <div className="d-hand">
          {you.hand.map((c, i) => (
            <CardView
              key={c.uid}
              card={c}
              size="md"
              onClick={() => onHandClick(i)}
              className={'d-hand-card' + (ui.kind === 'handMenu' && ui.handIndex === i ? ' picked' : '')}
            />
          ))}
          {you.hand.length === 0 && <span className="d-hand-empty jp">手札なし</span>}
        </div>
      </section>

      {/* ===== 手札アクションメニュー ===== */}
      {ui.kind === 'handMenu' && menuCard && (
        <div className="d-modal-back" onClick={closeMenu}>
          <div className="d-menu" onClick={(e) => e.stopPropagation()}>
            <div className="d-menu-card">
              <CardView card={menuCard} size="lg" />
            </div>
            {isMonster(menuCard) && (
              <div className="d-menu-note jp">
                【{ABILITY_INFO[menuCard.ability].name}】{ABILITY_INFO[menuCard.ability].text}
              </div>
            )}
            {isMonster(menuCard) ? (
              (() => {
                const need = tributesNeeded(menuCard.level)
                const ok = canSummon(game, 0, ui.handIndex)
                return (
                  <>
                    {need > 0 && <div className="d-menu-note jp">レベル{menuCard.level}：{need}体リリースが必要</div>}
                    <button className="d-menu-act jp" disabled={!ok} onClick={() => doSummon(ui.handIndex, 'attack', false)}>
                      攻撃表示で召喚
                    </button>
                    <button className="d-menu-act jp" disabled={!ok} onClick={() => doSummon(ui.handIndex, 'defense', true)}>
                      裏側守備でセット
                    </button>
                    {!ok && <div className="d-menu-note warn jp">{game.normalSummonUsed ? 'このターンは召喚済み' : '場・リリースが足りない'}</div>}
                  </>
                )
              })()
            ) : menuCard.kind === 'spell' ? (
              (() => {
                const hasMonster = you.field.some((f) => f)
                if (menuCard.id === 'closet') {
                  return (
                    <button className="d-menu-act jp" onClick={() => { act({ type: 'spell', side: 0, handIndex: ui.handIndex }); closeMenu() }}>
                      発動（2枚ドロー）
                    </button>
                  )
                }
                if (menuCard.id === 'storm') {
                  const targets = cpu.back.filter((b) => b).length
                  return (
                    <>
                      <button
                        className="d-menu-act jp"
                        disabled={targets === 0}
                        onClick={() => { act({ type: 'spell', side: 0, handIndex: ui.handIndex }); closeMenu() }}
                      >
                        発動（伏せ{targets}枚を破壊）
                      </button>
                      {targets === 0 && <div className="d-menu-note warn jp">相手の伏せカードがない</div>}
                    </>
                  )
                }
                const effect = menuCard.id === 'reward' ? 'reward' : 'layering'
                return (
                  <>
                    <button
                      className="d-menu-act jp"
                      disabled={!hasMonster}
                      onClick={() => setUi({ kind: 'spellTarget', handIndex: ui.handIndex, effect })}
                    >
                      発動（自分モンスターを対象）
                    </button>
                    {!hasMonster && <div className="d-menu-note warn jp">対象モンスターがいない</div>}
                  </>
                )
              })()
            ) : (
              (() => {
                const freeBack = you.back.some((b) => !b)
                return (
                  <>
                    <button className="d-menu-act jp" disabled={!freeBack} onClick={() => { act({ type: 'setTrap', side: 0, handIndex: ui.handIndex }); closeMenu() }}>
                      裏側にセット
                    </button>
                    {!freeBack && <div className="d-menu-note warn jp">伏せるゾーンがない</div>}
                  </>
                )
              })()
            )}
            <button className="d-menu-cancel jp" onClick={closeMenu}>
              やめる
            </button>
          </div>
        </div>
      )}

      {/* リリース確定バー */}
      {ui.kind === 'tribute' && (
        <div className="d-confirm-bar">
          <span className="jp">
            リリース <span className="mono">{ui.chosen.length}/{ui.need}</span>
          </span>
          <button className="d-act jp sm" disabled={ui.chosen.length !== ui.need} onClick={confirmTribute}>
            この生贄で召喚
          </button>
          <button className="chip jp" onClick={closeMenu}>
            やめる
          </button>
        </div>
      )}

      {/* 重ね着の季節選択 */}
      {ui.kind === 'layeringSeason' && (
        <div className="d-modal-back" onClick={() => setUi({ kind: 'idle' })}>
          <div className="d-menu" onClick={(e) => e.stopPropagation()}>
            <div className="d-menu-title jp">重ね着 — 属性を変える</div>
            <div className="d-season-pick">
              {SEASONS.map((s) => (
                <button
                  key={s}
                  className="d-season-btn jp"
                  style={{ '--sea': SEASON_COLOR[s] } as CSSProperties}
                  onClick={() => {
                    act({ type: 'spell', side: 0, handIndex: ui.handIndex, targetZone: ui.targetZone, season: s })
                    setUi({ kind: 'idle' })
                  }}
                >
                  {SEASON_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* カード拡大（詳細＋表示形式変更） */}
      {inspect && (
        <InspectModal
          inspect={inspect}
          onClose={() => setInspect(null)}
          slot={inspect.zone != null ? game.sides[inspect.side].field[inspect.zone] ?? undefined : undefined}
          canFlip={inspect.side === 0 && inspect.zone != null && myTurn && inMain && canChangePos(game, 0, inspect.zone)}
          onFlip={() => {
            if (inspect.zone == null) return
            act({ type: 'changePosition', side: 0, zone: inspect.zone })
            setInspect(null)
          }}
        />
      )}

      {/* ログ */}
      <div className="d-logbar">
        <button className="d-log-toggle jp" onClick={() => setShowLog((v) => !v)}>
          ログ {showLog ? '▲' : '▼'}
        </button>
        {game.log.length > 0 && <span className="d-log-last jp">{game.log[game.log.length - 1].text}</span>}
      </div>
      {showLog && (
        <ul className="d-log">
          {game.log.slice(-14).reverse().map((l, i) => (
            <li key={i} className={'jp' + (l.side === 0 ? ' you' : l.side === 1 ? ' cpu' : '')}>
              {l.text}
            </li>
          ))}
        </ul>
      )}

      {/* 勝敗 */}
      {game.winner !== null && (
        <div className="d-modal-back">
          <div className={'d-result ' + (game.winner === 0 ? 'win' : 'lose')}>
            {game.winner === 0 && (
              <div className="d-result-burst" aria-hidden>
                {Array.from({ length: 7 }).map((_, i) => (
                  <span key={i} style={{ '--i': i } as CSSProperties}>
                    ★
                  </span>
                ))}
              </div>
            )}
            <h2 className="d-setup-title jp">{game.winner === 0 ? '勝利！' : '敗北…'}</h2>
            <p className="jp d-result-lead">
              {game.winner === 0
                ? stats.streak >= 2
                  ? `${stats.streak}連勝中！ 次の相手はさらに強い。`
                  : 'デッキを率いてCPを下した。次の相手は少し強くなる。'
                : 'CPに敗れ、連勝が途切れた。デッキを組み直して再挑戦。'}
            </p>
            <div className="d-result-stats jp mono">
              <span>ターン {game.turnNo}</span>
              <span>与ダメ {8000 - cpu.lp}</span>
              <span>残LP {Math.max(0, you.lp)}</span>
              <span>最高連勝 {stats.best}</span>
            </div>
            <button className="d-start jp" onClick={startDuel}>
              {game.winner === 0 ? `次の相手へ（連勝${stats.streak}）` : 'リベンジ'}
            </button>
            <div className="d-setup-actions">
              <button className="chip jp" onClick={() => setPhase('deck')}>
                デッキ編集
              </button>
              <button className="chip jp" onClick={() => setPhase('setup')}>
                トップへ
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

// ---------------------------------------------------------------------------
// 戦闘のVSカットイン
// ---------------------------------------------------------------------------
function ClashOverlay({ flash }: { flash: BattleFlash }) {
  const youAttacking = flash.attackerSide === 0
  const resultText =
    flash.result === 'destroy-target'
      ? '破壊！'
      : flash.result === 'destroy-attacker'
        ? '返り討ち！'
        : flash.result === 'both'
          ? '相打ち！'
          : flash.result === 'recoil'
            ? '守備に阻まれた'
            : flash.result === 'direct'
              ? 'ダイレクトアタック！'
              : flash.result === 'negate' || flash.result === 'bounce'
                ? `罠「${flash.trap ?? ''}」発動！`
                : ''
  return (
    <div className="d-clash" aria-hidden>
      <div className="d-clash-row">
        <div className={'d-clash-side left' + (youAttacking ? ' atk' : '')}>
          {flash.attackerImg && (
            <span className="d-clash-art">
              <img src={thumb(flash.attackerImg, 240)} alt="" />
            </span>
          )}
          <span className="d-clash-name jp">{flash.attacker}</span>
          {flash.atkValue > 0 && <span className="d-clash-num mono atk">{flash.atkValue}</span>}
        </div>
        <span className="d-clash-vs mono">VS</span>
        <div className={'d-clash-side right' + (youAttacking ? '' : ' atk')}>
          {flash.targetImg ? (
            <>
              <span className="d-clash-art">
                <img src={thumb(flash.targetImg, 240)} alt="" />
              </span>
              <span className="d-clash-name jp">{flash.target}</span>
              <span className="d-clash-num mono def">{flash.defValue}</span>
            </>
          ) : (
            <span className="d-clash-direct jp">{flash.result === 'negate' || flash.result === 'bounce' ? '罠発動' : '直接攻撃'}</span>
          )}
        </div>
      </div>
      {resultText && <div className="d-clash-result jp">{resultText}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// カード拡大モーダル
// ---------------------------------------------------------------------------
function InspectModal({
  inspect,
  slot,
  canFlip = false,
  onFlip,
  onClose,
}: {
  inspect: NonNullable<Inspect>
  slot?: { orientation: Orientation; faceDown: boolean; atkBuff: number; season: Season }
  canFlip?: boolean
  onFlip?: () => void
  onClose: () => void
}) {
  const { card } = inspect
  return (
    <div className="d-modal-back" onClick={onClose}>
      <div className="d-inspect" onClick={(e) => e.stopPropagation()}>
        <div className="d-inspect-card">
          <CardView card={card} size="lg" atkBuff={slot?.atkBuff ?? 0} season={slot?.season} />
        </div>
        <div className="d-inspect-info">
          {isMonster(card) ? (
            <>
              <div className="d-inspect-abil jp">
                <b>【{ABILITY_INFO[card.ability].name}】</b>
                {ABILITY_INFO[card.ability].text}
              </div>
              <div className="d-inspect-meta jp">
                <span>{card.date} 着用 ・ スキ {card.likes}</span>
                <span className="d-inspect-title">「{card.title}」</span>
              </div>
              {slot && (
                <div className="d-inspect-meta jp">
                  <span>
                    現在: {slot.faceDown ? '裏側守備' : slot.orientation === 'attack' ? '攻撃表示' : '守備表示'}
                    {slot.atkBuff !== 0 && ` ／ ATK補正 ${slot.atkBuff > 0 ? '+' : ''}${slot.atkBuff}`}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="d-inspect-abil jp">{card.text}</div>
          )}
          {canFlip && slot && (
            <button className="d-menu-act jp" onClick={onFlip}>
              {slot.faceDown ? '反転して攻撃表示に' : slot.orientation === 'attack' ? '守備表示に変更' : '攻撃表示に変更'}
            </button>
          )}
          <button className="d-menu-cancel jp" onClick={onClose}>
            とじる
          </button>
        </div>
      </div>
    </div>
  )
}
