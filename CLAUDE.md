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

Fora do loop, com verificacao executavel normal: render, arena, ondas, HUD,
audio, build. Essas dimensoes nao tem benchmark real — rubrica ali seria
opiniao a custo de loop.

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
