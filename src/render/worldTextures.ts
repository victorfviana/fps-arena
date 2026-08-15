/**
 * Carregamento das texturas PBR de mundo e do HDRI de ambiente.
 *
 * Fonte: Poly Haven, tudo CC0 — ver docs/decisoes/0005-texturas-e-hdri.md.
 * Cada conjunto de superficie (parede/piso/teto) e um trio diff/nor_gl/rough
 * em JPG 2K; o HDRI e um .hdr 2K que vira environment map via PMREMGenerator
 * no renderer (usarTexturasDeMundo), nunca scene.background — a arena e
 * fechada e o HDRI so entra como luz e reflexo.
 *
 * Falha e isolada por conjunto, nao pelo carregamento inteiro: se uma das tres
 * texturas de "parede" falhar, so o conjunto "parede" vira null (o chamador
 * cai no material procedural so daquela superficie). O HDRI segue a mesma
 * logica isolada. So quando os quatro (parede, piso, teto, hdri) falham juntos
 * e que a funcao devolve null inteiro — sinal de que o portao de carregamento
 * deve tratar como "sem arte externa nenhuma", igual aos modelos e ao som.
 */

import { RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'

/** Um trio de mapas PBR: cor, relevo e rugosidade. */
export interface ConjuntoTexturas {
  diff: Texture
  normal: Texture
  rough: Texture
}

export interface TexturasDeMundo {
  parede: ConjuntoTexturas | null
  piso: ConjuntoTexturas | null
  teto: ConjuntoTexturas | null
  /** Equirretangular HDR, cru — o renderer que passa pelo PMREMGenerator. */
  hdri: Texture | null
}

/**
 * Caminhos relativos: o vite serve public/ na raiz, entao isto resolve certo
 * tanto em dev quanto no build publicado — mesmo raciocinio de
 * enemyModels.ts.
 */
const PREFIXOS: Record<'parede' | 'piso' | 'teto', string> = {
  parede: 'textures/brick_wall_12',
  piso: 'textures/concrete_floor_02',
  teto: 'textures/metal_plate',
}

const CAMINHO_HDRI = 'env/abandoned_workshop_2k.hdr'

const textureLoader = new TextureLoader()
const rgbeLoader = new RGBELoader()

async function carregarConjunto(nome: string, prefixo: string): Promise<ConjuntoTexturas | null> {
  try {
    const [diff, normal, rough] = await Promise.all([
      textureLoader.loadAsync(`${prefixo}_diff_2k.jpg`),
      textureLoader.loadAsync(`${prefixo}_nor_gl_2k.jpg`),
      textureLoader.loadAsync(`${prefixo}_rough_2k.jpg`),
    ])

    // So o albedo vive em espaco sRGB — normal e rugosidade sao dados, nao
    // cor (mesma regra de materials.ts). RepeatWrapping em todos: quem usa
    // ajusta o repeat conforme a superficie, mas o modo de repeticao e sempre
    // este, nunca ClampToEdge.
    diff.colorSpace = SRGBColorSpace
    for (const textura of [diff, normal, rough]) {
      textura.wrapS = RepeatWrapping
      textura.wrapT = RepeatWrapping
    }

    return { diff, normal, rough }
  } catch (erro) {
    console.warn(`Falha ao carregar o conjunto de textura "${nome}"; caindo para o procedural.`, erro)
    return null
  }
}

async function carregarHdri(): Promise<Texture | null> {
  try {
    return await rgbeLoader.loadAsync(CAMINHO_HDRI)
  } catch (erro) {
    console.warn('Falha ao carregar o HDRI de ambiente; seguindo sem environment map.', erro)
    return null
  }
}

export async function carregarTexturasDeMundo(): Promise<TexturasDeMundo | null> {
  const [parede, piso, teto, hdri] = await Promise.all([
    carregarConjunto('parede', PREFIXOS.parede),
    carregarConjunto('piso', PREFIXOS.piso),
    carregarConjunto('teto', PREFIXOS.teto),
    carregarHdri(),
  ])

  if (!parede && !piso && !teto && !hdri) return null

  return { parede, piso, teto, hdri }
}
