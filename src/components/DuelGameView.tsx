import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Data } from '../lib/useData'
import { outfits, thumb } from '../lib/useData'
import {
  applyAction,
  buildAutoDeck,
  canSummon,
  cpuNextAction,
  createGame,
  deriveMonster,
  isMonster,
  materializeDeck,
  MONSTER_COUNT,
  SEASON_COLOR,
  SEASON_LABEL,
  tributesNeeded,
  type Card,
  type GameState,
  type ItemInfo,
  type MonsterTemplate,
  type Orientation,
  type Season,
  type Side,
} from '../lib/duel'

const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter']
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Phase = 'setup' | 'deck' | 'playing'

type UIMode =
  | { kind: 'idle' }
  | { kind: 'handMenu'; handIndex: number }
  | { kind: 'tribute'; handIndex: number; orientation: Orientation; faceDown: boolean; need: number; chosen: number[] }
  | { kind: 'spellTarget'; handIndex: number; effect: 'reward' | 'layering' }
  | { kind: 'layeringSeason'; handIndex: number; targetZone: number }
  | { kind: 'attackFrom'; zone: number }

// 出勤服 → モンスターテンプレートのプールを作る
function buildPool(data: Data): MonsterTemplate[] {
  const out: MonsterTemplate[] = []
  for (const o of outfits) {
    if (!o.images[0]?.url) continue
    const ids = data.outfitItemIds.get(o.key)
    if (!ids || ids.size === 0) continue
    const items: ItemInfo[] = [...ids].map((id) => {
      const it = data.itemMap.get(id)
      return {
        category: it?.category ?? id.split('|')[0] ?? 'other',
        count: it?.count ?? 1,
        color: it?.color,
      }
    })
    out.push(deriveMonster(o, items))
  }
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
  const eff = card.atk + atkBuff
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
      </span>
      {!compact && <span className="d-card-race jp">【{card.race}／{SEASON_LABEL[sea]}】</span>}
      {compact ? (
        <span className="d-card-stats mono compact">
          <span className="d-atk">
            <b>{eff}</b>
            {atkBuff > 0 && <span className="d-buff">↑</span>}
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

  const gameRef = useRef<GameState | null>(null)
  const busyRef = useRef(false)

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

  // ---- CPUターンの自動進行 ----
  const runCpuTurn = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    let guard = 0
    while (guard++ < 100) {
      const s = gameRef.current
      if (!s || s.winner !== null || s.turn !== 1) break
      const action = cpuNextAction(s, 1)
      if (!action) break
      await sleep(action.type === 'attack' ? 1000 : action.type === 'endTurn' ? 500 : 700)
      commit(applyAction(gameRef.current!, action))
      if (gameRef.current!.winner !== null) break
      if (action.type === 'endTurn') break
    }
    busyRef.current = false
    setBusy(false)
  }, [commit])

  useEffect(() => {
    if (phase === 'playing' && game && game.turn === 1 && game.winner === null && !busyRef.current) {
      void runCpuTurn()
    }
  }, [phase, game, runCpuTurn])

  // ---- ゲーム開始 ----
  const startDuel = useCallback(() => {
    const monsters = deckMonsters.length >= MONSTER_COUNT ? deckMonsters.slice(0, MONSTER_COUNT) : buildAutoDeck(pool)
    const playerDeck = materializeDeck(monsters, 0)
    const cpuDeck = materializeDeck(buildAutoDeck(pool), 1)
    const g = createGame(playerDeck, cpuDeck)
    commit(g)
    setUi({ kind: 'idle' })
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
          <button className="game-back jp" onClick={onBack}>
            ← ゲームを選ぶ
          </button>
          <h2 className="d-setup-title jp">出勤服デュエル</h2>
          <p className="d-setup-lead jp">
            出勤服1着が1体のモンスター。<b>スキ数＝攻撃力</b>、<b>着用回数＝守備力</b>、<b>季節＝属性</b>。
            40枚デッキを引き合い、ライフ <span className="mono">8000</span> を先に削りきったほうが勝ち。
          </p>
          <ul className="d-rules jp">
            <li>毎ターン1ドロー → 召喚 → バトル（先攻1ターン目はドロー・バトルなし）</li>
            <li>レベル5・6は1体、7・8は2体を<b>リリース</b>して召喚（アドバンス召喚）</li>
            <li>攻撃表示は殴り合い、守備表示は守り。攻撃力が上回れば破壊＆差分ダメージ</li>
            <li>
              季節は巡る — <b>春→夏→秋→冬→春</b> の向きに相性○（攻撃力 <span className="mono">+500</span>）
            </li>
            <li>魔法・罠も8枚（ご褒美コーデ／クローゼット整理／重ね着／ゲリラ豪雨 ほか）</li>
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
              平均ATK <span className="mono">{avgAtk}</span> ・ 大型 <span className="mono">{bombs}</span> ・ 魔法罠 <span className="mono">8</span>
            </span>
          </div>

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
              モンスター <span className="mono">{deckMonsters.length}</span> 枚 ＋ 魔法・罠 <span className="mono">8</span> 枚（固定）。気に入らないカードは「引き直す」で交換。
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
              <CardView card={{ ...m, uid: 'edit' + i }} size="sm" />
              <button className="d-reroll jp" onClick={() => rerollCard(i)}>
                引き直す
              </button>
            </div>
          ))}
        </div>
      </main>
    )
  }

  // ===================== playing =====================
  if (!game) return null
  const you = game.sides[0]
  const cpu = game.sides[1]
  const myTurn = game.turn === 0 && game.winner === null && !busy
  const inMain = game.phase === 'main'
  const inBattle = game.phase === 'battle'

  // ---- プレイヤー操作ハンドラ ----
  const onHandClick = (handIndex: number) => {
    if (!myTurn || !inMain) return
    setUi({ kind: 'handMenu', handIndex })
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
    act({ type: 'summon', side: 0, handIndex: ui.handIndex, orientation: ui.orientation, faceDown: ui.faceDown, tributes: ui.chosen })
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
      act({ type: 'attack', side: 0, attackerZone: ui.zone, targetZone: zone })
      setUi({ kind: 'idle' })
      return
    }
    // 攻撃宣言（自分の攻撃表示モンスターを選ぶ）
    if (myTurn && inBattle && side === 0 && slot && slot.orientation === 'attack' && !slot.faceDown && !slot.hasAttacked) {
      setUi({ kind: 'attackFrom', zone })
      return
    }
  }

  const directAttack = () => {
    if (ui.kind !== 'attackFrom') return
    act({ type: 'attack', side: 0, attackerZone: ui.zone, targetZone: null })
    setUi({ kind: 'idle' })
  }

  const endTurn = () => {
    setUi({ kind: 'idle' })
    act({ type: 'endTurn', side: 0 })
  }
  const toBattle = () => {
    setUi({ kind: 'idle' })
    act({ type: 'toBattle', side: 0 })
  }

  const enemyHasMonster = cpu.field.some((f) => f)
  const menuCard = ui.kind === 'handMenu' ? you.hand[ui.handIndex] : null
  const flash = game.flash

  const lpPct = (lp: number) => Math.max(0, Math.min(100, (lp / 8000) * 100))

  return (
    <main className="d-play">
      {/* ===== 相手（CP） ===== */}
      <section className={'d-side cpu' + (game.turn === 1 ? ' active' : '')}>
        <div className="d-side-head">
          <span className="d-side-name jp">CP</span>
          <div className="d-lp">
            <div className="d-lp-bar">
              <span className="d-lp-fill cpu" style={{ width: lpPct(cpu.lp) + '%' }} />
            </div>
            <span className="d-lp-num mono">{cpu.lp}</span>
          </div>
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
            return (
              <div
                className={'d-zone' + (targetable ? ' targetable' : '')}
                key={z}
                onClick={() => onFieldClick(1, z)}
                role={targetable ? 'button' : undefined}
              >
                {slot && (
                  <CardView
                    card={slot.card}
                    faceDown={slot.faceDown}
                    orientation={slot.orientation}
                    atkBuff={slot.atkBuff}
                    season={slot.season}
                    size="sm"
                    compact
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
            {ui.kind === 'idle' && inMain && '手札のカードをタップして召喚／発動'}
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
            return (
              <div
                className={
                  'd-zone' +
                  (tributable || spellTargetable ? ' targetable' : '') +
                  (tributeSel ? ' selected' : '') +
                  (attackReady ? ' ready' : '') +
                  (attacking ? ' attacking' : '')
                }
                key={z}
                onClick={() => onFieldClick(0, z)}
                role={tributable || spellTargetable || attackReady ? 'button' : undefined}
              >
                {slot && (
                  <CardView
                    card={slot.card}
                    faceDown={slot.faceDown}
                    orientation={slot.orientation}
                    atkBuff={slot.atkBuff}
                    season={slot.season}
                    size="sm"
                    compact
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
              {b && <CardView card={b.card} faceDown size="sm" compact />}
            </div>
          ))}
        </div>
        <div className="d-side-head">
          <span className="d-side-name jp">あなた</span>
          <div className="d-lp">
            <div className="d-lp-bar">
              <span className="d-lp-fill you" style={{ width: lpPct(you.lp) + '%' }} />
            </div>
            <span className="d-lp-num mono">{you.lp}</span>
          </div>
          <span className="d-counts jp mono">山{you.deck.length}・墓{you.graveyard.length}</span>
        </div>
      </section>

      {/* ===== 手札 ===== */}
      <section className="d-hand-wrap">
        <div className="d-hand">
          {you.hand.map((c, i) => {
            const playable = myTurn && inMain
            return (
              <CardView
                key={c.uid}
                card={c}
                size="md"
                onClick={playable ? () => onHandClick(i) : undefined}
                disabled={!playable}
                className={'d-hand-card' + (ui.kind === 'handMenu' && ui.handIndex === i ? ' picked' : '')}
              />
            )
          })}
          {you.hand.length === 0 && <span className="d-hand-empty jp">手札なし</span>}
        </div>
      </section>

      {/* ===== 手札アクションメニュー ===== */}
      {ui.kind === 'handMenu' && menuCard && (
        <div className="d-modal-back" onClick={closeMenu}>
          <div className="d-menu" onClick={(e) => e.stopPropagation()}>
            <div className="d-menu-title jp">{menuCard.name}</div>
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
                    <div className="d-menu-note jp">{menuCard.text}</div>
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
          <div className="d-result">
            <h2 className="d-setup-title jp">{game.winner === 0 ? '勝利！' : '敗北…'}</h2>
            <p className="jp d-result-lead">
              {game.winner === 0 ? 'デッキを率いてCPを下した。' : 'CPに敗れた。デッキを組み直して再挑戦。'}
            </p>
            <button className="d-start jp" onClick={startDuel}>
              もう一度
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
