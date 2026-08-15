/**
 * Definicao do mundo, em map units do DOOM.
 *
 * Dados puros: geometria logica, paredes de colisao e pontos de nascimento.
 * A construcao das malhas do Three.js fica no modulo de render, para que o
 * mundo inteiro possa ser verificado sob teste sem navegador.
 *
 * ## Tres salas numa unica malha de coordenadas
 *
 * O mundo deixou de ser uma sala e virou uma sequencia de tres, JUSTAPOSTAS NO
 * EIXO Z NEGATIVO — a direcao para onde o jogador ja nasce olhando (yaw 0
 * aponta para -Z, ver `forwardVector`). Nao ha teleporte nem carregamento: as
 * coordenadas sao continuas, e andar de uma sala para a outra e so andar.
 *
 *     z = +1024  +-------------------+                fundo do galpao
 *                |     1 GALPAO      |  2048 x 2048
 *     z = -1024  +------[ porta 1 ]--+
 *                |   2 CORREDORES    |  2048 x 1024
 *     z = -2048  +------[ porta 2 ]--+
 *                | 3      PATIO      |  2560 x 2048
 *     z = -4096  +-------------------+
 *
 * A sala 1 preserva EXATAMENTE a geometria da arena publicada (mesmo tamanho,
 * mesmos pilares, mesmos obstaculos baixos): a rubrica, a legibilidade e a
 * janela de sobrevivencia foram calibradas nela, e mexer ali invalidaria
 * medicao ja paga.
 *
 * ## Porta: recomputa, nao espalha flag
 *
 * A porta e um segmento de parede com estado. Fechada, ela entra em `walls`
 * como uma Wall comum de altura cheia — logo barra movimento (colisao) E
 * visada (`segmentBlocked`) sem que nenhum dos dois modulos precise saber que
 * portas existem. Aberta, ela simplesmente sai da lista.
 *
 * A alternativa seria uma flag em `Wall` que colisao e visada respeitassem;
 * foi descartada porque espalharia o conceito de porta por `collision.ts`,
 * `hitscan.ts` e por todo consumidor futuro de `Wall`. Aqui a mudanca fica
 * contida: `abrirPorta` recompoe `arena.walls` NO LUGAR (mutando o array, nao
 * trocando a referencia), entao quem ja guardou `arena.walls` continua vendo a
 * lista correta.
 */

import { GRID_CELL } from '../core/doom'
import type { Vec2, Wall } from './collision'

/**
 * Que objeto escaneado o render deve por no lugar da caixa procedural.
 *
 * Vive aqui, e nao no modulo de render, porque a FORMA do obstaculo e decisao
 * de level design: o rodape de um barril e quadrado, o de uma mureta e comprido
 * e estreito, e a caixa de colisao foi desenhada para caber no modelo (ver
 * ALTURA_* e os construtores mais abaixo). O render so obedece.
 *
 * Ausente = a caixa texturizada de sempre. Nenhum consumidor da simulacao le
 * este campo: colisao, visada e IA continuam vendo apenas x/z/width/depth/height.
 */
export type VisualDeBox = 'caixa' | 'barril' | 'mureta' | 'municao'

/** Caixa alinhada aos eixos: pilar, bloco de cobertura ou parede grossa. */
export interface Box {
  /** Centro no plano horizontal. */
  x: number
  z: number
  /** Extensao total, nao meia-extensao. */
  width: number
  depth: number
  height: number
  /** Objeto escaneado que substitui a caixa procedural no render. */
  visual?: VisualDeBox
}

/** Retangulo alinhado aos eixos, em map units. */
export interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export type SalaId = 1 | 2 | 3

/**
 * Ponto de nascimento DESENHADO.
 *
 * O nome nao e enfeite: ele documenta a intencao tatica do ponto (atras de
 * cobertura, em pinca na entrada, no fundo do corredor) e aparece na
 * verificacao, onde um ponto que colide com parede precisa ser identificavel
 * sem contar indices.
 */
export interface SpawnPoint extends Vec2 {
  nome: string
}

/** Uma sala do mundo, com sua geometria e seus nascimentos proprios. */
export interface Sala {
  id: SalaId
  nome: 'galpao' | 'corredores' | 'patio'
  bounds: Bounds
  /** Obstaculos desta sala. Tambem aparecem em `Arena.boxes`. */
  boxes: Box[]
  /** Nascimentos desenhados para esta sala. */
  spawnPoints: SpawnPoint[]
}

/** Segmento de parede com estado, ligando duas salas. */
export interface Porta {
  id: number
  x1: number
  z1: number
  x2: number
  z2: number
  salaDe: SalaId
  salaPara: SalaId
  aberta: boolean
}

export interface Arena {
  /**
   * Lado da SALA INICIAL, em map units.
   *
   * Continua existindo com o mesmo valor de sempre porque o render e a rubrica
   * dimensionam neblina, luz e carga de teste a partir dele. O tamanho do
   * mundo inteiro esta em `boundsTotal`.
   */
  size: number
  wallHeight: number
  /**
   * Segmentos usados pela colisao e pela visada — perimetros, obstaculos e as
   * portas ainda fechadas. Recomposto no lugar por `abrirPorta`.
   */
  walls: Wall[]
  /** Obstaculos de todas as salas, para o render levantar as malhas. */
  boxes: Box[]
  playerStart: { x: number; z: number; yaw: number }
  /**
   * Nascimentos da sala inicial.
   *
   * Mantido por compatibilidade: quem so conhece uma sala continua lendo o que
   * sempre leu. O jogo usa `salas[n].spawnPoints`.
   */
  spawnPoints: Vec2[]
  /** As tres salas, na ordem em que sao percorridas. */
  salas: Sala[]
  /** As portas entre elas, na ordem em que sao abertas. */
  portas: Porta[]
  /** Envelope do mundo inteiro. */
  boundsTotal: Bounds
  /** Paredes que nunca mudam de estado. Base para recompor `walls`. */
  paredesFixas: Wall[]
}

/** Converte uma caixa nos quatro segmentos do seu perimetro. */
export function boxToWalls(box: Box): Wall[] {
  const halfWidth = box.width / 2
  const halfDepth = box.depth / 2
  const minX = box.x - halfWidth
  const maxX = box.x + halfWidth
  const minZ = box.z - halfDepth
  const maxZ = box.z + halfDepth

  const { height } = box
  return [
    { ax: minX, az: minZ, bx: maxX, bz: minZ, height },
    { ax: maxX, az: minZ, bx: maxX, bz: maxZ, height },
    { ax: maxX, az: maxZ, bx: minX, bz: maxZ, height },
    { ax: minX, az: maxZ, bx: minX, bz: minZ, height },
  ]
}

/** A porta como segmento de parede. So entra em `walls` enquanto fechada. */
export function portaToWall(porta: Porta): Wall {
  // Sem `height`: altura cheia, barra corpo e visada como qualquer parede.
  return { ax: porta.x1, az: porta.z1, bx: porta.x2, bz: porta.z2 }
}

/**
 * Recompoe `arena.walls` a partir das paredes fixas e das portas fechadas.
 *
 * Muta o array no lugar de proposito: `Game` e os inimigos guardam a
 * referencia de `arena.walls` e precisam enxergar a porta sumir.
 */
export function recomputarParedes(arena: Arena): void {
  const fechadas = arena.portas.filter((porta) => !porta.aberta).map(portaToWall)
  arena.walls.length = 0
  arena.walls.push(...arena.paredesFixas, ...fechadas)
}

/** Abre a porta e recompoe as paredes. Devolve false se o id nao existir. */
export function abrirPorta(arena: Arena, portaId: number): boolean {
  const porta = arena.portas.find((p) => p.id === portaId)
  if (!porta) return false
  if (porta.aberta) return true

  porta.aberta = true
  recomputarParedes(arena)
  return true
}

/** A porta que leva para fora desta sala, se houver. */
export function portaDaSala(arena: Arena, sala: SalaId): Porta | null {
  return arena.portas.find((porta) => porta.salaDe === sala) ?? null
}

export function dentroDeBounds(bounds: Bounds, x: number, z: number): boolean {
  return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ
}

/**
 * Em que sala esta o ponto?
 *
 * As salas se tocam (o fundo de uma e a frente da outra), entao um ponto
 * exatamente sobre a divisa pertence a sala de menor indice: a travessia so
 * conta quando o jogador passa DE FATO do vao.
 */
export function salaDoPonto(arena: Arena, x: number, z: number): SalaId | null {
  for (const sala of arena.salas) {
    if (dentroDeBounds(sala.bounds, x, z)) return sala.id
  }
  return null
}

// ---------------------------------------------------------------------------
// Construcao
// ---------------------------------------------------------------------------

/** Meia largura do vao de uma porta: 128, logo 256 de passagem. */
const MEIO_VAO = GRID_CELL * 2

/** Um segmento reto em Z constante, partido ao meio pelo vao de uma porta. */
function paredeComVao(z: number, minX: number, maxX: number): Wall[] {
  return [
    { ax: minX, az: z, bx: -MEIO_VAO, bz: z },
    { ax: MEIO_VAO, az: z, bx: maxX, bz: z },
  ]
}

// ---------------------------------------------------------------------------
// Cenario: os objetos escaneados que enchem as salas
//
// Tres regras DURAS decidem toda altura daqui para baixo, e nenhuma delas e
// gosto:
//
// 1. FAIXA PROIBIDA. Nenhum obstaculo pode ter altura dentro de
//    (SHOT_HEIGHT - BOB_AMPLITUDE, SHOT_HEIGHT + BOB_AMPLITUDE) = (33, 49): no
//    meio dessa faixa o balanco do passo faz a visada ora passar por cima ora
//    bater, e o que o jogador ve deixa de casar com o que o tiro faz.
//    Travado em tests/progressao.test.ts.
// 2. TETO DOS BAIXOS. tests/rubrica.test.ts exige que toda parede com altura
//    abaixo de 64 esteja abaixo da linha de visao (41). Somado a regra 1, so
//    sobram duas faixas legais: ATE 33, ou 64 PARA CIMA.
// 3. COBERTURA DE IA. `escolherCobertura` (enemies/enemy.ts, nao editado aqui)
//    so considera abrigo o obstaculo com altura ACIMA de 41. Todo objeto novo
//    deste arquivo fica em 33 ou menos, entao nenhum vira esconderijo novo e a
//    janela de sobrevivencia multi-semente continua medindo o que media.
//
// DIVERGENCIA DECLARADA do enunciado da etapa, que pedia pilhas de 26 a 56 de
// altura: 56 cai na faixa banida pela regra 2 (abaixo de 64 e acima de 41), e
// qualquer valor acima de 41 criaria cobertura de IA nova — as duas coisas que
// as regras acima proibem. As pilhas ficaram baixas, e o volume que elas dariam
// veio do NUMERO de pecas por grupo, nao da altura de cada uma.
//
// Os rodapes nao sao arbitrarios: cada um e a sombra do modelo escaneado quando
// ele e escalado ATE a altura declarada (o render escala pela altura, uniforme).
// Medidos no proprio glTF COM as transformacoes de no aplicadas, em metros:
//
//   engradado militar (par de caixas)  1,815 x 0,301 x 0,979
//   barril                             0,634 x 0,930 x 0,639
//   mureta de concreto                 1,545 x 0,831 x 0,639
//   caixa de municao                   0,087 x 0,177 x 0,258
//
// "Com as transformacoes aplicadas" nao e detalhe: o engradado tem uma tampa
// aberta e girada, e ler so o AABB cru dos vertices dava 0,538 de profundidade
// no lugar de 0,979 — quase a metade. A caixa de colisao desenhada por aquele
// numero deixaria a tampa para fora dela, e o jogador atravessaria com o ombro
// um pedaco de madeira que esta vendo.
//
// Sem esse cuidado o modelo transborda a caixa de colisao (o jogador esbarra no
// nada) ou nada dentro dela (esbarra antes de encostar).
// ---------------------------------------------------------------------------

/**
 * Pilha de engradados.
 *
 * O rodape do modelo e SEIS vezes a altura dele no lado maior, entao cada
 * unidade de altura custa caro em chao ocupado: em 20 o grupo ja mede 121 x 65,
 * o tamanho de um deposito de verdade. Subir para os 26 do primeiro rascunho
 * levaria a 157 x 85 e a pilha viraria uma ilha no meio da sala.
 */
const ALTURA_CAIXA = 20
const ALTURA_CAIXA_PEQUENA = 14
/** Barril de 0,93 m: a 30 unidades ele sai na escala real do mundo (~32 u/m). */
const ALTURA_BARRIL = 30
/** Mureta de 0,83 m: 26 unidades tambem cai na escala real. */
const ALTURA_MURETA = 26
/** Caixa de municao pequena, para ler como detalhe e nao como obstaculo. */
const ALTURA_MUNICAO = 14

/**
 * Passo entre muretas de uma fileira.
 *
 * A peca mede 48,3 na altura 26 (1,545/0,831 * 26). O passo e 50 para as pecas
 * se sucederem com uma folga fina em vez de se atravessarem — o render
 * distribui `comprimento / copias` e uma folga pequena e invisivel, enquanto
 * sobreposicao aparece como concreto entrando em concreto.
 */
const MODULO_MURETA = 50

/** Espessura da fileira de muretas novas, casada com o rodape do modelo. */
const ESPESSURA_MURETA = 24

type Eixo = 'x' | 'z'

/** Caixa cujo lado maior corre no eixo pedido. */
function deitada(x: number, z: number, eixo: Eixo, comprimento: number, largura: number,
                 height: number, visual: VisualDeBox): Box {
  return eixo === 'x'
    ? { x, z, width: comprimento, depth: largura, height, visual }
    : { x, z, width: largura, depth: comprimento, height, visual }
}

/**
 * Grupo de engradados militares. `grande` e a pilha; o outro e a peca solta.
 *
 * 128 x 72 na altura 20 vem de 1,815 x 0,979 escalados por 20/0,301, com uns 6%
 * de folga; 92 x 50 na altura 14, pela mesma conta.
 */
function caixa(x: number, z: number, eixo: Eixo, grande = true): Box {
  return grande
    ? deitada(x, z, eixo, 128, 72, ALTURA_CAIXA, 'caixa')
    : deitada(x, z, eixo, 92, 50, ALTURA_CAIXA_PEQUENA, 'caixa')
}

/** 0,64 m de diametro na altura 30 da 20,6 unidades; 22 com a mesma folga. */
function barril(x: number, z: number): Box {
  return { x, z, width: 22, depth: 22, height: ALTURA_BARRIL, visual: 'barril' }
}

/** 0,258 m de lado maior na altura 14 da 20,4 unidades. */
function municao(x: number, z: number): Box {
  return { x, z, width: 22, depth: 22, height: ALTURA_MUNICAO, visual: 'municao' }
}

/** Fileira de `modulos` muretas emendadas, no eixo pedido. */
function mureta(x: number, z: number, eixo: Eixo, modulos: number): Box {
  return deitada(
    x, z, eixo, MODULO_MURETA * modulos, ESPESSURA_MURETA, ALTURA_MURETA, 'mureta',
  )
}

/**
 * Sala 1 — galpao (2048 x 2048), a arena publicada, intacta.
 *
 * Os pilares existem por razao de jogo, nao decorativa: sem nada que quebre a
 * linha de visao, uma arena de ondas vira tiro ao alvo em campo aberto.
 */
function criarGalpao(wallHeight: number): Sala {
  const half = (GRID_CELL * 32) / 2 // 1024
  const pillarOffset = GRID_CELL * 8 // 512

  const boxes: Box[] = [
    { x: -pillarOffset, z: -pillarOffset, width: 128, depth: 128, height: wallHeight },
    { x: pillarOffset, z: -pillarOffset, width: 128, depth: 128, height: wallHeight },
    { x: -pillarOffset, z: pillarOffset, width: 128, depth: 128, height: wallHeight },
    { x: pillarOffset, z: pillarOffset, width: 128, depth: 128, height: wallHeight },
    // Obstaculos baixos: barram o corpo, nao a visada. Ficam abaixo da altura
    // do olho de proposito — a 64 unidades eles escondiam o inimigo por
    // inteiro e, plantados entre o centro e os pontos de nascimento, faziam o
    // jogador no meio da arena nao conseguir acertar quase ninguem.
    // As quatro ganharam `visual: 'mureta'`: mesma posicao, mesmo tamanho,
    // mesma altura — o que muda e o que o olho ve no lugar do bloco de
    // concreto procedural. Nenhum numero desta lista se moveu.
    { x: 0, z: -GRID_CELL * 5, width: 320, depth: 64, height: 28, visual: 'mureta' },
    { x: 0, z: GRID_CELL * 5, width: 320, depth: 64, height: 28, visual: 'mureta' },
    { x: -GRID_CELL * 5, z: 0, width: 64, depth: 320, height: 28, visual: 'mureta' },
    { x: GRID_CELL * 5, z: 0, width: 64, depth: 320, height: 28, visual: 'mureta' },

    // Cenario encostado nas quatro paredes, nas DIAGONAIS INTERMEDIARIAS do
    // anel de nascimento (22,5 graus + multiplos de 90). O lugar nao e estetico:
    //
    //  - o anel nasce a 832 do centro e a rota de cada inimigo e o RAIO dali ate
    //    o jogador; tudo aqui esta a mais de 250 unidades de qualquer uma dessas
    //    oito retas, entao ninguem tem o caminho desviado por decoracao;
    //  - o ponto mais proximo de qualquer nascimento fica a 137 unidades — muito
    //    alem do corpo de um inimigo (raio 20) e da folga de 16 que o teste
    //    de nascimentos cobra;
    //  - todos ficam abaixo de 33, entao nenhum vira cobertura de IA (regra 3
    //    do bloco acima) e a pressao sobre o jogador parado nao muda.
    //
    // A janela de sobrevivencia multi-semente foi medida ANTES e DEPOIS desta
    // lista, semente a semente, e continua dentro de 25-90 s.
    caixa(904, 336, 'z'),
    caixa(884, 452, 'x', false),
    municao(848, 300),

    barril(-352, 880),
    barril(-378, 902),
    barril(-330, 908),

    mureta(-900, -352, 'z', 4),
    municao(-856, -300),

    caixa(336, -904, 'x'),
    barril(452, -884),
    barril(478, -906),
    municao(300, -840),
  ]

  // Nascimentos nas quinas e no meio de cada parede, afastados do centro para
  // que nenhum inimigo apareca em cima do jogador.
  //
  // INTOCAVEIS. Duas tentativas de "melhorar" este anel — girar meio setor
  // para os diagonais nao rasparem a quina dos pilares, e afastar so os
  // diagonais em 48 unidades — quebraram a janela de sobrevivencia parado
  // (19,3 s na semente publicada, contra o piso de 25) e mais cinco testes de
  // combate seedados. A pressao sobre o jogador imovel e calibrada NESTAS oito
  // posicoes; a folga apertada de 17,4 unidades entre os diagonais e a quina
  // dos pilares esta medida e travada em tests/progressao.test.ts.
  const spawnRadius = half - GRID_CELL * 3 // 832
  const spawnPoints: SpawnPoint[] = []
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2
    spawnPoints.push({
      nome: `galpao-anel-${i}`,
      x: Math.cos(angle) * spawnRadius,
      z: Math.sin(angle) * spawnRadius,
    })
  }

  return {
    id: 1,
    nome: 'galpao',
    bounds: { minX: -half, maxX: half, minZ: -half, maxZ: half },
    boxes,
    spawnPoints,
  }
}

/**
 * Sala 2 — corredores (2048 x 1024).
 *
 * Duas trincheiras altas correndo no eixo Z partem a sala em TRES corredores
 * paralelos. Cada trincheira e feita de dois blocos com um vao no meio: sem
 * ele os corredores laterais seriam becos, e o flanco viraria corrida em linha
 * reta. Com ele, o imp que entra pela lateral pode cortar para o centro na
 * metade do caminho — que e o comportamento que a etapa B vai explorar.
 *
 * As duas portas ficam no corredor central: quem avanca em linha reta paga
 * pelo combate curto, quem quiser respirar tem de se enfiar nas laterais.
 */
function criarCorredores(wallHeight: number): Sala {
  const minZ = -2048
  const maxZ = -1024
  const half = 1024

  /** Faces internas das trincheiras: corredores de ~640 nas beiras e 704 no meio. */
  const trincheira = 352

  const boxes: Box[] = [
    { x: -trincheira, z: -1216, width: 64, depth: 320, height: wallHeight },
    { x: -trincheira, z: -1856, width: 64, depth: 320, height: wallHeight },
    { x: trincheira, z: -1216, width: 64, depth: 320, height: wallHeight },
    { x: trincheira, z: -1856, width: 64, depth: 320, height: wallHeight },
    // Cobertura baixa nas laterais: barra o corpo de quem corre pelo flanco,
    // sem esconder o inimigo de quem olha do corredor central. Viraram mureta
    // de concreto no visual, sem mudar um numero.
    { x: -688, z: -1408, width: 256, depth: 64, height: 28, visual: 'mureta' },
    { x: 688, z: -1408, width: 256, depth: 64, height: 28, visual: 'mureta' },

    // Segunda linha de muretas, mais ao fundo dos corredores laterais: quem
    // desce pelo flanco passa a ter DUAS paradas, e nao uma. Fora do vao das
    // portas (o corredor de travessia e |x| <= 128; nada aqui entra em |x| <= 192).
    mureta(-688, -1728, 'x', 4),
    mureta(688, -1728, 'x', 4),

    // Deposito encostado nas paredes laterais, na entrada da sala.
    caixa(-856, -1280, 'z'),
    caixa(-900, -1420, 'x', false),
    municao(-820, -1500),
    caixa(856, -1280, 'z'),
    caixa(900, -1420, 'x', false),
    municao(820, -1500),

    // Barris nas beiras do corredor central, na altura do vao das trincheiras:
    // enchem o olho no cruzamento sem estreitar a passagem (sobram 446 de
    // largura livre no meio) e sem encostar no vao das portas.
    barril(-256, -1520),
    barril(-282, -1544),
    barril(-234, -1550),
    barril(256, -1520),
    barril(282, -1544),
    barril(234, -1550),
  ]

  const spawnPoints: SpawnPoint[] = [
    // Pinça na entrada: os dois primeiros pegam quem acabou de cruzar a porta
    // 1 pelos flancos, sem nunca nascer na frente dele.
    { nome: 'corredores-pinca-esquerda', x: -704, z: -1152 },
    { nome: 'corredores-pinca-direita', x: 704, z: -1152 },
    // Atras da trincheira, fora da visada de quem esta no corredor central.
    { nome: 'corredores-atras-trincheira-esquerda', x: -480, z: -1216 },
    { nome: 'corredores-atras-trincheira-direita', x: 480, z: -1216 },
    { nome: 'corredores-cruzamento-esquerdo', x: -480, z: -1856 },
    { nome: 'corredores-cruzamento-direito', x: 480, z: -1856 },
    // Fundo dos tres corredores.
    { nome: 'corredores-fundo-esquerdo', x: -704, z: -1920 },
    { nome: 'corredores-fundo-central', x: 0, z: -1920 },
    { nome: 'corredores-fundo-direito', x: 704, z: -1920 },
  ]

  return {
    id: 2,
    nome: 'corredores',
    bounds: { minX: -half, maxX: half, minZ, maxZ },
    boxes,
    spawnPoints,
  }
}

/**
 * Sala 3 — patio (2560 x 2048).
 *
 * Linhas de visao longas com coberturas BAIXAS espalhadas: o inimigo continua
 * visivel de longe (a cobertura fica abaixo do olho), mas o corpo dele fica
 * barrado, o que da a IA da etapa B um lugar para se plantar. Os dois unicos
 * volumes altos sao pilares nas laterais, para o patio inteiro nao ser um
 * corredor de tiro sem nenhum quebra-visada.
 */
function criarPatio(wallHeight: number): Sala {
  const minZ = -4096
  const maxZ = -2048
  const half = 1280

  const boxes: Box[] = [
    // As oito coberturas baixas do patio viraram muretas de concreto no visual.
    // Todas sao compridas e baixas — a forma que o modelo de jersey barrier
    // pede —, e nenhuma mudou de lugar nem de tamanho.
    { x: -640, z: -2560, width: 256, depth: 64, height: 28, visual: 'mureta' },
    { x: 640, z: -2560, width: 256, depth: 64, height: 28, visual: 'mureta' },
    { x: 0, z: -2944, width: 64, depth: 256, height: 28, visual: 'mureta' },
    { x: -896, z: -3200, width: 64, depth: 256, height: 28, visual: 'mureta' },
    { x: 896, z: -3200, width: 64, depth: 256, height: 28, visual: 'mureta' },
    { x: -384, z: -3584, width: 256, depth: 64, height: 28, visual: 'mureta' },
    { x: 384, z: -3584, width: 256, depth: 64, height: 28, visual: 'mureta' },
    { x: 0, z: -3840, width: 320, depth: 64, height: 28, visual: 'mureta' },
    { x: -1024, z: -2816, width: 128, depth: 128, height: wallHeight },
    { x: 1024, z: -2816, width: 128, depth: 128, height: wallHeight },

    // Muretas novas: um par logo depois da porta 2 (recuado do vao, que ocupa
    // |x| <= 128) e um par no meio do patio, dando parada a quem cruza o vazio
    // entre as coberturas de origem.
    mureta(-352, -2688, 'x', 4),
    mureta(352, -2688, 'x', 4),
    mureta(-704, -3392, 'z', 4),
    mureta(704, -3392, 'z', 4),

    // Deposito nas laterais da entrada, ao lado dos dois pilares altos.
    caixa(-848, -2624, 'z'),
    caixa(-880, -2760, 'x', false),
    municao(-780, -2700),
    caixa(848, -2624, 'z'),
    caixa(880, -2760, 'x', false),
    municao(780, -2700),

    // Barris encostados nos pilares e nas muretas do meio.
    barril(-1152, -2900),
    barril(-1180, -2924),
    barril(-1132, -2930),
    barril(1152, -2900),
    barril(1180, -2924),
    barril(1132, -2930),
    barril(-384, -3520),
    barril(-412, -3496),
    barril(384, -3520),
    barril(412, -3496),

    // Fundo do patio: engradados nos dois lados da ultima cobertura.
    caixa(-272, -3776, 'x'),
    caixa(272, -3776, 'x'),
    municao(-224, -3700),
    municao(224, -3700),
  ]

  const spawnPoints: SpawnPoint[] = [
    // Pinça na entrada, atras dos pilares: so entram em jogo quando o jogador
    // ja avancou para o meio do patio.
    { nome: 'patio-pinca-esquerda', x: -1088, z: -2432 },
    { nome: 'patio-pinca-direita', x: 1088, z: -2432 },
    { nome: 'patio-flanco-esquerdo', x: -1088, z: -3072 },
    { nome: 'patio-flanco-direito', x: 1088, z: -3072 },
    { nome: 'patio-meio-esquerdo', x: -512, z: -3392 },
    { nome: 'patio-meio-direito', x: 512, z: -3392 },
    { nome: 'patio-fundo-esquerdo', x: -1024, z: -3840 },
    { nome: 'patio-fundo-central', x: 0, z: -3968 },
    { nome: 'patio-fundo-direito', x: 1024, z: -3840 },
  ]

  return {
    id: 3,
    nome: 'patio',
    bounds: { minX: -half, maxX: half, minZ, maxZ },
    boxes,
    spawnPoints,
  }
}

/**
 * Mundo padrao: galpao, corredores e patio em fila, ligados por duas portas.
 *
 * O tamanho de cada sala e multiplo da celula de grid do DOOM (64) de
 * proposito — a escala de referencia atravessa o projeto inteiro, inclusive no
 * level design.
 */
export function createArena(): Arena {
  const size = GRID_CELL * 32 // 2048: lado da sala inicial
  const wallHeight = GRID_CELL * 4 // 256

  const galpao = criarGalpao(wallHeight)
  const corredores = criarCorredores(wallHeight)
  const patio = criarPatio(wallHeight)
  const salas = [galpao, corredores, patio]

  const portas: Porta[] = [
    {
      id: 1,
      x1: -MEIO_VAO, z1: galpao.bounds.minZ,
      x2: MEIO_VAO, z2: galpao.bounds.minZ,
      salaDe: 1, salaPara: 2, aberta: false,
    },
    {
      id: 2,
      x1: -MEIO_VAO, z1: corredores.bounds.minZ,
      x2: MEIO_VAO, z2: corredores.bounds.minZ,
      salaDe: 2, salaPara: 3, aberta: false,
    },
  ]

  const perimetro: Wall[] = [
    // Galpao: fundo, laterais e a parede da porta 1.
    { ax: -1024, az: 1024, bx: 1024, bz: 1024 },
    { ax: 1024, az: -1024, bx: 1024, bz: 1024 },
    { ax: -1024, az: -1024, bx: -1024, bz: 1024 },
    ...paredeComVao(-1024, -1024, 1024),
    // Corredores: laterais e a parede da porta 2.
    { ax: 1024, az: -2048, bx: 1024, bz: -1024 },
    { ax: -1024, az: -2048, bx: -1024, bz: -1024 },
    ...paredeComVao(-2048, -1024, 1024),
    // Patio: as duas abas de parede que sobram na divisa (ele e mais largo que
    // os corredores), as laterais e o fundo.
    { ax: -1280, az: -2048, bx: -1024, bz: -2048 },
    { ax: 1024, az: -2048, bx: 1280, bz: -2048 },
    { ax: 1280, az: -4096, bx: 1280, bz: -2048 },
    { ax: -1280, az: -4096, bx: -1280, bz: -2048 },
    { ax: -1280, az: -4096, bx: 1280, bz: -4096 },
  ]

  const boxes = salas.flatMap((sala) => sala.boxes)
  const paredesFixas = [...perimetro, ...boxes.flatMap(boxToWalls)]

  const arena: Arena = {
    size,
    wallHeight,
    walls: [],
    boxes,
    playerStart: { x: 0, z: 0, yaw: 0 },
    spawnPoints: galpao.spawnPoints.map((ponto) => ({ x: ponto.x, z: ponto.z })),
    salas,
    portas,
    boundsTotal: { minX: -1280, maxX: 1280, minZ: -4096, maxZ: 1024 },
    paredesFixas,
  }

  recomputarParedes(arena)
  return arena
}
