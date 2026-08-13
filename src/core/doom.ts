/**
 * Constantes do DOOM (1993) — o benchmark contra o qual este jogo e medido.
 *
 * Tres categorias, e a distincao importa:
 *
 *   CITADO   valor lido direto do source liberado pela id Software
 *            (github.com/id-Software/DOOM, linuxdoom-1.10) ou do doomwiki.
 *   DERIVADO valor calculado a partir de constantes citadas. A derivacao esta
 *            escrita no comentario e reproduzida em teste.
 *   LACUNA   nao encontrado em fonte confiavel. Marcado, nunca inventado.
 *
 * Unidade nativa do projeto e o "map unit" do DOOM, e nao o metro: a camera,
 * a colisao e a fisica trabalham nela. Isso deixa a comparacao com o benchmark
 * direta, sem fator de conversao onde possa esconder erro.
 */

// ---------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------

/** CITADO — doomwiki.org/wiki/Tic. A simulacao inteira roda nesta taxa. */
export const TICRATE = 35

/** DERIVADO — 1000 / TICRATE. */
export const TIC_MS = 1000 / TICRATE

/** CITADO — m_fixed.h. Base da aritmetica de ponto fixo do DOOM. */
export const FRACUNIT = 65536

// ---------------------------------------------------------------------------
// Jogador — geometria
// ---------------------------------------------------------------------------

/** CITADO — p_local.h: `#define VIEWHEIGHT (41*FRACUNIT)`. */
export const VIEW_HEIGHT = 41

/** CITADO — p_local.h: `#define PLAYERRADIUS 16*FRACUNIT`. */
export const PLAYER_RADIUS = 16

/** CITADO — altura da hitbox do jogador. */
export const PLAYER_HEIGHT = 56

/** CITADO — doomwiki.org/wiki/Map_unit. Lado da celula do grid do editor. */
export const GRID_CELL = 64

// ---------------------------------------------------------------------------
// Jogador — movimento
//
// Ponto que e facil errar: forwardmove e sidemove NAO sao velocidade. Em
// p_user.c o valor entra como empuxo somado ao momento:
//
//     P_Thrust(player, angle, cmd->forwardmove * 2048)
//     player->mo->momx += FixedMul(move, finecosine[angle])
//
// Sao aceleracao por tic. A velocidade final emerge do equilibrio entre esse
// empuxo e a friccao. Tratar forwardmove como velocidade infla a corrida em
// tres vezes e produz um jogo que parece patinar no gelo.
// ---------------------------------------------------------------------------

/** CITADO — g_game.c: `forwardmove[2] = {0x19, 0x32}`. */
export const FORWARD_MOVE = { walk: 0x19, run: 0x32 } as const

/** CITADO — g_game.c: `sidemove[2] = {0x18, 0x28}`. */
export const SIDE_MOVE = { walk: 0x18, run: 0x28 } as const

/** CITADO — p_user.c: multiplicador aplicado antes de P_Thrust. */
export const THRUST_SCALE = 2048

/** CITADO — p_mobj.c: `#define FRICTION 0xe800`. Multiplicativo, por tic. */
export const FRICTION = 0xe800 / FRACUNIT // 0.90625

/** CITADO — p_local.h: `#define MAXMOVE (30*FRACUNIT)`. Teto do momento. */
export const MAX_MOVE = 30

/**
 * DERIVADO — aceleracao em map units por tic ao quadrado.
 * move * 2048 / FRACUNIT  =  move / 32
 */
export function thrustToAcceleration(move: number): number {
  return (move * THRUST_SCALE) / FRACUNIT
}

/**
 * DERIVADO — velocidade terminal, em map units por tic.
 *
 * A ordem das operacoes no tic do DOOM importa e e facil errar. P_MovePlayer
 * soma o empuxo ao momento; so entao P_XYMovement desloca o objeto por esse
 * momento e, depois de mover, aplica a friccao:
 *
 *     momx += a          (P_Thrust, em P_MovePlayer)
 *     x    += momx       (P_XYMovement, o deslocamento observado)
 *     momx *= f          (P_XYMovement, no fim)
 *
 * Chamando de m o momento no instante do deslocamento e de u o momento ja
 * friccionado, temos u = m * f e m = u + a. Substituindo: m = a / (1 - f).
 *
 * Isso rende 583,3 unidades por segundo correndo — que e exatamente a
 * velocidade de corrida consagrada do DOOM. A forma alternativa
 * a * f / (1 - f) daria 528,6 e descreveria o momento apos a friccao, que
 * nao e a distancia que o jogador percorre.
 */
export function terminalSpeed(move: number): number {
  return thrustToAcceleration(move) / (1 - FRICTION)
}

/** DERIVADO — conveniencia para a rubrica, que raciocina em u/s. */
export function perTicToPerSecond(unitsPerTic: number): number {
  return unitsPerTic * TICRATE
}

/** DERIVADO — velocidades terminais, em map units por tic. */
export const TERMINAL_SPEED = {
  forwardWalk: terminalSpeed(FORWARD_MOVE.walk),
  forwardRun: terminalSpeed(FORWARD_MOVE.run),
  sideWalk: terminalSpeed(SIDE_MOVE.walk),
  sideRun: terminalSpeed(SIDE_MOVE.run),
} as const

// ---------------------------------------------------------------------------
// Jogador — camera
// ---------------------------------------------------------------------------

/** CITADO — doomwiki.org/wiki/Doom_rendering_engine. FOV horizontal. */
export const FOV_HORIZONTAL_DEG = 90

/** CITADO — p_user.c: `#define MAXBOB 0x100000` (16 map units). */
export const MAX_BOB = 0x100000 / FRACUNIT

/**
 * CITADO — p_user.c: `bob = FixedMul(player->bob / 2, finesine[angle])`.
 * A amplitude efetiva do balanco e metade do teto.
 */
export const BOB_AMPLITUDE = MAX_BOB / 2

/**
 * LACUNA — o periodo do balanco vem de `FINEANGLES/20*leveltime`, o que
 * sugere ciclo de 20 tics, mas nao confirmei a expressao no source.
 * Usado so como polimento visual; nenhuma nota da rubrica depende dele.
 */
export const BOB_PERIOD_TICS = 20

/**
 * DERIVADO — rotacao por teclado, em graus por tic.
 *
 * g_game.c: `angleturn[3] = {640, 1280, 320}`, aplicado como
 * `angle += cmd->angleturn << 16` sobre um BAM de 32 bits, onde
 * 2^32 equivale a 360 graus. Logo graus = angleturn / 65536 * 360.
 *
 * Referencia historica apenas: aqui a mira e no mouse, e sensibilidade de
 * mouse e preferencia do jogador, nao constante de fidelidade.
 */
export const TURN_DEG_PER_TIC = {
  slow: (320 / FRACUNIT) * 360,
  normal: (640 / FRACUNIT) * 360,
  fast: (1280 / FRACUNIT) * 360,
} as const

// ---------------------------------------------------------------------------
// Armas
// ---------------------------------------------------------------------------

/**
 * CITADO — info.c, cadeias de estado das armas. Duracoes em tics.
 *
 * `delayTics` e o que a rubrica de responsividade mede: quantos tics entre
 * apertar o gatilho e o dano ser aplicado.
 */
export const WEAPONS = {
  pistol: {
    /** info.c: PISG A 4, B 6 A_FirePistol, C 4, B 5 A_ReFire */
    cycleTics: 19,
    delayTics: 4,
    pellets: 1,
    /** doomwiki A_FirePistol: 5 * (P_Random() % 3 + 1) */
    damage: { multiplier: 5, faces: 3 },
    spreadDeg: 0,
  },
  shotgun: {
    cycleTics: 44,
    delayTics: 3,
    /** doomwiki.org/wiki/Shotgun */
    pellets: 7,
    damage: { multiplier: 5, faces: 3 },
    /** Dispersao horizontal apenas; o engine original nao espalha na vertical. */
    spreadDeg: 5.9,
  },
} as const

// ---------------------------------------------------------------------------
// Inimigos
// ---------------------------------------------------------------------------

/**
 * CITADO — info.c, mobjinfo.
 *
 * `speed` nao e velocidade por tic: P_Move desloca o monstro em `speed`
 * unidades por chamada de A_Chase, e A_Chase roda uma vez por frame de
 * caminhada. Com frames de 4 tics, 8 unidades / 4 tics = 2 unidades por tic,
 * ou 70 unidades por segundo — o que bate com a velocidade observada e
 * relatada pela comunidade para o Zombieman.
 */
export const ENEMIES = {
  zombieman: {
    health: 20,
    radius: 20,
    height: 56,
    /** map units por chamada de P_Move */
    moveStep: 8,
    /** tics por frame de caminhada */
    stepTics: 4,
    /** info.c: painchance 200, em 256 */
    painChance: 200 / 256,
    painTics: 6,
    deathTics: 25,
  },
  imp: {
    health: 60,
    radius: 20,
    height: 56,
    moveStep: 8,
    stepTics: 4,
    painChance: 200 / 256,
    painTics: 4,
    deathTics: 40,
  },
} as const

/** DERIVADO — velocidade de perseguicao, em map units por tic. */
export function chaseSpeed(enemy: { moveStep: number; stepTics: number }): number {
  return enemy.moveStep / enemy.stepTics
}

/**
 * CITADO — p_inter.c, P_DamageMobj.
 * `thrust = damage * (FRACUNIT >> 3) * 100 / mass`, com massa padrao 100.
 */
export const DEFAULT_MASS = 100

/** DERIVADO — empuxo do dano, em map units por tic. */
export function damageThrust(damage: number, mass: number = DEFAULT_MASS): number {
  return (damage * (FRACUNIT >> 3) * 100) / mass / FRACUNIT
}

// ---------------------------------------------------------------------------
// Lacunas conhecidas do benchmark
//
// Registradas aqui porque o bloco de entrega exige declarar o que nao pode ser
// verificado, em vez de preencher com estimativa e apresentar como fato.
// ---------------------------------------------------------------------------

export const BENCHMARK_GAPS = [
  'Periodo exato do view bob (expressao de leveltime nao confirmada no source).',
  'Intervalo de A_Chase: fonte secundaria diz 3 tics, os frames de caminhada dizem 4. Adotado 4, que reproduz a velocidade observada de 70 u/s.',
  'Escala de map unit para metros: nao ha valor oficial; a comunidade diverge. Irrelevante aqui, porque nao convertemos.',
  'Latencia entre registro do hit e reacao visivel do inimigo nao esta documentada separadamente do pain state.',
] as const
