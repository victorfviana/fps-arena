# 2026-08-13 — Loop adversarial e publicacao

Terceira e ultima sessao do dia. Fecha o ciclo previsto no plano.

## A rubrica virou teste, e nao prosa

Decisao que mudou o resultado: em vez de escrever a rubrica em texto e julgar
por leitura, cada dimensao virou bloco de teste em `tests/rubrica.test.ts`, com
limiares em comportamento observavel. O ganho e que a avaliacao para de ser
opiniao renovavel a cada leitura — uma regressao em qualquer dimensao quebra a
suite daqui a seis meses.

## Iteracao 1 — REPROVADO, media 3,55

A suite passou 26 de 26 na primeira rodada. O documento avisa exatamente sobre
isso: critica que aprova de primeira quase sempre significa rubrica frouxa.
Assumindo o papel hostil, apareceram tres furos — dois deles no meu proprio
instrumento de medicao, nao no jogo.

| Dimensao | Peso | Nota | Defeito |
|---|---|---|---|
| D1 Responsividade | 25% | 4 | Latencia declarada supondo 60 fps, sem medir |
| D2 Feedback de tiro | 25% | 3 | Contagem de canais inflada |
| D3 Fidelidade de movimento | 20% | 5 | — |
| D4 Reacao do inimigo | 20% | 2 | Teste verdadeiro por vacuidade |
| D5 Legibilidade | 10% | 4 | Sem teste de contraste |

**D4 era o pior.** Contava o empurrao como reacao ao dano, e o empurrao ocorre
em 100% dos acertos por construcao. O teste passaria com `painChance` zerado —
media nada.

**D2 somava `fired` e `weaponFired` como canais distintos**, quando sao o mesmo
acontecimento. A contagem foi inflada para alcancar o limiar de quatro.

**D1 afirmava latencia de pior caso a partir de um framerate nunca medido.**

## Iteracao 2 — APROVADO, media 4,45

| Dimensao | Peso | Nota | Evidencia |
|---|---|---|---|
| D1 Responsividade | 25% | 5 | Deslocamento no 1o tic (12/12 amostras no navegador); dano em ate 4 tics; simulacao consome 0,0345 ms/tic com 14 inimigos |
| D2 Feedback de tiro | 25% | 4 | Quatro canais realmente distintos; rastro separa acerto de erro |
| D3 Fidelidade de movimento | 20% | 5 | Erro < 1% em corrida, caminhada e strafe vs constantes do source |
| D4 Reacao do inimigo | 20% | 4 | Taxa de interrupcao 70–86% medida; congelamento e empurrao verificados |
| D5 Legibilidade | 10% | 4 | Teto de simultaneos, separacao, obstaculos abaixo da visada |

**Media ponderada 4,45.** Corte era 4,0, nenhuma dimensao abaixo de 3 e
responsividade obrigatoriamente 5. **PARADA POR NOTA DE CORTE ATINGIDA**, na
segunda das duas iteracoes autorizadas. Ganho da iteracao: +0,90 ponto.

Guarda de regressao: as cinco dimensoes foram reavaliadas, nao apenas as
corrigidas. 157 testes passando, nenhuma queda.

### Por que D2, D4 e D5 nao chegaram a 5

Clarao, recuo, troca de cor no dano e contraste das silhuetas vivem no
renderer. Verificar isso exige WebGL, e nao ha teste automatizado — so
conferencia visual por screenshot. Nao dou nota maxima a dimensao cuja
evidencia e apenas visual.

## Medicao que nao foi possivel

**Framerate real e latencia de quadro.** Dependem de `requestAnimationFrame`
num navegador visivel, e a aba fica `hidden` sob automacao. O que deu para
provar e a metade que depende deste codigo: a simulacao consome 0,12% de um
quadro de 60 fps com a arena cheia, entao ela nao e o gargalo. O custo do
render permanece nao medido.

## Publicacao

Repositorio publico em `github.com/victorfviana/fps-arena`, com workflow que
roda os testes antes de publicar — nada quebrado chega ao ar.

Link testado com fetch real, nao suposto:

```
status=200 bytes=6378 tempo=0.323250s
<title>FPS Arena</title>
assets/index-JYcrHZ8C.js
status=200 bytes=500844
```

O bundle publicado tem exatamente os 500.844 bytes do build local. Jogo
carregado e sem erro de console na pagina publicada.

## Pendente

Nome do jogo. E o veredito que nenhum scorecard entrega: se e gostoso de jogar.
