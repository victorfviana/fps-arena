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
