// 公開（本番ビルド）は閲覧専用。dev は編集可（キュレーション用）。
//   pnpm dev   → 編集できる（splits / overrides を src/data/*.json に焼き込む）
//   pnpm build → READONLY（編集UIを隠し、焼き込み済みデータのみ表示）
export const READONLY = import.meta.env.PROD
