/**
 * Aleatoriedade com semente.
 *
 * O DOOM usa uma tabela fixa de 256 valores (`P_Random`), o que torna o jogo
 * inteiro reproduzivel. Nao encontrei a tabela em fonte citavel, entao usamos
 * um gerador proprio — mas mantemos a propriedade que importa: com a mesma
 * semente, a mesma partida. Sem isso, um teste de dano ou de dispersao mediria
 * ruido, e duas execucoes do jogo nao seriam comparaveis.
 *
 * Isto e escolha de implementacao, nao constante de benchmark.
 */

export interface Random {
  /** Inteiro de 0 (inclusive) a `bound` (exclusive). */
  int(bound: number): number
  /** Fracao de 0 (inclusive) a 1 (exclusive). */
  float(): number
  /** Fracao de -1 a 1. */
  signed(): number
}

export function createRandom(seed = 0x1d1a): Random {
  let state = seed >>> 0

  const next = (): number => {
    // xorshift32: barato, periodo longo o bastante para uma partida e sem
    // as correlacoes de baixa ordem de um congruencial simples.
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state
  }

  return {
    int: (bound: number) => (bound <= 0 ? 0 : next() % bound),
    float: () => next() / 0x100000000,
    signed: () => (next() / 0x100000000) * 2 - 1,
  }
}
