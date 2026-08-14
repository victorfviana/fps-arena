/**
 * Particulas: faiscas de impacto, fumaca e poeira.
 *
 * Um unico `Points` com posicoes pre-alocadas, e nao um objeto por particula.
 * Criar e descartar malhas a cada tiro produziria coleta de lixo justamente
 * durante o combate — o momento em que um engasgo mais custa.
 *
 * O deposito e circular: quando enche, a particula mais antiga e reaproveitada.
 * Isso limita o custo por quadro independentemente de quanto o jogador atira.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Points,
  PointsMaterial,
  Scene,
} from 'three'

const MAX_PARTICULAS = 420

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
}

const PERFIS: Record<ParticleKind, Perfil> = {
  // Faisca: rapida, quente e curta. Marca o ponto exato do impacto na parede.
  faisca: { cor: [1.0, 0.78, 0.34], vidaMs: 260, velocidade: 420, gravidade: 1, tamanho: 5, arrasto: 1.6 },
  // Fumaca: lenta, sobe e some. Vida curta de proposito — a primeira versao
  // durava quase um segundo e o chao ficava salpicado de bolotas claras que
  // nao eram nada no jogo, so ruido visual atrapalhando a leitura.
  fumaca: { cor: [0.55, 0.55, 0.54], vidaMs: 420, velocidade: 48, gravidade: -0.1, tamanho: 11, arrasto: 3.0 },
  // Sangue: escuro e pesado, para separar acerto em inimigo de acerto em parede.
  sangue: { cor: [0.62, 0.10, 0.10], vidaMs: 380, velocidade: 260, gravidade: 1.4, tamanho: 7, arrasto: 1.2 },
}

export class ParticleSystem {
  private readonly posicoes = new Float32Array(MAX_PARTICULAS * 3)
  private readonly cores = new Float32Array(MAX_PARTICULAS * 3)
  private readonly velocidades = new Float32Array(MAX_PARTICULAS * 3)
  private readonly vida = new Float32Array(MAX_PARTICULAS)
  private readonly vidaTotal = new Float32Array(MAX_PARTICULAS)
  private readonly gravidadeEscala = new Float32Array(MAX_PARTICULAS)
  private readonly arrasto = new Float32Array(MAX_PARTICULAS)

  private readonly pontos: Points
  private proximo = 0

  constructor(scene: Scene) {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(this.posicoes, 3))
    geometry.setAttribute('color', new BufferAttribute(this.cores, 3))

    const material = new PointsMaterial({
      size: 6,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      // Aditivo: faisca e clarao somam luz, em vez de tapar o que esta atras.
      blending: AdditiveBlending,
      sizeAttenuation: true,
      fog: false,
    })

    this.pontos = new Points(geometry, material)
    // A caixa envolvente muda a cada quadro; deixar o culling ligado faria o
    // sistema inteiro sumir quando a caixa ficasse desatualizada.
    this.pontos.frustumCulled = false
    scene.add(this.pontos)

    // Toda particula comeca morta e fora de vista.
    this.posicoes.fill(0)
    this.vida.fill(0)
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
    const perfil = PERFIS[kind]

    for (let i = 0; i < quantidade; i++) {
      const indice = this.proximo
      this.proximo = (this.proximo + 1) % MAX_PARTICULAS

      const p = indice * 3
      this.posicoes[p] = x
      this.posicoes[p + 1] = y
      this.posicoes[p + 2] = z

      // Cone em torno da direcao dada, com metade da forca vindo do acaso.
      const angulo = Math.random() * Math.PI * 2
      const inclinacao = Math.random() * 0.9
      const forca = perfil.velocidade * (0.45 + Math.random() * 0.55)

      this.velocidades[p] = (dirX * 0.7 + Math.cos(angulo) * inclinacao) * forca
      this.velocidades[p + 1] = (0.35 + Math.random() * 0.75) * forca
      this.velocidades[p + 2] = (dirZ * 0.7 + Math.sin(angulo) * inclinacao) * forca

      const variacao = 0.82 + Math.random() * 0.36
      this.cores[p] = perfil.cor[0] * variacao
      this.cores[p + 1] = perfil.cor[1] * variacao
      this.cores[p + 2] = perfil.cor[2] * variacao

      const vidaMs = perfil.vidaMs * (0.7 + Math.random() * 0.6)
      this.vida[indice] = vidaMs
      this.vidaTotal[indice] = vidaMs
      this.gravidadeEscala[indice] = perfil.gravidade
      this.arrasto[indice] = perfil.arrasto
    }

    this.pontos.geometry.attributes.position!.needsUpdate = true
    this.pontos.geometry.attributes.color!.needsUpdate = true
  }

  /** Avanca todas as particulas vivas. */
  update(deltaMs: number): void {
    const dt = Math.min(deltaMs, 50) / 1000
    let alguemVivo = false

    for (let i = 0; i < MAX_PARTICULAS; i++) {
      if (this.vida[i]! <= 0) continue

      alguemVivo = true
      this.vida[i] = this.vida[i]! - deltaMs

      const p = i * 3
      if (this.vida[i]! <= 0) {
        // Some do campo de visao em vez de ficar um ponto parado na origem.
        this.posicoes[p + 1] = -10000
        continue
      }

      this.velocidades[p + 1] = this.velocidades[p + 1]! + GRAVIDADE * this.gravidadeEscala[i]! * dt

      const perda = Math.max(0, 1 - this.arrasto[i]! * dt)
      this.velocidades[p] = this.velocidades[p]! * perda
      this.velocidades[p + 1] = this.velocidades[p + 1]! * perda
      this.velocidades[p + 2] = this.velocidades[p + 2]! * perda

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
