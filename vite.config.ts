import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'

// UIからの編集を src/data/*.json に書き戻す（devサーバー限定）。
// 公開ビルドはこのAPIを持たないので、本番では編集が永続化されない＝閲覧専用になる。
function dataWriteApi(): Plugin {
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null
  const endpoints: { route: string; file: string; valid: (v: unknown) => boolean }[] = [
    {
      route: '/api/splits',
      file: path.resolve(__dirname, 'src/data/splits.json'),
      valid: (v) => isRecord(v) && typeof v.items === 'object',
    },
    {
      route: '/api/overrides',
      file: path.resolve(__dirname, 'src/data/overrides.json'),
      valid: (v) => isRecord(v) && 'renames' in v,
    },
    {
      route: '/api/hair',
      file: path.resolve(__dirname, 'src/data/hair.json'),
      valid: (v) => isRecord(v) && typeof v.manual === 'object',
    },
  ]
  return {
    name: 'data-write-api',
    configureServer(server: ViteDevServer) {
      for (const ep of endpoints) {
        server.middlewares.use(ep.route, (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end('method not allowed')
            return
          }
          let body = ''
          req.on('data', (chunk) => (body += chunk))
          req.on('end', () => {
            try {
              const parsed = JSON.parse(body)
              if (!ep.valid(parsed)) throw new Error('invalid payload')
              writeFileSync(ep.file, JSON.stringify(parsed, null, 2), 'utf8')
              res.setHeader('Content-Type', 'application/json')
              res.end('{"ok":true}')
            } catch (e) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: String(e) }))
            }
          })
        })
      }
    },
  }
}

// GitHub Pages のプロジェクトサイト（https://kokinoue.github.io/OOTD/）配信。
// dev はルート配信（DX優先）、build と preview はサブパスを付ける（本番と一致させる）。
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/OOTD/' : '/',
  plugins: [react(), dataWriteApi()],
  build: {
    // data チャンク（同梱JSON）はコードではないので 500kB 警告の対象から外す
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // 日次scrapeで変わるのはデータだけなので、コードと分離してキャッシュを保つ
          if (id.includes('/src/data/')) return 'data'
          // 物理エンジンはタワーでしか使わないので vendor から分離
          // （TowerGameView と一緒に遅延ロードされ、初期バンドルに乗らない）
          if (id.includes('node_modules/planck/')) return 'planck'
          // Three.js は3Dタイムラインを開いたときだけ読み込む。
          // React本体と同じvendorチャンクへ混ぜると初期表示で取得されるため独立させる。
          if (id.includes('node_modules/three/')) return 'three'
          if (id.includes('node_modules')) return 'vendor'
        },
      },
    },
  },
  server: {
    // ツール（プレビュー等）が指定したポートを尊重する（既定は vite 標準の 5173）
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    watch: {
      // UI編集の保存でページがリロードされないようにする（手動リロードで反映）
      ignored: [
        '**/src/data/splits.json',
        '**/src/data/overrides.json',
        '**/src/data/hair.json',
      ],
    },
  },
}))
