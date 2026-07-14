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
    lead: '出勤服40枚デッキでCPと戦うカードバトル。種族アビリティと季節相性を操り、連勝するほど強くなる相手に挑む。',
  },
  {
    view: 'platform',
    title: 'ランウェイ',
    tag: 'PLATFORMER',
    lead: '出勤服からくり抜いた自分が今日のランウェイ（通勤路）を走るアクション。季節と色で特性が変わる全6ステージ。',
  },
  {
    view: 'tower',
    title: 'タワー',
    tag: 'PHYSICS PUZZLE',
    lead: '出勤服のくり抜きをどこまで高く積めるか。シルエットの凹凸が物理に効く、どうぶつタワーバトル風スコアアタック。',
  },
  {
    view: 'quiz',
    title: '性格診断',
    tag: 'PERSONALITY TEST',
    lead: '8つの質問で16タイプから診断。あなたにぴったりの出勤服が見つかる。あなたのkokiはこれ！',
  },
  {
    view: 'merge',
    title: 'クローゼット・マージ',
    tag: 'MERGE PUZZLE',
    lead: '同じ出勤服をぶつけると、より人気の一着に進化。箱があふれる前にいいね数1位を目指す、スイカゲーム風パズル。',
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
