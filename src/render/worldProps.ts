/**
 * Carregamento dos objetos de cenario escaneados (glTF 2K).
 *
 * Fonte: Poly Haven, tudo CC0 — mesma procedencia das texturas de mundo (ver
 * docs/decisoes/0005-texturas-e-hdri.md e CREDITS.md). Cada modelo vem como
 * .gltf + .bin + textures/ ao lado; o GLTFLoader resolve os caminhos relativos
 * sozinho, entao basta apontar para o .gltf.
 *
 * O padrao e o de worldTextures.ts, e por os mesmos motivos:
 *
 *   - caminhos RELATIVOS, porque o vite serve public/ na raiz e o build
 *     publicado tem base relativa;
 *   - falha ISOLADA por item: se so o barril nao carregar, o campo `barril`
 *     vira null, o console avisa, e as caixas do mundo que pediam barril
 *     continuam sendo o bloco procedural de sempre;
 *   - so quando os QUATRO falham a funcao devolve null inteiro, sinal de "sem
 *     cenario escaneado nenhum" para o portao de carregamento.
 *
 * Aqui nao ha versao procedural equivalente a ser trocada: o fallback e nao
 * chamar `Renderer.usarProps`, e a arena continua exatamente como e hoje.
 */

import { Box3, Vector3, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import type { VisualDeBox } from '../world/arena'

/**
 * Um modelo pronto para ser clonado, com as medidas que o render precisa para
 * assenta-lo dentro de uma caixa de colisao.
 *
 * As medidas sao tiradas do Box3 do modelo COMO VEIO DO ARQUIVO, sem escala
 * aplicada — do mesmo jeito que `EnemyModel.alturaOriginal` faz para os corpos.
 * Guardar isto uma vez no carregamento evita recalcular o Box3 a cada clone.
 */
export interface PropTemplate {
  /**
   * Raiz do glTF. NUNCA entra na cena: e so molde. Cada uso e um `clone(true)`,
   * que compartilha geometria e material com o molde — o custo de memoria de
   * cinquenta engradados e o de um.
   */
  raiz: Object3D
  /** Altura do modelo, na unidade do arquivo. Base da escala. */
  alturaOriginal: number
  /** Maior lado horizontal do modelo. */
  comprimentoOriginal: number
  /** Menor lado horizontal do modelo. */
  larguraOriginal: number
  /**
   * true quando o lado maior corre no eixo Z LOCAL do modelo.
   *
   * Sem isto o render nao teria como alinhar uma mureta comprida em Z com um
   * modelo que nasceu comprido em X: ele giraria pelo lado errado e a peca
   * atravessaria a propria caixa de colisao.
   */
  comprimentoEmZ: boolean
  /** Cota mais baixa do modelo, para assentar a peca NO CHAO e nao no centro. */
  minY: number
  /** Centro horizontal do modelo — varios destes arquivos nascem fora da origem. */
  centroX: number
  centroZ: number
}

export type PropsDeMundo = Record<VisualDeBox, PropTemplate | null>

const CAMINHOS: Record<VisualDeBox, string> = {
  caixa: 'models/props/old_military_crate/old_military_crate_2k.gltf',
  barril: 'models/props/barrel_03/barrel_03_2k.gltf',
  mureta: 'models/props/concrete_road_barrier/concrete_road_barrier_2k.gltf',
  municao: 'models/props/ammo_box/ammo_box_2k.gltf',
}

const loader = new GLTFLoader()

async function carregarProp(nome: VisualDeBox, caminho: string): Promise<PropTemplate | null> {
  try {
    const gltf = await loader.loadAsync(caminho)
    const raiz = gltf.scene

    const caixa = new Box3().setFromObject(raiz)
    const tamanho = caixa.getSize(new Vector3())
    const centro = caixa.getCenter(new Vector3())

    // Modelo sem volume (arquivo carregou, mas veio vazio) nao serve de molde:
    // a escala dividiria por zero e a peca sumiria da cena sem aviso.
    if (!(tamanho.y > 0) || !(tamanho.x > 0) || !(tamanho.z > 0)) {
      throw new Error(`o modelo "${nome}" nao tem volume`)
    }

    const comprimentoEmZ = tamanho.z > tamanho.x

    return {
      raiz,
      alturaOriginal: tamanho.y,
      comprimentoOriginal: Math.max(tamanho.x, tamanho.z),
      larguraOriginal: Math.min(tamanho.x, tamanho.z),
      comprimentoEmZ,
      minY: caixa.min.y,
      centroX: centro.x,
      centroZ: centro.z,
    }
  } catch (erro) {
    console.warn(
      `Falha ao carregar o objeto de cenario "${nome}"; as caixas que o usariam ` +
      'continuam com o bloco texturizado procedural.',
      erro,
    )
    return null
  }
}

export async function carregarProps(): Promise<PropsDeMundo | null> {
  const [caixa, barril, mureta, municao] = await Promise.all([
    carregarProp('caixa', CAMINHOS.caixa),
    carregarProp('barril', CAMINHOS.barril),
    carregarProp('mureta', CAMINHOS.mureta),
    carregarProp('municao', CAMINHOS.municao),
  ])

  if (!caixa && !barril && !mureta && !municao) return null

  return { caixa, barril, mureta, municao }
}
