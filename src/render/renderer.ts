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
  Fog,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  WebGLRenderer,
} from 'three'

import { FOV_HORIZONTAL_DEG, VIEW_HEIGHT } from '../core/doom'
import type { Arena } from '../world/arena'
import { createCeilingTexture, createFloorTexture, createWallTexture } from './textures'

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

  constructor(private readonly canvas: HTMLCanvasElement, arena: Arena) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    })
    // Mesma cor da neblina: qualquer diferenca aqui vira uma borda visivel no
    // limite do alcance de visao.
    this.renderer.setClearColor(0x14120f)

    this.camera = new PerspectiveCamera(75, 1, 1, 8000)
    // A ordem YXZ evita que o giro horizontal incline o horizonte quando o
    // jogador esta olhando para cima ou para baixo.
    this.camera.rotation.order = 'YXZ'
    this.camera.position.set(arena.playerStart.x, VIEW_HEIGHT, arena.playerStart.z)

    // Neblina na cor do fundo: esconde o limite do mundo e da profundidade
    // sem custo de geometria. Comeca tarde de proposito — puxar a neblina para
    // perto engolia a parede oposta e a arena parecia um corredor sem fim.
    this.scene.fog = new Fog(0x14120f, arena.size * 0.75, arena.size * 1.8)

    this.buildLights()
    this.buildArena(arena)

    // Luz que acompanha o jogador. Alcance maior que a metade da arena para
    // que o inimigo se destaque do fundo antes de chegar perto demais.
    this.playerLight = new PointLight(0xffd2a0, 1.5, 1600, 1.2)
    this.scene.add(this.playerLight)

    this.resize()
    window.addEventListener('resize', this.resize)
  }

  private buildLights(): void {
    // A arena precisa ser legivel antes de ser atmosferica: com a iluminacao
    // baixa demais, a silhueta do inimigo some contra a parede e o combate
    // vira adivinhacao.
    this.scene.add(new AmbientLight(0x6a6472, 2.2))
    this.scene.add(new HemisphereLight(0x9aa8cc, 0x4a3a28, 1.6))
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
    this.camera.position.set(x, y, z)
    this.camera.rotation.set(pitch, yaw, 0)
    this.playerLight.position.set(x, y + 8, z)
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
