/**
 * Carregamento dos modelos glb animados dos inimigos.
 *
 * Os arquivos vem do Zombie Apocalypse Kit (Quaternius, CC0) — ver
 * CREDITS.md. Cada .glb e autossuficiente (buffer e textura embutidos), entao
 * um GLTFLoader comum basta: nenhum DRACOLoader nem KTX2Loader para
 * registrar (os arquivos nao usam extensionsUsed nenhuma).
 *
 * Falha em qualquer etapa (rede fora do ar, arquivo corrompido, parse) devolve
 * null em vez de propagar a excecao — quem chama cai no corpo procedural em
 * vez de travar a tela de carregamento.
 */

import { Box3, type AnimationClip, type Group } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export interface EnemyModel {
  /** Raiz da cena do glTF. Nunca usada diretamente na cena — cada view clona
   *  este template via SkeletonUtils.clone (ver enemyView.ts). */
  template: Group
  animations: AnimationClip[]
  /** Altura do template, em map units, medida pelo Box3 do modelo como veio
   *  do arquivo (sem escala aplicada). Usada para calcular o fator de escala
   *  ate a altura de ENEMIES[kind].height. */
  alturaOriginal: number
}

export interface EnemyModelSet {
  zombieman: EnemyModel
  imp: EnemyModel
  sergeant: EnemyModel
}

/**
 * Caminho relativo: o vite serve public/ na raiz e o base do projeto e
 * relativo, entao 'models/atirador.glb' resolve certo tanto em dev quanto no
 * build publicado, sem depender de import.meta.url ou de barra inicial.
 *
 * Um arquivo por tipo — sobrevivente armado (atirador), sargento (outro
 * sobrevivente armado, mesmo kit) e o zumbi de bracos grandes (brutamontes).
 * Ver CREDITS.md para a procedencia de cada um.
 */
const CAMINHOS = {
  zombieman: 'models/atirador.glb',
  sergeant: 'models/sargento.glb',
  imp: 'models/brutamontes.glb',
} as const

export async function carregarModelosInimigos(): Promise<EnemyModelSet | null> {
  try {
    const loader = new GLTFLoader()
    const [zombieman, sergeant, imp] = await Promise.all([
      loader.loadAsync(CAMINHOS.zombieman),
      loader.loadAsync(CAMINHOS.sergeant),
      loader.loadAsync(CAMINHOS.imp),
    ])

    // Os dois sobreviventes vem de fabrica com arma BRANCA na mao (meshes
    // "Knife" e "Axe"), mas aqui eles sao atiradores em pose de pontaria
    // (clipes _Gun): faca erguida durante a mira lia como defeito na tela.
    // Mao vazia le melhor; anexar um rifle de verdade ao osso da mao fica
    // como refinamento futuro. O Zombie_Arm do brutamontes FICA — e tematico.
    for (const cena of [zombieman.scene, sergeant.scene]) {
      cena.traverse((o) => {
        if (o.name === 'Knife' || o.name === 'Axe') o.visible = false
      })
    }

    return {
      zombieman: paraModelo(zombieman.scene, zombieman.animations),
      sergeant: paraModelo(sergeant.scene, sergeant.animations),
      imp: paraModelo(imp.scene, imp.animations),
    }
  } catch (erro) {
    console.warn(
      'Falha ao carregar os modelos glb dos inimigos; caindo para os corpos procedurais.',
      erro,
    )
    return null
  }
}

/**
 * Os clipes dentro destes glb saem do FBX2glTF com o nome da armature como
 * prefixo ("CharacterArmature|Walk_Gun"), e o prefixo repete identico nos tres
 * arquivos. Enxuga para o nome puro do clipe (Walk_Gun, Death, Run_Arms, ...)
 * aqui, uma unica vez no carregamento, para o resto do codigo (enemyView.ts)
 * indexar `actions` por esses nomes fixos sem se importar com o prefixo nem
 * comparar strings inteiras por igualdade estrita.
 */
function nomeClipeSemPrefixo(nomeOriginal: string): string {
  const indice = nomeOriginal.indexOf('|')
  return indice === -1 ? nomeOriginal : nomeOriginal.slice(indice + 1)
}

function paraModelo(template: Group, animations: AnimationClip[]): EnemyModel {
  for (const clip of animations) {
    clip.name = nomeClipeSemPrefixo(clip.name)
  }

  const caixa = new Box3().setFromObject(template)
  const alturaOriginal = caixa.max.y - caixa.min.y
  return { template, animations, alturaOriginal }
}
