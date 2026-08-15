/**
 * Progressao de ondas, agora POR SALA.
 *
 * Esta dimensao nao tem benchmark: o DOOM nao e um jogo de ondas, entao nao ha
 * numero para copiar. A curva abaixo e escolha de design, e por isso fica
 * fora do loop adversarial — o que da para verificar por teste e que ela
 * cresce sem saltos absurdos e que a pressao simultanea tem teto.
 *
 * A sala entra como VIES sobre a mesma curva, nao como tabela separada: a
 * escalada continua sendo uma so (o numero da onda e global), e cada ambiente
 * so inclina a mistura para o que a sua geometria pede. Sala 1 tem vies zero
 * — a composicao dela e byte a byte a que foi calibrada e publicada.
 */

import type { EnemyKind } from '../enemies/enemy'

export interface WaveComposition {
  zombieman: number
  imp: number
  /**
   * Sargentos de escopeta.
   *
   * Sai da fatia dos ZUMBIS, nunca da dos imps: o sargento e um atirador
   * melhorado, entao promover parte dos atiradores preserva o significado da
   * curva (quantos atiram de longe contra quantos vem por cima) e mantem o
   * total da onda intacto.
   */
  sergeant: number
}

/** Teto de inimigos vivos ao mesmo tempo. */
export const MAX_CONCURRENT = 14

/** Quantas ondas cada sala pede antes de ser considerada limpa. */
export const WAVES_POR_SALA = 3

/**
 * Quanto a sala inclina a fatia de imps.
 *
 * Corredores: mais imps, porque a briga ali e curta e o flanco pelos
 * corredores paralelos e a graca do ambiente. Patio: mais zombiemen, porque a
 * linha de visao e longa e quem brilha ali e quem atira de longe.
 */
export const VIES_IMP_POR_SALA: Record<number, number> = {
  1: 0,
  2: 0.25,
  3: -0.15,
}

/**
 * A partir de qual onda o sargento entra na composicao.
 *
 * Nunca na primeira: a onda de abertura ensina a mirar e a recarregar, e um
 * inimigo que cospe tres chumbos de uma vez ali seria uma morte que o jogador
 * ainda nao tem como ler.
 */
export const ONDA_DO_SARGENTO = 2

/**
 * Que fatia da onda vira sargento, por sala.
 *
 * Galpao ZERO — a sala calibrada nao muda uma virgula. Patio e a casa dele: a
 * linha de visao longa e as coberturas baixas premiam quem atira forte e se
 * abriga entre os disparos, que e exatamente o comportamento da etapa B.
 * Corredores levam poucos: ali a briga e curta e a escopeta DELE competiria de
 * frente com a do jogador, sem a distancia que torna a troca legivel.
 */
export const FATIA_SARGENTO_POR_SALA: Record<number, number> = {
  1: 0,
  2: 0.12,
  3: 0.25,
}

/**
 * Quantos de cada tipo a onda traz.
 *
 * Cresce pouco a pouco, e a proporcao de imps sobe com o numero da onda: o
 * inicio ensina a mirar de longe, o meio obriga a recuar de quem chega perto.
 *
 * O total NAO muda com a sala nem com a entrada do sargento — a sala inclina a
 * mistura, nunca a quantidade.
 */
export function waveComposition(wave: number, sala = 1): WaveComposition {
  const total = Math.min(4 + Math.floor(wave * 1.6), 26)
  const base = Math.min(0.15 + wave * 0.06, 0.6)
  const impShare = Math.max(0, Math.min(0.85, base + (VIES_IMP_POR_SALA[sala] ?? 0)))

  const imp = Math.floor(total * impShare)

  // O teto por `total - imp` protege as ondas mais tardias dos corredores, onde
  // a fatia de imps chega a 0,85: sem ele, a soma das duas fatias passaria de
  // 100% e sobrariam zumbis negativos.
  const fatia = wave >= ONDA_DO_SARGENTO ? (FATIA_SARGENTO_POR_SALA[sala] ?? 0) : 0
  const sergeant = Math.min(Math.floor(total * fatia), total - imp)

  return { zombieman: total - imp - sergeant, imp, sergeant }
}

/**
 * A fila de nascimento da onda, ja embaralhada por tipo.
 *
 * Deterministica: nenhum sorteio entra aqui, entao duas partidas com a mesma
 * semente veem a mesma fila.
 */
export function waveQueue(wave: number, sala = 1): EnemyKind[] {
  const { zombieman, imp, sergeant } = waveComposition(wave, sala)
  const queue: EnemyKind[] = []

  // Intercala em vez de agrupar: uma onda que solta oito zumbis e depois oito
  // imps se joga em duas metades sem relacao uma com a outra.
  //
  // O sargento entra DEPOIS, promovendo vagas de atirador ja intercaladas — e
  // por isso que uma onda sem sargento nenhum (toda a sala 1) sai byte a byte
  // igual a que era gerada antes desta etapa.
  const atiradores = zombieman + sergeant
  const total = atiradores + imp
  let remainingZombie = atiradores
  let remainingImp = imp

  for (let i = 0; i < total; i++) {
    const wantImp = remainingImp > 0 && (remainingZombie === 0 || i % 3 === 2)
    if (wantImp) {
      queue.push('imp')
      remainingImp--
    } else {
      queue.push('zombieman')
      remainingZombie--
    }
  }

  if (sergeant > 0) {
    // Vagas espacadas por igual, nao as ultimas da fila: promover o final
    // faria a onda terminar sempre com uma salva de escopetas, e o comeco
    // dela nunca ensinaria o jogador a reconhecer o tipo novo.
    const vagas: number[] = []
    for (let i = 0; i < queue.length; i++) if (queue[i] === 'zombieman') vagas.push(i)

    for (let n = 0; n < sergeant; n++) {
      queue[vagas[Math.floor(((n + 0.5) * vagas.length) / sergeant)]!] = 'sergeant'
    }
  }

  return queue
}

/** Intervalo entre nascimentos, em tics. Encurta conforme as ondas avancam. */
export function spawnIntervalTics(wave: number): number {
  return Math.max(12, 40 - wave * 2)
}

/** Pausa entre o fim de uma onda e o inicio da proxima, em tics. */
export const INTERMISSION_TICS = 70
