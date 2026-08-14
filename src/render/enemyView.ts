/**
 * Desenho dos inimigos.
 *
 * Escolha declarada: geometria simples com silhueta e cor fortes, em vez de
 * sprites imitando o original. Sprite mal desenhado afunda um FPS, e a
 * dimensao que a rubrica cobra aqui e legibilidade de combate — o jogador
 * precisa distinguir tipo, estado e distancia num relance, no meio de uma onda.
 *
 * As malhas sao reaproveitadas de um deposito: criar e destruir geometria a
 * cada onda produziria engasgo justamente no momento de maior pressao.
 */

import {
  BoxGeometry,
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
const PALETTE: Record<EnemyKind, { body: number; head: number }> = {
  zombieman: { body: 0x5f7048, head: 0x8a9668 },
  imp: { body: 0xa8442a, head: 0xd4703c },
}

/** Cor do corpo no instante do dano. */
const PAIN_COLOR = new Color(0xffffff)

interface EnemyView {
  group: Group
  body: Mesh
  head: Mesh
  bodyMaterial: MeshStandardMaterial
  headMaterial: MeshStandardMaterial
  baseBody: Color
  baseHead: Color
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
      // Tomba para a frente e afunda: a morte precisa ser visivel de longe,
      // porque e o unico sinal de que aquele alvo pode ser esquecido.
      const progress = 1 - enemy.stateTics / stats.deathTics
      view.group.rotation.x = progress * (Math.PI / 2)
      view.group.position.y = -progress * stats.height * 0.35
      view.group.scale.setScalar(1 - progress * 0.15)
    } else {
      view.group.rotation.x = 0
      view.group.position.y = 0
      view.group.scale.setScalar(1)
    }

    // Vermelho crescente conforme a vida cai, branco no instante da dor.
    const wounded = 1 - enemy.health / enemy.maxHealth
    if (enemy.state === 'pain') {
      view.bodyMaterial.color.copy(PAIN_COLOR)
      view.headMaterial.color.copy(PAIN_COLOR)
    } else {
      view.bodyMaterial.color.copy(view.baseBody).lerp(PAIN_COLOR, wounded * 0.35)
      view.headMaterial.color.copy(view.baseHead).lerp(PAIN_COLOR, wounded * 0.35)
    }
  }

  private acquire(kind: EnemyKind): EnemyView {
    const reused = this.pool.pop()
    if (reused && reused.kind === kind) {
      reused.group.visible = true
      this.scene.add(reused.group)
      return reused
    }
    if (reused) {
      // Tipo diferente: devolve ao deposito e constroi o certo.
      this.pool.push(reused)
    }

    return this.build(kind)
  }

  private build(kind: EnemyKind): EnemyView {
    const stats = ENEMIES[kind]
    const palette = PALETTE[kind]

    const bodyHeight = stats.height * 0.68
    // Rugosidade alta e brilho quase nulo: sao criaturas, nao plastico.
    const bodyMaterial = new MeshStandardMaterial({
      color: palette.body, roughness: 0.82, metalness: 0.04,
    })
    const headMaterial = new MeshStandardMaterial({
      color: palette.head, roughness: 0.74, metalness: 0.04,
    })

    const body = new Mesh(
      new BoxGeometry(stats.radius * 1.7, bodyHeight, stats.radius * 1.1),
      bodyMaterial,
    )
    body.position.y = bodyHeight / 2

    // Cabecas de formato diferente: o tipo do inimigo tem de ser legivel pela
    // silhueta, nao so pela cor — parte do publico nao separa bem matizes.
    const headGeometry = kind === 'imp'
      ? new ConeGeometry(stats.radius * 0.75, stats.radius * 1.3, 6)
      : new SphereGeometry(stats.radius * 0.62, 10, 8)

    const head = new Mesh(headGeometry, headMaterial)
    head.position.y = bodyHeight + stats.radius * 0.55

    // Projetar e receber sombra e o que assenta o inimigo no chao; sem isso
    // ele parece um adesivo flutuando sobre a arena.
    body.castShadow = true
    body.receiveShadow = true
    head.castShadow = true

    const group = new Group()
    group.add(body)
    group.add(head)
    this.scene.add(group)

    return {
      group,
      body,
      head,
      bodyMaterial,
      headMaterial,
      baseBody: new Color(palette.body),
      baseHead: new Color(palette.head),
      kind,
    }
  }

  private release(id: number, view: EnemyView): void {
    this.scene.remove(view.group)
    view.group.visible = false
    this.views.delete(id)
    this.pool.push(view)
  }
}
