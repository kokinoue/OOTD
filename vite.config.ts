import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'

// UIからの編集を src/data/*.json に書き戻す（devサーバー限定）。
// 公開ビルドはこのAPIを持たないので、本番では編集が永続化されない＝閲覧専用になる。
function dataWriteApi(): Plugin {
  const endpoints: { route: string; file: string; valid: (v: unknown) => boolean }[] = [
    {
      route: '/api/splits',
      file: path.resolve(__dirname, 'src/data/splits.json'),
      valid: (v) => typeof v === 'object' && v !== null && typeof (v as any).items === 'object',
    },
    {
      route: '/api/overrides',
      file: path.resolve(__dirname, 'src/data/overrides.json'),
      valid: (v) => typeof v === 'object' && v !== null && 'renames' in (v as any),
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
  server: {
    watch: {
      // UI編集の保存でページがリロードされないようにする（手動リロードで反映）
      ignored: ['**/src/data/splits.json', '**/src/data/overrides.json'],
    },
  },
}))
