/**
 * Quando o menu de abertura deve aparecer.
 *
 * Existe como funcao pura por causa de um defeito real: a decisao vivia dentro
 * de um ouvinte de `pointerlockchange` que perguntava ao objeto de entrada se
 * o ponteiro estava preso. Esse ouvinte rodava antes do ouvinte do proprio
 * objeto de entrada, lia um valor ainda desatualizado e reexibia o menu no
 * exato instante em que a partida comecava — deixando o jogo rodando atras de
 * uma tela escura, sem que nada no codigo parecesse errado.
 *
 * Regra de bolso que ficou: decisao que depende de ordem de ouvintes do mesmo
 * evento nao e testavel e quebra sem avisar. Isolada aqui, ela e as duas
 * coisas.
 */

export interface MenuContext {
  /** O navegador concedeu o ponteiro? Consultado no DOM, nao em cache. */
  pointerLocked: boolean
  /** Fase atual da partida. */
  phase: 'intermission' | 'fighting' | 'over'
  /** Modo de medicao dispensa o ponteiro e nunca deve reexibir o menu. */
  measurementMode: boolean
}

export function shouldShowMenu(context: MenuContext): boolean {
  // Fim de jogo tem tela propria; o menu de abertura nao entra por cima.
  if (context.phase === 'over') return false
  if (context.measurementMode) return false
  return !context.pointerLocked
}

/**
 * Recorte minimo do `Document` que o ouvinte precisa: registrar/desregistrar
 * os dois eventos de pointer lock e ler o elemento preso NO MOMENTO do
 * evento. Nao dependemos do `Document` inteiro para que o teste possa passar
 * um objeto falso, sem jsdom.
 */
export interface DocumentLike {
  addEventListener(type: 'pointerlockchange' | 'pointerlockerror', listener: () => void): void
  removeEventListener(type: 'pointerlockchange' | 'pointerlockerror', listener: () => void): void
  readonly pointerLockElement: unknown
}

/** Peças de UI que o ouvinte precisa tocar, tambem reduzidas ao minimo. */
export interface PointerLockOverlayUi {
  overlay: { hidden: boolean }
  /** O elemento que deveria estar com o ponteiro preso (o `<canvas>` real). */
  lockTarget: unknown
  hideHud: () => void
  toast: (message: string, durationMs?: number) => void
}

/**
 * Registra os ouvintes de `pointerlockchange`/`pointerlockerror` que trazem
 * o menu de volta quando o jogador perde o ponteiro.
 *
 * O bug historico: a versao anterior guardava `pointerLocked` num objeto
 * (`input.isLocked`) atualizado por OUTRO ouvinte do mesmo evento. Quando o
 * ouvinte do menu rodava antes do ouvinte que atualizava esse espelho, ele
 * lia o valor velho. Aqui a decisao le `doc.pointerLockElement` direto do
 * documento dentro do proprio ouvinte — nao existe espelho para ficar
 * desatualizado, e a ordem de registro deixa de importar.
 *
 * `estado` e chamada a cada evento (nao uma vez, no momento do wiring) para
 * pegar fase e modo de medicao atuais — ambos mudam ao longo da partida.
 *
 * Devolve uma funcao de limpeza que remove os dois ouvintes.
 */
export function wirePointerLockOverlay(
  doc: DocumentLike,
  ui: PointerLockOverlayUi,
  estado: () => Pick<MenuContext, 'phase' | 'measurementMode'>,
): () => void {
  const onPointerLockChange = () => {
    const mostrar = shouldShowMenu({
      pointerLocked: doc.pointerLockElement === ui.lockTarget,
      ...estado(),
    })

    if (!mostrar) return
    ui.overlay.hidden = false
    ui.hideHud()
  }

  /**
   * O navegador pode recusar o ponteiro — foco perdido, pedido logo apos uma
   * saida, politica da pagina. Sem tratar, o jogador clicava em "jogar" e
   * nada acontecia, sem explicacao na tela.
   */
  const onPointerLockError = () => {
    ui.overlay.hidden = false
    ui.hideHud()
    ui.toast('clique na tela para capturar o mouse', 2500)
  }

  doc.addEventListener('pointerlockchange', onPointerLockChange)
  doc.addEventListener('pointerlockerror', onPointerLockError)

  return () => {
    doc.removeEventListener('pointerlockchange', onPointerLockChange)
    doc.removeEventListener('pointerlockerror', onPointerLockError)
  }
}
