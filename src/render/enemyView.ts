/**
 * Desenho dos inimigos, com corpo articulado e caminhada.
 *
 * A versao anterior era uma caixa com uma bola em cima, deslizando pelo chao
 * como peca de tabuleiro. Depois ganhou torso, cabeca, dois bracos e duas
 * pernas, com a caminhada animada a partir da distancia percorrida — nao do
 * relogio. Esse corpo procedural continua existindo integralmente: e o
 * fallback que entra quando `usarModelos()` nunca e chamado, ou quando o
 * carregamento dos modelos gltf falha (ver enemyModels.ts).
 *
 * Com `usarModelos()`, cada view passa a clonar um modelo glb animado (Zombie
 * Apocalypse Kit, Quaternius, CC0 — ver CREDITS.md) e tocar
 * os clipes do proprio arquivo via AnimationMixer, em vez de girar bracos e
 * pernas a mao. As duas trilhas coexistem nesta classe porque a troca precisa
 * ser indolor: se o fetch dos modelos falhar, o jogo nao pode quebrar, so
 * ficar visualmente mais simples.
 *
 * As malhas — de um jeito ou de outro — sao reaproveitadas de um deposito:
 * criar e destruir geometria a cada onda produziria engasgo justamente no
 * momento de maior pressao.
 */

import {
  AnimationMixer,
  BoxGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Scene,
  SphereGeometry,
  type AnimationAction,
  type Material,
} from 'three'
import { clone as clonarComEsqueleto } from 'three/examples/jsm/utils/SkeletonUtils.js'

import type { Enemy, EnemyKind, EnemyState } from '../enemies/enemy'
import { ENEMIES, chaseSpeed, perTicToPerSecond } from '../core/doom'
import type { EnemyModel, EnemyModelSet } from './enemyModels'

/** Paleta por tipo, usada so pelo corpo procedural. Matizes distantes para o
 *  olho separar sem pensar. */
const PALETTE: Record<EnemyKind, { body: number; head: number; limb: number }> = {
  zombieman: { body: 0x5f7048, head: 0x8a9668, limb: 0x4a5838 },
  imp: { body: 0xa8442a, head: 0xd4703c, limb: 0x8a3520 },
  // Sargento: azul-ardosia, longe do verde do zumbi e do laranja do imp.
  // Vale so para o corpo procedural (fallback quando o fetch do modelo
  // falha) — o modelo gltf real (sargento.glb) e um arquivo proprio, com a
  // cor-base do proprio atlas, sem tingimento (ver buildModel).
  sergeant: { body: 0x3e5670, head: 0x6a86a4, limb: 0x2f4257 },
}

/** Cor do corpo no instante do dano. Vale para os dois caminhos. */
const PAIN_COLOR = new Color(0xffffff)

/**
 * Comprimento de um passo completo, em map units.
 *
 * Casado com a velocidade de perseguicao (2 unidades por tic, 70 por segundo):
 * da pouco mais de um passo por segundo, que e a cadencia de quem caminha
 * pesado. Passo curto demais vira corridinha nervosa.
 *
 * Usada nos dois caminhos: fase da animacao procedural (por distancia) e
 * timeScale do clipe Walk do modelo (ver tocarCaminhadaModelo). Mantenha em
 * sincronia com PASSO_STRIDE_INIMIGO em main.ts (o som de passo usa a mesma
 * constante).
 */
const STRIDE = 62

/** Duracao do crossfade entre clipes do modelo. Curto o bastante para nao
 *  atrasar a leitura do estado, longo o bastante para nao saltar duro. */
const CROSSFADE_S = 0.15

/**
 * Nome do clipe de perseguicao (chase) por tipo — tocado em loop, com
 * timeScale casado ao deslocamento real (ver tocarCaminhadaModelo).
 *
 * zombieman e sergeant andam de arma em punho: Walk_Gun e a mesma cadencia de
 * passada do Walk simples, so que com a pose de pontaria ja embutida no
 * clipe. O imp (brutamontes) corre com os bracos estendidos mesmo em chase —
 * Run_Arms e a assinatura visual dele, entao ele nao tem um "andar", so o
 * correr.
 */
const CLIPE_CAMINHADA: Record<EnemyKind, string> = {
  zombieman: 'Walk_Gun',
  sergeant: 'Walk_Gun',
  imp: 'Run_Arms',
}

/**
 * Nome do clipe de ataque por tipo. zombieman e sergeant param na pose de
 * pontaria (Idle_Gun) durante ATTACK_POSE_TICS — o dano em si vem da arma do
 * jogador, o clipe so precisa ler como "mirando parado". O imp soca (Punch) —
 * condizente com a divergencia declarada em enemy.ts (BEHAVIOUR): aqui o imp
 * e corpo a corpo, sem bola de fogo.
 */
const CLIPE_ATAQUE: Record<EnemyKind, string> = {
  zombieman: 'Idle_Gun',
  sergeant: 'Idle_Gun',
  imp: 'Punch',
}

/** Partes exclusivas do corpo procedural (fallback). */
interface ProceduralVisual {
  tipo: 'procedural'
  /** Tudo que balanca junto no passo, exceto as pernas. */
  torso: Group
  head: Mesh
  legLeft: Group
  legRight: Group
  armLeft: Group
  armRight: Group
}

/** Partes exclusivas do modelo gltf animado. */
interface ModelVisual {
  tipo: 'model'
  /**
   * Grupo-pai so para a correcao de orientacao (ver build de modelo). Fica
   * entre `group` (posicao/yaw do inimigo) e o clone (malha/esqueleto), para
   * a correcao nao se misturar com o yaw que a simulacao controla.
   */
  pivo: Group
  mixer: AnimationMixer
  /** Uma action por clipe do arquivo, criada uma unica vez no build da view
   *  — nunca por quadro. Chave = nome do clipe (Walk, Weapon, Punch, ...). */
  actions: Record<string, AnimationAction>
  currentAction: AnimationAction | null
  currentActionName: string | null
}

interface EnemyView {
  group: Group
  /** Blob shadow no chao, independente do grupo — assim ela nao inclina junto
   *  com o corpo na animacao de morte e continua lendo como "sombra no piso". */
  shadowMesh: Mesh
  kind: EnemyKind
  /** Materiais e cor-base para o tingimento por dano (aplicarCor). No corpo
   *  procedural sao os 3 materiais compartilhados por malha; no modelo, um
   *  clone por material original do gltf (ver buildModel). */
  materials: Material[]
  baseColors: Color[]
  /** Ultimo health e state aplicados, para aplicarCor() so recolorir quando
   *  algo de fato mudou (ver aplicarCor). */
  lastHealth: number
  lastState: EnemyState | null
  visual: ProceduralVisual | ModelVisual
}

export class EnemyRenderer {
  private readonly views = new Map<number, EnemyView>()
  private readonly pool: EnemyView[] = []

  /** Definido por usarModelos(); null = sempre corpo procedural. */
  private modelos: EnemyModelSet | null = null

  constructor(private readonly scene: Scene) {}

  /**
   * Liga o caminho de modelos gltf animados. Chame antes da primeira partida
   * (antes do primeiro sync() com inimigos vivos) — trocar no meio de uma
   * partida deixaria views ja construidas presas no formato antigo, porque
   * build() so decide o formato uma vez, na criacao da view.
   *
   * Sem chamar isto, o EnemyRenderer funciona exatamente como antes desta
   * mudanca: corpos procedurais, animados por rotacao manual.
   */
  usarModelos(modelos: EnemyModelSet): void {
    this.modelos = modelos
  }

  /**
   * Sincroniza as malhas com o estado do jogo neste quadro.
   *
   * @param dtMs tempo desde o quadro anterior, em milissegundos — o
   *   AnimationMixer do caminho de modelos precisa disso para avancar os
   *   clipes; o corpo procedural ignora o parametro (a fase dele vem da
   *   distancia andada, nao do relogio).
   */
  sync(enemies: readonly Enemy[], dtMs: number): void {
    const seen = new Set<number>()
    const dtSeconds = dtMs / 1000

    for (const enemy of enemies) {
      if (enemy.state === 'dead') continue
      seen.add(enemy.id)

      let view = this.views.get(enemy.id)
      if (!view || view.kind !== enemy.kind) {
        if (view) this.release(enemy.id, view)
        view = this.acquire(enemy.kind)
        this.views.set(enemy.id, view)
      }

      this.apply(view, enemy, dtSeconds)
    }

    for (const [id, view] of this.views) {
      if (!seen.has(id)) this.release(id, view)
    }
  }

  private apply(view: EnemyView, enemy: Enemy, dtSeconds: number): void {
    view.group.position.set(enemy.x, 0, enemy.z)
    view.group.rotation.y = enemy.yaw

    // Chao, e nao no grupo: a sombra nao deve inclinar quando o corpo tomba
    // na morte, senao ela sai do chao e flutua junto com o cadaver.
    view.shadowMesh.position.x = enemy.x
    view.shadowMesh.position.z = enemy.z

    if (view.visual.tipo === 'model') {
      this.applyModel(view.visual, enemy, dtSeconds)
    } else {
      this.applyProcedural(view, view.visual, enemy)
    }

    this.aplicarCor(view, enemy)
  }

  // ---------------------------------------------------------------------
  // Caminho: modelo gltf animado
  // ---------------------------------------------------------------------

  private applyModel(visual: ModelVisual, enemy: Enemy, dtSeconds: number): void {
    visual.mixer.update(dtSeconds)

    if (enemy.state === 'dying') {
      // clampWhenFinished: o corpo fica na pose final do clipe ate a view ser
      // recolhida (sync() libera a view assim que enemy.state vira 'dead').
      this.tocarUmaVez(visual, 'Death', true)
      return
    }

    if (enemy.state === 'pain') {
      this.tocarUmaVez(visual, 'HitReact', false)
    } else if (enemy.state === 'attack') {
      this.tocarUmaVez(visual, CLIPE_ATAQUE[enemy.kind], false)
    } else {
      this.tocarCaminhadaModelo(visual, enemy)
    }
  }

  /**
   * Caminhada do modelo: clipe de perseguicao (CLIPE_CAMINHADA[kind]) em
   * loop, com timeScale calculado para a passada visual casar com o
   * deslocamento real.
   *
   * O inimigo anda a `chaseSpeed` map units por segundo (chaseSpeed() devolve
   * por tic; perTicToPerSecond() converte). O clipe, a timeScale=1, leva
   * `duracao` segundos para completar um ciclo de passada — nesse tempo, a
   * velocidade real do inimigo cobre `velocidade * duracao` map units.
   * timeScale escala o clipe para que esse ciclo dure exatamente STRIDE map
   * units percorridos (a mesma constante da fase por distancia do corpo
   * procedural), casando a cadencia visual com o chao:
   *
   *   timeScale = (velocidade * duracao) / STRIDE
   */
  private tocarCaminhadaModelo(visual: ModelVisual, enemy: Enemy): void {
    const nomeClipe = CLIPE_CAMINHADA[enemy.kind]
    const action = visual.actions[nomeClipe]
    if (!action) return

    const velocidade = perTicToPerSecond(chaseSpeed(ENEMIES[enemy.kind]))
    const duracao = action.getClip().duration
    action.timeScale = duracao > 0 ? (velocidade * duracao) / STRIDE : 1

    if (visual.currentActionName === nomeClipe) return

    action.reset()
    action.setLoop(LoopRepeat, Infinity)
    action.clampWhenFinished = false
    action.enabled = true
    if (visual.currentAction) action.crossFadeFrom(visual.currentAction, CROSSFADE_S, false)
    action.play()

    visual.currentAction = action
    visual.currentActionName = nomeClipe
  }

  /**
   * Toca um clipe uma unica vez, com crossfade a partir do que estava
   * tocando. So dispara quando o clipe-alvo muda: sem essa guarda, chamar de
   * novo a cada quadro reiniciaria a pose de ataque/dor enquanto o estado
   * durar. Quando o estado da simulacao muda de volta (attack/pain -> chase),
   * o proximo apply() cai em tocarCaminhadaModelo() e crossfada para Walk
   * sozinho — nao ha "restaurar o estado anterior" para programar aqui.
   */
  private tocarUmaVez(visual: ModelVisual, nomeClipe: string, clampFinal: boolean): void {
    if (visual.currentActionName === nomeClipe) return

    const action = visual.actions[nomeClipe]
    if (!action) return

    action.reset()
    action.setLoop(LoopOnce, 1)
    action.clampWhenFinished = clampFinal
    action.enabled = true
    if (visual.currentAction) action.crossFadeFrom(visual.currentAction, CROSSFADE_S, false)
    action.play()

    visual.currentAction = action
    visual.currentActionName = nomeClipe
  }

  // ---------------------------------------------------------------------
  // Caminho: corpo procedural (fallback)
  // ---------------------------------------------------------------------

  private applyProcedural(view: EnemyView, visual: ProceduralVisual, enemy: Enemy): void {
    const stats = ENEMIES[enemy.kind]

    if (enemy.state === 'dying') {
      this.animarMorte(view, visual, enemy, stats.deathTics)
    } else {
      view.group.rotation.x = 0
      view.group.position.y = 0
      view.group.scale.setScalar(1)

      if (enemy.state === 'pain') this.animarDor(visual)
      else if (enemy.state === 'attack') this.animarAtaque(visual, enemy)
      else this.animarCaminhada(visual, enemy)
    }
  }

  /**
   * Caminhada.
   *
   * Pernas em oposicao de fase, bracos contrarios as pernas (como todo bipede
   * anda), e o torso sobe duas vezes por ciclo — uma por passo. O balanco
   * vertical e o detalhe que mais rende: sem ele o inimigo parece patinar
   * mesmo com as pernas se mexendo.
   */
  private animarCaminhada(visual: ProceduralVisual, enemy: Enemy): void {
    const fase = (enemy.distanceWalked / STRIDE) * Math.PI * 2
    const seno = Math.sin(fase)

    visual.legLeft.rotation.x = seno * 0.75
    visual.legRight.rotation.x = -seno * 0.75
    // Bracos contrarios as pernas, com amplitude menor.
    visual.armLeft.rotation.x = -seno * 0.5
    visual.armRight.rotation.x = seno * 0.5

    const stats = ENEMIES[enemy.kind]
    visual.torso.position.y = stats.height * 0.42 + Math.abs(seno) * stats.height * 0.035
    visual.torso.rotation.z = seno * 0.05
    visual.torso.rotation.x = 0.08
    visual.head.rotation.z = -seno * 0.04
  }

  /** Ataque: bracos a frente, corpo projetado. */
  private animarAtaque(visual: ProceduralVisual, enemy: Enemy): void {
    const stats = ENEMIES[enemy.kind]
    visual.armLeft.rotation.x = -1.35
    visual.armRight.rotation.x = -1.35
    visual.legLeft.rotation.x = 0.15
    visual.legRight.rotation.x = -0.15
    visual.torso.position.y = stats.height * 0.42
    visual.torso.rotation.x = 0.2
    visual.torso.rotation.z = 0
  }

  /** Dor: encolhe e joga o tronco para tras. */
  private animarDor(visual: ProceduralVisual): void {
    visual.torso.rotation.x = -0.32
    visual.torso.rotation.z = 0
    visual.armLeft.rotation.x = 0.5
    visual.armRight.rotation.x = 0.5
  }

  /**
   * Morte: tomba para a frente, pernas cedem e o corpo afunda.
   *
   * Dura o mesmo que o estado de morte da simulacao, entao termina exatamente
   * quando o corpo e removido — sem corte no meio da queda.
   */
  private animarMorte(
    view: EnemyView,
    visual: ProceduralVisual,
    enemy: Enemy,
    deathTics: number,
  ): void {
    const stats = ENEMIES[enemy.kind]
    const progresso = 1 - enemy.stateTics / deathTics
    const suave = progresso * progresso * (3 - 2 * progresso)

    view.group.rotation.x = suave * (Math.PI / 2.1)
    view.group.position.y = -suave * stats.height * 0.30
    view.group.scale.setScalar(1 - suave * 0.12)

    visual.legLeft.rotation.x = suave * 0.9
    visual.legRight.rotation.x = suave * 0.6
    visual.armLeft.rotation.x = suave * 1.6
    visual.armRight.rotation.x = suave * 1.2
    visual.torso.rotation.x = suave * 0.4
    visual.torso.position.y = stats.height * 0.42
  }

  // ---------------------------------------------------------------------
  // Comum aos dois caminhos
  // ---------------------------------------------------------------------

  /**
   * Recolore o corpo conforme vida e estado de dor.
   *
   * So refaz o trabalho quando health ou state mudaram desde o quadro
   * anterior — antes rodava para todos os materiais de cada inimigo vivo,
   * todo quadro, mesmo parado e sem levar tiro nenhum. Vale para os dois
   * caminhos: os materiais do modelo sao clones proprios por view (ver
   * buildModel), entao recolorir um nao vaza para outra instancia do mesmo
   * gltf.
   */
  private aplicarCor(view: EnemyView, enemy: Enemy): void {
    if (view.lastHealth === enemy.health && view.lastState === enemy.state) return
    view.lastHealth = enemy.health
    view.lastState = enemy.state

    const ferido = 1 - enemy.health / enemy.maxHealth
    const emDor = enemy.state === 'pain'

    for (let i = 0; i < view.materials.length; i++) {
      const material = view.materials[i] as Material & { color?: Color }
      if (!material.color) continue
      if (emDor) material.color.copy(PAIN_COLOR)
      else material.color.copy(view.baseColors[i]!).lerp(PAIN_COLOR, ferido * 0.35)
    }
  }

  private acquire(kind: EnemyKind): EnemyView {
    const indice = this.pool.findIndex((v) => v.kind === kind)
    if (indice >= 0) {
      const reused = this.pool.splice(indice, 1)[0]!
      reused.group.visible = true
      this.scene.add(reused.group)
      reused.shadowMesh.visible = true
      this.scene.add(reused.shadowMesh)
      // O inimigo reaproveitado e outro individuo, com outro health: sem
      // isso, aplicarCor() compararia contra o estado do inimigo anterior e
      // poderia deixar de recolorir no primeiro quadro em que precisava.
      reused.lastHealth = -1
      reused.lastState = null
      return reused
    }

    // Sem modelo gltf para este tipo (ou sem modelos nenhum, porque a rede
    // falhou), cai no corpo procedural — o mesmo caminho de sempre.
    const modelo = this.modelos?.[kind] ?? null
    return modelo ? this.buildModel(kind, modelo) : this.buildProcedural(kind)
  }

  private buildProcedural(kind: EnemyKind): EnemyView {
    const stats = ENEMIES[kind]
    const palette = PALETTE[kind]

    const materialCorpo = new MeshStandardMaterial({
      color: palette.body, roughness: 0.82, metalness: 0.04,
    })
    const materialCabeca = new MeshStandardMaterial({
      color: palette.head, roughness: 0.74, metalness: 0.04,
    })
    const materialMembro = new MeshStandardMaterial({
      color: palette.limb, roughness: 0.86, metalness: 0.03,
    })

    const alturaTorso = stats.height * 0.42
    const alturaPerna = stats.height * 0.42
    const largura = stats.radius * 1.5

    const group = new Group()

    // Torso e o que balanca no passo; as pernas ficam presas ao grupo raiz,
    // porque o quadril nao acompanha o balanco do tronco.
    const torso = new Group()
    torso.position.y = alturaTorso

    const peito = new Mesh(
      new BoxGeometry(largura, alturaTorso, stats.radius * 0.95),
      materialCorpo,
    )
    peito.position.y = alturaTorso * 0.5
    peito.castShadow = true
    peito.receiveShadow = true
    torso.add(peito)

    // Cabecas de formato diferente: o tipo tem de ser legivel pela silhueta,
    // nao so pela cor — parte do publico nao separa bem matizes.
    const head = new Mesh(
      kind === 'imp'
        ? new ConeGeometry(stats.radius * 0.7, stats.radius * 1.25, 6)
        : new SphereGeometry(stats.radius * 0.58, 12, 10),
      materialCabeca,
    )
    head.position.y = alturaTorso + stats.radius * 0.55
    head.castShadow = true
    torso.add(head)

    const armLeft = this.construirMembro(
      materialMembro, stats.radius * 0.28, alturaTorso * 0.92, true,
    )
    armLeft.position.set(-largura * 0.58, alturaTorso * 0.86, 0)
    torso.add(armLeft)

    const armRight = this.construirMembro(
      materialMembro, stats.radius * 0.28, alturaTorso * 0.92, true,
    )
    armRight.position.set(largura * 0.58, alturaTorso * 0.86, 0)
    torso.add(armRight)

    group.add(torso)

    const legLeft = this.construirMembro(materialMembro, stats.radius * 0.33, alturaPerna, false)
    legLeft.position.set(-largura * 0.26, alturaPerna, 0)
    group.add(legLeft)

    const legRight = this.construirMembro(materialMembro, stats.radius * 0.33, alturaPerna, false)
    legRight.position.set(largura * 0.26, alturaPerna, 0)
    group.add(legRight)

    this.scene.add(group)

    const shadowMesh = this.criarSombra(stats)
    this.scene.add(shadowMesh)

    return {
      group,
      shadowMesh,
      kind,
      materials: [materialCorpo, materialCabeca, materialMembro],
      baseColors: [new Color(palette.body), new Color(palette.head), new Color(palette.limb)],
      lastHealth: -1,
      lastState: null,
      visual: { tipo: 'procedural', torso, head, legLeft, legRight, armLeft, armRight },
    }
  }

  /**
   * Membro que gira pelo topo.
   *
   * A malha fica deslocada meio comprimento para baixo dentro do grupo, de modo
   * que a rotacao do grupo aconteca no ombro ou no quadril. Girar a malha
   * direto pivotaria no meio do membro, e o pe descreveria um arco no ar.
   */
  private construirMembro(
    material: MeshStandardMaterial,
    raio: number,
    comprimento: number,
    braco: boolean,
  ): Group {
    const pivo = new Group()
    const malha = new Mesh(
      new CapsuleGeometry(raio, comprimento * (braco ? 0.78 : 0.72), 3, 7),
      material,
    )
    malha.position.y = -comprimento * 0.5
    malha.castShadow = true
    pivo.add(malha)
    return pivo
  }

  /**
   * Constroi a view a partir de um modelo gltf ja carregado.
   *
   * O clone via SkeletonUtils acontece uma unica vez aqui, no build do slot
   * do pool — nunca por quadro. Object3D.clone() comum NAO serve: ele nao
   * reconstroi o esqueleto, entao duas instancias clonadas por clone() comum
   * compartilhariam os mesmos ossos e uma animaria a outra.
   */
  private buildModel(kind: EnemyKind, modelo: EnemyModel): EnemyView {
    const stats = ENEMIES[kind]

    const clone = clonarComEsqueleto(modelo.template) as Group

    const escala = modelo.alturaOriginal > 0 ? stats.height / modelo.alturaOriginal : 1
    clone.scale.setScalar(escala)

    // ITEM A CONFERIR VISUALMENTE — orientacao. O jogo usa a mesma convencao
    // do jogador (renderer.ts: rotation.y = yaw faz o -Z LOCAL apontar para
    // onde o objeto olha; enemy.yaw em enemy.ts::faceTarget e derivado da
    // mesma formula). Os modelos Quaternius encaram +Z, o oposto: por isso o
    // pivo gira 180 graus antes do clone entrar nele. Se o inimigo aparecer
    // de costas ou de lado em jogo, ajuste so este angulo — nunca enemy.yaw.
    const pivo = new Group()
    pivo.rotation.y = Math.PI
    pivo.add(clone)

    const group = new Group()
    group.add(pivo)
    this.scene.add(group)

    const mixer = new AnimationMixer(clone)
    const actions: Record<string, AnimationAction> = {}
    for (const clip of modelo.animations) {
      actions[clip.name] = mixer.clipAction(clip)
    }

    // Tingimento por dano: clona os materiais do clone uma unica vez por
    // view (nunca por quadro), e guarda a cor-base de cada um — mesma tecnica
    // do corpo procedural, aplicada aos materiais do gltf. Sem o clone aqui,
    // recolorir esta view mudaria a cor de toda instancia que compartilha o
    // mesmo material de origem.
    //
    // Sem tingimento de tipo aqui: zombieman, sergeant e imp sao tres
    // arquivos .glb distintos agora (ver enemyModels.ts), cada um com a
    // cor-base propria do seu atlas — a cor capturada em baseColors e so o
    // ponto de partida para aplicarCor() interpolar no flash de acerto e na
    // dessaturacao de morte.
    const materials: Material[] = []
    const baseColors: Color[] = []
    clone.traverse((objeto) => {
      const malha = objeto as Mesh
      if (!malha.isMesh) return

      const original = malha.material
      const originais = Array.isArray(original) ? original : [original]
      const clonados = originais.map((material) => material.clone())
      malha.material = Array.isArray(original) ? clonados : clonados[0]!

      for (const material of clonados) {
        materials.push(material)
        const padrao = material as MeshStandardMaterial
        const cor = padrao.color as Color | undefined
        baseColors.push(cor ? cor.clone() : new Color(0xffffff))
      }
    })

    const shadowMesh = this.criarSombra(stats)
    this.scene.add(shadowMesh)

    return {
      group,
      shadowMesh,
      kind,
      materials,
      baseColors,
      lastHealth: -1,
      lastState: null,
      visual: {
        tipo: 'model',
        pivo,
        mixer,
        actions,
        currentAction: null,
        currentActionName: null,
      },
    }
  }

  /**
   * Blob shadow: no nivel de qualidade baixo a sombra direcional desliga (ver
   * quality.ts), e sem nenhuma marca no chao o inimigo parece flutuar.
   * Independente do grupo de proposito — ver comentario no tipo EnemyView.
   * Compartilhada pelos dois caminhos (procedural e modelo).
   */
  private criarSombra(stats: { radius: number }): Mesh {
    const shadowMesh = new Mesh(new CircleGeometry(stats.radius * 1.15, 20), materialSombra())
    shadowMesh.rotation.x = -Math.PI / 2
    shadowMesh.position.y = 0.5 // acima do chao o bastante para nao dar z-fight
    return shadowMesh
  }

  private release(id: number, view: EnemyView): void {
    this.scene.remove(view.group)
    view.group.visible = false
    this.scene.remove(view.shadowMesh)
    view.shadowMesh.visible = false
    this.views.delete(id)

    if (view.visual.tipo === 'model') {
      // Zera o mixer e o rastro de qual action estava tocando: sem isso, a
      // proxima partida que reusa este slot herdaria a action do inimigo
      // anterior e tocarCaminhadaModelo()/tocarUmaVez() achariam que o clipe
      // certo ja estava tocando, sem crossfade nem play().
      view.visual.mixer.stopAllAction()
      view.visual.currentAction = null
      view.visual.currentActionName = null
    }

    this.pool.push(view)
  }
}

/** Textura da blob shadow, gerada uma unica vez e reusada por todo inimigo. */
let sombraTexturaCache: CanvasTexture | null = null

function texturaSombra(): CanvasTexture {
  if (sombraTexturaCache) return sombraTexturaCache

  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D indisponivel neste navegador')

  const centro = size / 2
  const gradiente = ctx.createRadialGradient(centro, centro, 0, centro, centro, centro)
  gradiente.addColorStop(0, 'rgba(0,0,0,0.6)')
  gradiente.addColorStop(0.65, 'rgba(0,0,0,0.32)')
  gradiente.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gradiente
  ctx.fillRect(0, 0, size, size)

  sombraTexturaCache = new CanvasTexture(canvas)
  return sombraTexturaCache
}

/** Material da blob shadow, compartilhado por todo inimigo — nao ha nada
 *  para variar por instancia, entao um so material serve a todos. */
let sombraMaterialCache: MeshBasicMaterial | null = null

function materialSombra(): MeshBasicMaterial {
  if (sombraMaterialCache) return sombraMaterialCache

  sombraMaterialCache = new MeshBasicMaterial({
    map: texturaSombra(),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
  return sombraMaterialCache
}
