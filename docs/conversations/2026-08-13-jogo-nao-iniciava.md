# 2026-08-13 — O jogo publicado nao iniciava, e a rubrica nao viu

Victor jogou o link publicado e relatou: tela escura, zero visibilidade, os
botoes de instrucao nao saiam da tela, jogabilidade impossivel. O scorecard
tinha dado 4,45 poucos minutos antes.

## A causa

Condicao de corrida entre dois ouvintes do mesmo evento.

`main.ts` registrava o ouvinte de `pointerlockchange` do menu **antes** de
`input.attach()`. Quando o navegador concedia o ponteiro, o ouvinte do menu
rodava primeiro, consultava `input.isLocked` — ainda `false`, porque o ouvinte
do proprio Input so rodaria depois — e reexibia o menu.

Como `.screen` tem fundo `rgba(14, 12, 10, 0.93)`, o menu de volta explica os
dois sintomas de uma vez: a "tela escura" era ele cobrindo a partida, e os
"botoes que nao saem" eram ele proprio. O jogo estava rodando por tras o tempo
todo.

## Por que a verificacao nao pegou

Este e o ponto que importa mais que o defeito.

**Toda a verificacao automatizada contornava o pointer lock.** O navegador so
concede o ponteiro a partir de um gesto real do usuario, o que a automacao nao
consegue produzir. Em vez de tratar isso como um limite a declarar, eu criei o
modo `?test=1` para dispensar o ponteiro — e segui medindo tudo por ele.

O resultado: **o caminho real de entrada no jogo nunca foi exercitado uma unica
vez**. Nem localmente, nem no publicado. Todos os screenshots foram feitos
manipulando o estado do jogo por JavaScript, nunca clicando em "jogar".

E a rubrica tinha cinco dimensoes — responsividade, feedback de tiro,
fidelidade de movimento, reacao do inimigo, legibilidade — e **nenhuma cobria
"a partida comeca"**. Medi com precisao a velocidade em unidades por segundo de
um jogo que ninguem conseguia iniciar.

O documento de metodologia avisa dos dois erros que cometi aqui: usar o nivel
de verificacao errado, e confiar no scorecard como se fosse validacao.

## Correcoes

1. A decisao virou funcao pura em `src/menu.ts`, com seis testes. Nao depende
   mais de ordem de ouvintes, e a regressao quebra a suite.
2. `pointerlockerror` passou a ser tratado: antes, recusa do navegador falhava
   em silencio e o jogador clicava sem que nada acontecesse.
3. Iluminacao subiu — e depois desceu. A primeira correcao passou do ponto e
   deixou a cena lavada, com dominante avermelhada que apagava o contraste do
   imp contra o fundo. Luz de cima levemente fria contra textura quente
   equilibrou.

## O que fica para o metodo

Rubrica precisa de uma dimensao para **o caminho que o usuario percorre de
fato**, antes das dimensoes finas de qualidade. De nada adianta 583,3 u/s
medidos com erro abaixo de 1% se apertar "jogar" nao entra no jogo.

E quando um limite de ambiente impede exercitar um caminho, o certo e declarar
o caminho como nao verificado — nao construir um desvio e seguir medindo por
ele como se fosse a mesma coisa.
