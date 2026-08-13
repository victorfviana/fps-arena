# FPS Arena — regras do projeto

Shooter em primeira pessoa no navegador, construido com o modelo de prompt de
critica adversarial e parada mensuravel.

## Inegociaveis

1. **Nenhuma constante de gameplay entra sem procedencia.** Toda constante vive
   em `src/core/doom.ts`, marcada como CITADO (arquivo e identificador do
   source), DERIVADO (com a conta no comentario e um teste que a reproduz) ou
   LACUNA. Numero estimado apresentado como fato reprova a entrega. Ver
   `docs/decisoes/0001-benchmark-doom.md`.
2. **A unidade e o map unit do DOOM; a simulacao roda a 35 tics/s.** Nao
   converter para metros, nao acoplar fisica ao framerate.
3. **Zero asset externo.** Texturas em canvas, audio sintetizado. Sem download,
   sem licenca de terceiro no repositorio.
4. **Modulo de fisica nao importa Three.js.** `player/`, `world/collision.ts` e
   `core/` rodam sob teste sem navegador. Se um modulo de regra precisar do
   Three, a separacao esta errada.

## Onde o loop adversarial se aplica

So no nucleo sensorial: **movimento, arma e reacao do inimigo**, avaliados
juntos, porque game feel e emergente da combinacao. Teto de 2 iteracoes, parada
por ganho menor que 0,3 ponto.

**Ja executado**, em 13/08/2026: parou por nota de corte, media 4,45. A rubrica
vive em `tests/rubrica.test.ts` — nao e prosa, e teste. Mexer no nucleo exige
rodar aquele arquivo e conferir que nenhuma dimensao caiu.

**Pesos corrigidos depois de o jogador testar.** Legibilidade de combate subiu
de 10% para 25% e ganhou arquivo proprio (`tests/legibilidade.test.ts`): foi
por ela que o jogo falhou na mao de quem jogou, com inimigos estaticos e tiro
invisivel, enquanto as dimensoes finas de fidelidade iam bem. Dimensao que
descreve se o jogador ENTENDE o que acontece vale mais que precisao de
constante — 1% de erro na velocidade nao custa nada a quem joga; nao saber de
onde veio o tiro custa a partida.

Licao que vale para a proxima rodada: os tres defeitos da iteracao 1 estavam no
**instrumento de medicao**, nao no jogo. Rubrica que aprova de primeira e
suspeita — reveja se algum teste e verdadeiro por vacuidade antes de comemorar.

Fora do loop, com verificacao executavel normal: render, arena, ondas, HUD,
audio, build. Essas dimensoes nao tem benchmark real — rubrica ali seria
opiniao a custo de loop.

## Antes de tudo: o jogo tem de iniciar

Em 13/08/2026 o jogo foi publicado com scorecard 4,45 e **nao iniciava** — um
ouvinte reexibia o menu por cima da partida. Passou porque toda a verificacao
automatizada contornava o pointer lock pelo modo `?test=1`, entao o caminho
real de entrada nunca foi exercitado, e porque nenhuma dimensao da rubrica
cobria "a partida comeca".

Regra que ficou: **exercitar o caminho do usuario antes de medir qualquer
dimensao fina de qualidade.** Se um limite de ambiente impedir, declarar como
nao verificado — nunca construir um desvio e seguir medindo por ele.

`tests/menu.test.ts` guarda essa regressao.

## Verificacao antes de apresentar

Ordem obrigatoria, do mais barato ao mais caro:

```bash
npm test                      # N1 — determinístico
npx tsc --noEmit              # N2 — validador
npx vite build                # N2 — build real
```

Depois disso, N3: subir `vite preview` e olhar no navegador. O painel F3 e
`window.__fpsArena.getStats()` existem para que a verificacao leia numeros em
vez de depender de interpretacao de imagem.

Colar a saida literal dos comandos. Parafrase nao e prova.

## Limite declarado

Latencia, velocidade e frames de feedback sao mensuraveis e estao cobertos.
**"Se e gostoso de jogar" nao e.** Esse veredito e humano e nao deve ser
declarado com base em scorecard.
