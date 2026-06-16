import type { View } from '../App'

// 「ゲーム」タブの着地ページ。ここで神経衰弱／デュエルを選んでから各ゲームへ遷移する。
type Props = {
  onSelect: (view: View) => void
}

const GAMES: { view: View; title: string; tag: string; lead: string }[] = [
  {
    view: 'memory',
    title: '神経衰弱',
    tag: 'CONCENTRATION',
    lead: '場札の出勤服を2枚めくって、同じアイテム（同じブランドの一着）を当てる。1〜4人で対戦。',
  },
  {
    view: 'duel',
    title: 'デュエル',
    tag: 'CARD BATTLE',
    lead: '出勤服40枚デッキでCPと戦うカードバトル。スキ数＝攻撃力、着用回数＝守備力、季節＝属性。',
  },
]

export default function GameHubView({ onSelect }: Props) {
  return (
    <main className="game-hub">
      <div className="game-hub-inner">
        <h2 className="game-hub-title jp">ゲーム</h2>
        <p className="game-hub-sub jp">出勤服であそぶ。遊びたいゲームを選んでください。</p>
        <div className="game-hub-grid">
          {GAMES.map((g) => (
            <button key={g.view} className="game-hub-card" onClick={() => onSelect(g.view)}>
              <span className="game-hub-tag mono">{g.tag}</span>
              <span className="game-hub-name jp">{g.title}</span>
              <span className="game-hub-lead jp">{g.lead}</span>
              <span className="game-hub-go jp">あそぶ →</span>
            </button>
          ))}
        </div>
      </div>
    </main>
  )
}
