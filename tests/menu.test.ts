/**
 * Entrada no jogo.
 *
 * Esta dimensao faltava inteira na rubrica, e foi por onde o jogo quebrou para
 * o jogador: eu media velocidade, latencia e reacao ao dano, mas nada
 * verificava que apertar "jogar" realmente comecava a partida. Toda a
 * verificacao automatizada contornava o pointer lock, entao o caminho real de
 * entrada nunca foi exercitado uma vez sequer.
 */
import { describe, it, expect } from 'vitest'
import { shouldShowMenu, type MenuContext } from '../src/menu'

function context(overrides: Partial<MenuContext> = {}): MenuContext {
  return {
    pointerLocked: false,
    phase: 'intermission',
    measurementMode: false,
    ...overrides,
  }
}

describe('menu de abertura', () => {
  it('aparece antes de o jogador capturar o mouse', () => {
    expect(shouldShowMenu(context({ pointerLocked: false }))).toBe(true)
  })

  /**
   * A regressao que quebrou o jogo publicado.
   *
   * O ouvinte de `pointerlockchange` do menu estava registrado antes do
   * ouvinte do objeto de entrada. No instante em que o navegador concedia o
   * ponteiro, o do menu rodava primeiro, lia um `isLocked` ainda falso e
   * reexibia o menu — que tem fundo quase opaco. O jogo rodava atras de uma
   * tela escura, com os botoes de instrucao por cima, e parecia travado.
   */
  it('some assim que o mouse e capturado, em qualquer fase de jogo', () => {
    for (const phase of ['intermission', 'fighting'] as const) {
      expect(shouldShowMenu(context({ pointerLocked: true, phase })), phase).toBe(false)
    }
  })

  it('volta quando o jogador solta o mouse no meio da partida', () => {
    expect(shouldShowMenu(context({ pointerLocked: false, phase: 'fighting' }))).toBe(true)
  })

  it('nao cobre a tela de fim de jogo', () => {
    expect(shouldShowMenu(context({ pointerLocked: false, phase: 'over' }))).toBe(false)
  })

  it('nunca aparece em modo de medicao, que dispensa o ponteiro', () => {
    expect(shouldShowMenu(context({ measurementMode: true }))).toBe(false)
    expect(shouldShowMenu(context({ measurementMode: true, phase: 'fighting' }))).toBe(false)
  })

  it('decide so pelo estado recebido, sem depender de ordem de ouvintes', () => {
    // Mesma entrada, mesma saida, quantas vezes for chamada e em que ordem for.
    const entrada = context({ pointerLocked: true, phase: 'fighting' })
    const respostas = Array.from({ length: 5 }, () => shouldShowMenu(entrada))
    expect(new Set(respostas).size).toBe(1)
    expect(respostas[0]).toBe(false)
  })
})
