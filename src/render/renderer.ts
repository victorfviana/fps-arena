/**
 * Camada de desenho.
 *
 * Tres passadas por quadro, nesta ordem:
 *   1. O mundo, com o campo de visao horizontal de 90 graus do DOOM.
 *   2. O viewmodel (bracos e arma), em cena e camera proprias, com campo de
 *      visao estreito e limpando so a profundidade — assim a arma nunca
 *      atravessa parede e nao sai deformada pela perspectiva larga.
 *   3. Bloom e correcao de cor sobre o conjunto.
 *
 * O mundo inteiro vive em map units do DOOM, a mesma unidade da fisica. A
 * camera fixa o campo de visao HORIZONTAL; o Three.js pede o vertical, entao
 * convertemos a cada mudanca de proporcao da janela. Sem isso, uma tela
 * ultrawide entregaria mais visao periferica e mudaria a dificuldade do jogo.
 */

import {
  ACESFilmicToneMapping,
  AmbientLight,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Fog,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  Vector2,
  WebGLRenderer,
} from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

import { FOV_HORIZONTAL_DEG, VIEW_HEIGHT } from '../core/doom'
import type { EnemyShot, ShotTrace } from '../game'
import type { LoadoutId } from '../weapons/loadout'
import type { Arena } from '../world/arena'
import {
  createCeilingSurface,
  createFloorSurface,
  createWallSurface,
  surfaceMaterial,
  type SurfaceMaps,
} from './materials'
import { ParticleSystem } from './particles'
import { QUALITY_PRESETS, QualityGovernor, type QualityLevel, type QualitySettings } from './quality'
import { ViewModel } from './viewmodel'

/** Quantos rastros de tiro cabem na tela ao mesmo tempo. */
const MAX_TRACES = 32

/** Quantos decais de impacto cabem na arena ao mesmo tempo. */
const MAX_DECALS = 12

/** Quanto tempo um decal de impacto fica visivel antes de sumir, em ms. */
const DECAL_VIDA_MS = 8000

const COR_NEBLINA = 0x2a2620

export class Renderer {
  readonly scene = new Scene()
  readonly camera: PerspectiveCamera
  readonly viewModel = new ViewModel()

  private readonly renderer: WebGLRenderer
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly playerLight: PointLight
  private readonly muzzleLight: PointLight
  private readonly sun: DirectionalLight
  private readonly governor: QualityGovernor

  private recoil = 0
  private flashTimer = 0

  private readonly decalPool: Array<{ mesh: Mesh; material: MeshBasicMaterial; vidaMs: number }> = []
  private proximoDecal = 0

  private readonly traceLines: LineSegments
  private readonly tracePositions = new Float32Array(MAX_TRACES * 6)
  private traceTimer = 0

  private readonly enemyTraceLines: LineSegments
  private readonly enemyTracePositions = new Float32Array(MAX_TRACES * 6)
  private enemyTraceTimer = 0

  private readonly particles: ParticleSystem

  /** Atraso do conjunto arma-maos em relacao ao giro do mouse. */
  private readonly inclinacao = { x: 0, y: 0 }
  private balanco = 0

  constructor(private readonly canvas: HTMLCanvasElement, arena: Arena) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setClearColor(COR_NEBLINA)
    // Tone mapping filmico: sem ele as luzes fortes estouram em branco chapado
    // e a cena inteira parece lavada, que era exatamente o defeito anterior.
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap
    // O viewmodel entra numa segunda passada; limpar automaticamente apagaria
    // o mundo desenhado antes dele.
    this.renderer.autoClear = false

    this.camera = new PerspectiveCamera(75, 1, 1, 8000)
    this.camera.rotation.order = 'YXZ'
    this.camera.position.set(arena.playerStart.x, VIEW_HEIGHT, arena.playerStart.z)

    // Near a 35% do lado da arena, far a 105%. A visada mais longa possivel e
    // a diagonal da sala fechada, arena.size * raiz(2) — com arena.size=2048
    // isso da uns 2896 unidades. O far anterior (size*1.1 = 2252) ficava
    // AQUEM dessa diagonal, entao nenhum ponto visivel da arena chegava perto
    // dele: a neblina nunca tinha efeito visual, so existia no codigo.
    this.scene.fog = new Fog(COR_NEBLINA, arena.size * 0.35, arena.size * 1.05)

    this.sun = this.buildLights(arena)
    this.buildArena(arena)

    // Quase branca: qualquer tom quente aqui e multiplicado pelas texturas,
    // que ja sao quentes, e o resultado tinge a arena inteira de vermelho.
    this.playerLight = new PointLight(0xfffaf2, 1.15, 1500, 1.1)
    this.scene.add(this.playerLight)

    // Luz do clarao do tiro: curto alcance e decai rapido, so para o trecho
    // de parede/chao mais proximo reagir ao disparo. Intensidade contida de
    // proposito — o limiar do bloom e 0.92, e um pulso forte aqui estouraria
    // o metal da arma no viewmodel junto.
    this.muzzleLight = new PointLight(0xffb060, 0, 340, 2)
    this.scene.add(this.muzzleLight)

    this.traceLines = this.buildTraces(0xffe0a0, this.tracePositions)
    this.enemyTraceLines = this.buildTraces(0xff5a3c, this.enemyTracePositions)
    this.particles = new ParticleSystem(this.scene)
    this.buildDecals()

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))

    const viewPass = new RenderPass(this.viewModel.scene, this.viewModel.camera)
    // Nao limpa a cor: o viewmodel e desenhado por cima do mundo. A limpeza da
    // profundidade acontece no proprio passe, o que impede a arma de ser
    // recortada por parede encostada.
    viewPass.clear = false
    viewPass.clearDepth = true
    this.composer.addPass(viewPass)

    // Limiar alto e forca contida: o bloom deve pegar so o clarao do tiro e as
    // luzes, nao espalhar brilho quente por parede iluminada — era dai que
    // vinha parte da dominante avermelhada.
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.3, 0.65, 0.92)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.governor = new QualityGovernor('alto', (_nivel, settings) => {
      this.aplicarQualidade(settings)
    })
    this.aplicarQualidade(QUALITY_PRESETS.alto)

    this.resize()
    window.addEventListener('resize', this.resize)
  }

  /**
   * Luz.
   *
   * Uma direcional com sombra da o volume — sem sombra projetada, pilar e
   * inimigo parecem adesivos colados no chao. A ambiente e a hemisferica
   * garantem que nada fique preto de vez, porque legibilidade do combate vem
   * antes de atmosfera.
   */
  private buildLights(arena: Arena): DirectionalLight {
    // Neutro de proposito. As texturas ja sao quentes; somar luz quente por
    // cima deixava a arena inteira avermelhada e apagava o contraste do imp,
    // que e laranja, contra o fundo.
    this.scene.add(new AmbientLight(0x7c8088, 1.35))
    this.scene.add(new HemisphereLight(0xaebcd2, 0x4a4a4a, 1.0))

    const sun = new DirectionalLight(0xfff4e4, 2.0)
    sun.position.set(arena.size * 0.35, arena.wallHeight * 3.2, arena.size * 0.2)
    sun.castShadow = true

    const alcance = arena.size * 0.62
    sun.shadow.camera.left = -alcance
    sun.shadow.camera.right = alcance
    sun.shadow.camera.top = alcance
    sun.shadow.camera.bottom = -alcance
    sun.shadow.camera.near = 10
    sun.shadow.camera.far = arena.wallHeight * 8
    // Escala do mundo e grande; sem este afastamento a sombra sai listrada.
    sun.shadow.bias = -0.0016
    sun.shadow.normalBias = 2.5

    this.scene.add(sun)
    this.scene.add(sun.target)
    return sun
  }

  private buildArena(arena: Arena): void {
    const tiles = arena.size / 256

    const chao = new Mesh(
      new PlaneGeometry(arena.size, arena.size),
      surfaceMaterial(createFloorSurface(), tiles, { metalness: 0.35, normalScale: 1.1 }),
    )
    chao.rotation.x = -Math.PI / 2
    chao.receiveShadow = true
    this.scene.add(chao)

    const teto = new Mesh(
      new PlaneGeometry(arena.size, arena.size),
      surfaceMaterial(createCeilingSurface(), tiles, { metalness: 0.05 }),
    )
    teto.rotation.x = Math.PI / 2
    teto.position.y = arena.wallHeight
    this.scene.add(teto)

    const paredeMaps = createWallSurface()
    const sala = new Mesh(
      new BoxGeometry(arena.size, arena.wallHeight, arena.size),
      surfaceMaterial(paredeMaps, 1, { metalness: 0.06, normalScale: 1.4 }),
    )
    ;(sala.material as MeshStandardMaterial).side = BackSide
    // A caixa envolvente usa uma repeticao propria: as paredes sao muito mais
    // largas que altas, e uma repeticao uniforme esticaria os blocos.
    // Escala do bloco, e nao "um numero que parece bom": a textura traz 6
    // fileiras por repeticao, entao repetir a cada 128 unidades da blocos de
    // cerca de 21 unidades de altura. A 32 unidades por metro isso e um bloco
    // de concreto de uns 65 cm — grande, coerente com a arquitetura da arena.
    // A versao anterior repetia a cada 320 e produzia tijolos de dois metros.
    const escalaBloco = 128
    for (const textura of [paredeMaps.map, paredeMaps.normalMap, paredeMaps.roughnessMap]) {
      textura.repeat.set(arena.size / escalaBloco, arena.wallHeight / escalaBloco)
      textura.needsUpdate = true
    }
    sala.position.y = arena.wallHeight / 2
    sala.receiveShadow = true
    this.scene.add(sala)

    // Os obstaculos usam a mesma escala de bloco das paredes, senao pilar e
    // parede parecem feitos de materiais de tamanhos diferentes. Antes disso
    // gerava a textura de parede DE NOVO so por causa da repeticao diferente
    // — rodava o gerador de ruido e o normal map pela segunda vez para um
    // resultado identico. clone() da uma textura com repeat proprio sem
    // regerar um pixel: mesma imagem, wrapping independente.
    const paredeMapsObstaculo: SurfaceMaps = {
      map: paredeMaps.map.clone(),
      normalMap: paredeMaps.normalMap.clone(),
      roughnessMap: paredeMaps.roughnessMap.clone(),
    }
    for (const textura of Object.values(paredeMapsObstaculo)) textura.needsUpdate = true

    const materialObstaculo = surfaceMaterial(paredeMapsObstaculo, 256 / escalaBloco, {
      metalness: 0.1,
      normalScale: 1.2,
    })

    for (const box of arena.boxes) {
      const mesh = new Mesh(new BoxGeometry(box.width, box.height, box.depth), materialObstaculo)
      mesh.position.set(box.x, box.height / 2, box.z)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.scene.add(mesh)
    }
  }

  private buildTraces(color: number, positions: Float32Array): LineSegments {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))

    const lines = new LineSegments(
      geometry,
      new LineBasicMaterial({ color, transparent: true, opacity: 0, fog: false }),
    )
    lines.frustumCulled = false
    this.scene.add(lines)
    return lines
  }

  /**
   * Deposito de decais de impacto na parede.
   *
   * Mesmo raciocinio do sistema de particulas: um pool fixo, criado uma vez,
   * reaproveitado em anel. Nenhum tiro aloca malha ou material novo.
   */
  private buildDecals(): void {
    const textura = criarTexturaDecal()
    const geometry = new PlaneGeometry(24, 24)

    for (let i = 0; i < MAX_DECALS; i++) {
      const material = new MeshBasicMaterial({
        map: textura,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: DoubleSide,
        // Sem isso o decal, colado na mesma cota da parede, treme (z-fight)
        // contra a propria parede quando a camera se afasta.
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      })

      const mesh = new Mesh(geometry, material)
      mesh.visible = false
      mesh.frustumCulled = false
      this.scene.add(mesh)
      this.decalPool.push({ mesh, material, vidaMs: 0 })
    }
  }

  /**
   * Cola um decal no ponto de impacto.
   *
   * @param dirX,dirZ direcao normalizada de volta a origem do tiro — a mesma
   *   usada para o jato de faisca. Paredes e caixas da arena sao alinhadas
   *   aos eixos, entao o eixo dominante dessa direcao aproxima bem a normal
   *   da superficie sem precisar consultar a geometria.
   */
  private emitirDecal(x: number, y: number, z: number, dirX: number, dirZ: number): void {
    const normalX = Math.abs(dirX) >= Math.abs(dirZ) ? Math.sign(dirX) || 1 : 0
    const normalZ = normalX === 0 ? Math.sign(dirZ) || 1 : 0

    const slot = this.decalPool[this.proximoDecal]!
    this.proximoDecal = (this.proximoDecal + 1) % this.decalPool.length

    // Afasta um triz da superficie na direcao da normal, para nao brigar com
    // ela por profundidade, e orienta o plano para encarar essa mesma direcao.
    // O plano de PlaneGeometry encara +Z por padrao; girar em Y o aponta para
    // +-X ou mantem/inverte para +-Z, conforme o eixo dominante do impacto.
    const rotacaoY = normalX !== 0 ? Math.sign(normalX) * (Math.PI / 2) : normalZ > 0 ? 0 : Math.PI
    const rotacaoRolagem = (Math.random() - 0.5) * 0.6 // variedade, sem desalinhar da parede

    slot.mesh.position.set(x + normalX * 0.6, y, z + normalZ * 0.6)
    slot.mesh.rotation.set(0, rotacaoY, rotacaoRolagem)
    slot.mesh.scale.setScalar(0.8 + Math.random() * 0.5)

    slot.mesh.visible = true
    slot.material.opacity = 0.85
    slot.vidaMs = DECAL_VIDA_MS
  }

  private aplicarQualidade(settings: QualitySettings): void {
    this.renderer.shadowMap.enabled = settings.shadows
    this.sun.castShadow = settings.shadows
    this.sun.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize)
    // Descartar o mapa antigo forca o Three a recriar no tamanho novo.
    this.sun.shadow.map?.dispose()
    this.sun.shadow.map = null

    this.bloom.enabled = settings.bloom
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatio))
    this.resize()
  }

  /** Nivel de qualidade em vigor, para o painel de diagnostico. */
  get qualidade(): QualityLevel {
    return this.governor.nivel
  }

  /** Registra o disparo: recuo, clarao e rastros dos chumbos. */
  onFire(traces: readonly ShotTrace[], eyeY: number): void {
    this.recoil = 1
    this.flashTimer = 1
    this.traceTimer = 1

    // O clarao ate aqui so acendia o viewmodel — o mundo em volta do jogador
    // nao reagia ao proprio tiro. Reaproveita o mesmo flashTimer que decai em
    // updateEffects(), so que pulsando luz de verdade na cena em vez de so
    // trocar emissive na arma; a intensidade e aplicada la, junto do decaimento.
    this.muzzleLight.position.set(this.camera.position.x, eyeY, this.camera.position.z)

    const count = Math.min(traces.length, MAX_TRACES)
    for (let i = 0; i < MAX_TRACES; i++) {
      const trace = i < count ? traces[i]! : null
      const offset = i * 6

      if (!trace) {
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

    // Faisca na parede, sangue no alvo: a cor do respingo diz se o tiro
    // acertou antes que a barra de vida do inimigo mude.
    for (let i = 0; i < count; i++) {
      const trace = traces[i]!
      const dirX = trace.fromX - trace.toX
      const dirZ = trace.fromZ - trace.toZ
      const comprimento = Math.hypot(dirX, dirZ) || 1

      this.particles.emitir(
        trace.hit ? 'sangue' : 'faisca',
        trace.toX,
        eyeY - 3,
        trace.toZ,
        trace.hit ? 5 : 3,
        dirX / comprimento,
        dirZ / comprimento,
      )

      // Decal so quando o tiro NAO acertou inimigo — trace.hit ja e a mesma
      // distincao que decide faisca vs sangue acima, entao reaproveita.
      if (!trace.hit) {
        this.emitirDecal(
          trace.toX, eyeY - 3, trace.toZ,
          dirX / comprimento, dirZ / comprimento,
        )
      }
    }

    // Fumaca na boca do cano, ligeiramente a frente do jogador.
    const frenteX = -Math.sin(this.camera.rotation.y)
    const frenteZ = -Math.cos(this.camera.rotation.y)
    this.particles.emitir(
      'fumaca',
      this.camera.position.x + frenteX * 40,
      eyeY - 6,
      this.camera.position.z + frenteZ * 40,
      2,
      frenteX,
      frenteZ,
    )
  }

  /** Registra os tiros que vieram dos inimigos. */
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

  /** Troca a arma mostrada no viewmodel. */
  setWeapon(id: LoadoutId): void {
    this.viewModel.mostrar(id)
  }

  /**
   * Baque na altura do corpo quando o inimigo morre.
   *
   * Separado do respingo do tiro de proposito: o tiro marca onde acertou, a
   * morte marca quem caiu. Sao duas informacoes diferentes, e no meio de uma
   * onda o jogador precisa das duas.
   */
  onEnemyDeath(x: number, y: number, z: number): void {
    this.particles.emitir('sangue', x, y, z, 14)
  }

  /**
   * Posiciona a camera no olho do jogador.
   *
   * @param adsProgress 0 no quadril, 1 apontado — fecha o campo de visao.
   */
  setView(
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    adsProgress: number,
    fovAlvoDeg: number,
  ): void {
    this.camera.position.set(x, y + this.recoil * 1.2, z)
    this.camera.rotation.set(pitch + this.recoil * 0.03, yaw, 0)
    this.playerLight.position.set(x, y + 8, z)

    // A sombra acompanha o jogador: um mapa que cobrisse a arena inteira com
    // resolucao util custaria caro demais.
    this.sun.target.position.set(x, 0, z)
    this.sun.position.set(x + 900, 2600, z + 500)

    this.aplicarFov(fovAlvoDeg)
    this.adsAtual = adsProgress
  }

  private adsAtual = 0
  private fovAplicado = -1

  private aplicarFov(fovHorizontalDeg: number): void {
    if (Math.abs(fovHorizontalDeg - this.fovAplicado) < 0.01) return
    this.fovAplicado = fovHorizontalDeg

    const aspect = this.camera.aspect
    this.camera.fov = horizontalToVerticalFov(fovHorizontalDeg, aspect)
    this.camera.updateProjectionMatrix()
  }

  /**
   * Atualiza os efeitos que decaem com o tempo real.
   *
   * @param deltaMs tempo desde o quadro anterior. O decaimento e por tempo, e
   *   nao por quadro, senao o clarao duraria o dobro num monitor de 30 Hz.
   */
  updateEffects(
    deltaMs: number,
    estado: {
      swapProgress: number
      velocidadeNormalizada: number
      giroMouse: { x: number; y: number }
    },
  ): void {
    this.recoil = decay(this.recoil, deltaMs, 90)
    this.flashTimer = decay(this.flashTimer, deltaMs, 55)
    this.traceTimer = decay(this.traceTimer, deltaMs, 70)
    this.enemyTraceTimer = decay(this.enemyTraceTimer, deltaMs, 260)
    this.particles.update(deltaMs)

    // A luz do clarao segue o mesmo decaimento do flashTimer que ja movia o
    // brilho do viewmodel — os dois apagam juntos, sem cronometro proprio.
    this.muzzleLight.intensity = this.flashTimer * 3.2

    this.atualizarDecais(deltaMs)

    const traceMaterial = this.traceLines.material as LineBasicMaterial
    traceMaterial.opacity = this.traceTimer * 0.7
    this.traceLines.visible = this.traceTimer > 0.01

    const enemyMaterial = this.enemyTraceLines.material as LineBasicMaterial
    enemyMaterial.opacity = this.enemyTraceTimer * 0.9
    this.enemyTraceLines.visible = this.enemyTraceTimer > 0.01

    // Balanco do passo, em fase com o tempo real e proporcional a velocidade.
    this.balanco += (deltaMs / 1000) * 9 * estado.velocidadeNormalizada

    // O atraso da arma persegue o giro do mouse e volta ao centro sozinho.
    const alvoX = clamp(estado.giroMouse.x * 0.9, -0.06, 0.06)
    const alvoY = clamp(estado.giroMouse.y * 0.9, -0.05, 0.05)
    const suavizacao = Math.min(1, deltaMs / 90)
    this.inclinacao.x += (alvoX - this.inclinacao.x) * suavizacao
    this.inclinacao.y += (alvoY - this.inclinacao.y) * suavizacao

    this.viewModel.posicionar(
      this.adsAtual,
      this.recoil,
      estado.swapProgress,
      this.balanco,
      estado.velocidadeNormalizada,
      this.inclinacao,
    )
    this.viewModel.clarao(this.flashTimer)
  }

  /** Some com os decais aos poucos, so no ultimo trecho de vida. */
  private atualizarDecais(deltaMs: number): void {
    const FADE_MS = 1500

    for (const slot of this.decalPool) {
      if (slot.vidaMs <= 0) continue

      slot.vidaMs -= deltaMs
      if (slot.vidaMs <= 0) {
        slot.mesh.visible = false
        slot.material.opacity = 0
        continue
      }

      slot.material.opacity = slot.vidaMs < FADE_MS ? (slot.vidaMs / FADE_MS) * 0.85 : 0.85
    }
  }

  /**
   * Restaura o governador de qualidade ao estado inicial da sessao.
   *
   * Chamado pelo orquestrador no restart da partida — sem isso, um teto
   * travado pela anti-oscilacao numa partida anterior (por exemplo, por causa
   * do engasgo de compilacao de shader logo no primeiro combate) persistiria
   * para sempre, mesmo que a maquina desse conta de mais qualidade.
   */
  resetQualidade(): void {
    this.governor.reset()
  }

  render(): void {
    this.renderer.clear()
    this.composer.render()
    this.governor.registrarQuadro(performance.now())
  }

  private readonly resize = () => {
    const width = this.canvas.clientWidth || window.innerWidth
    const height = this.canvas.clientHeight || window.innerHeight
    const aspect = width / height

    this.camera.aspect = aspect
    this.fovAplicado = -1
    this.aplicarFov(FOV_HORIZONTAL_DEG)
    this.viewModel.redimensionar(aspect)

    this.renderer.setSize(width, height, false)
    this.composer.setSize(width, height)
    this.bloom.setSize(width, height)
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize)
    this.renderer.dispose()
  }
}

/** Converte campo de visao horizontal em vertical, dada a proporcao da tela. */
export function horizontalToVerticalFov(horizontalDeg: number, aspect: number): number {
  const horizontalRad = (horizontalDeg * Math.PI) / 180
  const verticalRad = 2 * Math.atan(Math.tan(horizontalRad / 2) / aspect)
  return (verticalRad * 180) / Math.PI
}

/** Decaimento exponencial por tempo real, com meia-vida em milissegundos. */
function decay(value: number, deltaMs: number, halfLifeMs: number): number {
  if (value <= 0.001) return 0
  return value * Math.pow(0.5, deltaMs / halfLifeMs)
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/** Textura do decal, gerada uma unica vez e reusada por todo o pool. */
let texturaDecalCache: CanvasTexture | null = null

/**
 * Furo de impacto: mancha escura com o centro mais fechado e borda
 * esfarelada, em vez de um circulo perfeito — chumbo nao faz buraco redondo.
 */
function criarTexturaDecal(): CanvasTexture {
  if (texturaDecalCache) return texturaDecalCache

  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D indisponivel neste navegador')

  const centro = size / 2
  const gradiente = ctx.createRadialGradient(centro, centro, 1, centro, centro, centro * 0.85)
  gradiente.addColorStop(0, 'rgba(8,7,6,0.88)')
  gradiente.addColorStop(0.5, 'rgba(20,17,14,0.55)')
  gradiente.addColorStop(1, 'rgba(20,17,14,0)')
  ctx.fillStyle = gradiente
  ctx.beginPath()
  ctx.arc(centro, centro, centro * 0.85, 0, Math.PI * 2)
  ctx.fill()

  // Borda irregular: respingos pequenos ao redor do furo principal, com
  // semente fixa para o resultado ser sempre o mesmo.
  let seed = 0xdeca1
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
  }
  for (let i = 0; i < 14; i++) {
    const angulo = random() * Math.PI * 2
    const distancia = centro * (0.55 + random() * 0.4)
    const raio = 1.5 + random() * 4
    ctx.fillStyle = `rgba(15,12,10,${0.25 + random() * 0.35})`
    ctx.beginPath()
    ctx.arc(centro + Math.cos(angulo) * distancia, centro + Math.sin(angulo) * distancia, raio, 0, Math.PI * 2)
    ctx.fill()
  }

  texturaDecalCache = new CanvasTexture(canvas)
  return texturaDecalCache
}

export { Color }
