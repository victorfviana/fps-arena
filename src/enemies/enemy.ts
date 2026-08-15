/**
 * Inimigos: estado, perseguicao e reacao ao dano.
 *
 * A reacao ao dano e uma dimensao inteira da rubrica, e e onde FPS amador
 * costuma falhar: sem estado de dor visivel, o jogador atira e nao sabe se
 * acertou. Aqui o dano produz tres sinais simultaneos — interrupcao do
 * movimento, empurrao e troca de cor — porque um so nao atravessa o ruido de
 * uma arena cheia.
 *
 * Modulo puro, sem Three.js.
 */

import {
  ATTACK_CYCLE_TICS,
  ENEMIES,
  PLAYER_RADIUS,
  SPOS_PELLETS,
  TICRATE,
  chaseSpeed,
  damageThrust,
} from '../core/doom'
import type { Random } from '../core/random'
import { moveWithCollision, segmentBlocked, type Vec2, type Wall } from '../world/collision'
import type { Box } from '../world/arena'
import { SHOT_HEIGHT } from '../weapons/hitscan'

export type EnemyKind = keyof typeof ENEMIES

export type EnemyState = 'chase' | 'attack' | 'pain' | 'dying' | 'dead'

export interface Enemy {
  id: number
  kind: EnemyKind
  x: number
  z: number
  radius: number
  height: number
  health: number
  maxHealth: number
  state: EnemyState
  /** Tics restantes no estado atual, quando o estado tem duracao. */
  stateTics: number
  /** Direcao para onde olha, usada pelo desenho. */
  yaw: number
  /** Empurrao residual do ultimo dano recebido. */
  knockX: number
  knockZ: number
  alive: boolean
  /** Tics ate poder atacar de novo. */
  attackCooldown: number
  /** Lado para onde circula ao chegar na distancia de tiro: 1 ou -1. */
  strafeDir: number
  /** Tics ate sortear um novo lado. */
  strafeTics: number
  /**
   * Distancia acumulada a pe, em map units.
   *
   * A animacao de caminhada deriva daqui, e nao do relogio. Andar preso a
   * distancia mantem o pe plantado no chao: se a fase viesse do tempo, um
   * inimigo empurrado ou travado numa quina continuaria mexendo as pernas
   * parado, que e o defeito que denuncia animacao mal feita.
   */
  distanceWalked: number
  /**
   * Ponto de cobertura escolhido depois do ultimo tiro. null = nao esta se
   * cobrindo, e o inimigo persegue como sempre perseguiu.
   *
   * E um PONTO, e nao uma referencia ao obstaculo: a escolha e geometrica e
   * acontece uma unica vez por disparo (ver escolherCobertura). Guardar o ponto
   * mantem o destino estavel enquanto ele caminha — recalcular a cada tic faria
   * o alvo trocar sozinho a cada passo, e o inimigo gaguejaria entre dois
   * esconderijos sem nunca chegar a nenhum.
   */
  coverX: number | null
  coverZ: number | null
  /** Tics de espera que ainda faltam, ja abrigado. */
  coverTics: number
}

/**
 * Comportamento por tipo.
 *
 * DIVERGENCIA DECLARADA do benchmark: no DOOM o imp lanca bola de fogo. Aqui
 * ele e corpo a corpo rapido. Projetil viajante e escopo proprio (colisao,
 * desenho, previsao da IA) e nao entra nesta etapa. A escolha esta registrada
 * para nao ser lida depois como erro de fidelidade.
 */
const ZOMBIEMAN = {
  /** Atira de longe. */
  attackRange: 900,
  damage: 3,
  // 1,43 s entre tiros. Os 28 tics originais davam o dobro da cadencia do
  // POSS do DOOM e, com pontaria perfeita, matavam o jogador parado em
  // ~17 s — fora da janela de 30-90 s do design. Calibrado por varredura
  // de sementes junto com a curva de acerto abaixo.
  attackCooldownTics: 50,
  /** Distancia em que para de se aproximar. */
  preferredRange: 400,
  /** Chance de acerto a queima-roupa e quanto ela cai ate o attackRange. */
  acertoBase: 0.75,
  acertoQueda: 0.6,
  /** Entre um tiro e o outro, procura obstaculo que corte a visada. */
  buscaCobertura: true,
} as const

/** Alcance da escopeta do sargento. Ver BEHAVIOUR.sergeant. */
const SERGEANT_RANGE = 700

export const BEHAVIOUR = {
  zombieman: ZOMBIEMAN,
  imp: {
    attackRange: 150,
    // Calibrado pela janela de sobrevivencia parado, junto com a cadencia do
    // zombieman: com 7 de dano a cada 20 tics, dois imps encostados matavam
    // em ~8 s e nenhuma dispersao de zombieman compensava.
    damage: 4,
    attackCooldownTics: 32,
    // Perto, mas nao encostado. Colado, o modelo dele tomava metade da tela e
    // o jogador perdia de vista o resto da onda — que e justamente o momento
    // em que precisa ver o resto da onda.
    preferredRange: 118,
    /**
     * Flanco: desvio lateral maximo do PONTO DE MIRA, em map units.
     *
     * Nao e teleporte nem rota calculada — o imp continua andando com
     * `moveWithCollision`, e so o ponto para onde ele aponta sai da linha reta.
     * Numa sala aberta isso desenha um arco; nos corredores da sala 2, o arco
     * esbarra na trincheira e o corpo desliza por ela, o que faz o imp entrar
     * pelo corredor lateral sem nenhuma logica de rota.
     */
    flancoDesvio: 260,
    /** Abaixo desta distancia o desvio derrete e ele fecha em cima do jogador. */
    flancoConverge: 300,
  },
  /**
   * Sargento de escopeta (SPOS do DOOM).
   *
   * As constantes de corpo (vida, raio, altura, painchance, velocidade) sao
   * CITADAS e vivem em `core/doom.ts`. Aqui fica o que e decisao de jogo:
   *
   * - `chumbos` — CITADO via SPOS_PELLETS: A_SPosAttack dispara tres.
   * - `damage` — o mesmo dano unitario do zombieman, ja calibrado pela janela
   *   de sobrevivencia. Um disparo dele vale de 1x a 3x um tiro de zumbi,
   *   conforme quantos chumbos acertam.
   * - `acertoQueda` — DERIVADO para reproduzir a MESMA curva de acerto POR
   *   DISTANCIA do zombieman. `rollHit` divide a queda pelo attackRange, entao
   *   manter 0,6 num alcance menor tornaria a curva mais ingreme: a queda e
   *   reescalada por 700/900 e a chance a X unidades fica identica a dele.
   * - `attackCooldownTics` — DERIVADO: no benchmark a cadeia de ataque do SPOS
   *   dura 30 tics contra 26 do POSS (ATTACK_CYCLE_TICS). A cadencia do
   *   zombieman aqui (50) ja e calibrada; aplicar a mesma razao preserva a
   *   calibracao e mantem a escopeta mais lenta: 50 * 30/26 = 57,7 -> 58.
   * - `preferredRange` 300, contra 400 do zombieman: escopeta pede chegar mais
   *   perto, e a curva de acerto cobra caro de longe.
   */
  sergeant: {
    attackRange: SERGEANT_RANGE,
    damage: ZOMBIEMAN.damage,
    chumbos: SPOS_PELLETS,
    attackCooldownTics: Math.round(
      (ZOMBIEMAN.attackCooldownTics * ATTACK_CYCLE_TICS.spos) / ATTACK_CYCLE_TICS.poss,
    ),
    preferredRange: 300,
    acertoBase: ZOMBIEMAN.acertoBase,
    acertoQueda: (ZOMBIEMAN.acertoQueda * SERGEANT_RANGE) / ZOMBIEMAN.attackRange,
    buscaCobertura: true,
  },
} as const

let nextId = 1

export function createEnemy(kind: EnemyKind, x: number, z: number): Enemy {
  const stats = ENEMIES[kind]
  return {
    id: nextId++,
    kind,
    x,
    z,
    radius: stats.radius,
    height: stats.height,
    health: stats.health,
    maxHealth: stats.health,
    state: 'chase',
    stateTics: 0,
    yaw: 0,
    knockX: 0,
    knockZ: 0,
    alive: true,
    attackCooldown: 0,
    strafeDir: 1,
    strafeTics: 0,
    distanceWalked: 0,
    coverX: null,
    coverZ: null,
    coverTics: 0,
  }
}

/** Reinicia a numeracao. Existe para manter os testes independentes. */
export function resetEnemyIds(): void {
  nextId = 1
}

export interface EnemyAttack {
  enemyId: number
  /**
   * Dano do disparo.
   *
   * Para quem dispara um projetil so, e o dano do tipo. Para quem dispara
   * varios (`chumbos`, hoje so o sargento), e a SOMA dos chumbos que acertaram
   * — um unico acerto agregado, nao tres ataques.
   *
   * A agregacao e deliberada: `tickEnemy` devolve `EnemyAttack | null`, e
   * devolver uma lista obrigaria a mudar o contrato em `game.ts`, no desenho do
   * rastro e no audio de tiro, sem ganho nenhum para o jogador — que ouve UM
   * estampido e leva UM tranco. O que o jogador precisa distinguir, "levei um
   * chumbo de raspao ou os tres na cara", esta preservado no valor: 1x, 2x ou
   * 3x o dano unitario.
   *
   * Quando nada acerta, `hit` e false e o campo volta a valer o dano unitario,
   * como no contrato antigo — quem consome ja ignora o valor nesse caso.
   */
  damage: number
  /** false = o disparo saiu, mas passou ao lado: o traco existe, o dano nao. */
  hit: boolean
}

/**
 * DERIVADO do DOOM: o tiro do zombieman usa P_GunShot com accurate=false
 * (dispersao de ate ~11 graus), entao a maioria erra a media distancia — e a
 * primeira versao daqui, com pontaria perfeita, matava o jogador parado em
 * ~17 s, fora da janela de 30-90 s do design. A dispersao vira chance de
 * acerto decrescente com a distancia; corpo a corpo, como no DOOM, nao erra.
 */
function rollHit(
  behaviour: (typeof BEHAVIOUR)[EnemyKind],
  distance: number,
  random: Random,
): boolean {
  if (!('acertoBase' in behaviour)) return true
  const chance = Math.max(
    0.15,
    behaviour.acertoBase - (behaviour.acertoQueda * distance) / behaviour.attackRange,
  )
  return random.float() < chance
}

/**
 * Posicoes de outros inimigos, congeladas no inicio do tic.
 *
 * So x/z importam para a separacao; o resto do Enemy (estado, vida, yaw...)
 * nao participa da conta e nao precisaria estar aqui.
 */
export interface EnemyPositionSnapshot {
  id: number
  x: number
  z: number
  radius: number
  alive: boolean
}

export interface EnemyTickContext {
  player: Vec2
  walls: readonly Wall[]
  others: readonly EnemyPositionSnapshot[]
  random: Random
  /**
   * Obstaculos da sala ativa, candidatos a cobertura.
   *
   * Opcional de proposito: sem esta lista, todo inimigo se comporta exatamente
   * como antes desta etapa. Os testes de unidade que so querem perseguicao
   * continuam montando o contexto sem saber que cobertura existe.
   *
   * Vem em forma de `Box` (e nao de `Wall`) porque a busca precisa do VOLUME:
   * o ponto de cobertura fica ao lado da caixa, a um corpo de distancia da
   * face. Uma lista de segmentos daria o contorno, mas tambem daria o
   * perimetro da sala inteira — e "esconder-se atras da parede externa" nao e
   * lugar nenhum.
   */
  coberturas?: readonly Box[]
}

/**
 * Avanca um inimigo um tic.
 *
 * @returns o ataque desferido neste tic, se houver.
 */
export function tickEnemy(enemy: Enemy, context: EnemyTickContext): EnemyAttack | null {
  if (enemy.state === 'dead') return null

  if (enemy.state === 'dying') {
    enemy.stateTics--
    applyKnockback(enemy, context.walls)
    if (enemy.stateTics <= 0) enemy.state = 'dead'
    return null
  }

  faceTarget(enemy, context.player)
  applyKnockback(enemy, context.walls)

  if (enemy.attackCooldown > 0) enemy.attackCooldown--

  if (enemy.state === 'pain') {
    enemy.stateTics--
    // Em dor o inimigo nao anda nem ataca: e o que torna o acerto legivel.
    if (enemy.stateTics <= 0) enemy.state = 'chase'
    return null
  }

  const behaviour = BEHAVIOUR[enemy.kind]
  const distance = Math.hypot(context.player.x - enemy.x, context.player.z - enemy.z)
  // Mesma altura de visada do tiro do jogador: se o inimigo enxerga, ele pode
  // ser enxergado. Assimetria aqui produz a sensacao de tiro que vem do nada.
  const hasLineOfSight = !segmentBlocked(
    enemy.x, enemy.z, context.player.x, context.player.z, context.walls, SHOT_HEIGHT,
  )

  if (hasLineOfSight && distance <= behaviour.attackRange && enemy.attackCooldown <= 0) {
    enemy.state = 'attack'
    // A pose de ataque precisa durar mais que o tic do golpe, senao pisca por
    // 28 ms e o jogador nao chega a ver quem disparou nele.
    enemy.stateTics = ATTACK_POSE_TICS
    enemy.attackCooldown = behaviour.attackCooldownTics

    // Um sorteio por chumbo, na ordem: para quem dispara um projetil so, isto
    // consome exatamente o mesmo valor do gerador que consumia antes desta
    // etapa — as partidas seedadas ja calibradas continuam identicas.
    const chumbos = 'chumbos' in behaviour ? behaviour.chumbos : 1
    let acertos = 0
    for (let i = 0; i < chumbos; i++) {
      if (rollHit(behaviour, distance, context.random)) acertos++
    }

    // Atirou: escolhe agora, de onde esta e enxergando o jogador, para onde vai
    // se abrigar ate a proxima chance. Uma unica busca por disparo — refazer a
    // conta a cada tic custaria caro e trocaria o destino no meio do caminho.
    if ('buscaCobertura' in behaviour) escolherCobertura(enemy, context, behaviour)

    return {
      enemyId: enemy.id,
      damage: behaviour.damage * Math.max(acertos, 1),
      hit: acertos > 0,
    }
  }

  // Segura a pose de ataque enquanto ela durar, mesmo ja em recarga.
  if (enemy.state === 'attack' && enemy.stateTics > 0) {
    enemy.stateTics--
    return null
  }

  enemy.state = 'chase'
  advance(enemy, context, distance, behaviour)
  return null
}

// ---------------------------------------------------------------------------
// Cobertura
// ---------------------------------------------------------------------------

/**
 * Teto do raio de busca de cobertura, em map units (valor do plano da etapa).
 *
 * DIVERGENCIA DECLARADA: o raio efetivo e menor, porque quem manda e a fisica.
 * O inimigo anda 2 unidades por tic e recarrega em 50; um esconderijo a 400
 * unidades levaria 200 tics so de ida, quatro cadencias inteiras andando de
 * costas para o jogador. O raio usado e o MENOR entre este teto e o que da para
 * alcancar dentro de um cooldown (ver `alcanceDeCobertura`) — fora dali vale a
 * segunda metade da regra do plano: comportamento antigo, sem cobertura.
 */
const COVER_SEARCH_RADIUS = 400

/** Quanto do cooldown ele passa abrigado, depois de chegar. */
const COVER_SHARE = 0.6

/**
 * Quanto o inimigo aceita andar atras de um abrigo, em map units.
 *
 * Um cooldown inteiro de caminhada: chegando la, ainda sobra a espera de
 * COVER_SHARE antes de sair para o proximo tiro.
 */
function alcanceDeCobertura(enemy: Enemy, cooldownTics: number): number {
  return Math.min(COVER_SEARCH_RADIUS, chaseSpeed(ENEMIES[enemy.kind]) * cooldownTics)
}

/** Folga entre o corpo e a face do obstaculo, em map units. */
const COVER_CLEARANCE = 12

/** A que distancia do ponto ele ja se considera abrigado. */
const COVER_ARRIVAL = 24

/**
 * Posicoes candidatas ao redor de uma caixa: quatro faces e quatro quinas.
 *
 * A quina importa tanto quanto a face — atras de um pilar quadrado visto na
 * diagonal, quem corta a visada e a quina, e so as faces deixariam o inimigo
 * escolhendo um ponto que nao esconde nada.
 */
const COVER_SIDES = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const

/**
 * Escolhe o ponto de cobertura mais proximo, ou nenhum.
 *
 * "Cobertura" aqui tem definicao operacional, nao estetica: e um ponto de onde
 * `segmentBlocked` diz que a visada ate o jogador esta CORTADA, na mesma altura
 * em que o tiro viaja. Por isso os obstaculos baixos da arena (altura 28, por
 * baixo do olho a 41) nunca sao escolhidos — eles barram o corpo e nao a visao,
 * e agachar atras deles seria fingir cobertura que o jogador nao ve acontecer.
 *
 * Deterministico: percorre caixas e lados em ordem fixa e fica com o mais
 * proximo, com desempate pela ordem de iteracao. Nenhum sorteio novo entra no
 * gerador — duas partidas com a mesma semente escolhem os mesmos pontos.
 */
function escolherCobertura(
  enemy: Enemy,
  context: EnemyTickContext,
  behaviour: { attackRange: number; attackCooldownTics: number },
): void {
  enemy.coverX = null
  enemy.coverZ = null
  enemy.coverTics = 0

  const coberturas = context.coberturas
  if (!coberturas) return

  const alcance = alcanceDeCobertura(enemy, behaviour.attackCooldownTics)
  let melhorX = 0
  let melhorZ = 0
  let melhorDistancia = alcance

  for (const box of coberturas) {
    // Baixa demais para cortar a linha de tiro: nao e cobertura.
    if (box.height <= SHOT_HEIGHT) continue

    const afastamentoX = box.width / 2 + enemy.radius + COVER_CLEARANCE
    const afastamentoZ = box.depth / 2 + enemy.radius + COVER_CLEARANCE

    for (const [ladoX, ladoZ] of COVER_SIDES) {
      const x = box.x + ladoX * afastamentoX
      const z = box.z + ladoZ * afastamentoZ

      const daqui = Math.hypot(x - enemy.x, z - enemy.z)
      if (daqui >= melhorDistancia) continue

      // De nada adianta um esconderijo de onde ele nao alcance o jogador
      // depois: sair dali para atirar custaria a travessia inteira de volta.
      if (Math.hypot(x - context.player.x, z - context.player.z) > behaviour.attackRange) continue

      if (!segmentBlocked(x, z, context.player.x, context.player.z, context.walls, SHOT_HEIGHT)) {
        continue
      }

      melhorX = x
      melhorZ = z
      melhorDistancia = daqui
    }
  }

  if (melhorDistancia === alcance) return

  enemy.coverX = melhorX
  enemy.coverZ = melhorZ
  // Orcamento do episodio inteiro: a ida mais a espera. Um contador so, gasto
  // tanto andando quanto agachado — chegando rapido, sobra espera; chegando no
  // limite, ele sai quase na hora, que e o comportamento certo para quem gastou
  // a recarga inteira caminhando.
  enemy.coverTics = Math.round(behaviour.attackCooldownTics * (1 + COVER_SHARE))
}

function largarCobertura(enemy: Enemy): void {
  enemy.coverX = null
  enemy.coverZ = null
  enemy.coverTics = 0
}

/**
 * Movimento do tic quando ha cobertura escolhida.
 *
 * @returns true se a cobertura consumiu o tic; false para o chamador seguir com
 *   a perseguicao de sempre.
 */
function moverParaCobertura(enemy: Enemy, context: EnemyTickContext): boolean {
  if (enemy.coverX === null || enemy.coverZ === null) return false

  // O orcamento corre em qualquer caso. Sem isso, um ponto que ele nunca
  // alcanca (do outro lado de uma quina, bloqueado por outro corpo) o prenderia
  // em vaivem eterno, sem nunca voltar a atirar.
  enemy.coverTics--
  if (enemy.coverTics <= 0) {
    largarCobertura(enemy)
    return false
  }

  const falta = Math.hypot(enemy.coverX - enemy.x, enemy.coverZ - enemy.z)

  if (falta > COVER_ARRIVAL) {
    moverPara(enemy, context, enemy.coverX, enemy.coverZ)
    return true
  }

  // Abrigado e esperando. Continua resolvendo a separacao para nao virar poste
  // dentro de outro corpo, mas nao avanca.
  aplicarPasso(enemy, context, 0, 0)
  return true
}

/** Quantos tics a pose de ataque permanece visivel. */
export const ATTACK_POSE_TICS = 7

function faceTarget(enemy: Enemy, target: Vec2): void {
  enemy.yaw = Math.atan2(-(target.x - enemy.x), -(target.z - enemy.z))
}

/**
 * Movimento do tic: cobertura, flanco ou perseguicao.
 *
 * O DOOM move o monstro em saltos de `speed` unidades a cada frame de
 * caminhada. Aqui distribuimos o mesmo deslocamento por tic: a velocidade
 * media e identica, mas o movimento interpola sem tranco a 60 fps, onde o
 * salto original apareceria como engasgo.
 *
 * Nenhuma das camadas taticas muda a velocidade nem a colisao — as tres
 * decidem apenas PARA ONDE aponta o passo deste tic.
 */
function advance(
  enemy: Enemy,
  context: EnemyTickContext,
  distance: number,
  behaviour: (typeof BEHAVIOUR)[EnemyKind],
): void {
  // Abrigar-se tem prioridade sobre perseguir: quem acabou de atirar sai da
  // linha de tiro antes de qualquer outra coisa.
  if (moverParaCobertura(enemy, context)) return

  // Nunca entrar no espaco do jogador. Sem este limite o inimigo corpo a
  // corpo caminha ate o centro dele, a camera termina dentro do modelo e o
  // jogador perde a nocao de onde a ameaca esta.
  const bodyDistance = PLAYER_RADIUS + enemy.radius
  const minimo = Math.max(behaviour.preferredRange, bodyDistance)

  const speed = chaseSpeed(ENEMIES[enemy.kind])
  const toPlayerX = (context.player.x - enemy.x) / (distance || 1)
  const toPlayerZ = (context.player.z - enemy.z) / (distance || 1)

  let moveX: number
  let moveZ: number

  if (distance > minimo) {
    // Ponto de mira, que nem sempre e o jogador: quem flanqueia aponta para o
    // lado dele enquanto esta longe (ver desvioDeFlanco) e so converge de
    // perto. A caminhada continua sendo um passo por tic contra as paredes —
    // o desvio guia, nao teleporta, e nada aqui atravessa geometria.
    const desvio = desvioDeFlanco(enemy, behaviour, distance)
    const alvoX = context.player.x - toPlayerZ * desvio
    const alvoZ = context.player.z + toPlayerX * desvio

    const paraAlvoX = alvoX - enemy.x
    const paraAlvoZ = alvoZ - enemy.z
    const comprimento = Math.hypot(paraAlvoX, paraAlvoZ) || 1

    moveX = (paraAlvoX / comprimento) * speed
    moveZ = (paraAlvoZ / comprimento) * speed
  } else {
    // Chegou na distancia de tiro. A versao anterior simplesmente parava, e o
    // inimigo virava estatua: parecia alvo de estande enquanto continuava
    // matando de longe. Agora circula o jogador, trocando de lado de tempos
    // em tempos — le-se como ameaca viva e obriga a reajustar a mira.
    enemy.strafeTics--
    if (enemy.strafeTics <= 0) {
      enemy.strafeDir = context.random.float() < 0.5 ? 1 : -1
      enemy.strafeTics = 25 + context.random.int(45)
    }

    const lateral = speed * 0.7 * enemy.strafeDir
    moveX = -toPlayerZ * lateral
    moveZ = toPlayerX * lateral

    // Correcao suave de raio: se estiver perto ou longe demais da distancia
    // preferida, aproxima ou afasta enquanto circula.
    const erro = distance - minimo
    if (Math.abs(erro) > 40) {
      const ajuste = Math.sign(erro) * speed * 0.35
      moveX += toPlayerX * ajuste
      moveZ += toPlayerZ * ajuste
    }
  }

  aplicarPasso(enemy, context, moveX, moveZ)
}

/**
 * Desvio lateral do ponto de mira, em map units, com sinal.
 *
 * Zero para quem nao flanqueia e para quem ja chegou perto. O LADO e estavel
 * por individuo — sai da paridade do id, nao de sorteio por tic. Sorteado a
 * cada tic, o imp trocaria de lado varias vezes por segundo e andaria em
 * zigue-zague no lugar de flanquear; sorteado uma vez e guardado, custaria mais
 * um campo de estado e mais um consumo do gerador, deslocando toda partida
 * seedada ja calibrada. A paridade do id da as duas coisas de graca: metade da
 * onda vai por um lado, metade pelo outro, e a partida continua reproduzivel.
 */
function desvioDeFlanco(
  enemy: Enemy,
  behaviour: (typeof BEHAVIOUR)[EnemyKind],
  distance: number,
): number {
  if (!('flancoDesvio' in behaviour)) return 0
  if (distance <= behaviour.flancoConverge) return 0

  // Rampa: no limite da convergencia o desvio e zero e cresce ate o maximo a
  // duas vezes essa distancia. Sem a rampa, o desvio sumiria de um tic para o
  // outro e a curva viraria uma quina visivel na tela.
  const rampa = Math.min(1, (distance - behaviour.flancoConverge) / behaviour.flancoConverge)
  const lado = enemy.id % 2 === 0 ? 1 : -1

  return behaviour.flancoDesvio * rampa * lado
}

/** Caminha um passo em direcao a um ponto, parando nele em vez de passar. */
function moverPara(
  enemy: Enemy,
  context: EnemyTickContext,
  targetX: number,
  targetZ: number,
): void {
  const dx = targetX - enemy.x
  const dz = targetZ - enemy.z
  const distance = Math.hypot(dx, dz)
  if (distance === 0) return

  const passo = Math.min(chaseSpeed(ENEMIES[enemy.kind]), distance)
  aplicarPasso(enemy, context, (dx / distance) * passo, (dz / distance) * passo)
}

/** Aplica o passo pretendido somado a separacao, contra as paredes. */
function aplicarPasso(
  enemy: Enemy,
  context: EnemyTickContext,
  moveX: number,
  moveZ: number,
): void {
  const separation = computeSeparation(enemy, context.others)

  const moved = moveWithCollision(
    { x: enemy.x, z: enemy.z },
    { x: moveX + separation.x, z: moveZ + separation.z },
    enemy.radius,
    context.walls,
  )

  // Acumula o que ANDOU, nao o que tentou andar: preso contra parede, o passo
  // para junto com o corpo.
  enemy.distanceWalked += Math.hypot(moved.x - enemy.x, moved.z - enemy.z)

  enemy.x = moved.x
  enemy.z = moved.z
}

/**
 * Empurrao suave entre inimigos.
 *
 * Sem isso todos convergem para o mesmo ponto e viram um unico bloco: a onda
 * perde a leitura, e o jogador nao consegue estimar quantos estao vindo.
 */
function computeSeparation(enemy: Enemy, others: readonly EnemyPositionSnapshot[]): Vec2 {
  let pushX = 0
  let pushZ = 0

  for (const other of others) {
    if (other.id === enemy.id || !other.alive) continue

    const dx = enemy.x - other.x
    const dz = enemy.z - other.z
    const distance = Math.hypot(dx, dz)
    const minimum = enemy.radius + other.radius

    if (distance === 0 || distance >= minimum) continue

    const strength = (minimum - distance) / minimum
    pushX += (dx / distance) * strength * 2
    pushZ += (dz / distance) * strength * 2
  }

  return { x: pushX, z: pushZ }
}

function applyKnockback(enemy: Enemy, walls: readonly Wall[]): void {
  if (enemy.knockX === 0 && enemy.knockZ === 0) return

  const moved = moveWithCollision(
    { x: enemy.x, z: enemy.z },
    { x: enemy.knockX, z: enemy.knockZ },
    enemy.radius,
    walls,
  )
  enemy.x = moved.x
  enemy.z = moved.z

  // Mesma friccao do jogador: o empurrao morre em poucos tics.
  enemy.knockX *= 0.75
  enemy.knockZ *= 0.75
  if (Math.abs(enemy.knockX) < 0.05) enemy.knockX = 0
  if (Math.abs(enemy.knockZ) < 0.05) enemy.knockZ = 0
}

export interface DamageResult {
  killed: boolean
  /** Entrou em estado de dor — o sinal visivel de que o tiro acertou. */
  staggered: boolean
}

/**
 * Aplica dano a um inimigo.
 *
 * @param dirX direcao do tiro, para o empurrao. Deve ser unitaria.
 */
export function damageEnemy(
  enemy: Enemy,
  damage: number,
  dirX: number,
  dirZ: number,
  random: Random,
): DamageResult {
  if (!enemy.alive || enemy.state === 'dying' || enemy.state === 'dead') {
    return { killed: false, staggered: false }
  }

  enemy.health -= damage

  const thrust = damageThrust(damage)
  enemy.knockX += dirX * thrust
  enemy.knockZ += dirZ * thrust

  if (enemy.health <= 0) {
    enemy.alive = false
    enemy.state = 'dying'
    enemy.stateTics = ENEMIES[enemy.kind].deathTics
    return { killed: true, staggered: false }
  }

  const stats = ENEMIES[enemy.kind]
  const staggered = random.float() < stats.painChance

  if (staggered) {
    enemy.state = 'pain'
    enemy.stateTics = stats.painTics
  }

  return { killed: false, staggered }
}

/** Quanto tempo o corpo permanece visivel apos a morte, em tics. */
export const CORPSE_LINGER_TICS = TICRATE * 8
