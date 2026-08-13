# 2026-08-13 — Nucleo jogavel: arma, inimigos, ondas, HUD e audio

Continuacao de `2026-08-13-fundacao.md`. Ao fim desta sessao o jogo esta
jogavel de ponta a ponta.

## Quatro defeitos reais encontrados pela verificacao

Nenhum apareceu por releitura de codigo. Todos vieram de rodar alguma coisa.

**1. Atraso de um tic em toda arma.** O teste exigia dano 4 tics apos o
gatilho; saia em 5. A causa era decrementar o contador num tic e checar o zero
no seguinte. Sao 28,6 ms de atraso extra em cada disparo — pequeno demais para
alguem apontar de onde vem, grande o bastante para o tiro parecer responder
tarde. Corrigido em `weapon.ts`.

**2. O jogador atirava e nunca acertava.** Diagnostico mostrou o tiro morrendo
em z=288, a exata posicao dos blocos de "cobertura parcial". Duas causas
somadas: os blocos tinham 64 de altura contra um olho a 41 — eram cobertura
total, nao parcial — e o hitscan era 2D puro, entao nenhum obstaculo podia ser
baixo. Pior, estavam plantados entre o centro da arena e os pontos de
nascimento, cobrindo justamente as linhas que importavam.

Correcao estrutural: `Wall` ganhou `height`, e `segmentBlocked` passou a
receber a altura da visada. Agora todo obstaculo barra o corpo, mas so barra
tiro e visao quem for mais alto que o olho. Os blocos baixaram para 28.

**3. Inimigos entravam dentro do jogador.** Um imp ficou a distancia 1 do
centro do jogador — a camera dentro do modelo. Faltava limite de aproximacao
pelo raio dos dois corpos. Depois de corrigido, ainda tapava metade da tela a
73 unidades; a distancia preferida do imp subiu para 118.

**4. Jogador parado morria em 20 segundos.** Tempo insuficiente para localizar
de onde vem o tiro. Dano e cadencia dos dois inimigos foram reduzidos, e a
janela de sobrevivencia virou teste (30 a 90 segundos), para nao regredir.

## Dois erros de enquadramento da arma na tela

A arma passou por tres versoes. A primeira ficava a 13 unidades da camera e era
cortada pelo plano de corte proximo. A segunda tomava um terco da tela. A
terceira derivou as medidas do campo de visao — a 35 unidades o campo visivel
mede cerca de 70 por 33 unidades, entao um cano de 3 de largura ocupa uns 4%.
So a inspecao visual pegou isso; nenhum teste olharia.

## Arquitetura que se manteve

`game.ts` concentra as regras e devolve os acontecimentos do tic; desenho e
audio consomem. Isso permitiu 16 testes que simulam minutos de partida em
milissegundos, incluindo morte do jogador, teto de inimigos simultaneos e
estabilidade em 300 segundos de entrada caotica.

Nenhum modulo de regra importa Three.js.

## Verificacao

```
Test Files  7 passed (7)
     Tests  127 passed (127)
TSC OK
dist/assets/index-CT87EAcC.js  500.68 kB │ gzip: 129.47 kB
✓ built in 915ms
```

Mais screenshots conferidos no Chrome a cada mudanca visual.

## Pendente

- Rodar o loop adversarial sobre movimento + arma + reacao do inimigo.
- Publicar no GitHub Pages e testar o link com fetch real.
- Nome do jogo.
