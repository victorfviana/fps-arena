/**
 * Carregamento das amostras gravadas de tiro (ADR 0004).
 *
 * Guarda os bytes CRUS (ArrayBuffer), nao AudioBuffer: `decodeAudioData` e
 * por contexto, e o jogo tem no minimo dois — o `AudioContext` real e o
 * `OfflineAudioContext` de `medirTiro`. Cada `Sfx` decodifica sua propria
 * copia sob demanda (ver sfx.ts).
 *
 * Falha em qualquer etapa (rede fora do ar, arquivo corrompido) deixa o
 * cache com `null` para aquela arma e cai no aviso — quem chama (`Sfx`) usa
 * isso como sinal para seguir na cadeia sintetica de sempre, igual ao
 * fallback de `enemyModels.ts` para o corpo procedural.
 */

import type { ShotKind } from './sfx'

/**
 * Caminho relativo: o vite serve public/ na raiz e o base do projeto e
 * relativo, entao 'sounds/shotgun.wav' resolve certo tanto em dev quanto no
 * build publicado (mesma convencao de CAMINHOS em enemyModels.ts).
 */
const CAMINHOS: Record<ShotKind, string> = {
  shotgun: 'sounds/shotgun.wav',
  rifle: 'sounds/rifle.wav',
}

/** Cache de modulo dos bytes crus, por arma. `null` = sem amostra disponivel. */
const cache: Record<ShotKind, ArrayBuffer | null> = {
  shotgun: null,
  rifle: null,
}

/**
 * Busca os arquivos de audio gravado e preenche o cache de modulo.
 *
 * Chamar uma vez, no mesmo portao de carregamento dos modelos dos inimigos
 * (main.ts). Nunca rejeita: cada arma falha por conta propria e o jogo segue
 * mudo de amostra so naquela arma especifica, nunca trava o portao.
 */
export async function carregarAmostrasDeTiro(): Promise<void> {
  await Promise.all(
    (Object.keys(CAMINHOS) as ShotKind[]).map(async (kind) => {
      try {
        const resposta = await fetch(CAMINHOS[kind])
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`)
        cache[kind] = await resposta.arrayBuffer()
      } catch (erro) {
        console.warn(
          `[audio] falha ao carregar a amostra de ${kind}; o disparo segue so com a sintese.`,
          erro,
        )
        cache[kind] = null
      }
    }),
  )
}

/**
 * Copia dos bytes crus da amostra, pronta para `decodeAudioData`.
 *
 * `decodeAudioData` consome (detacha) o `ArrayBuffer` recebido — por isso
 * `slice(0)` a cada chamada, nunca o buffer do cache diretamente. Sem
 * amostra carregada (fetch nao rodou ainda, falhou, ou terminou em erro),
 * devolve `null`.
 */
export function amostraCrua(kind: ShotKind): ArrayBuffer | null {
  const bytes = cache[kind]
  return bytes ? bytes.slice(0) : null
}
