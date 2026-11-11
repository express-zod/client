import { execSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { defineConfig } from 'tsdown'

const outDir = 'dist'

function formatDist() {
  const files = readdirSync(outDir, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.[cm]?[jt]s$/.test(file))
    .map((file) => join(outDir, file))

  if (files.length === 0) return

  execSync(`oxfmt --write --config .oxfmtrc.dist.json ${files.join(' ')}`, { stdio: 'inherit' })
}

export default defineConfig({
  entry: ['src/index.ts'],
  outDir,
  format: ['esm', 'cjs'],
  platform: 'node',
  target: 'es2023',
  fixedExtension: true,
  dts: true,
  clean: true,
  hooks: {
    'build:done': formatDist,
  },
})
