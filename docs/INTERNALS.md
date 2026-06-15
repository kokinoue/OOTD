# INTERNALS — データ生成とキュレーションの詳細

[README](../README.md) の補足。スクレイピング・名寄せ・個体分割・衣替えの内部仕様と各スクリプトの使い方。

## できること（UI機能の対応表）

| 機能 | 場所 |
|---|---|
| コーデ一覧（写真グリッド） | FITS タブ |
| 日時で絞る | 年チップ → 月チップ、または日付範囲指定 |
| アイテムごとのコーデ | アイテム名・チップをクリック |
| 髪で絞る | FITS タブの髪フィルタ行（髪色 / 髪型 / 帽子のチップ） |
| フリーワード検索 | ブランド名・キャプション・メモを横断 |
| コーデ詳細 | カードクリック（←/→ キーで前後移動） |
| アイテム管理 | ITEMS タブ：名前変更 ✎ / カテゴリ変更 / 統合 ⇒ / 非表示 − |
| タイムラプス再生 | FITS タブの「▶ タイムラプス」。絞り込み結果をそのまま再生。Space=再生/停止、←→=コマ送り |
| 衣替え前線 | 衣替えタブ |

## スクレイピング

```sh
pnpm scrape                    # note記事の取得 + 気温更新（fetch-weather も連鎖）
node scripts/scrape.mjs --force   # 本文パースをやり直す
```

- note の公開APIからマガジン全記事を取得し `src/data/*.json` を再生成
- 取得済み記事は `.cache/notes/` にキャッシュ。2回目以降は新着分だけ（数十秒）
- 末尾で `splits.json` の整合性（個体割当の参照切れ）も自動チェック
- アイテムは記事中の figcaption（`shirt: ensou, pants: 80's, ...`）をパースして抽出

## 名寄せルール（スクレイパー側で自動適用）

アイテムIDは `カテゴリ|正規化ラベル` で決まり、以下のゆれを同一アイテムに名寄せする:

- 大文字小文字・スペース・記号（`J.M.WESTON` = `J.M. WESTON`、`Crockett&Jones` = `CROCKETT & JONES`）
- ダイアクリティカル（`WILDFRÄULEIN` = `wildfraulein`、`Hermès` = `Hermes`）。仮名の濁点は保持
- アポストロフィ類・×/x（`Le Yucca's` = `Le Yuccaʼs`、`adidas × noah` = `Noah x Adidas`）
- 年代表記（`1950's` = `50's`）
- 末尾のシーズン表記（`Call 22aw` → `Call`、`sacai 12ss` → `sacai`）。元の表記はコーデ詳細のキャプションで確認できる
- 既知のタイポ（`J.M.WESTOM`→`J.M.WESTON` 等。`scripts/scrape.mjs` の `LABEL_ALIASES` に追記で拡張可）
- カテゴリの表記ゆれ（`jacket1`→`jacket`、`shirts`→`shirt` 等）も正規化

キャプションのカンマ抜け（`cap: IDEA jacket: Yohji...`）・ピリオド区切り・セミコロン・カテゴリ重複（`shoes: shoes: ...`）も自動で区切り直す。

これでも残る曖昧なペア（`boutique` と `boutique aoyama` 等）は ITEMS タブの統合機能（⇒）で手動マージする。表示名は最頻出の表記が自動で選ばれる。

## 個体分割（画像判定）

同じラベルでも別の服（例: `pants: Maison Martin Margiela` の中の紺フレア／グレーワイド）を `src/data/splits.json` でサブアイテムに分割している。ITEMS タブでは `Maison Martin Margiela · 紺フレアデニム` のように表示され、個体単位でコーデを絞れる。割当がない着用は `· 未分類` に残る（バッグ等、写真で判別できなかったもの）。

### スクリプトでの一括判定

```sh
node scripts/contact-sheet.mjs "pants|maisonmartinmargiela"   # 部位クロップの一覧画像を生成
node scripts/contact-sheet.mjs --min-count 12                 # 対象アイテム一括生成
node scripts/apply-splits.mjs                                  # decisions.json → splits.json
```

1. コンタクトシート（`.cache/sheets/*.png`）を見て個体を判定する（Claudeに「◯◯を分けて」と頼む）
2. 判定は `.cache/sheets/decisions.json` に書く（`nos` はコーデの#番号、`rest` で残り一括割当）
3. `apply-splits.mjs` で `src/data/splits.json` に展開（#番号→記事キーの変換・重複検証つき）

`apply-splits.mjs` は splits.json を丸ごと上書きするので、**UIで修正したあとは基本使わない**こと。

### 割当の修正（UIでできる）

- **割り当て変更**: コーデ詳細を開き、アイテムチップ横の **⇄** をクリック → 既存の個体を選ぶ／「＋作成して割当」で新しい個体を作る／未分類に戻す。変更は `pnpm dev` のサーバー経由で `src/data/splits.json` に即保存される
- **名称の書き換え**: ITEMS タブの ✎。個体（`ブランド · 個体名`）にもそのまま効く
- 統合・カテゴリ変更・非表示も ITEMS タブの既存機能が個体に対して使える
- `pnpm scrape` 後の新着コーデは未割当として入る。コーデ詳細の ⇄ で割り当てる

## 髪タグ（画像AIによる分類）

各コーデ写真を画像認識AI（Anthropic）に渡し、**髪色・髪型・帽子**を推定して `src/data/hair.json` に持つ。FITS タブの髪フィルタ行（データがある軸だけ表示）で絞り込める。

```sh
ANTHROPIC_API_KEY=sk-... pnpm hair                 # 未分類のコーデを一括分類
ANTHROPIC_API_KEY=sk-... pnpm hair -- --limit 5    # 試運転（5件だけ）
ANTHROPIC_API_KEY=sk-... pnpm hair -- --force      # 既存分も全部やり直す
```

- 各軸は決め打ちの語彙（髪色: 黒/茶/明るめ/白髪まじり、帽子: キャップ/ニット帽/ハット 等）から選ばせ、チップ数を安定させる。帽子で隠れて不明な軸・帽子なしは保存時に「未設定」に畳む
- 増分実行: `hair.auto` に未登録のコーデだけ処理（`pnpm scrape` の新着分はここで追加分類）。並列・途中保存つき
- **手動修正**: コーデ詳細を開くと髪タグ（AI推定 or 手動）が出る。`pnpm dev` では各軸を直接編集して保存でき、`hair.manual` に入って AI 推定より優先される（「AI推定に戻す」で手動分を消せる）
- データの持ち方: `{ "version": 1, "auto": { outfitKey: {color,style,hat} }, "manual": { ... } }`。スクリプトは `auto` だけ、UI は `manual` だけを書くので互いを上書きしない

## 衣替え前線（気温 × 着用記録）

東京の過去気温（Open-Meteo、2022/3〜現在の日次）と着用記録を突き合わせ、季節性のあるアイテムの「私的な気温閾値」「衣替え前線」「解禁予報」を出す。

```sh
pnpm weather    # 気温データだけ更新（pnpm scrape にも含まれる）
```

- **私的気温閾値**: カテゴリごとに、その日の最高気温で着用有無をロジスティック回帰し「着用確率50%＝◯℃」を算出。`cold`系（コート＝寒いと着る）と`warm`系（半袖＝暑いと着る）を自動判定して文言を出し分ける。着用が少なく相関が浅いカテゴリ（ブーツ等）は50%交点が観測域外に外挿されるので、その場合は「着た日の平均気温」を主表示に切り替える
- **レイヤー判定**: トップス系は **一番外側に着た日のみカウント**（インナー使いは除外）。レイヤー順位 `coat/outer > jacket > knit/sweat/vest > shirt > t-shirt` で、対象より外側のトップスが共存していたらインナーと判定。これで「Tシャツを一枚で着るシーズン」が初夏として正しく出る（インナー込みだと3月になってしまう）
- **極座標プロット**: 1年を円環（真上=1月、時計回り）、各年を同心リング（内側→外側で古い→新しい）にし、着用日を打点。点の色は当日の最高気温（寒色→暖色）。リング間のズレで前線の年次ドリフトが見える
- **解禁予報**: 各年のシーズンイン日（cold系=8月以降の初着用 / warm系=3月以降の初着用）を抽出し、平年日と今日を突き合わせて「コート解禁まであと◯日（平年11/14）」とカウントダウン
- `src/data/weather.json`（`{ "2022-03-01": { max, min, mean }, ... }`）は他機能からも使える共通基盤

## タイムラプス書き出し（note記事用）

```sh
pnpm timelapse                                              # 全コーデ → 約90秒のMP4
pnpm timelapse --item "shoes|jmweston#black-loafer" --duration 15
pnpm timelapse --from 2025-01-01 --to 2025-12-31 --format gif
```

- 出力は `exports/`（gitignore済み）。日付が左下に焼き込まれる
- `--item` は個体ID（`base#sub`）でもアイテムIDでも可。その部位が写っているfigureを優先採用
- 要 ffmpeg（`brew install ffmpeg`）。画像は `.cache/images/` を再利用するので2回目以降は速い

## 公開ビルドのデータの持ち方

公開ビルドは閲覧専用で書き込みAPIを持たないため、乗るのは **ファイルに焼き込まれたデータだけ**：

| データ | 保存先 | 公開反映 |
|---|---|---|
| 個体分割（⇄ の割当） | `src/data/splits.json` | 自動（編集時に即書き込み） |
| 髪タグ（AI推定＋手動修正） | `src/data/hair.json` | 自動（`pnpm hair` / 詳細での編集時に即書き込み） |
| 改名・統合・カテゴリ・非表示 | localStorage → `src/data/overrides.json` | **「公開用に確定」ボタンで焼き込みが必要** |

改名や統合は作業中 localStorage にあるので、公開前に ITEMS タブ下部の **「公開用に確定」** を一度押して `overrides.json` に焼き込むこと（忘れると自分のブラウザにしか反映されない）。

## デプロイ設定のポイント

- **base パス**: `vite.config.ts` で build/preview 時のみ `/OOTD/` を付与（dev はルートのまま）。リポジトリ名を変えるならこの値と `index.html` の OGP URL を合わせて変更する
- **OGP**: `index.html` の `og:url` / `og:image` は絶対URL。`node scripts/make-og.mjs` でコラージュOG画像を再生成できる
- **`.nojekyll`**: `public/` に配置済み（Pages の Jekyll 処理を無効化）
- 初回のみ GitHub の Settings → Pages → Source を「GitHub Actions」にする
