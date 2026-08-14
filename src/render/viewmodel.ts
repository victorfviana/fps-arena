/**
 * Bracos, maos e armas em primeira pessoa.
 *
 * Renderizado numa cena e numa camera proprias, com campo de visao estreito
 * (por volta de 55 graus) enquanto o mundo usa os 90 graus do DOOM. Essa
 * separacao e o padrao da industria e existe por um motivo concreto: a 90
 * graus a perspectiva estica tudo que esta perto da camera, e a arma sai
 * deformada, com o cano parecendo um funil. Renderizar por cima, limpando so
 * o buffer de profundidade, tambem impede que a arma atravesse parede quando
 * o jogador encosta numa quina.
 *
 * A escala aqui e propria — cerca de 1 unidade por metro — e nao a do mundo em
 * map units. As duas nunca se encontram, entao nao ha risco de confusao, e
 * pensar a arma em metros e muito mais simples.
 */

import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  SphereGeometry,
  TorusGeometry,
} from 'three'

import type { LoadoutId } from '../weapons/loadout'

/** Campo de visao vertical da camera do viewmodel, em graus. */
const VIEW_FOV = 48

const MATERIAIS = {
  metalEscuro: new MeshStandardMaterial({ color: 0x2b2d30, metalness: 0.92, roughness: 0.34 }),
  metalGasto: new MeshStandardMaterial({ color: 0x4a4c50, metalness: 0.85, roughness: 0.52 }),
  polimero: new MeshStandardMaterial({ color: 0x232527, metalness: 0.08, roughness: 0.78 }),
  madeira: new MeshStandardMaterial({ color: 0x6b4423, metalness: 0.02, roughness: 0.66 }),
  luva: new MeshStandardMaterial({ color: 0x33383d, metalness: 0.04, roughness: 0.88 }),
  pele: new MeshStandardMaterial({ color: 0xa87355, metalness: 0.0, roughness: 0.85 }),
  manga: new MeshStandardMaterial({ color: 0x3d4a3a, metalness: 0.02, roughness: 0.9 }),
  vidro: new MeshStandardMaterial({
    color: 0x0d1a26,
    metalness: 0.3,
    roughness: 0.08,
    emissive: 0x1a3a55,
    emissiveIntensity: 0.35,
  }),
}

/**
 * Uma mao: palma, quatro dedos e polegar.
 *
 * Dedos separados em vez de um bloco so. Nao e detalhe gratuito — a mao
 * fechada em torno do punho e o que faz o cerebro ler "alguem esta segurando
 * isso" em vez de "ha um objeto flutuando na tela".
 */
function construirMao(espelhada = false): Group {
  const mao = new Group()
  const lado = espelhada ? -1 : 1

  const palma = new Mesh(new BoxGeometry(0.075, 0.105, 0.055), MATERIAIS.luva)
  mao.add(palma)

  // Quatro dedos curvados em torno do punho, cada um levemente mais curto.
  for (let i = 0; i < 4; i++) {
    const comprimento = 0.062 - i * 0.005
    const dedo = new Mesh(
      new CapsuleGeometry(0.0125, comprimento, 3, 6),
      MATERIAIS.luva,
    )
    dedo.position.set(lado * 0.03, 0.038 - i * 0.027, -0.028)
    dedo.rotation.x = Math.PI / 2
    dedo.rotation.z = lado * 0.25
    mao.add(dedo)
  }

  const polegar = new Mesh(new CapsuleGeometry(0.014, 0.05, 3, 6), MATERIAIS.luva)
  polegar.position.set(-lado * 0.032, 0.022, -0.012)
  polegar.rotation.set(Math.PI / 2.4, 0, -lado * 0.55)
  mao.add(polegar)

  return mao
}

/** Antebraco com manga, ligando a mao a borda da tela. */
function construirBraco(espelhado = false): Group {
  const braco = new Group()
  const lado = espelhado ? -1 : 1

  const antebraco = new Mesh(new CapsuleGeometry(0.052, 0.30, 4, 10), MATERIAIS.manga)
  antebraco.position.set(lado * 0.02, -0.02, 0.20)
  antebraco.rotation.set(Math.PI / 2 - 0.22, 0, lado * 0.12)
  braco.add(antebraco)

  // Punho aparente entre a manga e a luva.
  const punho = new Mesh(new CylinderGeometry(0.042, 0.046, 0.05, 10), MATERIAIS.pele)
  punho.position.set(lado * 0.012, -0.012, 0.055)
  punho.rotation.set(Math.PI / 2 - 0.22, 0, lado * 0.12)
  braco.add(punho)

  return braco
}

/** Guarda-mato e gatilho, comuns as duas armas. */
function construirGatilho(): Group {
  const grupo = new Group()

  const guarda = new Mesh(new TorusGeometry(0.038, 0.007, 6, 14, Math.PI), MATERIAIS.metalEscuro)
  guarda.rotation.set(Math.PI / 2, 0, Math.PI)
  guarda.position.set(0, -0.042, 0.02)
  grupo.add(guarda)

  const gatilho = new Mesh(new BoxGeometry(0.011, 0.036, 0.011), MATERIAIS.metalGasto)
  gatilho.position.set(0, -0.03, 0.022)
  gatilho.rotation.x = 0.22
  grupo.add(gatilho)

  return grupo
}

/**
 * Escopeta de bomba.
 *
 * A bomba (`forend`) sai como filho nomeado para ser animada no recuo: e o
 * movimento dela que faz a arma parecer mecanica em vez de um adereco rigido.
 */
export interface ArmaMontada {
  grupo: Group
  /** Onde a mao que segura o punho encosta. */
  ancoraDireita: { x: number; y: number; z: number }
  /** Onde a mao de apoio encosta. */
  ancoraEsquerda: { x: number; y: number; z: number }
  /** Peca que desliza no recuo, se houver. */
  bomba: Mesh | null
  /** Clarao da boca do cano. */
  clarao: Mesh
  /** Posicao da boca do cano, para a fumaca. */
  boca: { x: number; y: number; z: number }
  /** Deslocamento que alinha a alca de mira com o centro da tela no ADS. */
  alinhamentoAds: { x: number; y: number; z: number }
}

function construirClarao(): Mesh {
  const clarao = new Mesh(
    new PlaneGeometry(0.34, 0.34),
    new MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0, fog: false }),
  )
  clarao.visible = false
  return clarao
}

export function construirEscopeta(): ArmaMontada {
  const grupo = new Group()

  const receiver = new Mesh(new BoxGeometry(0.062, 0.085, 0.30), MATERIAIS.metalEscuro)
  receiver.position.set(0, 0, -0.02)
  grupo.add(receiver)

  const cano = new Mesh(new CylinderGeometry(0.019, 0.020, 0.52, 14), MATERIAIS.metalEscuro)
  cano.rotation.x = Math.PI / 2
  cano.position.set(0, 0.021, -0.42)
  grupo.add(cano)

  // Tubo do carregador sob o cano: e a silhueta que identifica uma escopeta
  // de bomba a distancia, mais que qualquer detalhe fino.
  const tubo = new Mesh(new CylinderGeometry(0.016, 0.016, 0.44, 12), MATERIAIS.metalGasto)
  tubo.rotation.x = Math.PI / 2
  tubo.position.set(0, -0.026, -0.38)
  grupo.add(tubo)

  const bomba = new Mesh(new BoxGeometry(0.056, 0.052, 0.16), MATERIAIS.madeira)
  bomba.position.set(0, -0.024, -0.34)
  grupo.add(bomba)

  const punho = new Mesh(new BoxGeometry(0.048, 0.13, 0.062), MATERIAIS.polimero)
  punho.position.set(0, -0.09, 0.10)
  punho.rotation.x = -0.30
  grupo.add(punho)

  const coronha = new Mesh(new BoxGeometry(0.052, 0.10, 0.26), MATERIAIS.madeira)
  coronha.position.set(0, -0.035, 0.26)
  coronha.rotation.x = 0.09
  grupo.add(coronha)

  const alca = new Mesh(new BoxGeometry(0.008, 0.022, 0.012), MATERIAIS.metalGasto)
  alca.position.set(0, 0.052, -0.66)
  grupo.add(alca)

  grupo.add(construirGatilho())

  const clarao = construirClarao()
  clarao.position.set(0, 0.021, -0.70)
  grupo.add(clarao)

  return {
    grupo,
    ancoraDireita: { x: 0.012, y: -0.075, z: 0.075 },
    ancoraEsquerda: { x: -0.012, y: -0.036, z: -0.335 },
    bomba,
    clarao,
    boca: { x: 0, y: 0.021, z: -0.68 },
    alinhamentoAds: { x: 0, y: -0.052, z: 0 },
  }
}

/** Rifle com luneta. */
export function construirRifle(): ArmaMontada {
  const grupo = new Group()

  const receiver = new Mesh(new BoxGeometry(0.056, 0.078, 0.34), MATERIAIS.polimero)
  grupo.add(receiver)

  const cano = new Mesh(new CylinderGeometry(0.013, 0.014, 0.68, 12), MATERIAIS.metalEscuro)
  cano.rotation.x = Math.PI / 2
  cano.position.set(0, 0.012, -0.50)
  grupo.add(cano)

  // Quebra-chamas: pouca geometria, muito efeito na leitura da ponta da arma.
  const quebraChamas = new Mesh(new CylinderGeometry(0.021, 0.018, 0.07, 10), MATERIAIS.metalGasto)
  quebraChamas.rotation.x = Math.PI / 2
  quebraChamas.position.set(0, 0.012, -0.82)
  grupo.add(quebraChamas)

  const guardaMao = new Mesh(new BoxGeometry(0.05, 0.05, 0.30), MATERIAIS.polimero)
  guardaMao.position.set(0, 0.004, -0.34)
  grupo.add(guardaMao)

  const carregador = new Mesh(new BoxGeometry(0.032, 0.16, 0.062), MATERIAIS.polimero)
  carregador.position.set(0, -0.11, -0.03)
  carregador.rotation.x = -0.10
  grupo.add(carregador)

  const punho = new Mesh(new BoxGeometry(0.044, 0.125, 0.056), MATERIAIS.polimero)
  punho.position.set(0, -0.085, 0.11)
  punho.rotation.x = -0.32
  grupo.add(punho)

  const coronha = new Mesh(new BoxGeometry(0.046, 0.092, 0.24), MATERIAIS.polimero)
  coronha.position.set(0, -0.012, 0.28)
  grupo.add(coronha)

  // Luneta: tubo, dois anseis de fixacao e a lente que capta luz.
  const tuboLuneta = new Mesh(new CylinderGeometry(0.026, 0.026, 0.28, 14), MATERIAIS.metalEscuro)
  tuboLuneta.rotation.x = Math.PI / 2
  tuboLuneta.position.set(0, 0.077, -0.10)
  grupo.add(tuboLuneta)

  const objetiva = new Mesh(new CylinderGeometry(0.034, 0.030, 0.07, 14), MATERIAIS.metalEscuro)
  objetiva.rotation.x = Math.PI / 2
  objetiva.position.set(0, 0.077, -0.26)
  grupo.add(objetiva)

  const lente = new Mesh(new CylinderGeometry(0.029, 0.029, 0.006, 14), MATERIAIS.vidro)
  lente.rotation.x = Math.PI / 2
  lente.position.set(0, 0.077, -0.295)
  grupo.add(lente)

  for (const z of [-0.02, 0.02]) {
    const anel = new Mesh(new BoxGeometry(0.036, 0.05, 0.022), MATERIAIS.metalGasto)
    anel.position.set(0, 0.052, z)
    grupo.add(anel)
  }

  grupo.add(construirGatilho())

  const clarao = construirClarao()
  clarao.position.set(0, 0.012, -0.87)
  grupo.add(clarao)

  return {
    grupo,
    ancoraDireita: { x: 0.010, y: -0.072, z: 0.088 },
    ancoraEsquerda: { x: -0.010, y: -0.012, z: -0.325 },
    bomba: null,
    clarao,
    boca: { x: 0, y: 0.012, z: -0.85 },
    // Sobe a linha da luneta ate o centro da tela.
    alinhamentoAds: { x: 0, y: -0.077, z: 0 },
  }
}

/**
 * Conjunto completo: cena propria, camera propria, armas e maos.
 *
 * Uma unica instancia guarda as duas armas montadas e mostra so a ativa. Criar
 * geometria na hora da troca produziria engasgo justamente no meio do combate.
 */
export class ViewModel {
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(VIEW_FOV, 1, 0.01, 12)

  private readonly raiz = new Group()
  private readonly armas: Record<LoadoutId, ArmaMontada>
  private readonly maoDireita = construirMao(false)
  private readonly maoEsquerda = construirMao(true)
  private readonly bracoDireito = construirBraco(false)
  private readonly bracoEsquerdo = construirBraco(true)
  private readonly luz: PointLight
  private ativa: LoadoutId = 'shotgun'

  constructor() {
    this.armas = {
      shotgun: construirEscopeta(),
      rifle: construirRifle(),
    }

    for (const arma of Object.values(this.armas)) {
      this.raiz.add(arma.grupo)
      arma.grupo.visible = false
    }

    this.maoDireita.add(this.bracoDireito)
    this.maoEsquerda.add(this.bracoEsquerdo)
    this.raiz.add(this.maoDireita)
    this.raiz.add(this.maoEsquerda)
    this.scene.add(this.raiz)

    // Luz propria: a cena do viewmodel nao recebe a iluminacao do mundo, e sem
    // isto as maos e a arma sairiam pretas.
    this.luz = new PointLight(0xfff0dc, 2.6, 6, 1.4)
    this.luz.position.set(0.35, 0.5, 0.6)
    this.scene.add(this.luz)

    const preenchimento = new PointLight(0x8fa8c8, 1.1, 6, 1.6)
    preenchimento.position.set(-0.5, -0.2, 0.4)
    this.scene.add(preenchimento)

    this.mostrar('shotgun')
  }

  /** Arma visivel no momento. */
  mostrar(id: LoadoutId): void {
    this.ativa = id
    for (const [nome, arma] of Object.entries(this.armas)) {
      arma.grupo.visible = nome === id
    }

    const arma = this.armas[id]
    this.maoDireita.position.set(arma.ancoraDireita.x, arma.ancoraDireita.y, arma.ancoraDireita.z)
    this.maoEsquerda.position.set(
      arma.ancoraEsquerda.x,
      arma.ancoraEsquerda.y,
      arma.ancoraEsquerda.z,
    )
  }

  get armaAtual(): ArmaMontada {
    return this.armas[this.ativa]
  }

  /**
   * Posiciona o conjunto no quadro.
   *
   * @param ads 0 no quadril, 1 apontado.
   * @param recuo 0 a 1, decaindo apos o disparo.
   * @param swap 0 a 1, subindo e descendo durante a troca.
   * @param balanco fase do passo, para o embalo da caminhada.
   * @param velocidade 0 a 1, quanto o jogador se move.
   */
  posicionar(
    ads: number,
    recuo: number,
    swap: number,
    balanco: number,
    velocidade: number,
    inclinacaoMouse: { x: number; y: number },
  ): void {
    const arma = this.armaAtual

    // Quadril: arma deslocada para a direita e para baixo. Apontado: centrada
    // e trazida para tras, com a alca de mira na linha do olho.
    const quadrilX = 0.135
    const quadrilY = -0.115
    const quadrilZ = -0.30
    const alvoX = arma.alinhamentoAds.x
    const alvoY = arma.alinhamentoAds.y
    const alvoZ = -0.20

    // Embalo da caminhada, que some conforme o jogador aponta: quem esta com a
    // arma no olho segura a respiracao.
    const embalo = (1 - ads * 0.85) * velocidade
    const balancoX = Math.sin(balanco) * 0.012 * embalo
    const balancoY = Math.abs(Math.cos(balanco)) * 0.010 * embalo

    // Atraso da arma em relacao ao giro do mouse. Poucos graus bastam para o
    // conjunto ganhar peso; muito faz o jogador achar que a mira falhou.
    const atrasoX = inclinacaoMouse.x * (1 - ads * 0.7)
    const atrasoY = inclinacaoMouse.y * (1 - ads * 0.7)

    this.raiz.position.set(
      quadrilX + (alvoX - quadrilX) * ads + balancoX + atrasoX,
      quadrilY + (alvoY - quadrilY) * ads + balancoY + atrasoY - swap * 0.42,
      quadrilZ + (alvoZ - quadrilZ) * ads + recuo * 0.075,
    )

    this.raiz.rotation.set(
      recuo * 0.22 + swap * 0.5 - atrasoY * 1.4,
      (1 - ads) * -0.06 - atrasoX * 1.2,
      (1 - ads) * 0.045 + swap * 0.3,
    )

    if (arma.bomba) {
      // A bomba recua junto com o disparo e volta — o ciclo mecanico visivel.
      arma.bomba.position.z = -0.34 + recuo * 0.10
    }
  }

  /** Liga ou desliga o clarao da boca do cano. */
  clarao(intensidade: number): void {
    const arma = this.armaAtual
    const material = arma.clarao.material as MeshBasicMaterial
    material.opacity = intensidade
    arma.clarao.visible = intensidade > 0.02
    arma.clarao.rotation.z = intensidade * 7.3
    this.luz.intensity = 2.6 + intensidade * 12
  }

  redimensionar(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  /** Esconde tudo — usado quando a luneta toma a tela. */
  set visivel(valor: boolean) {
    this.raiz.visible = valor
  }
}

/** Fumaca simples saindo do cano, na cena do viewmodel. */
export function construirFumaca(): Mesh {
  return new Mesh(
    new SphereGeometry(0.05, 8, 6),
    new MeshBasicMaterial({ color: 0x9a9a96, transparent: true, opacity: 0, fog: false }),
  )
}
