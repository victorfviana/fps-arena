/**
 * Particulas: faiscas de impacto, fumaca e sangue.
 *
 * Um `Points` por especie, cada um com posicoes pre-alocadas — e nao um objeto
 * por particula. Criar e descartar malhas a cada tiro produziria coleta de
 * lixo justamente durante o combate — o momento em que um engasgo mais custa.
 *
 * Um Points por especie, e nao um unico para as tres, porque o PointsMaterial
 * so aceita um tamanho por malha. Faisca, fumaca e sangue tem perfis de
 * tamanho bem diferentes (5, 11 e 7); um material compartilhado forcava tudo
 * para o mesmo tamanho fixo e o perfil de cada um virava letra morta.
 *
 * Cada especie mantem seu proprio deposito circular: quando enche, a
 * particula mais antiga daquela especie e reaproveitada. Isso limita o custo
 * por quadro independentemente de quanto o jogador atira.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  NormalBlending,
  Points,
  PointsMaterial,
  Scene,
} from 'three'

/**
 * Sprite circular compartilhado. Sem `map`, o PointsMaterial desenha cada
 * ponto como um QUADRADO de tela — invisivel com pontos de 5-6 px, gritante
 * quando a fumaca de 11 chega perto da camera. Branco de proposito: a cor
 * vem por vertice e o sprite so recorta a forma.
 */
let spriteRedondoCache: CanvasTexture | null = null

function spriteRedondo(): CanvasTexture {
  if (spriteRedondoCache) return spriteRedondoCache
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const gradiente = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradiente.addColorStop(0, 'rgba(255,255,255,1)')
  gradiente.addColorStop(0.55, 'rgba(255,255,255,0.85)')
  gradiente.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradiente
  ctx.fillRect(0, 0, 64, 64)
  spriteRedondoCache = new CanvasTexture(canvas)
  return spriteRedondoCache
}

/** Gravidade em map units por segundo ao quadrado. */
const GRAVIDADE = -900

export type ParticleKind = 'faisca' | 'fumaca' | 'sangue'

interface Perfil {
  cor: [number, number, number]
  vidaMs: number
  velocidade: number
  gravidade: number
  tamanho: number
  /** Fracao da velocidade perdida por segundo. */
  arrasto: number
  /** Quantas particulas desta especie cabem no deposito circular. */
  capacidade: number
  /** Opacidade de base do material. */
  opacidade: number
  /** Aditivo soma luz (faisca, sangue); fumaca pede blending normal, senao
   *  nuvens sobrepostas estouram em branco e param de parecer fumaca. */
  aditivo: boolean
}

const PERFIS: Record<ParticleKind, Perfil> = {
  // Faisca: rapida, quente e curta. Marca o ponto exato do impacto na parede.
  faisca: {
    cor: [1.0, 0.78, 0.34], vidaMs: 260, velocidade: 420, gravidade: 1,
    tamanho: 5, arrasto: 1.6, capacidade: 160, opacidade: 0.9, aditivo: true,
  },
  // Fumaca: lenta, sobe e some. Vida curta de proposito — a primeira versao
  // durava quase um segundo e o chao ficava salpicado de bolotas claras que
  // nao eram nada no jogo, so ruido visual atrapalhando a leitura.
  fumaca: {
    cor: [0.55, 0.55, 0.54], vidaMs: 420, velocidade: 48, gravidade: -0.1,
    tamanho: 11, arrasto: 3.0, capacidade: 100, opacidade: 0.55, aditivo: false,
  },
  // Sangue: escuro e pesado, para separar acerto em inimigo de acerto em parede.
  sangue: {
    cor: [0.62, 0.10, 0.10], vidaMs: 380, velocidade: 260, gravidade: 1.4,
    tamanho: 7, arrasto: 1.2, capacidade: 160, opacidade: 0.9, aditivo: true,
  },
}

/** Deposito circular de uma unica especie, com seu proprio Points. */
class EspeciePool {
  private readonly posicoes: Float32Array
  private readonly cores: Float32Array
  private readonly velocidades: Float32Array
  private readonly vida: Float32Array
  private readonly vidaTotal: Float32Array

  private readonly pontos: Points
  private proximo = 0

  constructor(private readonly perfil: Perfil, scene: Scene) {
    const capacidade = perfil.capacidade
    this.posicoes = new Float32Array(capacidade * 3)
    this.cores = new Float32Array(capacidade * 3)
    this.velocidades = new Float32Array(capacidade * 3)
    this.vida = new Float32Array(capacidade)
    this.vidaTotal = new Float32Array(capacidade)

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(this.posicoes, 3))
    geometry.setAttribute('color', new BufferAttribute(this.cores, 3))

    const material = new PointsMaterial({
      size: perfil.tamanho,
      map: spriteRedondo(),
      vertexColors: true,
      transparent: true,
      opacity: perfil.opacidade,
      depthWrite: false,
      blending: perfil.aditivo ? AdditiveBlending : NormalBlending,
      sizeAttenuation: true,
      fog: false,
    })

    this.pontos = new Points(geometry, material)
    // A caixa envolvente muda a cada quadro; deixar o culling ligado faria o
    // sistema inteiro sumir quando a caixa ficasse desatualizada.
    this.pontos.frustumCulled = false
    scene.add(this.pontos)

    this.posicoes.fill(0)
    this.vida.fill(0)
  }

  emitir(quantidade: number, x: number, y: number, z: number, dirX: number, dirZ: number): void {
    const capacidade = this.perfil.capacidade

    for (let i = 0; i < quantidade; i++) {
      const indice = this.proximo
      this.proximo = (this.proximo + 1) % capacidade

      const p = indice * 3
      this.posicoes[p] = x
      this.posicoes[p + 1] = y
      this.posicoes[p + 2] = z

      // Cone em torno da direcao dada, com metade da forca vindo do acaso.
      const angulo = Math.random() * Math.PI * 2
      const inclinacao = Math.random() * 0.9
      const forca = this.perfil.velocidade * (0.45 + Math.random() * 0.55)

      this.velocidades[p] = (dirX * 0.7 + Math.cos(angulo) * inclinacao) * forca
      this.velocidades[p + 1] = (0.35 + Math.random() * 0.75) * forca
      this.velocidades[p + 2] = (dirZ * 0.7 + Math.sin(angulo) * inclinacao) * forca

      const variacao = 0.82 + Math.random() * 0.36
      this.cores[p] = this.perfil.cor[0] * variacao
      this.cores[p + 1] = this.perfil.cor[1] * variacao
      this.cores[p + 2] = this.perfil.cor[2] * variacao

      const vidaMs = this.perfil.vidaMs * (0.7 + Math.random() * 0.6)
      this.vida[indice] = vidaMs
      this.vidaTotal[indice] = vidaMs
    }

    this.pontos.geometry.attributes.position!.needsUpdate = true
    this.pontos.geometry.attributes.color!.needsUpdate = true
  }

  /** Avanca as particulas vivas desta especie. */
  update(deltaMs: number): void {
    const dt = Math.min(deltaMs, 50) / 1000
    const capacidade = this.perfil.capacidade
    const gravidadeEscala = this.perfil.gravidade
    const perdaArrasto = Math.max(0, 1 - this.perfil.arrasto * dt)
    let alguemVivo = false

    for (let i = 0; i < capacidade; i++) {
      if (this.vida[i]! <= 0) continue

      alguemVivo = true
      this.vida[i] = this.vida[i]! - deltaMs

      const p = i * 3
      if (this.vida[i]! <= 0) {
        // Some do campo de visao em vez de ficar um ponto parado na origem.
        this.posicoes[p + 1] = -10000
        continue
      }

      this.velocidades[p + 1] = this.velocidades[p + 1]! + GRAVIDADE * gravidadeEscala * dt

      this.velocidades[p] = this.velocidades[p]! * perdaArrasto
      this.velocidades[p + 1] = this.velocidades[p + 1]! * perdaArrasto
      this.velocidades[p + 2] = this.velocidades[p + 2]! * perdaArrasto

      this.posicoes[p] = this.posicoes[p]! + this.velocidades[p]! * dt
      this.posicoes[p + 1] = this.posicoes[p + 1]! + this.velocidades[p + 1]! * dt
      this.posicoes[p + 2] = this.posicoes[p + 2]! + this.velocidades[p + 2]! * dt

      // Escurece conforme morre, para o sumico nao ser um corte seco.
      const restante = this.vida[i]! / this.vidaTotal[i]!
      const c = i * 3
      this.cores[c] = this.cores[c]! * (0.965 + restante * 0.035)
      this.cores[c + 1] = this.cores[c + 1]! * (0.965 + restante * 0.035)
      this.cores[c + 2] = this.cores[c + 2]! * (0.965 + restante * 0.035)

      // Ao tocar o chao a particula se apaga depressa, em vez de quicar e
      // ficar parada ali. Quicando, elas se acumulavam pela arena e o piso
      // virava um campo de bolotas que nao significavam nada.
      if (this.posicoes[p + 1]! < 3) {
        this.posicoes[p + 1] = 3
        this.velocidades[p] = this.velocidades[p]! * 0.3
        this.velocidades[p + 1] = 0
        this.velocidades[p + 2] = this.velocidades[p + 2]! * 0.3
        this.vida[i] = Math.min(this.vida[i]!, 90)
      }
    }

    if (!alguemVivo) return
    this.pontos.geometry.attributes.position!.needsUpdate = true
    this.pontos.geometry.attributes.color!.needsUpdate = true
  }
}

export class ParticleSystem {
  private readonly pools: Record<ParticleKind, EspeciePool>

  constructor(scene: Scene) {
    this.pools = {
      faisca: new EspeciePool(PERFIS.faisca, scene),
      fumaca: new EspeciePool(PERFIS.fumaca, scene),
      sangue: new EspeciePool(PERFIS.sangue, scene),
    }
  }

  /**
   * Espalha um punhado de particulas a partir de um ponto.
   *
   * @param dirX direcao preferencial do jato (a normal do impacto, por exemplo).
   */
  emitir(
    kind: ParticleKind,
    x: number,
    y: number,
    z: number,
    quantidade: number,
    dirX = 0,
    dirZ = 0,
  ): void {
    this.pools[kind].emitir(quantidade, x, y, z, dirX, dirZ)
  }

  /** Avanca todas as particulas vivas, nas tres especies. */
  update(deltaMs: number): void {
    this.pools.faisca.update(deltaMs)
    this.pools.fumaca.update(deltaMs)
    this.pools.sangue.update(deltaMs)
  }
}
