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
import {
  shouldShowMenu,
  wirePointerLockOverlay,
  type MenuContext,
  type DocumentLike,
} from '../src/menu'

function context(overrides: Partial<MenuContext> = {}): MenuContext {
  return {
    pointerLocked: false,
    phase: 'intermission',
    measurementMode: false,
    ...overrides,
  }
}

/**
 * `document` falso, sem jsdom: so o suficiente para registrar/disparar
 * `pointerlockchange` e `pointerlockerror` e guardar `pointerLockElement`.
 *
 * Preserva ordem de registro e permite mais de um ouvinte por tipo, porque a
 * regressao historica e justamente sobre ORDEM entre dois ouvintes do mesmo
 * evento.
 */
class FakeDocument implements DocumentLike {
  pointerLockElement: unknown = null
  private readonly listeners = new Map<string, Array<() => void>>()

  addEventListener(type: string, listener: () => void): void {
    const lista = this.listeners.get(type) ?? []
    lista.push(listener)
    this.listeners.set(type, lista)
  }

  removeEventListener(type: string, listener: () => void): void {
    const lista = this.listeners.get(type)
    if (!lista) return
    const i = lista.indexOf(listener)
    if (i >= 0) lista.splice(i, 1)
  }

  dispatch(type: string): void {
    // Copia a lista antes de rodar: um ouvinte que se desregistra durante o
    // disparo nao pode embaralhar a iteracao dos outros.
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener()
  }
}

function fakeUi() {
  return {
    overlay: { hidden: false },
    lockTarget: {} as unknown,
    hudHidden: false,
    toasts: [] as Array<{ message: string; durationMs?: number }>,
    hideHud(this: any) {
      this.hudHidden = true
    },
    toast(this: any, message: string, durationMs?: number) {
      this.toasts.push({ message, durationMs })
    },
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

})

/**
 * Testes de regressao do wiring real (`wirePointerLockOverlay`), nao so da
 * funcao pura. `shouldShowMenu` sempre acertou isolada — o defeito publicado
 * vivia no ouvinte que a chamava, com dado desatualizado. Estes testes
 * dirigem eventos por um `document` falso para provar o ouvinte inteiro,
 * ordem de registro incluida.
 */
describe('wirePointerLockOverlay', () => {
  it('ponteiro adquirido: overlay permanece escondido', () => {
    const doc = new FakeDocument()
    const ui = fakeUi()
    const canvas = ui.lockTarget
    ui.overlay.hidden = true // beginPlaying() ja escondeu o menu

    wirePointerLockOverlay(doc, ui, () => ({ phase: 'fighting', measurementMode: false }))

    doc.pointerLockElement = canvas
    doc.dispatch('pointerlockchange')

    expect(ui.overlay.hidden).toBe(true)
  })

  it('ponteiro perdido em jogo: overlay volta', () => {
    const doc = new FakeDocument()
    const ui = fakeUi()
    ui.overlay.hidden = true

    wirePointerLockOverlay(doc, ui, () => ({ phase: 'fighting', measurementMode: false }))

    doc.pointerLockElement = null
    doc.dispatch('pointerlockchange')

    expect(ui.overlay.hidden).toBe(false)
    expect(ui.hudHidden).toBe(true)
  })

  /**
   * A regressao historica, reproduzida de verdade.
   *
   * A versao anterior lia um espelho (`input.isLocked`) mantido por OUTRO
   * ouvinte do mesmo evento, registrado DEPOIS do ouvinte do menu — entao o
   * menu rodava primeiro e via o espelho ainda desatualizado. Aqui registramos
   * o wiring PRIMEIRO (a mesma ordem do bug) e, so depois, um ouvinte que
   * imita o espelho velho do Input. O navegador ja atualizou
   * `pointerLockElement` antes de disparar o evento — e e exatamente isso que
   * o wiring le. Ele precisa acertar mesmo rodando antes do espelho ser
   * corrigido.
   */
  it('acerta mesmo com um espelho de estado desatualizado no instante da decisao', () => {
    const doc = new FakeDocument()
    const ui = fakeUi()
    const canvas = ui.lockTarget
    ui.overlay.hidden = true

    // Espelho tipo `input.isLocked`: comeca desatualizado (o estado de ANTES
    // desta transicao) e so e corrigido pelo ouvinte (3), registrado depois.
    const espelho = { isLocked: false }
    let espelhoNoInstanteDaDecisao: boolean | null = null

    // 1) Wiring registrado primeiro — mesma ordem do bug historico (o
    // ouvinte do menu vinha antes do ouvinte que atualizava o Input).
    wirePointerLockOverlay(doc, ui, () => ({ phase: 'fighting', measurementMode: false }))

    // 2) Sonda registrada logo depois do wiring: flagra o valor do espelho
    // exatamente no ponto em que o ouvinte antigo (buggy) o teria lido —
    // ou seja, ANTES do ouvinte (3) corrigi-lo.
    doc.addEventListener('pointerlockchange', () => {
      espelhoNoInstanteDaDecisao = espelho.isLocked
    })

    // 3) So agora o espelho e corrigido — tarde demais para quem dependesse
    // dele.
    doc.addEventListener('pointerlockchange', () => {
      espelho.isLocked = doc.pointerLockElement === canvas
    })

    // O navegador concede o ponteiro e atualiza o DOM antes de disparar,
    // como faz de verdade.
    doc.pointerLockElement = canvas
    doc.dispatch('pointerlockchange')

    // Prova que o espelho estava mesmo desatualizado no instante da decisao
    // — o cenario que quebrou o jogo publicado.
    expect(espelhoNoInstanteDaDecisao).toBe(false)
    // E mesmo assim o wiring acertou, porque nunca consultou o espelho.
    expect(ui.overlay.hidden).toBe(true)
  })

  it('fase over: overlay nao volta, a tela de fim de jogo e que manda', () => {
    const doc = new FakeDocument()
    const ui = fakeUi()
    ui.overlay.hidden = true

    wirePointerLockOverlay(doc, ui, () => ({ phase: 'over', measurementMode: false }))

    doc.pointerLockElement = null
    doc.dispatch('pointerlockchange')

    expect(ui.overlay.hidden).toBe(true)
    expect(ui.hudHidden).toBe(false)
  })

  it('pointerlockerror: mostra overlay e avisa para clicar na tela', () => {
    const doc = new FakeDocument()
    const ui = fakeUi()
    ui.overlay.hidden = true

    wirePointerLockOverlay(doc, ui, () => ({ phase: 'fighting', measurementMode: false }))

    doc.dispatch('pointerlockerror')

    expect(ui.overlay.hidden).toBe(false)
    expect(ui.hudHidden).toBe(true)
    expect(ui.toasts).toHaveLength(1)
    expect(ui.toasts[0]!.message).toMatch(/clique na tela/)
  })
})
