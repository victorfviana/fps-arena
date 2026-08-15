import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Todo binario em public/models/ precisa de linha no CREDITS.md. E a regra 3
 * do CLAUDE.md do projeto em forma executavel: asset sem procedencia
 * registrada reprova a entrega.
 */
const PASTAS_DE_ASSETS = ['models', 'sounds'] as const

describe('rastreio de licenca de assets', () => {
  it('todo arquivo de public/models/ e public/sounds/ tem linha no CREDITS.md', () => {
    const raiz = join(__dirname, '..')
    const creditos = readFileSync(join(raiz, 'CREDITS.md'), 'utf8')
    let total = 0
    for (const pasta of PASTAS_DE_ASSETS) {
      for (const arquivo of readdirSync(join(raiz, 'public', pasta))) {
        total++
        expect(creditos, `sem credito para ${arquivo}`).toContain(`public/${pasta}/${arquivo}`)
      }
    }
    expect(total).toBeGreaterThan(0)
  })

  it('toda linha de credito declara uma licenca conhecida', () => {
    const raiz = join(__dirname, '..')
    const creditos = readFileSync(join(raiz, 'CREDITS.md'), 'utf8')
    const linhas = creditos
      .split('\n')
      .filter((l) => l.trimStart().startsWith('|') && l.includes('public/'))
    expect(linhas.length).toBeGreaterThan(0)
    for (const linha of linhas) {
      expect(linha, `licenca ausente em: ${linha}`).toMatch(/CC0|CC-BY|MIT/)
    }
  })
})
