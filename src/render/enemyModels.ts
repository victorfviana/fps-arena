/**
 * Carregamento dos modelos gltf animados dos inimigos.
 *
 * Os arquivos vem do pack Ultimate Monsters (Quaternius, CC0) — ver
 * docs/decisoes/0003-arte-externa-fase-1.md. Cada .gltf e autossuficiente
 * (buffer e textura embutidos), entao um GLTFLoader comum basta: nenhum
 * DRACOLoader nem KTX2Loader para registrar.
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
}

/**
 * Caminho relativo: o vite serve public/ na raiz e o base do projeto e
 * relativo, entao 'models/orc.gltf' resolve certo tanto em dev quanto no
 * build publicado, sem depender de import.meta.url ou de barra inicial.
 */
const CAMINHOS: Record<keyof EnemyModelSet, string> = {
  zombieman: 'models/orc.gltf',
  imp: 'models/demon.gltf',
}

export async function carregarModelosInimigos(): Promise<EnemyModelSet | null> {
  try {
    const loader = new GLTFLoader()
    const [orc, demon] = await Promise.all([
      loader.loadAsync(CAMINHOS.zombieman),
      loader.loadAsync(CAMINHOS.imp),
    ])

    return {
      zombieman: paraModelo(orc.scene, orc.animations),
      imp: paraModelo(demon.scene, demon.animations),
    }
  } catch (erro) {
    console.warn(
      'Falha ao carregar os modelos gltf dos inimigos; caindo para os corpos procedurais.',
      erro,
    )
    return null
  }
}

function paraModelo(template: Group, animations: AnimationClip[]): EnemyModel {
  const caixa = new Box3().setFromObject(template)
  const alturaOriginal = caixa.max.y - caixa.min.y
  return { template, animations, alturaOriginal }
}
