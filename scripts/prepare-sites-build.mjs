// 通常のVite静的出力を、Sitesが受け取るCloudflare Worker形式へ整える。
// GitHub Pages向けの `pnpm build` は変えず、`pnpm build:sites` の末尾だけで使う。
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist')
const client = path.join(dist, 'client')
const server = path.join(dist, 'server')

await mkdir(client, { recursive: true })
for (const entry of await readdir(dist)) {
  if (entry === 'client' || entry === 'server' || entry === '.openai') continue
  await rename(path.join(dist, entry), path.join(client, entry))
}
await mkdir(server, { recursive: true })
await writeFile(
  path.join(server, 'index.js'),
  `const worker = {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request)
    if (response.status !== 404 || request.method !== 'GET') return response
    const url = new URL('/index.html', request.url)
    return env.ASSETS.fetch(new Request(url, request))
  },
}

export default worker
`,
  'utf8',
)
