# ADR 0001 — O DOOM de 1993 como benchmark mensuravel

Data: 2026-08-13
Status: aceito

## Contexto

O projeto usa o modelo de prompt com critica adversarial e parada mensuravel.
O Bloco 1 desse modelo exige uma referencia de qualidade **real, nomeada e
acessivel**, e o Bloco 5 exige rubrica em comportamento observavel, nao em
adjetivo. "Game feel bom" nao e nivel de rubrica; sem numero, a critica
adversarial vira troca de opiniao e o custo do loop nao se paga.

## Decisao

O benchmark e o DOOM (1993), e a fonte da verdade e o **codigo-fonte liberado
pela id Software** (`linuxdoom-1.10`), nao a impressao de jogar o original.

Tres consequencias praticas:

1. **A unidade do mundo e o map unit do DOOM.** Camera, colisao e fisica
   trabalham nela. Nao ha conversao para metros — conversao e onde erro se
   esconde.
2. **A simulacao roda a 35 tics por segundo**, com passo fixo e interpolacao
   no desenho. Constantes por tic entram literalmente.
3. **Toda constante e classificada**: citada (com arquivo e identificador),
   derivada (com a conta escrita e reproduzida em teste) ou lacuna declarada.
   Nenhum numero entra por estimativa apresentada como fato.

## Por que o source e nao a gravacao

A alternativa considerada era medir video do DOOM emulado no navegador. Foi
descartada: emulacao e captura introduzem ruido maior que as diferencas que
queremos detectar, e o resultado nao seria reproduzivel por outra pessoa.

## Erro que essa decisao ja evitou

O primeiro levantamento tratou `forwardmove` (50) como velocidade, concluindo
1750 u/s de corrida. O source mostra que o valor entra em `P_Thrust` multiplicado
por 2048 e **somado ao momento** — e aceleracao, nao velocidade. A velocidade
real emerge do equilibrio com a friccao de 0,90625:

```
aceleracao   = 50 * 2048 / 65536 = 1,5625 u/tic
v_terminal   = 1,5625 / (1 - 0,90625) = 16,667 u/tic = 583,3 u/s
```

583,3 u/s e a velocidade de corrida consagrada do DOOM — a convergencia com um
valor conhecido de forma independente confirma a cadeia. Adotar o numero errado
teria produzido um jogo tres vezes rapido demais, com sensacao de patinacao, e
nenhum teste teria pegado, porque nao haveria com o que comparar.

## Consequencia para o custo

Como decidido no plano, o loop adversarial roda **apenas** sobre movimento,
arma e reacao do inimigo — as dimensoes que tem benchmark. Render, arena, HUD,
ondas e audio seguem em pipeline direto com verificacao executavel. Aplicar o
loop onde nao ha referencia produziria rubrica de opiniao a tres a cinco vezes
o custo.
