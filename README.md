# OOTD — 出勤服アーカイブ

**公開サイト → https://kokinoue.github.io/OOTD/**

note マガジン「[出勤服](https://note.com/kokinoue/m/m1e7ba6acb234)」から、画像と服のアイテム情報を取り込んで閲覧する個人コーデアーカイブ。2022年3月から毎営業日続けている定点撮影のコーデ 640日分が素材。

- **コーデ一覧** — 年・月・期間・フリーワードで絞り込み、写真グリッドで一覧
- **アイテム別** — 着用ブランド/アイテムごとに横断（画像判定で「個体」単位に分割）
- **衣替え前線** — 着用記録 × 気温から「コートを着る気温」「解禁予報」を算出
- **タイムラプス** — 定点写真を連続再生（絞り込み結果をそのまま動画化）

技術: Vite + React + TypeScript の静的SPA。データは note 公開API + Open-Meteo から生成し JSON で同梱。

## 開発

```sh
pnpm install
pnpm dev        # http://localhost:5173（編集できる）
pnpm build      # dist/ を生成（公開モード＝閲覧専用）
```

`pnpm dev` は編集モード（改名・統合・割当・非表示ができる）、`pnpm build` した成果物は閲覧専用。切り替えは `src/lib/env.ts` の `READONLY = import.meta.env.PROD`。

## データ更新

```sh
pnpm scrape     # note記事＋気温を取得し src/data/*.json を再生成
```

新着分だけ取りにいく（`.cache/` にキャッシュ）。気温だけなら `pnpm weather`。

## 公開（GitHub Pages）

main へ push すると [GitHub Actions](.github/workflows/deploy.yml) が build → デプロイする。

```sh
# ITEMS タブで改名・統合をしたら「公開用に確定」を押して overrides.json に焼き込む
git add -A && git commit -m "update" && git push
```

## 仕組み

```
scripts/scrape.mjs   note API → src/data/{outfits,items,meta}.json
src/lib/useData.ts   元データ + 編集（splits/overrides）を合成して表示用データを作る
src/components/      FitsView（一覧） / OutfitModal（詳細） / ItemsView（管理） / WeatherView（衣替え）
```

画像は note CDN を直接参照（`?width=` でリサイズ、自前ホストしない）。

名寄せ・個体分割・衣替えの算出ロジック・各スクリプトの詳細は **[docs/INTERNALS.md](docs/INTERNALS.md)** を参照。
