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
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
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
  PMREMGenerator,
  PointLight,
  Scene,
  Vector2,
  Vector3,
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
import type { ConjuntoTexturas, TexturasDeMundo } from './worldTextures'

/** Quantos rastros de tiro cabem na tela ao mesmo tempo. */
const MAX_TRACES = 32

/** Quantos decais de impacto cabem na arena ao mesmo tempo. */
const MAX_DECALS = 12

/** Quanto tempo um decal de impacto fica visivel antes de sumir, em ms. */
const DECAL_VIDA_MS = 8000

/**
 * Quantos traçadores em volume (o cilindro que substitui a linha de 1px)
 * cabem simultaneos. Um por disparo — rifle e escopeta usam o mesmo, a
 * escopeta so aponta na direcao media dos 7 chumbos. 10 da folga para tiros
 * em sequencia rapida sem reciclar um traçador ainda visivel.
 */
const MAX_TRACE_BEAMS = 10

/** Raio do traçador em volume, em map units. */
const TRACE_BEAM_RAIO = 0.45

/**
 * O feixe nasce este tanto A FRENTE da boca do cano, nao nela: um cilindro
 * colado na camera vira uma cunha branca de meia tela (conferido em captura)
 * — a espessura constante em world units explode em screen space no perto.
 */
const TRACE_BEAM_RECUO_INICIAL = 72

/** Vida do traçador em volume, em ms — rapido o bastante para nao virar
 *  rastro permanente, lento o bastante para o olho pegar a trajetoria. */
const TRACE_BEAM_VIDA_MS = 130

/** Opacidade inicial do traçador em volume. */
const TRACE_BEAM_OPACIDADE = 0.85

/** Cor quente quase-branca do traçador. Mantida abaixo do estouro do bloom
 *  (limiar 0.92): nenhum canal chega a 1.0. */
const TRACE_BEAM_COR = 0xffe6c4

/**
 * Opacidade-alvo das 7 linhas de chumbo da escopeta quando o traçador central
 * assume o protagonismo — eram 0.7 (via traceTimer), agora contexto, nao
 * historia principal. O rifle usa 0, a linha de 1px some e so o cilindro fala.
 */
// Zero: as 7 linhas de chumbo eram exatamente o "difuso" que o dono pediu
// para tirar (e apareciam como fios verticais em quadro congelado). O feixe
// central + o flash de impacto contam a historia; a dispersao REAL dos
// chumbos continua na simulacao, so nao vira macarrao na tela.
const TRACE_LINE_OPACIDADE_ESCOPETA = 0

/** Fracao do comprimento original que cada linha de chumbo da escopeta
 *  mantem — mais curta reforça que e contexto, nao o traçado principal. */
const TRACE_LINE_ENCURTAMENTO_ESCOPETA = 0.55

/** Quantos flashes de impacto cabem simultaneos — um por disparo. */
const MAX_IMPACT_FLASHES = 10

/** Tamanho do flash de impacto, em map units. */
const IMPACT_FLASH_TAMANHO = 24

/** Vida do flash de impacto, em ms — um pop curto, nao uma luz que persiste. */
const IMPACT_FLASH_VIDA_MS = 90

/** Opacidade inicial do flash de impacto. */
const IMPACT_FLASH_OPACIDADE = 0.85

/** Cor do flash quando o tiro bate em parede/caixa. */
const IMPACT_FLASH_COR_PAREDE = 0xffc98a

/** Cor do flash quando o tiro acerta inimigo — avermelhada, ecoa o sangue. */
const IMPACT_FLASH_COR_ACERTO = 0xff5a42

/** Quantidade de particulas de sangue por chumbo que acerta o inimigo. Antes
 *  era 5 — mais encorpado deixa o acerto mais visivel no meio do combate. */
const SANGUE_QTD_POR_ACERTO = 9

const COR_NEBLINA = 0x2a2620

// --- Calibracao usada so quando usarTexturasDeMundo() troca o procedural
// pelas texturas reais do Poly Haven (ver ADR 0005). Sem chamada, nenhuma
// destas constantes entra em jogo. ---

/**
 * Normal scale para os normal maps reais (nor_gl do Poly Haven). Eles ja sao
 * calibrados — a escala 1.0 padrao do three.js da o relevo correto. Os
 * valores antigos passados a surfaceMaterial (1.1 a 1.4) compensavam o
 * heightToNormal procedural, que e mais fraco; reaplica-los aqui exageraria o
 * relevo das texturas reais.
 */
const TEXTURA_REAL_NORMAL_SCALE = 1.0

// Metalness recalibrado por material real, e nao mais pela luminancia do
// ruido procedural (que so aproximava "parece metal"/"parece concreto").
// Tijolo e concreto sao dieletricos, perto de 0; a chapa metalica do
// teto/obstaculos e metal de verdade.
const TEXTURA_REAL_METALNESS_PAREDE = 0.05
const TEXTURA_REAL_METALNESS_PISO = 0.05
const TEXTURA_REAL_METALNESS_METAL = 0.75

/**
 * O HDRI vira luz ambiente (via scene.environment) por cima da AmbientLight e
 * da HemisphereLight ja calibradas para a cena 100% procedural — sem reduzir
 * as duas, a arena sai mais clara do que o combate foi balanceado. Fator
 * empirico, nao fisico: so evita a dupla contagem de luz ambiente.
 */
const HDRI_REDUCAO_LUZ_AMBIENTE = 0.45

/**
 * As luzes foram calibradas para as albedos ESCURAS do procedural; as fotos
 * reais (tijolo areia, concreto claro) refletem muito mais e a mesma luz
 * lavava a cena inteira — conferido em captura. Sol tambem cai quando as
 * texturas reais entram.
 */
const SOL_REDUCAO_TEXTURA_REAL = 0.7

/**
 * Dose do environment POR MATERIAL. O scene.environmentIntensity global se
 * mostrou inerte nesta versao (conferido por A/B ao vivo: env inteiro ligado
 * lavava a cena com o valor 0.32 setado; anulado, a cena voltava ao humor
 * certo). O envMapIntensity de MeshStandardMaterial e a alavanca que o
 * renderer respeita de fato. Dieletricos quase nao refletem; o metal precisa
 * do reflexo para nao virar breu.
 */
const TEXTURA_REAL_ENVMAP_DIELETRICO = 0.3
const TEXTURA_REAL_ENVMAP_METAL = 0.6

/**
 * Quanto do HDRI entra como luz/reflexo. Em 1.0 a oficina abandonada (quente
 * e clara) lavava a arena inteira num tom laranja estourado — conferido em
 * captura de tela, nao em suposicao. O ambiente e tempero, nao sol.
 */
const HDRI_INTENSIDADE = 0.32

/**
 * Lado do ladrilho de cada textura real, em map units (24,4u ~ 1 m).
 *
 * O repeat NAO e herdado do procedural: la um "bloco" de 128u carregava um
 * padrao desenhado para isso; a foto 2K do Poly Haven cobre ~2 m fisicos, e
 * herdad o repeat antigo esticava tijolo em 5 m e concreto em 10 m — o piso
 * parecia tabua corrida (conferido em captura). Valores um pouco acima do
 * fisico (2,6 m) para o tiling nao serrilhar de longe.
 */
const TILE_PAREDE = 64
const TILE_PISO = 64
const TILE_TETO = 96
const TILE_OBSTACULO = 64

// Auxiliares estaticos do modulo para orientar o traçador em volume sem
// alocar Vector3 novo a cada disparo — regra de zero alocacao por tiro.
const EIXO_Y_AUX = new Vector3(0, 1, 0)
const direcaoTraceBeamAux = new Vector3()

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
  private readonly ambientLight: AmbientLight
  private readonly hemiLight: HemisphereLight
  private readonly governor: QualityGovernor

  // Materiais existentes de cada superficie da arena — guardados para
  // usarTexturasDeMundo() poder trocar map/normalMap/roughnessMap depois que
  // a arena ja foi montada, sem duplicar a montagem.
  private readonly materialChao: MeshStandardMaterial
  private readonly materialTeto: MeshStandardMaterial
  private readonly materialParede: MeshStandardMaterial
  private readonly materialObstaculo: MeshStandardMaterial

  private recoil = 0
  private flashTimer = 0

  private readonly decalPool: Array<{ mesh: Mesh; material: MeshBasicMaterial; vidaMs: number }> = []
  private proximoDecal = 0

  private readonly traceBeamPool: Array<{
    mesh: Mesh
    material: MeshBasicMaterial
    vidaMs: number
  }> = []
  private proximoTraceBeam = 0

  private readonly impactFlashPool: Array<{
    mesh: Mesh
    material: MeshBasicMaterial
    vidaMs: number
  }> = []
  private proximoImpactFlash = 0

  private readonly traceLines: LineSegments
  private readonly tracePositions = new Float32Array(MAX_TRACES * 6)
  private traceTimer = 0
  /** Opacidade-alvo das linhas finas de chumbo neste disparo — 0 no rifle
   *  (o cilindro conta a historia sozinho), fraca na escopeta (contexto). */
  private traceLineOpacidadeAlvo = 0

  private readonly enemyTraceLines: LineSegments
  private readonly enemyTracePositions = new Float32Array(MAX_TRACES * 6)
  private enemyTraceTimer = 0

  private readonly particles: ParticleSystem

  /** Atraso do conjunto arma-maos em relacao ao giro do mouse. */
  private readonly inclinacao = { x: 0, y: 0 }
  private balanco = 0

  /** Dimensoes da arena, para calcular o repeat das texturas reais. */
  private readonly arenaSize: number
  private readonly arenaWallHeight: number

  constructor(private readonly canvas: HTMLCanvasElement, arena: Arena) {
    this.arenaSize = arena.size
    this.arenaWallHeight = arena.wallHeight
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

    const lights = this.buildLights(arena)
    this.sun = lights.sun
    this.ambientLight = lights.ambientLight
    this.hemiLight = lights.hemiLight

    const materiaisArena = this.buildArena(arena)
    this.materialChao = materiaisArena.chao
    this.materialTeto = materiaisArena.teto
    this.materialParede = materiaisArena.parede
    this.materialObstaculo = materiaisArena.obstaculo

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
    this.buildTraceBeams()
    this.buildImpactFlashes()

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
   * Troca os mapas procedurais pelas texturas PBR reais (ver ADR 0005) e liga
   * o HDRI como environment map. Chamado uma UNICA vez pelo orquestrador
   * (main.ts), depois do portao de carregamento e antes da primeira partida.
   *
   * Sem chamada, nada muda: o fallback procedural continua integral, porque
   * os materiais ja nascem funcionais no construtor.
   *
   * Falha e isolada por superficie: um conjunto null (a textura daquela
   * superficie nao carregou) so deixa aquela superficie procedural — as
   * outras trocam normalmente.
   */
  usarTexturasDeMundo(t: TexturasDeMundo): void {
    // So os diffs de piso e parede pedem anisotropia: sao as duas superficies
    // vistas em angulo raso (chao aos pes, parede de raspao ao correr), onde
    // a textura borra sem ela. Teto e obstaculos sao vistos de frente ou de
    // longe, o custo extra nao se paga.
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())

    const lado = this.arenaSize
    const algumConjunto = Boolean(t.piso || t.parede || t.teto)
    if (algumConjunto) this.sun.intensity *= SOL_REDUCAO_TEXTURA_REAL
    if (t.piso) {
      this.trocarConjunto(this.materialChao, t.piso, TEXTURA_REAL_METALNESS_PISO, aniso, true,
        lado / TILE_PISO, lado / TILE_PISO)
    }
    if (t.parede) {
      this.trocarConjunto(this.materialParede, t.parede, TEXTURA_REAL_METALNESS_PAREDE, aniso, true,
        lado / TILE_PAREDE, this.arenaWallHeight / TILE_PAREDE)
    }
    if (t.teto) {
      // Teto e obstaculos usam o mesmo conjunto metal_plate (ver mapeamento
      // do ADR 0005) — dois materiais distintos, dois clones, cada um com o
      // ladrilho proprio.
      this.trocarConjunto(this.materialTeto, t.teto, TEXTURA_REAL_METALNESS_METAL, aniso, false,
        lado / TILE_TETO, lado / TILE_TETO)
      this.trocarConjunto(this.materialObstaculo, t.teto, TEXTURA_REAL_METALNESS_METAL, aniso, false,
        256 / TILE_OBSTACULO, 256 / TILE_OBSTACULO)
    }

    if (t.hdri) {
      const pmrem = new PMREMGenerator(this.renderer)
      this.scene.environment = pmrem.fromEquirectangular(t.hdri).texture
      this.scene.environmentIntensity = HDRI_INTENSIDADE
      pmrem.dispose()
      // A textura equirretangular crua ja foi convertida para o cubemap
      // filtrado que o PMREMGenerator gerou; nao serve mais para nada.
      t.hdri.dispose()

      this.ambientLight.intensity *= HDRI_REDUCAO_LUZ_AMBIENTE
      this.hemiLight.intensity *= HDRI_REDUCAO_LUZ_AMBIENTE
    }
  }

  /**
   * Troca map/normalMap/roughnessMap de UM material existente pelos mapas
   * reais, clonando as texturas do conjunto — o mesmo motivo do clone que ja
   * existia entre parede e obstaculo com os mapas procedurais: cada material
   * tem seu proprio repeat, entao nao da para compartilhar a textura entre
   * dois materiais sem um pisar no repeat do outro.
   *
   * O repeat e copiado do mapa procedural que esta saindo — e ele quem sabe
   * quantas vezes essa superficie especifica repete a textura, calculado a
   * partir do tamanho da arena em buildArena().
   */
  private trocarConjunto(
    material: MeshStandardMaterial,
    conjunto: ConjuntoTexturas,
    metalness: number,
    aniso: number,
    aplicarAniso: boolean,
    repeatX: number,
    repeatY: number,
  ): void {
    const mapaAntigo = material.map
    const normalAntigo = material.normalMap
    const roughAntigo = material.roughnessMap

    const diff = conjunto.diff.clone()
    const normal = conjunto.normal.clone()
    const rough = conjunto.rough.clone()

    // Repeat calculado pelo ladrilho FISICO da textura real (ver TILE_*), e
    // nao herdado do procedural — os dois sistemas medem coisas diferentes.
    diff.repeat.set(repeatX, repeatY)
    normal.repeat.set(repeatX, repeatY)
    rough.repeat.set(repeatX, repeatY)

    if (aplicarAniso) diff.anisotropy = aniso

    diff.needsUpdate = true
    normal.needsUpdate = true
    rough.needsUpdate = true

    material.map = diff
    material.normalMap = normal
    material.roughnessMap = rough
    material.metalness = metalness
    material.envMapIntensity =
      metalness > 0.5 ? TEXTURA_REAL_ENVMAP_METAL : TEXTURA_REAL_ENVMAP_DIELETRICO
    material.normalScale.setScalar(TEXTURA_REAL_NORMAL_SCALE)
    material.needsUpdate = true

    // Os mapas procedurais saindo nao servem mais para nada — cada um e uma
    // CanvasTexture unica deste material, nunca compartilhada.
    mapaAntigo?.dispose()
    normalAntigo?.dispose()
    roughAntigo?.dispose()
  }

  /**
   * Luz.
   *
   * Uma direcional com sombra da o volume — sem sombra projetada, pilar e
   * inimigo parecem adesivos colados no chao. A ambiente e a hemisferica
   * garantem que nada fique preto de vez, porque legibilidade do combate vem
   * antes de atmosfera.
   */
  private buildLights(arena: Arena): {
    sun: DirectionalLight
    ambientLight: AmbientLight
    hemiLight: HemisphereLight
  } {
    // Neutro de proposito. As texturas ja sao quentes; somar luz quente por
    // cima deixava a arena inteira avermelhada e apagava o contraste do imp,
    // que e laranja, contra o fundo.
    const ambientLight = new AmbientLight(0x7c8088, 1.35)
    const hemiLight = new HemisphereLight(0xaebcd2, 0x4a4a4a, 1.0)
    this.scene.add(ambientLight)
    this.scene.add(hemiLight)

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
    return { sun, ambientLight, hemiLight }
  }

  private buildArena(arena: Arena): {
    chao: MeshStandardMaterial
    teto: MeshStandardMaterial
    parede: MeshStandardMaterial
    obstaculo: MeshStandardMaterial
  } {
    const tiles = arena.size / 256

    const materialChao = surfaceMaterial(createFloorSurface(), tiles, { metalness: 0.35, normalScale: 1.1 })
    const chao = new Mesh(new PlaneGeometry(arena.size, arena.size), materialChao)
    chao.rotation.x = -Math.PI / 2
    chao.receiveShadow = true
    this.scene.add(chao)

    const materialTeto = surfaceMaterial(createCeilingSurface(), tiles, { metalness: 0.05 })
    const teto = new Mesh(new PlaneGeometry(arena.size, arena.size), materialTeto)
    teto.rotation.x = Math.PI / 2
    teto.position.y = arena.wallHeight
    this.scene.add(teto)

    const paredeMaps = createWallSurface()
    const materialParede = surfaceMaterial(paredeMaps, 1, { metalness: 0.06, normalScale: 1.4 })
    const sala = new Mesh(new BoxGeometry(arena.size, arena.wallHeight, arena.size), materialParede)
    materialParede.side = BackSide
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

    return { chao: materialChao, teto: materialTeto, parede: materialParede, obstaculo: materialObstaculo }
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

  /**
   * Deposito do traçador em volume: um cilindro fino por slot, reaproveitado
   * em anel — mesmo raciocinio do deposito de decais e do de particulas.
   * Geometria unica compartilhada entre os slots; cada um so muda posicao,
   * orientacao e escala, nunca aloca malha nova por tiro.
   */
  private buildTraceBeams(): void {
    // Poucos segmentos radiais: visto quase sempre de raspao, no meio do
    // combate ninguem nota a diferenca entre 6 e 16 lados de um tubo de 130ms.
    const geometry = new CylinderGeometry(TRACE_BEAM_RAIO, TRACE_BEAM_RAIO, 1, 6, 1, true)

    for (let i = 0; i < MAX_TRACE_BEAMS; i++) {
      const material = new MeshBasicMaterial({
        color: TRACE_BEAM_COR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: false,
      })

      const mesh = new Mesh(geometry, material)
      mesh.visible = false
      mesh.frustumCulled = false
      this.scene.add(mesh)
      this.traceBeamPool.push({ mesh, material, vidaMs: 0 })
    }
  }

  /**
   * Acende um traçador em volume de `from` a `to`, na mesma cota Y (os tiros
   * do jogador sempre viajam nessa altura fixa — ver onFire). O cilindro
   * nasce apontando em Y; giramos essa direcao unitaria ate o rumo do tiro e
   * esticamos so o eixo local Y pelo comprimento, sem alocar vetor novo por
   * disparo (os auxiliares sao estaticos do modulo).
   */
  private emitirTraceBeam(fromX: number, y: number, fromZ: number, toX: number, toZ: number): void {
    const dx = toX - fromX
    const dz = toZ - fromZ
    const total = Math.hypot(dx, dz)
    // Recuo so quando ha percurso de sobra; tiro a queima-roupa fica sem
    // feixe (o flash de impacto conta a historia sozinho nessa distancia).
    if (total < TRACE_BEAM_RECUO_INICIAL + 24) return
    const inicioX = fromX + (dx / total) * TRACE_BEAM_RECUO_INICIAL
    const inicioZ = fromZ + (dz / total) * TRACE_BEAM_RECUO_INICIAL
    const comprimento = total - TRACE_BEAM_RECUO_INICIAL

    const slot = this.traceBeamPool[this.proximoTraceBeam]!
    this.proximoTraceBeam = (this.proximoTraceBeam + 1) % this.traceBeamPool.length

    direcaoTraceBeamAux.set(dx, 0, dz).normalize()
    slot.mesh.quaternion.setFromUnitVectors(EIXO_Y_AUX, direcaoTraceBeamAux)
    slot.mesh.position.set(
      inicioX + direcaoTraceBeamAux.x * comprimento * 0.5,
      y,
      inicioZ + direcaoTraceBeamAux.z * comprimento * 0.5,
    )
    slot.mesh.scale.set(1, comprimento, 1)

    slot.mesh.visible = true
    slot.material.opacity = TRACE_BEAM_OPACIDADE
    slot.vidaMs = TRACE_BEAM_VIDA_MS
  }

  /** Some os traçadores em volume aos poucos, com decaimento rapido — o
   *  pedido era "menos difuso", entao o fim precisa ser nitido, nao um
   *  esmaecer lento igual ao decal de parede. */
  private atualizarTraceBeams(deltaMs: number): void {
    for (const slot of this.traceBeamPool) {
      if (slot.vidaMs <= 0) continue

      slot.vidaMs -= deltaMs
      if (slot.vidaMs <= 0) {
        slot.mesh.visible = false
        slot.material.opacity = 0
        continue
      }

      const restante = slot.vidaMs / TRACE_BEAM_VIDA_MS
      slot.material.opacity = TRACE_BEAM_OPACIDADE * restante * restante
    }
  }

  /**
   * Deposito de flashes de impacto: sprites aditivos billboard, no mesmo
   * padrao radial em canvas usado pelo decal e pelas particulas — nucleo
   * quase solido que esvanece rapido, so que redondo e sempre de frente para
   * a camera, para marcar com nitidez ONDE o tiro terminou.
   */
  private buildImpactFlashes(): void {
    const textura = criarTexturaClarao()
    const geometry = new PlaneGeometry(1, 1)

    for (let i = 0; i < MAX_IMPACT_FLASHES; i++) {
      const material = new MeshBasicMaterial({
        map: textura,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: false,
      })

      const mesh = new Mesh(geometry, material)
      mesh.visible = false
      mesh.frustumCulled = false
      this.scene.add(mesh)
      this.impactFlashPool.push({ mesh, material, vidaMs: 0 })
    }
  }

  /**
   * Acende um flash no ponto exato onde o traçador termina.
   *
   * @param acerto cor quente em parede, avermelhada quando o tiro acertou
   *   inimigo — o mesmo campo `hit` do ShotTrace que ja decide faisca vs
   *   sangue, reaproveitado aqui.
   */
  private emitirImpactFlash(x: number, y: number, z: number, acerto: boolean): void {
    const slot = this.impactFlashPool[this.proximoImpactFlash]!
    this.proximoImpactFlash = (this.proximoImpactFlash + 1) % this.impactFlashPool.length

    slot.mesh.position.set(x, y, z)
    // Billboard simples: encara a camera no instante do disparo. O flash some
    // em 90ms, entao nao vale o custo de atualizar isso todo quadro.
    slot.mesh.quaternion.copy(this.camera.quaternion)
    const escala = IMPACT_FLASH_TAMANHO * (0.85 + Math.random() * 0.3)
    slot.mesh.scale.set(escala, escala, 1)
    slot.material.color.set(acerto ? IMPACT_FLASH_COR_ACERTO : IMPACT_FLASH_COR_PAREDE)

    slot.mesh.visible = true
    slot.material.opacity = IMPACT_FLASH_OPACIDADE
    slot.vidaMs = IMPACT_FLASH_VIDA_MS
  }

  /** Mesmo esquema de decaimento rapido dos traçadores: o flash precisa
   *  sumir com nitidez, nao arrastar um brilho residual pela cena. */
  private atualizarImpactFlashes(deltaMs: number): void {
    for (const slot of this.impactFlashPool) {
      if (slot.vidaMs <= 0) continue

      slot.vidaMs -= deltaMs
      if (slot.vidaMs <= 0) {
        slot.mesh.visible = false
        slot.material.opacity = 0
        continue
      }

      const restante = slot.vidaMs / IMPACT_FLASH_VIDA_MS
      slot.material.opacity = IMPACT_FLASH_OPACIDADE * restante * restante
    }
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

  /** Registra o disparo: recuo, clarao, traçador em volume e rastros dos chumbos. */
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
    // Unico sinal disponivel aqui para distinguir rifle de escopeta: rifle
    // sempre manda 1 traço (loadout.ts, pellets:1), escopeta sempre manda 7
    // (DOOM_WEAPONS.shotgun.pellets). onFire nao recebe o id da arma.
    const ehEscopeta = count > 1
    this.traceLineOpacidadeAlvo = ehEscopeta ? TRACE_LINE_OPACIDADE_ESCOPETA : 0

    let somaFromX = 0
    let somaFromZ = 0
    let somaToX = 0
    let somaToZ = 0
    let algumAcerto = false

    for (let i = 0; i < MAX_TRACES; i++) {
      const trace = i < count ? traces[i]! : null
      const offset = i * 6

      if (!trace) {
        this.tracePositions.fill(0, offset, offset + 6)
        continue
      }

      somaFromX += trace.fromX
      somaFromZ += trace.fromZ
      somaToX += trace.toX
      somaToZ += trace.toZ
      if (trace.hit) algumAcerto = true

      // Na escopeta as 7 linhas de chumbo viram contexto: mais curtas, o
      // traçador central e que mostra o trajeto. No rifle o comprimento fica
      // integral, mas a opacidade acima ja zera a linha mesmo assim.
      const toX = ehEscopeta
        ? trace.fromX + (trace.toX - trace.fromX) * TRACE_LINE_ENCURTAMENTO_ESCOPETA
        : trace.toX
      const toZ = ehEscopeta
        ? trace.fromZ + (trace.toZ - trace.fromZ) * TRACE_LINE_ENCURTAMENTO_ESCOPETA
        : trace.toZ

      this.tracePositions[offset] = trace.fromX
      this.tracePositions[offset + 1] = eyeY - 3
      this.tracePositions[offset + 2] = trace.fromZ
      this.tracePositions[offset + 3] = toX
      this.tracePositions[offset + 4] = eyeY - 3
      this.tracePositions[offset + 5] = toZ
    }

    this.traceLines.geometry.attributes.position!.needsUpdate = true

    // Traçador principal em volume: um so por disparo, na direcao media do
    // tiro. No rifle (1 traço) a media e o proprio traço, entao o cilindro
    // vai exatamente do cano ao ponto de impacto. Na escopeta a media dos 7
    // chumbos da a direcao central pedida — sem duplicar logica entre as duas
    // armas. O flash de impacto acende no mesmo ponto medio, avermelhado se
    // qualquer chumbo acertou o inimigo.
    if (count > 0) {
      const mediaFromX = somaFromX / count
      const mediaFromZ = somaFromZ / count
      const mediaToX = somaToX / count
      const mediaToZ = somaToZ / count

      this.emitirTraceBeam(mediaFromX, eyeY - 3, mediaFromZ, mediaToX, mediaToZ)
      this.emitirImpactFlash(mediaToX, eyeY - 3, mediaToZ, algumAcerto)
    }

    // Faisca na parede, sangue no alvo: a cor do respingo diz se o tiro
    // acertou antes que a barra de vida do inimigo mude.
    for (let i = 0; i < count; i++) {
      const trace = traces[i]!
      const dirX = trace.fromX - trace.toX
      const dirZ = trace.fromZ - trace.toZ
      const comprimento = Math.hypot(dirX, dirZ) || 1

      if (trace.hit) {
        // Sangue continua no sentido do disparo (o oposto de dirX/dirZ, que
        // aponta de volta para o cano) — o jato sai pelo lado oposto ao
        // impacto, como uma ferida de saida, em vez de espirrar na cara de
        // quem atirou.
        this.particles.emitir(
          'sangue',
          trace.toX,
          eyeY - 3,
          trace.toZ,
          SANGUE_QTD_POR_ACERTO,
          -dirX / comprimento,
          -dirZ / comprimento,
        )
      } else {
        this.particles.emitir(
          'faisca',
          trace.toX,
          eyeY - 3,
          trace.toZ,
          3,
          dirX / comprimento,
          dirZ / comprimento,
        )

        // Decal so quando o tiro NAO acertou inimigo — trace.hit ja e a mesma
        // distincao que decide faisca vs sangue acima, entao reaproveita.
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
    this.atualizarTraceBeams(deltaMs)
    this.atualizarImpactFlashes(deltaMs)

    const traceMaterial = this.traceLines.material as LineBasicMaterial
    traceMaterial.opacity = this.traceTimer * this.traceLineOpacidadeAlvo
    this.traceLines.visible = this.traceTimer > 0.01 && this.traceLineOpacidadeAlvo > 0

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

/** Textura do flash de impacto, gerada uma unica vez e reusada por todo o pool. */
let texturaClaraoCache: CanvasTexture | null = null

/**
 * Nucleo quase solido que esvanece rapido — o mesmo padrao de gradiente
 * radial do sprite de particulas (spriteRedondo em particles.ts), so que mais
 * compacto no centro para ler como "pancada" pontual, nao "nuvem".
 */
function criarTexturaClarao(): CanvasTexture {
  if (texturaClaraoCache) return texturaClaraoCache

  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D indisponivel neste navegador')

  const centro = size / 2
  const gradiente = ctx.createRadialGradient(centro, centro, 0, centro, centro, centro)
  gradiente.addColorStop(0, 'rgba(255,255,255,1)')
  gradiente.addColorStop(0.35, 'rgba(255,255,255,0.9)')
  gradiente.addColorStop(0.7, 'rgba(255,255,255,0.25)')
  gradiente.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradiente
  ctx.fillRect(0, 0, size, size)

  texturaClaraoCache = new CanvasTexture(canvas)
  return texturaClaraoCache
}

export { Color }
