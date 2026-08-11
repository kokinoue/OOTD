import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

export type Locale = 'ja' | 'en'
type Variables = Record<string, string | number>

const LOCALE_STORAGE_KEY = 'ootd-locale'

const EN: Record<string, string> = {
  // App shell
  '出勤服': 'WORKDAY OUTFITS',
  'ビュー切り替え': 'Switch view',
  '稼働率': 'ROTATION',
  '色': 'COLORS',
  '衣替え': 'SEASONS',
  '今日の服': "TODAY'S FIT",
  'ゲーム': 'GAMES',
  '読み込み中…': 'Loading…',
  'データを保存できませんでした。`pnpm dev` のサーバーで開いているか確認してください':
    'Could not save data. Make sure the app is running on the `pnpm dev` server.',
  'データ元:': 'Source:',
  'note マガジン「出勤服」': 'note magazine “Workday Outfits”',
  '取得': 'retrieved',
  '表示言語': 'Display language',
  '日本語': 'Japanese',
  '英語': 'English',

  // Common controls
  '閉じる': 'Close',
  'もどる': 'Back',
  'ゲームを選ぶ': 'Choose a game',
  'ゲーム選択にもどる': 'Back to games',
  'あそぶ →': 'PLAY →',
  'すべて': 'All',
  'すべて解除': 'Clear all',
  '解除': 'Undo',
  'リセット': 'Reset',
  'キャンセル': 'Cancel',
  'やめる': 'Cancel',
  'もういちど': 'Play again',
  'もう一度': 'Try again',
  'トップへ': 'Back to top',
  '保存中…': 'Saving…',
  '保存に失敗しました': 'Save failed',
  '公開用データに焼き込みました': 'Saved to published data',

  // Fits
  '絞り込み・検索': 'FILTERS & SEARCH',
  '過去の同じ時期（今日の前後3日）に着ていた服を横断':
    'Show outfits worn around this date in previous years (±3 days)',
  '今日この頃': 'AROUND TODAY',
  '月': 'MO',
  'ブランド・アイテム・メモで検索': 'Search brands, items, or notes',
  '並び替え': 'Sort',
  '新しい順': 'Newest',
  '古い順': 'Oldest',
  'スキ順': 'Most liked',
  'アイテム絞り込みを解除': 'Clear item filter',
  'ペア絞り込みを解除': 'Clear pair filter',
  '件': ' results',
  '絞り込んだ中からランダムに1枚開く': 'Open a random outfit from these results',
  'ランダム': 'RANDOM',
  '絞り込んだコーデを時系列で連続再生': 'Play filtered outfits in chronological order',
  'タイムラプス': 'TIMELAPSE',
  '出勤服を3Dタイムラインで辿る': 'Explore the archive on a 3D timeline',
  '条件に合うコーデがありません': 'No outfits match these filters.',

  // Items
  '新しいカテゴリ名（例: jacket）': 'New category name (e.g. jacket)',
  'カテゴリを変更': 'Change category',
  '＋新しいカテゴリ…': '+ New category…',
  '色を補正（自動判定の修正）': 'Correct color (override automatic detection)',
  '色: 自動': 'Color: Auto',
  '色なし': 'No color',
  '名前を変更': 'Rename',
  '別のアイテムに統合': 'Merge into another item',
  '一覧に表示する': 'Show in list',
  '一覧から非表示にする': 'Hide from list',
  '読み込めませんでした。エクスポートしたJSONを指定してください。':
    'Could not import this file. Select a previously exported JSON file.',
  'アイテム・ブランド名で検索': 'Search items or brands',
  '着用回数順': 'Most worn',
  '最近着た順': 'Recently worn',
  '名前順': 'Name',
  '非表示も見る': 'Show hidden',
  '表示の切り替え': 'Switch layout',
  'リスト表示': 'List view',
  'グリッド表示': 'Grid view',
  '色すべて': 'All colors',
  'このアイテムのコーデを見る': 'View outfits with this item',
  '統合済みのアイテム': 'Merged items',
  '回': ' wears',
  '件統合': ' merged',
  '条件に合うアイテムがありません': 'No items match these filters.',
  '編集内容をエクスポート': 'Export edits',
  'インポート': 'Import',
  '名前変更・統合・カテゴリ変更・非表示をすべてリセットします。よろしいですか？':
    'Reset all renames, merges, category changes, and hidden items?',
  'いますぐ保存': 'Save now',
  '保留中の自動保存を待たず、いますぐ overrides.json に書き込む':
    'Write to overrides.json now without waiting for autosave',
  '編集すると自動で overrides.json に保存されます（公開ビルドに反映）':
    'Edits are automatically saved to overrides.json for the published build.',
  '「{label}」を統合する先を選ぶ': 'Choose an item to merge “{label}” into',
  '統合すると、このアイテムの着用コーデは統合先のアイテムとして数えられます（あとで解除できます）。':
    'After merging, outfits using this item count toward the selected item. You can undo this later.',
  '統合先を検索': 'Search merge targets',
  '{label} の最新着用': 'Latest outfit with {label}',
  '色: {label}': 'Color: {label}',
  '白': 'White',
  'ベージュ': 'Beige',
  'グレー': 'Gray',
  '黒': 'Black',
  '茶': 'Brown',
  'ネイビー': 'Navy',
  '青': 'Blue',
  '緑': 'Green',
  '黄': 'Yellow',
  'オレンジ': 'Orange',
  '赤': 'Red',
  'ピンク': 'Pink',
  '紫': 'Purple',
  '髪色': 'Hair color',
  '髪型': 'Hairstyle',
  '帽子': 'Hat',
  '金': 'Blond',
  '白髪': 'Gray',
  '坊主': 'Buzz cut',
  '短髪': 'Short',
  'ミディアム': 'Medium',
  '長髪': 'Long',
  'キャップ': 'Cap',
  'ニット帽': 'Beanie',
  'ハット': 'Hat',

  // Today and weather
  '気温で選ぶ、今日の一着': 'FIND TODAY’S OUTFIT BY TEMPERATURE',
  '気温を合わせると、過去に同じくらいの陽気だった日の出勤服が並びます。':
    'Set the temperature to see outfits worn on similarly mild days in the past.',
  '℃ の日': '°C DAYS',
  '気温': 'Temperature',
  '例年の今日ごろの平均気温に合わせる': 'Use the average temperature around this date',
  '今日の陽気': 'TODAY’S NORM',
  '天気': 'Weather',
  '晴れ': 'Sunny',
  'くもり': 'Cloudy',
  '雨': 'Rain',
  '雪': 'Snow',
  '平均': 'Average',
  '平均 {temp}℃ 前後（±{band}℃）': 'Around {temp}°C (±{band}°C)',
  'の日は': ': ',
  'この陽気の定番アイテム': 'GO-TO ITEMS FOR THIS WEATHER',
  '{label} のコーデを見る': 'View outfits with {label}',
  '条件に合う日が記録にありません。気温や天気を変えてみてください':
    'No recorded days match. Try another temperature or weather condition.',
  '近い順に {shown} 件を表示しています（全 {total} 件）':
    'Showing the {shown} closest matches out of {total}.',
  'データがありません': 'No data available.',
  'コート': 'Coat',
  'アウター': 'Outerwear',
  'ブーツ': 'Boots',
  'ニット': 'Knitwear',
  'スウェット': 'Sweatshirt',
  'フーディー': 'Hoodie',
  'カーディガン': 'Cardigan',
  'ベスト': 'Vest',
  '半袖（Tシャツ）': 'T-shirt',
  'シャツ': 'Shirt',
  'ショーツ': 'Shorts',
  '中心から外へ {from}→{to} 年。点 = 着用日（色は当日の最高気温）':
    'Rings run from {from} to {to}, center to edge. Each dot is a wear date, colored by the day’s high.',
  '※一番外側に着た日のみ（インナー使いは除外）':
    'Only days worn as the outermost layer; inner-layer use is excluded.',
  '{label}を着る気温': 'Temperature for {label}',
  'これを下回ると': 'below this threshold',
  'これを上回ると': 'above this threshold',
  '最高気温が{direction}着用確率50%': 'A high {direction} gives a 50% wear probability.',
  '{count}日': '{count} days',
  '寒い': 'cold',
  '暖かい': 'warm',
  '着た日の平均最高気温（{kind}日中心だが気温との相関はゆるやか）':
    'Average high on days worn (mostly {kind} days; temperature correlation is weak)',
  '着た日の平均': 'Average when worn',
  '着なかった日': 'not worn',
  'シーズンイン': ' SEASON START',
  '解禁まで {days} 日': '{days} days until season start',
  '（平年 {date}）': '(typical date: {date})',
  '{days} 日前に解禁済み': 'Season started {days} days ago',
  'オフシーズン（平年解禁 {date}）': 'Off season (typically starts {date})',
  '直近の最高気温 {temp}℃（{date}）': 'Latest high: {temp}°C ({date})',

  // Timelapse and navigation
  'ゆっくり': 'Slow',
  'ふつう': 'Normal',
  'はやい': 'Fast',
  '一時停止': 'Pause',
  '再生': 'Play',
  '（全{seconds}秒）': '({seconds}s total)',
  '先頭へ戻る': 'Back to top',

  // Color analysis
  '全色': 'All colors',
  '色ありコーデ': 'Outfits with color',
  '主色': 'Top color',
  '定番ペア': 'Top pairing',
  '平均色数': 'Avg. colors',

  // Closet rotation
  'アイテムの並び替え': 'Sort items',
  '90日稼働順': 'Most worn in 90 days',
  '年間稼働密度順': 'Annual wear rate',
  '休眠長い順': 'Longest dormant',
  '基準日': 'As of',
  '180日稼働率': '180-day rotation',
  '基準日から180日以内に1回以上着たアイテムの割合':
    'Share of items worn at least once in the 180 days before the reference date',
  '90日着用数': '90-day wears',
  '基準日から90日以内の着用回数の合計': 'Total wears in the 90 days before the reference date',
  '365日休眠': 'Dormant 365d',
  '最後の着用から365日以上たったアイテム数': 'Items not worn for at least 365 days',
  '{year} 初登場': '{year} debuts',
  '初めて着たのが{year}年のアイテム数': 'Items first worn in {year}',
  '稼働率は基準日（最終記録日 {date}）から180日以内に1回以上着たアイテムの割合です。個体に分けた服はそれぞれ1点として数え、非表示アイテムは母数から除きます。並び替えの「90日稼働」は直近90日の着用回数、「年間稼働密度」は年あたりの着用回数を指します。':
    'Rotation is the share of items worn at least once in the 180 days before the final recorded date ({date}). Split items count separately and hidden items are excluded. “90-day activity” counts recent wears; “annual wear rate” is wears per year.',
  '{active}/{total} 稼働 · 休眠 {dormant} · 90日 {wears}回':
    '{active}/{total} active · {dormant} dormant · {wears} wears in 90d',
  '最近90日に動いたアイテムがありません': 'No items were worn in the last 90 days.',
  '90日 {recent}回 / total {total}回': '{recent} in 90d / {total} total',
  '365日以上休眠中のアイテムはありません': 'No items have been dormant for 365 days.',
  '{days}日休眠 / total {total}回': 'Dormant {days}d / {total} total',
  '{year}年初登場のアイテムはありません': 'No items debuted in {year}.',
  '{date} 初登場 / {count}回': 'Debuted {date} / {count} wears',
  '2回以上一緒に着られたアイテムペアがまだありません。':
    'No item pairs have been worn together at least twice yet.',
  'よく一緒に着られるアイテムのネットワーク': 'Network of items often worn together',
  'アイテム相関ネットワーク': 'Item co-wear network',
  '{label}、{category}、共起強度{strength}。FITSを見る':
    '{label}, {category}, co-wear strength {strength}. View outfits.',
  '{source} と {target} のFITSを見る': 'View outfits with {source} and {target}',

  // Outfit details and editing
  '← 前へ': '← PREVIOUS',
  '次へ →': 'NEXT →',
  'ロック画面用に整形した画像を保存・共有する': 'Save or share an image formatted for a lock screen',
  '画像を生成中…': 'Creating image…',
  'ロック画面用に保存': 'Save for lock screen',
  '共有メニューから「画像を保存」→ 写真アプリで壁紙に設定できます':
    'Choose “Save Image” in the share menu, then set it as wallpaper from Photos.',
  '画像を保存しました。写真アプリから壁紙／ロック画面に設定できます':
    'Image saved. Set it as wallpaper or your lock screen from Photos.',
  '画像を生成できませんでした': 'Could not create the image.',
  'この着用を別の個体に割り当てる': 'Assign this wear to another item variant',
  '← スワイプで前後のコーデ →': '← Swipe between outfits →',
  '前': 'Previous',
  'noteで見る': 'View on note',
  '次': 'Next',
  '似ている出勤服': 'SIMILAR OUTFITS',
  '{date} のコーデを見る': 'View outfit from {date}',
  '髪': 'Hair',
  '手動': 'Manual',
  'AI推定': 'AI estimate',
  '未設定': 'Not set',
  'なし': 'None',
  '保存': 'Save',
  '手動修正を消してAI推定に戻す': 'Remove manual edits and restore the AI estimate',
  'AI推定に戻す': 'Restore AI estimate',
  'この日の着用をどの個体にする？': 'Which item variant was worn today?',
  'アイテム名を変更': 'Rename item',
  'この個体名を変更': 'Rename this variant',
  '未分類': 'Unassigned',
  'この個体（{label}）は {target} に統合されています':
    'This variant ({label}) is merged into {target}.',
  '統合を解除': 'Undo merge',
  'この日の着用は {target} へ付け替え済み': 'This wear has been reassigned to {target}.',
  '元に戻す': 'Restore',
  '別のアイテムへ付け替え直す →': 'Reassign to another item →',
  'この日の着用だけ別のアイテムへ移す →': 'Move only this wear to another item →',
  'この日（{date}）の「{label}」の着用だけを、選んだアイテムへ付け替えます（「元に戻す」でいつでも戻せます）。':
    'Only the “{label}” wear on {date} will move to the selected item. You can restore it at any time.',
  '付け替え先のアイテムを検索': 'Search destination items',
  '新しい個体名（例: 紺フレアデニム）': 'New variant name (e.g. navy flared denim)',
  '＋作成して割当': '+ Create and assign',
  '名前（空で自動に戻す）': 'Name (leave blank to restore automatic name)',
  '取消': 'Cancel',
  '近い季節': 'Similar season',
  '同じアイテム': 'Same item',

  // Game sharing
  'リンクをコピーしました': 'Link copied',
  'コピーできませんでした': 'Could not copy',
  'このゲームのリンクを共有': 'Share this game',
  '共有': 'Share',
  '出勤服アーカイブ': 'Workday Outfit Archive',

  // Matching pairs
  '出勤服 神経衰弱': 'WORKDAY OUTFIT MATCHING PAIRS',
  '場札は {count} 枚の出勤服。2枚めくって、同じアイテム（同じブランドの一着）があれば、その数だけ得点。':
    'The board has {count} outfit cards. Flip two; each shared item from the same brand scores one point.',
  'jacket も pants も同じなら ＋2pt': 'Matching both jacket and pants scores +2pt.',
  '当たっても外れても、ターンは次の人へ交代': 'The turn passes after every pair, match or miss.',
  '一致した2枚は獲得して場から外す': 'Matched cards are claimed and leave play.',
  '場が尽きたら終了 — 合計得点が最大の人が勝ち': 'The highest score when no matches remain wins.',
  'プレイヤー人数': 'Players',
  '人': ' players',
  'ゲーム開始': 'START GAME',
  'クリア！': 'CLEARED!',
  '結果発表': 'RESULTS',
  'プレイヤー{number}': 'Player {number}',
  '{players} の引き分け！': 'Tie: {players}!',
  '{player} の勝ち！': '{player} wins!',
  'の勝ち！': 'wins!',
  'もう一度（{count}人）': 'Play again ({count})',
  '人数を変える': 'Change players',
  'の番': ' turn',
  '残り {count} 枚': '{count} cards left',
  'カードをめくる': 'Flip a card',
  'もう1枚めくる': 'Flip one more',
  'プレイヤー{number} の番 — {selected}/2 枚': 'Player {number} — {selected}/2 cards',
  '{categories} が一致': 'Match: {categories}',
  '一致なし': 'No match',
  'つぎへ →': 'NEXT →',
  '場札': 'Cards',
  '伏せカード': 'Face-down card',
  'ゲームをやめる': 'Quit game',

  // Tower
  '体': ' pcs',
  '自己ベスト更新！': 'NEW PERSONAL BEST!',
  'Xでポスト': 'Post on X',
  'ドラッグで移動 / タップで回転 / はなすと落下':
    'Drag to move / Tap to rotate / Release to drop',
  'つぎ': 'NEXT',
  '次の出勤服': 'Next outfit',
  '出勤服アーカイブの「タワー」で {score}体 積み上げました！{record} #出勤服アーカイブ':
    'I stacked {score} outfits in Workday Outfit Archive “Tower”! {record} #WorkdayOutfitArchive',

  // Personality quiz
  '性格診断 — あなたのkokiはこれ！': 'PERSONALITY TEST — WHICH KOKI ARE YOU?',
  '服・朝の支度・休日の過ごし方など8つの質問に答えると、4文字コード付きの性格タイプと、660着以上の出勤服から選ばれたぴったりの一着がわかります。':
    'Answer eight questions about clothes, mornings, and days off to discover your four-letter personality and a matching look from more than 660 outfits.',
  '質問は全部で {count} 問': '{count} questions',
  '4つの軸から16通りの4文字コードを判定': 'One of 16 four-letter types across four axes',
  '選択肢をタップするとすぐ次の質問へ': 'Tap an answer to move to the next question',
  '同じ回答なら、いつでも同じ結果になります': 'The same answers always produce the same result',
  'はじめる': 'START',
  '前の質問': 'Previous question',
  'あなたのkokiはこれ！': 'THIS IS YOUR KOKI!',
  '結果をシェア': 'SHARE YOUR RESULT',
  'Xでシェア': 'Share on X',
  '画像を作成中…': 'Creating image…',
  '画像でシェア': 'Share image',
  'コピーしました': 'Copied',
  'リンクをコピー': 'Copy link',
  '画像の生成に失敗しました。時間をおいてもう一度お試しください。':
    'Could not create the image. Please try again later.',
  'もう一度診断する': 'Take the quiz again',
  '私のkokiは『{name}（{code}）』でした！': 'My koki type is “{name} ({code})”!',
  'モノトーン': 'Monochrome',
  'カラフル': 'Colorful',
  'カジュアル': 'Casual',
  'きれいめ': 'Formal',
  '定番派': 'Classic',
  '冒険派': 'Adventurous',
  '身軽': 'Minimal',
  'マシマシ': 'Layered',
  '寒がり': 'Runs cold',
  '暑がり': 'Runs warm',
  '朝、家を出る5分前。何をしてる？': 'Five minutes before leaving home—what are you doing?',
  '昨日決めておいた服にそのまま袖を通す': 'Putting on the outfit I chose yesterday',
  'クローゼットの前で最終的に色を決める': 'Making one last color decision at the closet',
  '鏡の前で小物をあれこれ足したり引いたりしている': 'Adding and removing accessories in front of the mirror',
  'まだ布団の中で、あと2分は粘る': 'Still in bed, bargaining for two more minutes',
  '初めて入るコンビニでまず向かうのは？': 'In a convenience store you have never visited, where do you go first?',
  'いつも買う定番のドリンクの棚': 'The shelf with my usual drink',
  '新商品・限定パッケージのコーナー': 'New products and limited-edition packaging',
  'レジ横のホットスナック': 'The hot snacks by the register',
  '会計だけ済ませてすぐ出る': 'Straight to the register and out',
  'クローゼットを開けたときの理想の状態は？': 'What does your ideal closet look like?',
  '白・黒・グレーで統一されている': 'Unified in white, black, and gray',
  '差し色になる一着が必ず目に入る': 'One bold accent piece always catches my eye',
  'ジャケットやシャツがきれいに並んでいる': 'Jackets and shirts are neatly arranged',
  'とにかく着心地優先で畳まれてなくてもいい': 'Comfort first—even if nothing is folded',
  '予定のない休日、気づいたら何をしている？': 'On a day off with no plans, what do you end up doing?',
  '近所の知ってる店だけを回っている': 'Making the rounds of familiar neighborhood shops',
  '前から気になっていた新しい店に足を伸ばす': 'Trying a new place I have been curious about',
  '家で映画を見ながらゴロゴロしている': 'Lounging at home with a movie',
  '小物や雑貨を見に出かけている': 'Browsing accessories and small goods',
  '急な来客・大事な打ち合わせが入った。どうする？': 'A surprise guest or important meeting appears. What do you do?',
  'ジャケットを一枚羽織って引き締める': 'Throw on a jacket to sharpen the look',
  'いつもの服のままで特に変えない': 'Keep my usual outfit as-is',
  'バッグや靴だけさっと変える': 'Quickly switch the bag or shoes',
  '内心そわそわして時間ギリギリまで悩む': 'Quietly panic and deliberate until the last minute',
  'オフィスの空調、正直どう感じることが多い？': 'Honestly, how does the office temperature usually feel?',
  '寒い。ひざ掛けか羽織りものが手放せない': 'Cold—I always need a blanket or extra layer',
  '暑い。すぐ薄着になりたくなる': 'Hot—I want to shed layers immediately',
  '特に気にならない。周りに合わせる': 'I barely notice and adapt to everyone else',
  '暑がりだけど冷房も苦手で毎回ちょうどいい一枚を探している':
    'I run warm but dislike AC, so I am always hunting for the perfect layer',
  '服を買うとき、決め手になるのは？': 'What seals the decision when you buy clothes?',
  '長く着られる定番かどうか': 'Whether it is a timeless piece I can wear for years',
  '今までにない形や色かどうか': 'Whether the shape or color is new to me',
  '着心地と動きやすさ': 'Comfort and freedom of movement',
  '小物やレイヤードでどう遊べるか': 'How I can play with accessories and layers',
  '出かけるときの荷物、気づけばどうなっている？': 'When you go out, what happens to your bag?',
  '財布とスマホだけで身軽に': 'Just a wallet and phone—travel light',
  'あれこれ持って結局パンパンになる': 'I pack everything and it ends up stuffed',
  '色や柄がはっきりしたバッグを選びがち': 'I tend to choose a bag with a bold color or pattern',
  '主張しない無地のバッグに落ち着く': 'I settle on a quiet, solid-color bag',
  '重彩職人koki': 'Maximalist Artisan koki',
  '色も仕立ても重ねて完成させる、攻めの盛装派': 'Bold color, sharp tailoring, and layers in full force',
  '差し色、素材、小物を幾層にも重ねながら、全体は端正に着地させるタイプ。新しい組み合わせを試す大胆さと、着崩れて見せない構成力を併せ持つ。足すほど完成度が上がる、根っからのスタイリスト気質。':
    'You stack accent colors, textures, and accessories while keeping the whole look polished. Fearless experimentation meets a stylist’s instinct for structure—the more you add, the more complete it feels.',
  '彩職人koki': 'Color Artisan koki',
  '色と仕立てを一手で決める、攻めの正装派': 'Bold color and tailoring, resolved in one decisive move',
  '差し色を効かせながらも、要素数は絞ってきちんと感を崩さないタイプ。新しい形や色を試すことを恐れず、一着の強さで装いを完成させる。周りから「今日も決まってるね」と言われがち。':
    'You use a strong accent while keeping the number of elements tight and polished. New shapes and colors do not scare you; one powerful piece is enough to finish the look.',
  '定番重彩koki': 'Classic Layered Color koki',
  '安心できる型に、色と小物を丁寧に重ねる': 'Carefully layering color and detail onto a trusted formula',
  '自分の中で固まった端正な型を土台に、好きな色や小物を少しずつ積み上げるタイプ。冒険はしすぎないが、レイヤードの組み替えで毎日に変化をつくる。準備のよさと遊び心が同居している。':
    'You build on a polished personal formula, adding favorite colors and accessories piece by piece. Rather than chase extremes, you create daily variety by reshuffling thoughtful layers.',
  '定番彩色koki': 'Classic Color koki',
  'カラーはきちんと、でも安心できる型を貫く': 'Bright color within a reliable, polished formula',
  '色使いはカラフルで気分が上がるものを選びつつ、シルエットや組み合わせは自分の中で固まった「勝ちパターン」を持っている。余計なものは足さず、冒険は色だけで十分という堅実な遊び心の持ち主。':
    'You choose uplifting color but rely on silhouettes and combinations you know will work. Nothing extra is needed—the color itself provides exactly enough adventure.',
  '自由積層koki': 'Freeform Layerist koki',
  '色も柄も小物も重ねる、即興アーティスト': 'An improviser stacking color, pattern, and accessories',
  '力の抜けた服をキャンバスに、大胆な色や柄、小物を思うまま重ねるタイプ。ルールよりその日の気分を信じ、丈や素材の違いまで遊びに変える。同じ格好を二度つくらない即興性が魅力。':
    'Relaxed clothes become your canvas for bold colors, patterns, and accessories. You trust the day’s mood over rules and turn differences in length and texture into spontaneous play.',
  '自由配色koki': 'Freeform Colorist koki',
  'ラフな空気に色を効かせる、気分屋アーティスト': 'A mood-led artist bringing color to relaxed looks',
  'かっちりした服よりも身軽で力の抜けた格好が好きで、そこに毎回新しい色や柄を投入してくる。少ない要素で印象を変える気まぐれさがあり、周りを飽きさせない。':
    'You prefer easy, relaxed clothes and introduce a fresh color or pattern each time. With very few elements, you can change the entire impression and keep everyone guessing.',
  '色盛りkoki': 'Color Pile koki',
  'いつものラフさに、好きな色を重ねていく': 'Layering favorite colors over familiar ease',
  '着慣れたカジュアルを土台に、好きな色とレイヤードをたっぷり楽しむタイプ。新奇さを追うより、自分に馴染んだアイテムを重ねて気分を上げる。荷物も装いも、好きなものは多めが落ち着く。':
    'Familiar casual pieces are your base for generous color and layers. You would rather pile on trusted favorites than chase novelty—more of what you love simply feels right.',
  '色好きkoki': 'Color Lover koki',
  'いつもの形に、いつもの好きな色を': 'Your favorite color in a familiar shape',
  'カジュアルで身軽な服を定番として持ちつつ、色選びだけは譲らないこだわり派。奇をてらうことはないが、鮮やかな一色が毎回どこかに効いている。':
    'You keep a light, casual uniform but never compromise on color. Nothing is showy for its own sake, yet one vivid note always makes the outfit yours.',
  '積層求道者koki': 'Layered Seeker koki',
  'モノトーンを幾層にも組み、更新し続ける': 'Continually reinventing monochrome through layers',
  '白黒グレーを軸に、素材、丈、シルエットの差を幾層にも重ねて新しい表現を探す研究肌。色を抑えるぶん構成には妥協せず、重ねる一枚ごとに意味を持たせる。静かに見えて、発想はかなり攻めている。':
    'You explore new expression by layering differences in texture, length, and silhouette over black, white, and gray. Restrained color makes structure matter; every layer has a purpose.',
  '求道者koki': 'Purist Seeker koki',
  '研ぎ澄ましたモノトーンを、更新し続ける': 'Forever refining a sharpened monochrome',
  '白黒グレーを軸にした引き算の美学を持ちながら、一着の素材やシルエットで新しい表現を探し続ける研究肌。要素数は少なくても、着る服の完成度には常に貪欲で妥協を良しとしない。':
    'Your subtractive black-white-gray aesthetic still leaves room for discovery in a single material or silhouette. Few elements, exacting standards, no compromise.',
  '静謐積層koki': 'Quiet Layerist koki',
  '整えたモノトーンを、静かに重ねる': 'Quietly layering a composed monochrome',
  'モノトーンの端正な型を守りながら、ベストやストール、小物を丁寧に重ねるタイプ。目立つ変化より奥行きを好み、いつもの装いを少しずつ整えていく。準備周到で、静かな安定感がある。':
    'You preserve a polished monochrome formula while carefully adding vests, scarves, and accessories. Depth matters more than obvious change, creating calm and considered stability.',
  '静謐派koki': 'Quiet Classic koki',
  '磨き上げた「いつもの正装」を崩さない': 'Never disturbing a carefully perfected uniform',
  'モノトーンできちんと感のある装いを、身軽で確立した型のまま淡々と継続するタイプ。飾らないが隙もない、静かな安定感が最大の武器。周囲からの信頼も厚い。':
    'You steadily maintain a light, established monochrome uniform. Unadorned but impeccable, your quiet consistency is your greatest strength.',
  '脱力積層koki': 'Relaxed Layerist koki',
  'ラフなモノトーンに、発見を重ねる': 'Layering new discoveries over relaxed monochrome',
  'ラフなモノトーンをキャンバスに、丈の差や素材感、小物の組み合わせを次々と試すタイプ。気負いはないのに仕掛けは多く、重ねるほど個性が現れる。見る人が見ればわかる実験精神の持ち主。':
    'Relaxed monochrome is your canvas for experiments in length, texture, and accessories. The look feels effortless, but insiders notice how much invention is layered within it.',
  '脱力実験koki': 'Relaxed Experimentalist koki',
  '身軽なモノトーンに、毎回新しい発見を': 'A new discovery in every light monochrome look',
  '力の抜けた身軽な格好を好みつつ、素材感や主役アイテムでは常に新しいものを試したがる。飾らない中に潜む一手を、見る人が見ればわかるタイプ。':
    'You like easy, lightweight clothes but keep testing a new texture or statement piece. The decisive move hides inside an otherwise unadorned look.',
  '快適重ねkoki': 'Comfort Layer koki',
  '着心地のいい定番を、安心できるだけ重ねる': 'Layering comfortable staples until everything feels right',
  'モノトーンの着慣れた服を重ね、気温差や予定の変化にも備えておきたい安定志向。おしゃれのために無理はしないが、羽織りものや小物があると落ち着く。快適さを積み上げるのが得意。':
    'You layer familiar monochrome pieces to stay ready for temperature shifts and changing plans. Fashion should never hurt; an extra layer or accessory brings reassuring comfort.',
  '省エネkoki': 'Low-Energy koki',
  '着心地と定番、それさえあれば十分': 'Comfort and reliable staples are all you need',
  'モノトーンでラフ、そして毎回似た組み合わせに落ち着く安定志向。派手さより快適さを選び、朝の意思決定コストを極限まで減らすことに長けている。何を着るか迷わないのが最大の強み。':
    'You settle into relaxed monochrome combinations that reliably work. Comfort beats spectacle, and you have mastered the art of reducing morning decisions to almost zero.',

  // Runway platformer
  '春': 'Spring',
  '夏': 'Summer',
  '秋': 'Autumn',
  '冬': 'Winter',
  '操作キャラにする出勤服を選んでください。季節と色で特性が変わります（全{count}着）。':
    'Choose an outfit character. Season and color change its abilities ({count} total).',
  'おまかせ': 'Random',
  'べつの服にする →': 'Choose another outfit →',
  '未クリア': 'Not cleared',
  '★ コイン {coins}/{total} · タイム {time} · ミス {miss}':
    '★ COINS {coins}/{total} · TIME {time} · MISSES {miss}',
  '←→ 移動 / Z・スペース ジャンプ（空中でもう1回） / X ダッシュ / R やりなおし / ESC ステージ選択':
    '←→ MOVE / Z or SPACE JUMP (again in air) / X DASH / R RETRY / ESC STAGES',
  'コイン': 'COINS',
  'ミス': 'MISSES',
  'タイム': 'TIME',
  'サウンドをオン': 'Turn sound on',
  'サウンドをオフ': 'Turn sound off',
  '音 OFF': 'SOUND OFF',
  '音 ON': 'SOUND ON',
  '全画面（スマホは横向き固定）': 'Fullscreen (landscape on mobile)',
  '全画面切り替え': 'Toggle fullscreen',
  'コイン {coins}/{total} · タイム {time} · ミス {miss}':
    'COINS {coins}/{total} · TIME {time} · MISSES {miss}',
  '次のステージ →': 'NEXT STAGE →',
  'ステージ選択': 'Choose stage',
  '←→で移動、Z/スペースでジャンプ（空中でもう1回とべる）':
    'Move with ←→. Jump with Z/Space, then jump once more in the air.',
  'トゲに触れるとスタートに戻る。とったコインは消えない':
    'Spikes send you back to the start. Collected coins stay collected.',
  'バネで大ジャンプ！ 上のコインもとれる': 'Hit springs for a huge jump and grab coins above.',
  '氷はすべる！ 冬服（と茶・青の服）はすべらない':
    'Ice is slippery. Winter outfits—and brown or blue ones—keep their grip.',
  'ベルトは流れに注意！ Xダッシュで勢いをのせろ':
    'Watch the conveyor direction. Use X dash to build momentum.',
  '敵は上から踏めば倒せる。踏むと空中ジャンプも回復！':
    'Stomp enemies from above to defeat them and recover your air jump.',
  '春風の跳躍': 'Spring Breeze Leap',
  'ジャンプが高い': 'Higher jump',
  '真夏の疾走': 'Midsummer Sprint',
  '走りが速い': 'Faster run',
  '落ち葉の滑空': 'Falling Leaf Glide',
  '落下がゆっくり': 'Slower fall',
  '冬の踏ん張り': 'Winter Grip',
  '氷ですべらない': 'No slipping on ice',
  '白の調和': 'White Balance',
  '走りとジャンプが少し上がる': 'Slightly faster run and higher jump',
  '砂色の引力': 'Sand Magnetism',
  'コインを引き寄せる': 'Attracts coins',
  '霧の身軽さ': 'Mist Agility',
  '空中で動きやすい': 'More air control',
  '漆黒のダッシュ': 'Jet-Black Dash',
  'ダッシュが強い': 'Stronger dash',
  '大地の足裏': 'Earthbound Soles',
  '深海の推進': 'Deep-Sea Drive',
  'ダッシュと走りが少し上がる': 'Slightly stronger dash and faster run',
  '青の冷静': 'Blue Composure',
  '若葉のバネ': 'Fresh-Leaf Spring',
  'ジャンプが少し高い': 'Slightly higher jump',
  '金運の磁力': 'Golden Magnetism',
  'コインを強く引き寄せる': 'Strongly attracts coins',
  '陽気な加速': 'Sunny Acceleration',
  '走りが少し速い': 'Slightly faster run',
  '情熱の初速': 'Passionate Launch',
  'ダッシュが強め': 'Moderately stronger dash',
  '花吹雪': 'Petal Storm',
  'ジャンプと走りが少し上がる': 'Slightly higher jump and faster run',
  '宵闇の羽': 'Twilight Wing',
  '空中ジャンプがもう1回増える': 'One additional air jump',

  // Bike commute
  '住宅街': 'Residential',
  '商店街': 'Shopping street',
  '工事現場': 'Roadworks',
  '駅前': 'Station',
  '公園通り': 'Park avenue',
  '強風': 'Strong wind',
  '霧': 'Fog',
  '安定': 'Stable',
  '強スリップ': 'Low grip',
  '風に流される': 'Wind drift',
  '濃霧': 'Dense fog',
  '早朝': 'Early morning',
  '出勤ラッシュ': 'Morning rush',
  '午前': 'Morning',
  'ランチ・COIN×2': 'Lunch · COIN×2',
  '午後': 'Afternoon',
  '帰宅ラッシュ': 'Evening rush',
  '夜間': 'Night',
  '🏬 連続屋根渡り': '🏬 Rooftop run',
  '🚇 ロング地下道': '🚇 Long underpass',
  '🌳 公園パルクール': '🌳 Park parkour',
  '地下道・天候無効': 'Underpass · weather blocked',
  '追い風・大加速': 'Tailwind · big boost',
  '向かい風・大減速': 'Headwind · heavy slowdown',
  '{from}→{to}・変化中': '{from}→{to} · changing',
  'この先 {icon} {zone} {meters}m': 'Ahead: {icon} {zone} in {meters}m',
  '着替え': 'Change outfit',
  'チャリ通のゲーム画面': 'Bike Commute game screen',
  '現在の地域と天候': 'Current area and weather',
  '現在の服効果': 'Current outfit effects',
  '服効果': 'OUTFIT EFFECTS',
  '着替える': 'Change outfit',
  '通勤終了': 'COMMUTE OVER',
  '画面タップでジャンプ（長押し・空中でもう1回）':
    'Tap to jump (hold, then tap once more in the air)',
  'Space / Z / ↑ ジャンプ · C 着替え · R やりなおし · ESC もどる':
    'SPACE / Z / ↑ JUMP · C CHANGE OUTFIT · R RETRY · ESC BACK',
  '出勤服アーカイブの「チャリ通」で {meters}m 走りました！ SCORE {score}{record} #出勤服アーカイブ':
    'I rode {meters}m in Workday Outfit Archive “Bike Commute”! SCORE {score} {record} #WorkdayOutfitArchive',
  '標準': 'Standard',
  'コイン吸引': 'Coin magnet',
  '霧視界+': 'Fog visibility+',
  '悪天候耐性': 'Bad-weather resistance',
  'コンボ猶予+0.5秒': 'Combo window +0.5s',
  '雨でも安定': 'Stable in rain',
  'ジャンプ強化': 'Jump boost',
  '強風耐性': 'Wind resistance',
  'バランス型': 'Balanced',
  '↑ 地上 SAFE': '↑ STREET SAFE',
  '↓ 地下 COIN / RISK': '↓ UNDERPASS COIN / RISK',

  // Outfit duel
  'レベル{level}': 'Level {level}',
  '魔法': 'Spell',
  '罠': 'Trap',
  '{season}属性': '{season} attribute',
  '戦衣族': 'Warwear',
  '織衣族': 'Woven',
  '脚装族': 'Leggear',
  '踏破族': 'Trailblazer',
  '装具族': 'Accessory',
  '貫通': 'Pierce',
  '守備表示モンスターを戦闘で破壊したとき、守備力との差分を相手ライフに与える。':
    'When this destroys a defense-position monster, deal the ATK–DEF difference as damage.',
  '連携': 'Formation',
  '自分フィールドに他の表側の織衣族がいるとき、攻撃力+300。':
    'Gains 300 ATK while another face-up Woven monster is on your field.',
  '疾走': 'Sprint',
  'ダイレクトアタックのダメージ+300。': 'Direct attacks deal 300 extra damage.',
  '重装': 'Bulwark',
  '守備表示モンスターへの攻撃で跳ね返りダメージを受けない。':
    'Takes no recoil damage when attacking a defense-position monster.',
  '道連れ': 'Revenge',
  '戦闘で破壊されたとき、相手ライフに300ダメージ。':
    'When destroyed in battle, deal 300 damage to the opponent.',
  'ご褒美コーデ': 'Reward Outfit',
  '自分フィールドのモンスター1体の攻撃力を800上げる（永続）。':
    'One monster you control gains 800 ATK permanently.',
  'クローゼット整理': 'Closet Clear-out',
  'デッキから2枚ドローする。': 'Draw two cards.',
  '重ね着': 'Layering',
  '自分フィールドのモンスター1体の属性を、選んだ季節に変更する。':
    'Change one monster you control to the selected season attribute.',
  '大掃除': 'Deep Clean',
  '相手の伏せカードをすべて破壊する。': 'Destroy all opponent face-down cards.',
  'ゲリラ豪雨': 'Cloudburst',
  '相手の攻撃モンスター1体を破壊する。その攻撃は無効になる。':
    'Destroy one attacking opponent monster and negate its attack.',
  'サイズ違い': 'Wrong Size',
  '攻撃モンスターの攻撃力を、この戦闘の間だけ半分にする。':
    'Halve the attacking monster’s ATK for this battle.',
  'タグ付き返品': 'Return With Tags',
  '攻撃モンスターを持ち主の手札に戻す。その攻撃は無効になる。':
    'Return the attacking monster to its owner’s hand and negate the attack.',
  '虫食い': 'Moth Damage',
  '攻撃モンスターの攻撃力を永続で500下げる。攻撃はそのまま続行される。':
    'The attacking monster permanently loses 500 ATK; the attack continues.',
  '出勤服デュエル': 'WORKDAY OUTFIT DUEL',
  '出勤服1着が1体のモンスター。スキ数の人気順でレベル（★）と攻撃力、着用回数＝守備力、季節＝属性。40枚デッキを引き合い、ライフ 8000 を先に削りきったほうが勝ち。':
    'Each outfit becomes a monster. Likes determine level and attack, wears become defense, and season becomes attribute. Draw from 40-card decks and reduce the opponent’s 8000 life to zero.',
  '毎ターン1ドロー → 召喚 → バトル（先攻1ターン目はドロー・バトルなし）':
    'Each turn: draw → summon → battle (the first player skips draw and battle on turn one)',
  'レベル5・6は1体、7・8は2体をリリースして召喚（アドバンス召喚）':
    'Release one monster for levels 5–6 or two for levels 7–8 (advance summon)',
  '攻撃表示は殴り合い、守備表示は守り。表示形式は1ターン1回変更できる':
    'Attack position fights; defense position guards. Change position once per turn.',
  '季節は巡る — 春→夏→秋→冬→春 の向きに相性○（攻撃力 +500）':
    'Seasons cycle Spring→Summer→Autumn→Winter→Spring; advantage grants +500 ATK.',
  '種族ごとに固有アビリティ — 戦衣【貫通】・織衣【連携】・脚装【疾走】・踏破【重装】・装具【道連れ】':
    'Each class has an ability: Warwear [Pierce], Woven [Formation], Leggear [Sprint], Trailblazer [Bulwark], Accessory [Revenge].',
  '魔法・罠も{count}枚（ご褒美コーデ／大掃除／ゲリラ豪雨／虫食い ほか）':
    '{count} spell and trap cards are included.',
  'あなたのデッキ {count} 枚': 'YOUR DECK · {count} CARDS',
  '平均ATK {atk} ・ 大型 {large} ・ 魔法罠 {effects}':
    'AVG ATK {atk} · HIGH LEVEL {large} · SPELL/TRAP {effects}',
  '通算 {wins}勝{losses}敗 ・ 最高連勝 {best}':
    'RECORD {wins}W–{losses}L · BEST STREAK {best}',
  '連勝中 {streak} — 相手が強化されている': 'WIN STREAK {streak} — OPPONENT POWERED UP',
  '決闘開始': 'START DUEL',
  'デッキを見る・編集': 'View / edit deck',
  'おまかせで引き直す': 'Reroll deck',
  'デッキ編集': 'DECK EDITOR',
  'モンスター {monsters} 枚 ＋ 魔法・罠 {effects} 枚（固定）。気に入らないカードは「引き直す」で交換。':
    '{monsters} monsters + {effects} fixed spell/trap cards. Reroll any monster you want to replace.',
  '全部おまかせ': 'Reroll all',
  'この40枚で対戦': 'Duel with these 40',
  '戻る': 'Back',
  '引き直す': 'Reroll',
  'アドバンス召喚！': 'ADVANCE SUMMON!',
  'CPのアドバンス召喚': 'CPU ADVANCE SUMMON',
  '強化Lv{level}': 'BOOST Lv{level}',
  '手{hand}・山{deck}・墓{grave}': 'HAND {hand} · DECK {deck} · GY {grave}',
  '山{deck}・墓{grave}': 'DECK {deck} · GY {grave}',
  'あなたのターン': 'YOUR TURN',
  'CPのターン': 'CPU TURN',
  'バトル！': 'BATTLE!',
  'メインフェイズ': 'MAIN PHASE',
  'バトルフェイズ': 'BATTLE PHASE',
  '連勝{streak}': 'STREAK {streak}',
  'CPが思考中…': 'CPU thinking…',
  'あなたの勝ち！': 'YOU WIN!',
  'CPの勝ち…': 'CPU WINS…',
  'がダイレクトアタック': ' makes a direct attack',
  'の攻撃は': '’s attack was ',
  '防がれた': 'blocked',
  '相性○': 'ADVANTAGE',
  '相性×': 'DISADVANTAGE',
  '{target} に {damage} ダメージ': '{damage} damage to {target}',
  'あなた': 'You',
  '破壊！': 'DESTROYED!',
  '守備に阻まれた': 'BLOCKED BY DEFENSE',
  'リリースするモンスターを {chosen}/{need} 体えらぶ': 'Choose releases: {chosen}/{need}',
  '対象の自分モンスターをえらぶ': 'Choose one of your monsters',
  '変更する季節をえらぶ': 'Choose a new season',
  '攻撃する相手をえらぶ': 'Choose an attack target',
  'ダイレクトアタックできる': 'Direct attack available',
  '手札をタップして召喚／発動。場のカードはタップで詳細':
    'Tap a hand card to summon/activate. Tap a field card for details.',
  '自分の攻撃表示モンスターをタップ': 'Tap one of your attack-position monsters',
  '行動をえらぶ': 'Choose an action',
  'ダイレクトアタック！': 'DIRECT ATTACK!',
  '攻撃やめる': 'Cancel attack',
  'バトルへ': 'To battle',
  'AIが次の一手を代わりに実行': 'Let the AI make your next move',
  'おまかせ行動': 'Auto move',
  'ターン終了': 'End turn',
  '攻撃済': 'Attacked',
  '手札なし': 'No cards in hand',
  'レベル{level}：{need}体リリースが必要': 'Level {level}: release {need}',
  '攻撃表示で召喚': 'Summon in attack position',
  '裏側守備でセット': 'Set face-down in defense',
  'このターンは召喚済み': 'Already summoned this turn',
  '場・リリースが足りない': 'Not enough field space or releases',
  '発動（2枚ドロー）': 'Activate (draw 2)',
  '発動（伏せ{count}枚を破壊）': 'Activate (destroy {count} set cards)',
  '相手の伏せカードがない': 'Opponent has no set cards',
  '発動（自分モンスターを対象）': 'Activate (target your monster)',
  '対象モンスターがいない': 'No valid target',
  '裏側にセット': 'Set face-down',
  '伏せるゾーンがない': 'No open spell/trap zone',
  'リリース': 'RELEASE',
  'この生贄で召喚': 'Summon with these releases',
  '重ね着 — 属性を変える': 'LAYERING — CHANGE ATTRIBUTE',
  'ログ': 'LOG',
  '勝利！': 'VICTORY!',
  '敗北…': 'DEFEAT…',
  '{streak}連勝中！ 次の相手はさらに強い。': '{streak}-win streak! The next opponent is stronger.',
  'デッキを率いてCPを下した。次の相手は少し強くなる。':
    'You led your deck past the CPU. The next opponent will be a little stronger.',
  'CPに敗れ、連勝が途切れた。デッキを組み直して再挑戦。':
    'The CPU ended your streak. Rebuild and try again.',
  'ターン {turn}': 'Turns {turn}',
  '与ダメ {damage}': 'Damage dealt {damage}',
  '残LP {lp}': 'LP left {lp}',
  '最高連勝 {best}': 'Best streak {best}',
  '次の相手へ（連勝{streak}）': 'Next opponent (streak {streak})',
  'リベンジ': 'Rematch',
  '返り討ち！': 'COUNTERED!',
  '相打ち！': 'DOUBLE KO!',
  '罠「{trap}」発動！': 'TRAP “{trap}” ACTIVATED!',
  '罠発動': 'TRAP ACTIVATED',
  '直接攻撃': 'DIRECT ATTACK',
  '{date} 着用 ・ スキ {likes}': 'Worn {date} · {likes} likes',
  '現在:': 'Current:',
  'ATK補正': 'ATK bonus',
  '裏側守備': 'Face-down defense',
  '攻撃表示': 'Attack position',
  '守備表示': 'Defense position',
  '反転して攻撃表示に': 'Flip to attack position',
  '守備表示に変更': 'Change to defense position',
  '攻撃表示に変更': 'Change to attack position',
  'とじる': 'Close',

  // Orbit
  '3Dタイムラインを閉じる': 'Close 3D timeline',
  '出勤服の軌道': 'THE ORBIT OF WORKDAY OUTFITS',
  'スクロール、ドラッグ、上下キーで時間を移動。ひとつの定点から生まれた毎日の装いを、2022年から現在まで辿れます。':
    'Move through time with the mouse wheel, a drag, or the arrow keys. Trace daily looks from one fixed viewpoint, from 2022 to today.',
  '上下スワイプで2022年から現在まで移動。': 'Swipe vertically to travel from 2022 to today.',
  '軌道の表示方法': 'Orbit view options',
  '表示レイアウト': 'View layout',
  '時間': 'Time',
  '色別': 'By color',
  'カラーパレット': 'Color palette',
  'この環境では3D表示を利用できないため、1日ずつ表示しています。':
    '3D is not available in this browser, so outfits are shown one day at a time.',
  '年へ移動': 'Jump to year',
  '{label}の着用軌跡を表示': 'Show wear history for {label}',
  '過去へ': 'Previous',
  '← 過去へ': '← PREVIOUS',
  '詳細を見る': 'View details',
  '詳細': 'Details',
  '現在へ': 'Next',
  '現在へ →': 'NEXT →',
  '出勤服の日付を移動': 'Move through outfit dates',
  '出勤服の3Dタイムライン。上下キー、マウスホイール、ドラッグで年代を移動できます':
    '3D outfit timeline. Move through the years with the arrow keys, mouse wheel, or dragging.',
  '出勤服の軌道。上下キー、マウスホイール、ドラッグで年代を移動できます':
    'Outfit orbit. Move through the years with the arrow keys, mouse wheel, or dragging.',

  // Game hub
  '神経衰弱': 'MATCHING PAIRS',
  'デュエル': 'DUEL',
  'ランウェイ': 'RUNWAY',
  'タワー': 'TOWER',
  'チャリ通': 'BIKE COMMUTE',
  '性格診断': 'PERSONALITY TEST',
  '出勤服であそぶ。遊びたいゲームを選んでください。':
    'Play with the workday outfit archive. Choose a game.',
  '場札の出勤服を2枚めくって、同じアイテム（同じブランドの一着）を当てる。1〜4人で対戦。':
    'Flip two outfit cards and find a shared item from the same brand. Play with 1–4 players.',
  '出勤服40枚デッキでCPと戦うカードバトル。種族アビリティと季節相性を操り、連勝するほど強くなる相手に挑む。':
    'Battle the CPU with a 40-card outfit deck. Master class abilities and seasonal matchups as each win makes your rival stronger.',
  '出勤服からくり抜いた自分が今日のランウェイ（通勤路）を走るアクション。季節と色で特性が変わる全6ステージ。':
    'Run down today’s runway—your commute—as a cutout outfit character. Seasons and colors change your abilities across six stages.',
  '出勤服のくり抜きをどこまで高く積めるか。シルエットの凹凸が物理に効く、どうぶつタワーバトル風スコアアタック。':
    'Stack outfit cutouts as high as you can. Every silhouette affects the physics in this score attack.',
  '朝の通勤路を自転車でどこまでも走る。ジャンプと二段ジャンプで穴や工事現場をかわす、チャリ走風スコアアタック。':
    'Bike endlessly along the morning commute. Jump and double-jump over gaps and roadworks in this score attack.',
  '8つの質問で16タイプから診断。あなたにぴったりの出勤服が見つかる。あなたのkokiはこれ！':
    'Answer eight questions to discover one of 16 personalities—and the workday outfit that fits you best.',
}

const interpolate = (message: string, variables: Variables = {}) =>
  message.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(variables, key) ? String(variables[key]) : match,
  )

const translateDynamicEnglish = (message: string) => {
  let match = message.match(/^同じ(.+)$/)
  if (match) return `Same ${match[1]}`
  match = message.match(/^(.+)あり$/)
  if (match) return `Includes ${match[1]}`
  match = message.match(/^(\d+)℃台$/)
  if (match) return `Around ${match[1]}°C`
  match = message.match(/^(髪色|髪型|帽子): (.+)$/)
  if (match) return `${EN[match[1]] ?? match[1]}: ${EN[match[2]] ?? match[2]}`
  return message
}

export const translate = (locale: Locale, message: string, variables?: Variables) =>
  interpolate(locale === 'en' ? (EN[message] ?? translateDynamicEnglish(message)) : message, variables)

export const detectLocale = (stored: string | null, languages: readonly string[]): Locale => {
  if (stored === 'ja' || stored === 'en') return stored
  return languages.some((language) => language.toLowerCase().startsWith('ja')) ? 'ja' : 'en'
}

const initialLocale = (): Locale => {
  if (typeof window === 'undefined') return 'ja'
  try {
    return detectLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY), navigator.languages)
  } catch {
    return detectLocale(null, navigator.languages)
  }
}

type I18nValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (message: string, variables?: Variables) => string
}

const I18nContext = createContext<I18nValue | null>(null)

const PAGE_META: Record<Locale, { title: string; description: string }> = {
  ja: {
    title: '出勤服アーカイブ — koki inoue の毎日のコーデ',
    description:
      'note マガジン「出勤服」から作った、4年分・600日超の毎日のコーディネート記録。コーデ一覧、アイテム別、衣替え前線、タイムラプスで振り返る。',
  },
  en: {
    title: 'Workday Outfit Archive — Daily looks by koki inoue',
    description:
      'More than 600 daily outfits across four years, with outfit and item views, seasonal insights, and timelapse playback.',
  },
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next)
    } catch {
      // The in-memory choice still works when storage is unavailable.
    }
  }, [])

  useEffect(() => {
    const meta = PAGE_META[locale]
    document.documentElement.lang = locale
    document.title = meta.title
    document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description)
  }, [locale])

  const t = useCallback(
    (message: string, variables?: Variables) => translate(locale, message, variables),
    [locale],
  )
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside I18nProvider')
  return value
}
