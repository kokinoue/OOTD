# OOTD — 出勤服アーカイブ

**公開サイト → https://kokinoue.github.io/OOTD/**

note マガジン「[出勤服](https://note.com/kokinoue/m/m1e7ba6acb234)」の全記事から、
画像と服のアイテム情報を取り込んで閲覧する個人コーデアーカイブ。
2022年3月から毎営業日続けている定点撮影の出勤コーデ 640日分が素材。
[yafafits.com](https://www.yafafits.com/) 風のミニマルUI。

- **コーデ一覧** — 年・月・期間・フリーワードで絞り込み、写真グリッドで一覧
- **アイテム別** — 着用ブランド/アイテムごとにコーデを横断（画像判定で「個体」単位に分割）
- **衣替え前線** — 4年分の着用記録 × 気温から「コートを着る気温」「解禁予報」を算出
- **タイムラプス** — 定点写真を連続再生（絞り込み結果をそのまま動画化）

技術: Vite + React + TypeScript の静的SPA。データは note 公開API + Open-Meteo から生成し JSON で同梱。

## 2つのモード

| | `pnpm dev`（編集モード） | `pnpm build`（公開モード / READONLY） |
|---|---|---|
| 用途 | 自分でデータをキュレーション | 静的サイトとして公開 |
| 編集UI | あり（改名・統合・割当・非表示） | **すべて非表示**（閲覧専用） |
| データ保存 | dev サーバー経由で `src/data/*.json` に書き込み | 書き込みAPIなし＝編集不可 |

判定は `src/lib/env.ts` の `READONLY = import.meta.env.PROD`。dev は編集でき、build した成果物は閲覧専用になる。

## 使い方

```sh
pnpm install
pnpm dev        # http://localhost:5173（編集できる）
```

## データ更新（新しい記事を取り込む）

```sh
pnpm scrape    # note記事の取得 + 気温データ更新（fetch-weather も連鎖実行）
```

- note の公開APIからマガジン全記事を取得し `src/data/*.json` を再生成する
- 取得済み記事は `.cache/notes/` にキャッシュされるので、2回目以降は新着分だけ取りにいく（数十秒）
- 本文のパースをやり直したいときは `node scripts/scrape.mjs --force`
- 末尾で `splits.json` の整合性（個体割当の参照切れ）も自動チェックする

## できること

| 機能 | 場所 |
|---|---|
| コーデ一覧（写真グリッド） | FITS タブ |
| 日時で絞る | 年チップ → 月チップ、または日付範囲指定 |
| アイテムごとのコーデ | アイテム名・チップをクリック |
| フリーワード検索 | ブランド名・キャプション・メモを横断 |
| コーデ詳細 | カードクリック（←/→ キーで前後移動） |
| アイテム管理 | ITEMS タブ：名前変更 ✎ / カテゴリ変更 / 統合 ⇒ / 非表示 − |
| タイムラプス再生 | FITS タブの「▶ タイムラプス」。**絞り込み結果をそのまま再生**するので、アイテムで絞れば「この靴と過ごした日々」になる。Space=再生/停止、←→=コマ送り、シークバーは季節色 |
| 衣替え前線 | 衣替えタブ。気温と着用記録から私的閾値・前線・解禁予報を出す（下記） |

## 衣替え前線（気温 × 着用記録）

東京の過去気温（Open-Meteo、2022/3〜現在の日次）と着用記録を突き合わせ、季節性のあるアイテムの「私的な気温閾値」「衣替え前線」「解禁予報」を出す。

```sh
pnpm weather    # 気温データだけ更新（pnpm scrape にも含まれる）
```

- **私的気温閾値**: カテゴリ（コート/ニット/半袖等）ごとに、その日の最高気温で着用有無をロジスティック回帰し「着用確率50%＝◯℃」を算出。`cold`系（コート＝寒いと着る）と`warm`系（半袖＝暑いと着る）を自動判定して文言を出し分ける。着用が少なく相関が浅いカテゴリ（ブーツ等）は50%交点が観測域外に外挿されるので、その場合は「着た日の平均気温」を主表示に切り替える
- **レイヤー判定**: トップス系（half-sleeve/shirt/knit 等）は **一番外側に着た日のみカウント**（ジャケットやシャツの下のインナー使いは除外）。レイヤー順位 `coat/outer > jacket > knit/sweat/vest > shirt > t-shirt` で、対象より外側のトップスが共存していたらインナーと判定。これで「Tシャツを一枚で着るシーズン」が初夏として正しく出る（インナー込みだと3月になってしまう）
- **極座標プロット**: 1年を円環（真上=1月、時計回り）、各年を同心リング（内側→外側で古い→新しい）にし、着用日を打点。点の色は当日の最高気温（寒色→暖色）。冬物は冬の弧に、夏物は夏の弧にクラスタし、リング間のズレで**前線の年次ドリフト**が見える
- **解禁予報**: 各年のシーズンイン日（cold系=8月以降の初着用＝冬入り / warm系=3月以降の初着用＝夏入り）を抽出し、平年日と今日を突き合わせて「コート解禁まであと◯日（平年11/14）」とカウントダウン
- データは Open-Meteo の無料API（キー不要）。`src/data/weather.json`（`{ "2022-03-01": { max, min, mean }, ... }`）として他機能からも使える共通基盤

## タイムラプス書き出し（note記事用）

```sh
pnpm timelapse                                              # 全コーデ → 約90秒のMP4
pnpm timelapse --item "shoes|jmweston#black-loafer" --duration 15
pnpm timelapse --from 2025-01-01 --to 2025-12-31 --format gif
```

- 出力は `exports/`（gitignore済み）。日付が左下に焼き込まれる
- `--item` は個体ID（`base#sub`）でもアイテムIDでも可。その部位が写っているfigureを優先採用
- 要 ffmpeg（`brew install ffmpeg`）。画像は `.cache/images/` を再利用するので2回目以降は速い

## アイテム編集の保存先

- 名前変更・カテゴリ変更・統合・非表示は **ブラウザの localStorage** に保存される（元データは書き換えない）
- ITEMS タブ下部からエクスポート／インポートできるので、ブラウザを変えるときはJSONを持ち運ぶ
- `pnpm scrape` してもアイテムIDは `カテゴリ|ブランド名（正規化済み）` で安定しているので、編集内容は新データにもそのまま効く

## 仕組み

```
scripts/scrape.mjs   note API → .cache/notes/*.json → src/data/{outfits,items,meta}.json
src/lib/useData.ts   元データ + localStorage の編集を合成して表示用データを作る
src/components/      FitsView（一覧・絞り込み） / OutfitModal（詳細） / ItemsView（管理）
```

- アイテムは記事中の figcaption（`shirt: ensou, pants: 80's, ...`）をパースして抽出
- カテゴリの表記ゆれ（`jacket1`→`jacket`、`shirts`→`shirt`、タイポ等）はスクレイパー側で正規化
- 画像は note CDN を直接参照（`?width=` でリサイズ）。ダウンロードは行わない

## 名寄せルール（スクレイパー側で自動適用）

アイテムIDは `カテゴリ|正規化ラベル` で決まり、以下のゆれを同一アイテムに名寄せする:

- 大文字小文字・スペース・記号（`J.M.WESTON` = `J.M. WESTON`、`Crockett&Jones` = `CROCKETT & JONES`）
- ダイアクリティカル（`WILDFRÄULEIN` = `wildfraulein`、`Hermès` = `Hermes`）。仮名の濁点は保持
- アポストロフィ類・×/x（`Le Yucca's` = `Le Yuccaʼs`、`adidas × noah` = `Noah x Adidas`）
- 年代表記（`1950's` = `50's`）
- 末尾のシーズン表記（`Call 22aw` → `Call`、`sacai 12ss` → `sacai`）。元の表記はコーデ詳細のキャプションで確認できる
- 既知のタイポ（`J.M.WESTOM`→`J.M.WESTON` 等。`scripts/scrape.mjs` の `LABEL_ALIASES` に追記で拡張可）

キャプションのカンマ抜け（`cap: IDEA jacket: Yohji...`）・ピリオド区切り・セミコロン・
カテゴリ重複（`shoes: shoes: ...`）も自動で区切り直す。

これでも残る曖昧なペア（`boutique` と `boutique aoyama` 等、判断が必要なもの）は
ITEMS タブの統合機能（⇒）で手動マージする。表示名は最頻出の表記が自動で選ばれる。

## 個体分割（画像判定）

同じラベルでも別の服（例: `pants: Maison Martin Margiela` の中の紺フレア／グレーワイド）を
`src/data/splits.json` でサブアイテムに分割している。ITEMS タブでは
`Maison Martin Margiela · 紺フレアデニム` のように表示され、個体単位でコーデを絞れる。
割当がない着用は `· 未分類` に残る（バッグ等、写真で判別できなかったもの）。

### 運用

```sh
node scripts/contact-sheet.mjs "pants|maisonmartinmargiela"   # 部位クロップの一覧画像を生成
node scripts/contact-sheet.mjs --min-count 12                 # 対象アイテム一括生成
node scripts/apply-splits.mjs                                  # decisions.json → splits.json
```

1. コンタクトシート（`.cache/sheets/*.png`）を見て個体を判定する（Claudeに「◯◯を分けて」と頼む）
2. 判定は `.cache/sheets/decisions.json` に書く（`nos` はコーデの#番号、`rest` で残り一括割当）
3. `apply-splits.mjs` で `src/data/splits.json` に展開（#番号→記事キーの変換・重複検証つき）

### 割当の修正（UIでできる）

- **割り当て変更**: コーデ詳細を開き、アイテムチップ横の **⇄** をクリック →
  既存の個体を選ぶ／「＋作成して割当」で新しい個体を作る／未分類に戻す。
  変更は `pnpm dev` のサーバー経由で `src/data/splits.json` に即保存される
  （編集UIは公開ビルドでは非表示。`pnpm dev` でのみ編集できる）
- **名称の書き換え**: ITEMS タブの ✎。個体（`ブランド · 個体名`）にもそのまま効く
  （作業中は localStorage に保存。公開に反映するには「公開用に確定」が必要 → 下記「公開」）
- 統合・カテゴリ変更・非表示も ITEMS タブの既存機能が個体に対して使える

## 公開（GitHub Pages）

`https://kokinoue.github.io/OOTD/` での公開を前提に設定済み。push して Pages を有効化するだけ。

### データの持ち方（重要）

公開ビルドに乗るのは **ファイルに焼き込まれたデータだけ**（公開ビルドは閲覧専用で、書き込みAPIを持たない）：

| データ | 保存先 | 公開反映 |
|---|---|---|
| 個体分割（⇄ の割当） | `src/data/splits.json` | 自動（編集時に即書き込み） |
| 改名・統合・カテゴリ・非表示 | localStorage → `src/data/overrides.json` | **「公開用に確定」ボタンで焼き込みが必要** |

改名や統合は作業中 localStorage にあるので、公開前に ITEMS タブ下部の **「公開用に確定」** を一度押して `overrides.json` に焼き込むこと（これを忘れると自分のブラウザにしか反映されない）。

### 公開手順

```sh
# 1. データを最新化（任意）
pnpm scrape                # 記事＋気温
node scripts/make-og.mjs   # OGP画像を最新コーデで作り直す
# 2. ITEMS タブで「公開用に確定」を押し overrides.json を焼き込む
# 3. ローカル確認（本番と同じ /OOTD/ サブパスで配信される）
pnpm build && pnpm preview # → http://localhost:4173/OOTD/
# 4. GitHub へ
git init -b main           # 未初期化なら
gh repo create OOTD --public --source=. --remote=origin
git add -A && git commit -m "publish OOTD"
git push -u origin main
```

push 後、GitHub のリポジトリ **Settings → Pages → Source を「GitHub Actions」** にすれば、
[.github/workflows/deploy.yml](.github/workflows/deploy.yml) が走って自動デプロイされる
（以後は main へ push するたびに更新）。

### 設定のポイント

- **base パス**: `vite.config.ts` で build/preview 時のみ `/OOTD/` を付与（dev はルートのまま）。
  リポジトリ名を変えるならこの値と `index.html` の OGP URL を合わせて変更する
- **OGP**: `index.html` の `og:url` / `og:image` は `https://kokinoue.github.io/OOTD/` 絶対URL
- **`.nojekyll`**: `public/` に配置済み（Pages の Jekyll 処理を無効化）
- 画像は note CDN を直リンク（本人の記事画像）。CDN が将来変わると表示が崩れる点は許容

### 一括での再判定（スクリプト）

- `decisions.json` の `nos` を直して `apply-splits.mjs` を再実行する方法もあるが、
  **splits.json を丸ごと上書きするので、UIでの修正後は基本使わない**こと
- `pnpm scrape` 後の新着コーデは未割当として入る。コーデ詳細の ⇄ でその都度割り当てるか、
  たまに `contact-sheet.mjs` を再生成して新着分をまとめて判定する
