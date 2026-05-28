import { access } from 'node:fs/promises'

const outDir = new URL('../src/extension/assets/', import.meta.url)
const requiredIcons = ['icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-128.png']

for (const icon of requiredIcons) {
  await access(new URL(icon, outDir))
}
