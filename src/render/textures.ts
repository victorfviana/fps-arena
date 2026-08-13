/**
 * Texturas geradas em canvas, no carregamento.
 *
 * Nenhum arquivo de imagem entra no projeto: sem download, sem licenca, sem
 * peso no bundle. A superficie precisa ter granulacao suficiente para o olho
 * perceber velocidade — parede lisa faz o movimento parecer travado mesmo
 * quando a fisica esta correta.
 */

import {
  CanvasTexture,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three'

/**
 * Gerador pseudoaleatorio com semente.
 *
 * Math.random deixaria a textura diferente a cada carregamento, e uma
 * comparacao visual entre duas versoes do jogo pararia de significar algo.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function createCanvas(size: number): {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
} {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D indisponivel neste navegador')
  return { canvas, context }
}

function finish(canvas: HTMLCanvasElement, repeat: number): Texture {
  const texture = new CanvasTexture(canvas)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.repeat.set(repeat, repeat)
  // Filtro nearest de perto mantem a leitura dura, de bloco, coerente com a
  // referencia. De longe o mipmap assume, e a anisotropia evita que o chao
  // vire ruido cintilante no horizonte.
  texture.magFilter = NearestFilter
  texture.anisotropy = 8
  texture.colorSpace = SRGBColorSpace
  return texture
}

/** Granulacao aplicada por cima de qualquer padrao. */
function addGrain(
  context: CanvasRenderingContext2D,
  size: number,
  random: () => number,
  strength: number,
): void {
  const image = context.getImageData(0, 0, size, size)
  const { data } = image

  for (let i = 0; i < data.length; i += 4) {
    const noise = (random() - 0.5) * strength
    data[i] = clampByte(data[i]! + noise)
    data[i + 1] = clampByte(data[i + 1]! + noise)
    data[i + 2] = clampByte(data[i + 2]! + noise)
  }

  context.putImageData(image, 0, 0)
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value
}

/** Parede de blocos, com junta escura e desgaste irregular. */
export function createWallTexture(): Texture {
  const size = 128
  const { canvas, context } = createCanvas(size)
  const random = seededRandom(0x5eed)

  context.fillStyle = '#4a3f33'
  context.fillRect(0, 0, size, size)

  const rows = 4
  const blockHeight = size / rows
  const blockWidth = size / 2

  for (let row = 0; row < rows; row++) {
    const offset = row % 2 === 0 ? 0 : blockWidth / 2

    for (let column = -1; column < 3; column++) {
      const x = column * blockWidth + offset
      const y = row * blockHeight
      const shade = 0.9 + random() * 0.2

      context.fillStyle = `rgb(${Math.round(132 * shade)}, ${Math.round(112 * shade)}, ${Math.round(90 * shade)})`
      context.fillRect(x + 2, y + 2, blockWidth - 4, blockHeight - 4)
    }
  }

  addGrain(context, size, random, 20)
  return finish(canvas, 1)
}

/** Piso de placas metalicas, mais escuro que a parede para separar os planos. */
export function createFloorTexture(): Texture {
  const size = 128
  const { canvas, context } = createCanvas(size)
  const random = seededRandom(0xf100)

  context.fillStyle = '#38312a'
  context.fillRect(0, 0, size, size)

  // Celulas pequenas e variacao curta. A versao anterior usava quatro celulas
  // grandes com 30% de variacao: repetida dezenas de vezes pelo chao da arena,
  // virava um tabuleiro de xadrez que puxava o olho para baixo e atrapalhava
  // enxergar o inimigo.
  const cells = 8
  const cell = size / cells

  for (let row = 0; row < cells; row++) {
    for (let column = 0; column < cells; column++) {
      const shade = 0.95 + random() * 0.1
      context.fillStyle = `rgb(${Math.round(84 * shade)}, ${Math.round(74 * shade)}, ${Math.round(64 * shade)})`
      context.fillRect(column * cell + 1, row * cell + 1, cell - 2, cell - 2)
    }
  }

  addGrain(context, size, random, 14)
  return finish(canvas, 1)
}

/** Teto, quase liso: nada ali deve competir com a leitura do combate. */
export function createCeilingTexture(): Texture {
  const size = 64
  const { canvas, context } = createCanvas(size)
  const random = seededRandom(0xce11)

  context.fillStyle = '#2a2520'
  context.fillRect(0, 0, size, size)
  addGrain(context, size, random, 12)

  return finish(canvas, 1)
}
