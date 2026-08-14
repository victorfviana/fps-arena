/**
 * Governador de qualidade: desce na hora, sobe com cautela, e trava um teto
 * permanente quando uma subida nao se sustenta.
 *
 * O governador so decide ao fechar uma janela de observacao (2000 ms, ver
 * JANELA_MS em src/render/quality.ts) e ignora tudo antes do aquecimento
 * inicial (2500 ms, AQUECIMENTO_MS). Os helpers abaixo simulam um relogio e
 * alimentam janelas inteiras com um fps constante e conhecido.
 *
 * `janela()` alimenta o numero de quadros necessario para cruzar os 2000 ms
 * da janela, mais uma folga de um quadro — soma de ponto flutuante repetida
 * (`r.t += passo` centenas de vezes) as vezes fecha em 1999.999... em vez de
 * 2000.0 exatos, e sem a folga o cruzamento ficava pendente para a proxima
 * chamada, desalinhando toda a contagem de janelas seguintes. A folga sobra
 * como uma fracao pequena (bem menor que uma janela inteira) para a proxima
 * chamada, o que nao muda o fps medido de forma perceptivel.
 */
import { describe, expect, it } from 'vitest'
import { QualityGovernor, type QualityLevel } from '../src/render/quality'

const JANELA_MS = 2000
const AQUECIMENTO_MS = 2500

interface Relogio {
  t: number
}

/** Primeira chamada: so registra o nascimento, nao conta quadro nenhum. */
function iniciar(governor: QualityGovernor, r: Relogio): void {
  governor.registrarQuadro(r.t)
}

/** Avanca o relogio para alem do aquecimento, em passos curtos. */
function aquecer(governor: QualityGovernor, r: Relogio): void {
  const passo = 50
  while (r.t < AQUECIMENTO_MS) {
    r.t += passo
    governor.registrarQuadro(r.t)
  }
}

/**
 * Alimenta exatamente os quadros necessarios para fechar uma janela com o
 * fps pedido, e para no quadro que fecha — sem sobra para a chamada seguinte.
 */
function janela(governor: QualityGovernor, r: Relogio, fps: number): void {
  const passo = 1000 / fps
  const quadros = Math.ceil(JANELA_MS / passo) + 1
  for (let i = 0; i < quadros; i++) {
    r.t += passo
    governor.registrarQuadro(r.t)
  }
}

function montar(): { governor: QualityGovernor; mudancas: QualityLevel[] } {
  const mudancas: QualityLevel[] = []
  const governor = new QualityGovernor('alto', (nivel) => mudancas.push(nivel))
  return { governor, mudancas }
}

/** Leva o governador ate 'baixo' com duas janelas ruins seguidas. */
function irParaBaixo(governor: QualityGovernor, r: Relogio): void {
  iniciar(governor, r)
  aquecer(governor, r)
  janela(governor, r, 20) // alto -> medio
  janela(governor, r, 20) // medio -> baixo
}

describe('QualityGovernor', () => {
  it('comeca no nivel inicial e nao decide nada durante o aquecimento', () => {
    const { governor, mudancas } = montar()
    const r: Relogio = { t: 0 }
    iniciar(governor, r)

    // Ainda dentro do aquecimento: nenhuma decisao, mesmo com fps ruim.
    for (let i = 0; i < 10; i++) {
      r.t += 20
      governor.registrarQuadro(r.t)
    }

    expect(governor.nivel).toBe('alto')
    expect(mudancas).toEqual([])
  })

  describe('degradacao', () => {
    it('desce um degrau apos uma unica janela abaixo do alvo', () => {
      const { governor, mudancas } = montar()
      const r: Relogio = { t: 0 }
      iniciar(governor, r)
      aquecer(governor, r)

      janela(governor, r, 20)

      expect(governor.nivel).toBe('medio')
      expect(mudancas).toEqual(['medio'])
    })

    it('desce um degrau por janela ruim, ate o minimo, e para ali', () => {
      const { governor } = montar()
      const r: Relogio = { t: 0 }
      irParaBaixo(governor, r)

      expect(governor.nivel).toBe('baixo')

      janela(governor, r, 20) // ja no minimo: nao ha erro, so nao ha o que descer
      expect(governor.nivel).toBe('baixo')
    })
  })

  describe('recuperacao', () => {
    it('nao sobe com menos de 3 janelas boas consecutivas', () => {
      const { governor } = montar()
      const r: Relogio = { t: 0 }
      irParaBaixo(governor, r)

      janela(governor, r, 90) // 1a janela boa
      expect(governor.nivel).toBe('baixo')
      janela(governor, r, 90) // 2a janela boa
      expect(governor.nivel).toBe('baixo')
    })

    it('sobe um degrau na 3a janela boa consecutiva', () => {
      const { governor, mudancas } = montar()
      const r: Relogio = { t: 0 }
      irParaBaixo(governor, r)
      mudancas.length = 0

      janela(governor, r, 90)
      janela(governor, r, 90)
      janela(governor, r, 90) // 3a: sobe

      expect(governor.nivel).toBe('medio')
      expect(mudancas).toEqual(['medio'])
    })

    it('so cruzar o alvo nao basta: exige a folga de recuperacao', () => {
      const { governor } = montar()
      const r: Relogio = { t: 0 }
      irParaBaixo(governor, r)

      // 52 fps esta acima do alvo (50) mas abaixo da folga de recuperacao
      // (50 + 8 = 58): nao degrada, mas tambem nao conta como janela boa.
      janela(governor, r, 90)
      janela(governor, r, 90)
      janela(governor, r, 52) // quebra a sequencia de boas
      janela(governor, r, 90)

      // So 1 janela boa consecutiva depois da quebra: ainda nao subiu.
      expect(governor.nivel).toBe('baixo')
    })

    it('uma janela ruim no meio da sequencia zera a contagem de boas', () => {
      const { governor } = montar()
      const r: Relogio = { t: 0 }
      irParaBaixo(governor, r)

      janela(governor, r, 90)
      janela(governor, r, 90)
      janela(governor, r, 20) // ruim: desce, e zera a contagem de boas
      expect(governor.nivel).toBe('baixo') // ja estava no minimo

      janela(governor, r, 90)
      janela(governor, r, 90)
      expect(governor.nivel).toBe('baixo') // so 2 boas desde a quebra

      janela(governor, r, 90)
      expect(governor.nivel).toBe('medio') // agora sim, 3 seguidas
    })
  })

  describe('anti-oscilacao', () => {
    it('trava o nivel alcancado como teto quando a subida nao se sustenta', () => {
      const { governor } = montar()
      const r: Relogio = { t: 0 }
      irParaBaixo(governor, r)

      janela(governor, r, 90)
      janela(governor, r, 90)
      janela(governor, r, 90) // sobe para medio
      expect(governor.nivel).toBe('medio')

      // A subida nao se sustenta: a proxima janela ja e ruim de novo. Isso
      // trava 'medio' como teto permanente da sessao, alem de descer.
      janela(governor, r, 20)
      expect(governor.nivel).toBe('baixo')

      // Doravante, nenhuma sequencia de janelas boas deve passar de 'medio'.
      for (let ciclo = 0; ciclo < 3; ciclo++) {
        janela(governor, r, 90)
        janela(governor, r, 90)
        janela(governor, r, 90)
        expect(governor.nivel).toBe('medio')

        // Forca nova descida para testar que o teto continua valendo em
        // outra rodada de recuperacao.
        janela(governor, r, 20)
        expect(governor.nivel).toBe('baixo')
      }
    })

    it('nao trava teto quando a janela seguinte a subida tambem e boa', () => {
      const { governor } = montar()
      const r: Relogio = { t: 0 }
      irParaBaixo(governor, r)

      janela(governor, r, 90)
      janela(governor, r, 90)
      janela(governor, r, 90) // sobe para medio
      expect(governor.nivel).toBe('medio')

      janela(governor, r, 90) // boa de novo: nao e oscilacao, sem teto
      janela(governor, r, 90)
      janela(governor, r, 90) // 3 boas: deveria poder subir para alto

      expect(governor.nivel).toBe('alto')
    })
  })

  describe('reset', () => {
    it('restaura o nivel inicial e limpa o teto de anti-oscilacao', () => {
      const { governor, mudancas } = montar()
      const r: Relogio = { t: 0 }
      irParaBaixo(governor, r)

      janela(governor, r, 90)
      janela(governor, r, 90)
      janela(governor, r, 90) // sobe para medio
      janela(governor, r, 20) // nao se sustenta: trava teto em medio, desce
      expect(governor.nivel).toBe('baixo')

      mudancas.length = 0
      governor.reset()

      expect(governor.nivel).toBe('alto')
      expect(mudancas).toEqual(['alto'])

      // Sessao nova: o teto anterior ('medio') nao deveria mais existir. Uma
      // recuperacao completa, sem oscilar desta vez, chega de volta a 'alto'.
      const r2: Relogio = { t: 0 }
      irParaBaixo(governor, r2)
      janela(governor, r2, 90)
      janela(governor, r2, 90)
      janela(governor, r2, 90) // baixo -> medio
      expect(governor.nivel).toBe('medio')

      janela(governor, r2, 90)
      janela(governor, r2, 90)
      janela(governor, r2, 90) // medio -> alto
      expect(governor.nivel).toBe('alto')
    })

    it('reset() reaplica os settings do nivel inicial', () => {
      const aplicados: QualityLevel[] = []
      const governor = new QualityGovernor('medio', (nivel) => aplicados.push(nivel))
      const r: Relogio = { t: 0 }
      iniciar(governor, r)
      aquecer(governor, r)
      janela(governor, r, 20) // medio -> baixo

      aplicados.length = 0
      governor.reset()

      expect(governor.nivel).toBe('medio')
      expect(aplicados).toEqual(['medio'])
    })
  })
})
