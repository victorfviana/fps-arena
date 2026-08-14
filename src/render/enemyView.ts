/**
 * Desenho dos inimigos, com corpo articulado e caminhada.
 *
 * A versao anterior era uma caixa com uma bola em cima, deslizando pelo chao
 * como peca de tabuleiro. Agora cada inimigo tem torso, cabeca, dois bracos e
 * duas pernas, e a caminhada anima a partir da distancia percorrida — nao do
 * relogio. A diferenca aparece quando o inimigo trava numa quina ou leva
 * empurrao: o passo para junto com o corpo, em vez de pedalar no lugar.
 *
 * Continua sendo geometria simples, por escolha declarada: sprite ou malha
 * organica mal feita afunda um FPS mais rapido que forma honesta. O que a
 * rubrica cobra aqui e legibilidade — tipo, estado e distancia num relance,
 * no meio de uma onda.
 *
 * As malhas sao reaproveitadas de um deposito: criar e destruir geometria a
 * cada onda produziria engasgo justamente no momento de maior pressao.
 */

import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
  SphereGeometry,
} from 'three'

import type { Enemy, EnemyKind } from '../enemies/enemy'
import { ENEMIES } from '../core/doom'

/** Paleta por tipo. Matizes distantes para o olho separar sem pensar. */
const PALETTE: Record<EnemyKind, { body: number; head: number; limb: number }> = {
  zombieman: { body: 0x5f7048, head: 0x8a9668, limb: 0x4a5838 },
  imp: { body: 0xa8442a, head: 0xd4703c, limb: 0x8a3520 },
}

/** Cor do corpo no instante do dano. */
const PAIN_COLOR = new Color(0xffffff)

/**
 * Comprimento de um passo completo, em map units.
 *
 * Casado com a velocidade de perseguicao (2 unidades por tic, 70 por segundo):
 * da pouco mais de um passo por segundo, que e a cadencia de quem caminha
 * pesado. Passo curto demais vira corridinha nervosa.
 */
const STRIDE = 62

interface EnemyView {
  group: Group
  /** Tudo que balanca junto no passo, exceto as pernas. */
  torso: Group
  head: Mesh
  legLeft: Group
  legRight: Group
  armLeft: Group
  armRight: Group
  materials: MeshStandardMaterial[]
  baseColors: Color[]
  kind: EnemyKind
}

export class EnemyRenderer {
  private readonly views = new Map<number, EnemyView>()
  private readonly pool: EnemyView[] = []

  constructor(private readonly scene: Scene) {}

  /** Sincroniza as malhas com o estado do jogo neste quadro. */
  sync(enemies: readonly Enemy[]): void {
    const seen = new Set<number>()

    for (const enemy of enemies) {
      if (enemy.state === 'dead') continue
      seen.add(enemy.id)

      let view = this.views.get(enemy.id)
      if (!view || view.kind !== enemy.kind) {
        if (view) this.release(enemy.id, view)
        view = this.acquire(enemy.kind)
        this.views.set(enemy.id, view)
      }

      this.apply(view, enemy)
    }

    for (const [id, view] of this.views) {
      if (!seen.has(id)) this.release(id, view)
    }
  }

  private apply(view: EnemyView, enemy: Enemy): void {
    const stats = ENEMIES[enemy.kind]
    view.group.position.set(enemy.x, 0, enemy.z)
    view.group.rotation.y = enemy.yaw

    if (enemy.state === 'dying') {
      this.animarMorte(view, enemy, stats.deathTics)
    } else {
      view.group.rotation.x = 0
      view.group.position.y = 0
      view.group.scale.setScalar(1)

      if (enemy.state === 'pain') this.animarDor(view)
      else if (enemy.state === 'attack') this.animarAtaque(view, enemy)
      else this.animarCaminhada(view, enemy)
    }

    this.aplicarCor(view, enemy)
  }

  /**
   * Caminhada.
   *
   * Pernas em oposicao de fase, bracos contrarios as pernas (como todo bipede
   * anda), e o torso sobe duas vezes por ciclo — uma por passo. O balanco
   * vertical e o detalhe que mais rende: sem ele o inimigo parece patinar
   * mesmo com as pernas se mexendo.
   */
  private animarCaminhada(view: EnemyView, enemy: Enemy): void {
    const fase = (enemy.distanceWalked / STRIDE) * Math.PI * 2
    const seno = Math.sin(fase)

    view.legLeft.rotation.x = seno * 0.75
    view.legRight.rotation.x = -seno * 0.75
    // Bracos contrarios as pernas, com amplitude menor.
    view.armLeft.rotation.x = -seno * 0.5
    view.armRight.rotation.x = seno * 0.5

    const stats = ENEMIES[enemy.kind]
    view.torso.position.y = stats.height * 0.42 + Math.abs(seno) * stats.height * 0.035
    view.torso.rotation.z = seno * 0.05
    view.torso.rotation.x = 0.08
    view.head.rotation.z = -seno * 0.04
  }

  /** Ataque: bracos a frente, corpo projetado. */
  private animarAtaque(view: EnemyView, enemy: Enemy): void {
    const stats = ENEMIES[enemy.kind]
    view.armLeft.rotation.x = -1.35
    view.armRight.rotation.x = -1.35
    view.legLeft.rotation.x = 0.15
    view.legRight.rotation.x = -0.15
    view.torso.position.y = stats.height * 0.42
    view.torso.rotation.x = 0.2
    view.torso.rotation.z = 0
  }

  /** Dor: encolhe e joga o tronco para tras. */
  private animarDor(view: EnemyView): void {
    view.torso.rotation.x = -0.32
    view.torso.rotation.z = 0
    view.armLeft.rotation.x = 0.5
    view.armRight.rotation.x = 0.5
  }

  /**
   * Morte: tomba para a frente, pernas cedem e o corpo afunda.
   *
   * Dura o mesmo que o estado de morte da simulacao, entao termina exatamente
   * quando o corpo e removido — sem corte no meio da queda.
   */
  private animarMorte(view: EnemyView, enemy: Enemy, deathTics: number): void {
    const stats = ENEMIES[enemy.kind]
    const progresso = 1 - enemy.stateTics / deathTics
    const suave = progresso * progresso * (3 - 2 * progresso)

    view.group.rotation.x = suave * (Math.PI / 2.1)
    view.group.position.y = -suave * stats.height * 0.30
    view.group.scale.setScalar(1 - suave * 0.12)

    view.legLeft.rotation.x = suave * 0.9
    view.legRight.rotation.x = suave * 0.6
    view.armLeft.rotation.x = suave * 1.6
    view.armRight.rotation.x = suave * 1.2
    view.torso.rotation.x = suave * 0.4
    view.torso.position.y = stats.height * 0.42
  }

  private aplicarCor(view: EnemyView, enemy: Enemy): void {
    const ferido = 1 - enemy.health / enemy.maxHealth
    const emDor = enemy.state === 'pain'

    for (let i = 0; i < view.materials.length; i++) {
      const material = view.materials[i]!
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
      return reused
    }
    return this.build(kind)
  }

  private build(kind: EnemyKind): EnemyView {
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

    return {
      group,
      torso,
      head,
      legLeft,
      legRight,
      armLeft,
      armRight,
      materials: [materialCorpo, materialCabeca, materialMembro],
      baseColors: [new Color(palette.body), new Color(palette.head), new Color(palette.limb)],
      kind,
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

  private release(id: number, view: EnemyView): void {
    this.scene.remove(view.group)
    view.group.visible = false
    this.views.delete(id)
    this.pool.push(view)
  }
}
