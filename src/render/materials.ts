/**
 * Materiais PBR com texturas geradas em canvas.
 *
 * Continua valendo a regra de nenhum arquivo externo — o que muda e a
 * qualidade do que geramos. Antes era so cor chapada em `MeshLambertMaterial`,
 * o que da aquele aspecto de bloco de papel: sem relevo, toda superficie
 * reflete igual e o olho nao encontra escala nem material.
 *
 * Agora cada superficie sai com tres mapas:
 *   albedo    — a cor propriamente dita
 *   normal    — relevo falso, derivado de um mapa de altura
 *   roughness — onde brilha e onde e fosco
 *
 * O normal map e o que mais rende: e ele que faz a luz correr pela parede
 * quando o jogador anda, e sem isso nenhuma quantidade de pos-processamento
 * salva a cena.
 */

import {
  CanvasTexture,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three'

export interface SurfaceMaps {
  map: Texture
  normalMap: Texture
  roughnessMap: Texture
}

/** Gerador com semente: a mesma textura em toda execucao, sempre. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function makeCanvas(size: number): {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
} {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D indisponivel neste navegador')
  return { canvas, ctx }
}

function toTexture(canvas: HTMLCanvasElement, srgb: boolean, repeat: number): Texture {
  const texture = new CanvasTexture(canvas)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.repeat.set(repeat, repeat)
  texture.anisotropy = 8
  // So o albedo vive em espaco sRGB. Normal e rugosidade sao dados, nao cor —
  // marcar como cor os deixaria com gama aplicada e o relevo sairia errado.
  if (srgb) texture.colorSpace = SRGBColorSpace
  return texture
}

/**
 * Converte um mapa de altura em normal map, por diferenca finita.
 *
 * Para cada ponto, mede a inclinacao comparando os vizinhos em X e em Y; essa
 * inclinacao vira a direcao para onde a superficie aponta. E a forma mais
 * barata de obter relevo convincente sem modelar geometria nenhuma.
 */
function heightToNormal(height: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(size)
  const image = ctx.createImageData(size, size)

  const at = (x: number, y: number): number => {
    // Envolve nas bordas para a textura continuar sem costura visivel.
    const wx = (x + size) % size
    const wy = (y + size) % size
    return height[wy * size + wx]!
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength

      // Normaliza o vetor (dx, dy, 1) e leva de [-1,1] para [0,255].
      const length = Math.hypot(dx, dy, 1)
      const i = (y * size + x) * 4
      image.data[i] = ((dx / length) * 0.5 + 0.5) * 255
      image.data[i + 1] = ((dy / length) * 0.5 + 0.5) * 255
      image.data[i + 2] = ((1 / length) * 0.5 + 0.5) * 255
      image.data[i + 3] = 255
    }
  }

  ctx.putImageData(image, 0, 0)
  return canvas
}

/** Canvas em tons de cinza a partir de valores de 0 a 1. */
function grayscaleCanvas(values: Float32Array, size: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(size)
  const image = ctx.createImageData(size, size)

  for (let i = 0; i < values.length; i++) {
    const v = Math.max(0, Math.min(1, values[i]!)) * 255
    const p = i * 4
    image.data[p] = v
    image.data[p + 1] = v
    image.data[p + 2] = v
    image.data[p + 3] = 255
  }

  ctx.putImageData(image, 0, 0)
  return canvas
}

/** Ruido de valor com varias oitavas — a base de todo desgaste. */
function fractalNoise(size: number, seed: number, octaves = 4): Float32Array {
  const random = seededRandom(seed)
  const out = new Float32Array(size * size)
  let amplitude = 1
  let total = 0

  for (let o = 0; o < octaves; o++) {
    const cells = 2 << o
    const grid = new Float32Array(cells * cells)
    for (let i = 0; i < grid.length; i++) grid[i] = random()

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells
        const gy = (y / size) * cells
        const x0 = Math.floor(gx) % cells
        const y0 = Math.floor(gy) % cells
        const x1 = (x0 + 1) % cells
        const y1 = (y0 + 1) % cells
        const fx = gx - Math.floor(gx)
        const fy = gy - Math.floor(gy)

        // Suavizacao em curva S: interpolacao linear pura deixa um xadrez
        // visivel nas junções da grade.
        const sx = fx * fx * (3 - 2 * fx)
        const sy = fy * fy * (3 - 2 * fy)

        const top = grid[y0 * cells + x0]! * (1 - sx) + grid[y0 * cells + x1]! * sx
        const bottom = grid[y1 * cells + x0]! * (1 - sx) + grid[y1 * cells + x1]! * sx
        const indice = y * size + x
        out[indice] = out[indice]! + (top * (1 - sy) + bottom * sy) * amplitude
      }
    }

    total += amplitude
    amplitude *= 0.5
  }

  for (let i = 0; i < out.length; i++) out[i] = out[i]! / total
  return out
}

/**
 * Parede de blocos de concreto.
 *
 * A altura vem do padrao de blocos, com as juntas rebaixadas; o ruido por cima
 * quebra a regularidade. E a junta funda que da leitura de escala — sem ela a
 * parede podia ter tres metros ou trinta.
 */
export function createWallSurface(): SurfaceMaps {
  const size = 256
  const { canvas, ctx } = makeCanvas(size)
  const random = seededRandom(0x5eed)
  const noise = fractalNoise(size, 0x5eed, 5)

  const height = new Float32Array(size * size)
  const rough = new Float32Array(size * size)

  const rows = 6
  const blockH = size / rows
  const blockW = size / 3
  const joint = 4

  ctx.fillStyle = '#3c3833'
  ctx.fillRect(0, 0, size, size)

  for (let row = 0; row < rows; row++) {
    const offset = row % 2 === 0 ? 0 : blockW / 2
    for (let col = -1; col < 4; col++) {
      const x = col * blockW + offset
      const y = row * blockH
      const tom = 0.86 + random() * 0.28
      ctx.fillStyle = `rgb(${Math.round(118 * tom)},${Math.round(112 * tom)},${Math.round(103 * tom)})`
      ctx.fillRect(x + joint, y + joint, blockW - joint * 2, blockH - joint * 2)
    }
  }

  // Altura e rugosidade a partir do desenho: onde e junta, afunda e fica fosco.
  const pixels = ctx.getImageData(0, 0, size, size).data
  for (let i = 0; i < size * size; i++) {
    const luz = pixels[i * 4]! / 255
    const eJunta = luz < 0.45
    height[i] = (eJunta ? 0.15 : 0.85) + noise[i]! * 0.28
    rough[i] = eJunta ? 0.95 : 0.62 + noise[i]! * 0.25
  }

  // Manchas de umidade e sujeira, aplicadas depois para escurecer sem mexer
  // no relevo — sujeira nao muda a forma da parede, so como ela reflete.
  const img = ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < size * size; i++) {
    const mancha = 0.72 + noise[i]! * 0.5
    img.data[i * 4] = Math.min(255, img.data[i * 4]! * mancha)
    img.data[i * 4 + 1] = Math.min(255, img.data[i * 4 + 1]! * mancha)
    img.data[i * 4 + 2] = Math.min(255, img.data[i * 4 + 2]! * mancha * 0.97)
  }
  ctx.putImageData(img, 0, 0)

  return {
    map: toTexture(canvas, true, 1),
    normalMap: toTexture(heightToNormal(height, size, 2.4), false, 1),
    roughnessMap: toTexture(grayscaleCanvas(rough, size), false, 1),
  }
}

/** Piso de placas metalicas gastas, com rebites e riscos de uso. */
export function createFloorSurface(): SurfaceMaps {
  const size = 256
  const { canvas, ctx } = makeCanvas(size)
  const random = seededRandom(0xf100)
  const noise = fractalNoise(size, 0xf100, 5)

  ctx.fillStyle = '#2e2b28'
  ctx.fillRect(0, 0, size, size)

  const cells = 2
  const cell = size / cells
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const tom = 0.9 + random() * 0.2
      ctx.fillStyle = `rgb(${Math.round(92 * tom)},${Math.round(88 * tom)},${Math.round(84 * tom)})`
      ctx.fillRect(col * cell + 3, row * cell + 3, cell - 6, cell - 6)

      // Rebites nos cantos da placa.
      ctx.fillStyle = 'rgba(150,146,140,0.85)'
      for (const [rx, ry] of [[14, 14], [cell - 14, 14], [14, cell - 14], [cell - 14, cell - 14]]) {
        ctx.beginPath()
        ctx.arc(col * cell + rx!, row * cell + ry!, 3.2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  const pixels = ctx.getImageData(0, 0, size, size).data
  const height = new Float32Array(size * size)
  const rough = new Float32Array(size * size)
  for (let i = 0; i < size * size; i++) {
    const luz = pixels[i * 4]! / 255
    height[i] = luz * 0.7 + noise[i]! * 0.35
    // Metal pisado brilha mais no centro da placa e enferruja nas bordas.
    rough[i] = 0.45 + (1 - luz) * 0.4 + noise[i]! * 0.15
  }

  return {
    map: toTexture(canvas, true, 1),
    normalMap: toTexture(heightToNormal(height, size, 1.7), false, 1),
    roughnessMap: toTexture(grayscaleCanvas(rough, size), false, 1),
  }
}

/** Teto: escuro e fosco, sem detalhe que dispute atencao com o combate. */
export function createCeilingSurface(): SurfaceMaps {
  const size = 128
  const { canvas, ctx } = makeCanvas(size)
  const noise = fractalNoise(size, 0xce11, 4)

  const img = ctx.createImageData(size, size)
  const height = new Float32Array(size * size)
  const rough = new Float32Array(size * size)

  for (let i = 0; i < size * size; i++) {
    const n = noise[i]!
    const base = 38 + n * 26
    img.data[i * 4] = base
    img.data[i * 4 + 1] = base * 0.96
    img.data[i * 4 + 2] = base * 0.9
    img.data[i * 4 + 3] = 255
    height[i] = n
    rough[i] = 0.88 + n * 0.1
  }
  ctx.putImageData(img, 0, 0)

  return {
    map: toTexture(canvas, true, 1),
    normalMap: toTexture(heightToNormal(height, size, 1.1), false, 1),
    roughnessMap: toTexture(grayscaleCanvas(rough, size), false, 1),
  }
}

/** Monta o material a partir dos mapas, com a repeticao pedida. */
export function surfaceMaterial(
  maps: SurfaceMaps,
  repeat: number,
  options: { metalness?: number; normalScale?: number } = {},
): MeshStandardMaterial {
  for (const texture of [maps.map, maps.normalMap, maps.roughnessMap]) {
    texture.repeat.set(repeat, repeat)
    texture.needsUpdate = true
  }

  const material = new MeshStandardMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    roughnessMap: maps.roughnessMap,
    metalness: options.metalness ?? 0.08,
    roughness: 1,
  })

  if (options.normalScale !== undefined) {
    material.normalScale.setScalar(options.normalScale)
  }

  return material
}
