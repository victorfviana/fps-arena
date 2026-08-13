/**
 * Camada de desenho.
 *
 * Toda a cena vive em map units do DOOM — a mesma unidade da fisica. A camera
 * fixa o campo de visao HORIZONTAL em 90 graus, como o original; o Three.js
 * pede o vertical, entao convertemos a cada mudanca de proporcao da janela.
 * Sem isso, uma tela ultrawide entregaria mais visao periferica e mudaria a
 * dificuldade do jogo conforme o monitor.
 */

import {
  AmbientLight,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Fog,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  WebGLRenderer,
} from 'three'

import { FOV_HORIZONTAL_DEG, VIEW_HEIGHT } from '../core/doom'
import type { EnemyShot, ShotTrace } from '../game'
import type { Arena } from '../world/arena'
import { createCeilingTexture, createFloorTexture, createWallTexture } from './textures'

/** Quantos rastros de tiro cabem na tela ao mesmo tempo. */
const MAX_TRACES = 32

/** Converte campo de visao horizontal em vertical, dada a proporcao da tela. */
export function horizontalToVerticalFov(horizontalDeg: number, aspect: number): number {
  const horizontalRad = (horizontalDeg * Math.PI) / 180
  const verticalRad = 2 * Math.atan(Math.tan(horizontalRad / 2) / aspect)
  return (verticalRad * 180) / Math.PI
}

export class Renderer {
  readonly scene = new Scene()
  readonly camera: PerspectiveCamera
  private readonly renderer: WebGLRenderer
  private readonly playerLight: PointLight

  /** Arma presa a camera, com recuo. */
  private readonly viewmodel = new Group()
  private readonly muzzleFlash: Mesh
  private readonly muzzleLight: PointLight
  private recoil = 0
  private flashTimer = 0

  private readonly traceLines: LineSegments
  private readonly tracePositions = new Float32Array(MAX_TRACES * 6)
  private traceTimer = 0

  /** Rastros do tiro inimigo, em cor propria e com vida mais longa. */
  private readonly enemyTraceLines: LineSegments
  private readonly enemyTracePositions = new Float32Array(MAX_TRACES * 6)
  private enemyTraceTimer = 0

  constructor(private readonly canvas: HTMLCanvasElement, arena: Arena) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    })
    // Mesma cor da neblina: qualquer diferenca aqui vira uma borda visivel no
    // limite do alcance de visao.
    this.renderer.setClearColor(0x2a2620)

    this.camera = new PerspectiveCamera(75, 1, 1, 8000)
    // A ordem YXZ evita que o giro horizontal incline o horizonte quando o
    // jogador esta olhando para cima ou para baixo.
    this.camera.rotation.order = 'YXZ'
    this.camera.position.set(arena.playerStart.x, VIEW_HEIGHT, arena.playerStart.z)

    // Neblina na cor do fundo: esconde o limite do mundo e da profundidade
    // sem custo de geometria. Comeca tarde de proposito — puxar a neblina para
    // perto engolia a parede oposta e a arena parecia um corredor sem fim.
    this.scene.fog = new Fog(0x2a2620, arena.size * 1.1, arena.size * 2.6)

    this.buildLights()
    this.buildArena(arena)

    // Luz que acompanha o jogador. Alcance maior que a metade da arena para
    // que o inimigo se destaque do fundo antes de chegar perto demais.
    this.playerLight = new PointLight(0xfff2e0, 1.3, 1500, 1.1)
    this.scene.add(this.playerLight)

    this.muzzleFlash = this.buildViewmodel()
    this.muzzleLight = new PointLight(0xffc06a, 0, 700, 1.8)
    this.scene.add(this.muzzleLight)

    this.traceLines = this.buildTraces(0xffe0a0, this.tracePositions)
    // Vermelho quente para o tiro que vem em voce: precisa ser distinguivel do
    // proprio disparo num relance, sem exigir leitura.
    this.enemyTraceLines = this.buildTraces(0xff5a3c, this.enemyTracePositions)

    this.resize()
    window.addEventListener('resize', this.resize)
  }

  /**
   * Arma na tela.
   *
   * Nao e decoracao: sem uma referencia fixa no campo de visao, o jogador
   * perde a nocao de para onde esta apontando e o recuo nao tem em que se
   * apoiar. O modelo fica preso a camera, entao acompanha a mira sem calculo.
   */
  private buildViewmodel(): Mesh {
    // As medidas seguem do campo de visao, nao de chute. Com 90 graus na
    // horizontal e a arma a 30 unidades da camera, a altura visivel ali e de
    // cerca de 28 unidades: um cano de 4 ocupa uns 15% da tela, que e o que
    // da presenca sem tapar o alvo. A primeira versao ficava a 13 unidades e
    // era cortada pelo plano de corte proximo.
    const metal = new MeshLambertMaterial({ color: 0x3c3c3a })
    const wood = new MeshLambertMaterial({ color: 0x6b4526 })

    // A 35 unidades da camera, o campo visivel mede cerca de 70 por 33
    // unidades. Um cano de 3 de largura ocupa uns 4% da tela e o conjunto sai
    // do canto inferior direito. As duas versoes anteriores erraram por ficar
    // perto demais: a primeira era cortada pelo plano de corte, a segunda
    // tomava um terco da tela.
    const barrel = new Mesh(new BoxGeometry(3, 2.8, 28), metal)
    barrel.position.set(0, 0, -35)

    const stock = new Mesh(new BoxGeometry(3.8, 4.4, 14), wood)
    stock.position.set(0, -1.6, -14)

    const flash = new Mesh(
      new PlaneGeometry(15, 15),
      new MeshBasicMaterial({ color: 0xffcf7a, transparent: true, opacity: 0, fog: false }),
    )
    flash.position.set(0, 0.4, -51)

    this.viewmodel.add(barrel)
    this.viewmodel.add(stock)
    this.viewmodel.add(flash)
    // Abaixo e a direita do centro, como uma arma empunhada.
    this.viewmodel.position.set(12, -9, 0)
    this.viewmodel.rotation.set(0.04, 0.03, 0)
    this.camera.add(this.viewmodel)
    this.scene.add(this.camera)

    return flash
  }

  private buildTraces(color: number, positions: Float32Array): LineSegments {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))

    const lines = new LineSegments(
      geometry,
      new LineBasicMaterial({ color, transparent: true, opacity: 0, fog: false }),
    )
    // O rastro so vive alguns quadros; nao deve ser descartado pelo culling
    // quando a caixa envolvente ficar desatualizada.
    lines.frustumCulled = false
    this.scene.add(lines)

    return lines
  }

  /** Registra o disparo: recuo, clarao e rastros dos chumbos. */
  onFire(traces: readonly ShotTrace[], eyeY: number): void {
    this.recoil = 1
    this.flashTimer = 1
    this.traceTimer = 1

    const count = Math.min(traces.length, MAX_TRACES)
    for (let i = 0; i < MAX_TRACES; i++) {
      const trace = i < count ? traces[i]! : null
      const offset = i * 6

      if (!trace) {
        // Degenera o segmento em um ponto: nao aparece, e evita realocar
        // a geometria a cada disparo de arma com contagem diferente.
        this.tracePositions.fill(0, offset, offset + 6)
        continue
      }

      this.tracePositions[offset] = trace.fromX
      this.tracePositions[offset + 1] = eyeY - 3
      this.tracePositions[offset + 2] = trace.fromZ
      this.tracePositions[offset + 3] = trace.toX
      this.tracePositions[offset + 4] = eyeY - 3
      this.tracePositions[offset + 5] = trace.toZ
    }

    this.traceLines.geometry.attributes.position!.needsUpdate = true
  }

  /**
   * Registra os tiros que vieram nos inimigos.
   *
   * Desenhados da arma deles ate o jogador, na altura do olho. Duram mais que
   * o proprio disparo do jogador de proposito: quem levou o tiro precisa de
   * tempo para virar a cabeca e achar a origem.
   */
  onEnemyFire(shots: readonly EnemyShot[], eyeY: number): void {
    const rastros = shots.filter((shot) => !shot.melee)
    if (rastros.length === 0) return

    this.enemyTraceTimer = 1

    for (let i = 0; i < MAX_TRACES; i++) {
      const shot = i < rastros.length ? rastros[i]! : null
      const offset = i * 6

      if (!shot) {
        this.enemyTracePositions.fill(0, offset, offset + 6)
        continue
      }

      this.enemyTracePositions[offset] = shot.fromX
      this.enemyTracePositions[offset + 1] = eyeY - 6
      this.enemyTracePositions[offset + 2] = shot.fromZ
      this.enemyTracePositions[offset + 3] = shot.toX
      this.enemyTracePositions[offset + 4] = eyeY - 6
      this.enemyTracePositions[offset + 5] = shot.toZ
    }

    this.enemyTraceLines.geometry.attributes.position!.needsUpdate = true
  }

  private buildLights(): void {
    // A arena precisa ser legivel antes de ser atmosferica: com a iluminacao
    // baixa demais, a silhueta do inimigo some contra a parede e o combate
    // vira adivinhacao. Os valores ja subiram duas vezes depois de olhar a
    // tela em vez de confiar no numero — monitor e captura de tela mentem em
    // direcoes opostas, e no fim quem decide e o olho de quem joga.
    // Luz de cima levemente fria contra textura quente: sem isso a arena
    // inteira puxa para o vermelho quando a iluminacao sobe, e o imp — que e
    // laranja — deixa de se destacar do fundo.
    this.scene.add(new AmbientLight(0x8e909c, 2.3))
    this.scene.add(new HemisphereLight(0xc2ccdf, 0x585048, 1.7))
  }

  private buildArena(arena: Arena): void {
    const wallTexture = createWallTexture()
    const floorTexture = createFloorTexture()
    const ceilingTexture = createCeilingTexture()

    const tilesPerSide = arena.size / 128
    floorTexture.repeat.set(tilesPerSide, tilesPerSide)
    ceilingTexture.repeat.set(tilesPerSide, tilesPerSide)

    const floor = new Mesh(
      new PlaneGeometry(arena.size, arena.size),
      new MeshLambertMaterial({ map: floorTexture }),
    )
    floor.rotation.x = -Math.PI / 2
    this.scene.add(floor)

    const ceiling = new Mesh(
      new PlaneGeometry(arena.size, arena.size),
      new MeshLambertMaterial({ map: ceilingTexture }),
    )
    ceiling.rotation.x = Math.PI / 2
    ceiling.position.y = arena.wallHeight
    this.scene.add(ceiling)

    // Perimetro: uma caixa gigante desenhada por dentro custa menos que quatro
    // planos e nunca deixa fresta na quina.
    const room = new Mesh(
      new BoxGeometry(arena.size, arena.wallHeight, arena.size),
      new MeshLambertMaterial({ map: wallTexture, side: BackSide }),
    )
    room.position.y = arena.wallHeight / 2
    this.scene.add(room)

    const obstacleMaterial = new MeshLambertMaterial({ map: wallTexture })
    for (const box of arena.boxes) {
      const mesh = new Mesh(
        new BoxGeometry(box.width, box.height, box.depth),
        obstacleMaterial,
      )
      mesh.position.set(box.x, box.height / 2, box.z)
      this.scene.add(mesh)
    }
  }

  /** Posiciona a camera no olho do jogador. */
  setView(x: number, y: number, z: number, yaw: number, pitch: number): void {
    // O recuo empurra a camera para tras da mira, nao a mira para longe do
    // alvo: mexer no angulo faria o jogador perder o alvo a cada disparo.
    this.camera.position.set(x, y + this.recoil * 1.2, z)
    this.camera.rotation.set(pitch + this.recoil * 0.035, yaw, 0)
    this.playerLight.position.set(x, y + 8, z)

    this.viewmodel.position.z = this.recoil * 11
    this.viewmodel.position.y = -9 - this.recoil * 2.2
    this.viewmodel.rotation.x = 0.04 + this.recoil * 0.18
    this.muzzleLight.position.set(x, y, z)
  }

  /**
   * Faz decair os efeitos do disparo.
   *
   * @param deltaMs tempo real desde o quadro anterior. O decaimento e por
   *   tempo, e nao por quadro, senao o clarao duraria o dobro num monitor de
   *   30 Hz e metade num de 120 Hz.
   */
  updateEffects(deltaMs: number): void {
    this.recoil = decay(this.recoil, deltaMs, 90)
    this.flashTimer = decay(this.flashTimer, deltaMs, 55)
    this.traceTimer = decay(this.traceTimer, deltaMs, 70)

    const flashMaterial = this.muzzleFlash.material as MeshBasicMaterial
    flashMaterial.opacity = this.flashTimer
    this.muzzleFlash.visible = this.flashTimer > 0.01
    this.muzzleLight.intensity = this.flashTimer * 4

    const traceMaterial = this.traceLines.material as LineBasicMaterial
    traceMaterial.opacity = this.traceTimer * 0.7
    this.traceLines.visible = this.traceTimer > 0.01

    // Meia-vida bem maior: o rastro inimigo e a unica pista de onde veio o
    // dano, e some antes de ser lido se decair na mesma velocidade do seu.
    this.enemyTraceTimer = decay(this.enemyTraceTimer, deltaMs, 260)
    const enemyMaterial = this.enemyTraceLines.material as LineBasicMaterial
    enemyMaterial.opacity = this.enemyTraceTimer * 0.9
    this.enemyTraceLines.visible = this.enemyTraceTimer > 0.01
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }

  private readonly resize = () => {
    const width = this.canvas.clientWidth || window.innerWidth
    const height = this.canvas.clientHeight || window.innerHeight
    const aspect = width / height

    this.camera.aspect = aspect
    this.camera.fov = horizontalToVerticalFov(FOV_HORIZONTAL_DEG, aspect)
    this.camera.updateProjectionMatrix()

    // Teto de 2x no devicePixelRatio: acima disso o custo sobe rapido e o
    // ganho visual e pequeno, e queremos folga no orcamento de 60 fps.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(width, height, false)
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize)
    this.renderer.dispose()
  }
}

/** Decaimento exponencial por tempo real, com meia-vida em milissegundos. */
function decay(value: number, deltaMs: number, halfLifeMs: number): number {
  if (value <= 0.001) return 0
  return value * Math.pow(0.5, deltaMs / halfLifeMs)
}
