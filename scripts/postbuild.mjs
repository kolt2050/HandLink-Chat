import { copyFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const copies = [
  ['src/extension/manifest.json', 'dist/manifest.json'],
  ['src/extension/assets/icon.svg', 'dist/assets/icon.svg'],
  ['src/extension/assets/icon-16.png', 'dist/assets/icon-16.png'],
  ['src/extension/assets/icon-32.png', 'dist/assets/icon-32.png'],
  ['src/extension/assets/icon-48.png', 'dist/assets/icon-48.png'],
  ['src/extension/assets/icon-128.png', 'dist/assets/icon-128.png']
]

for (const [from, to] of copies) {
  await mkdir(dirname(to), { recursive: true })
  await copyFile(from, to)
}
