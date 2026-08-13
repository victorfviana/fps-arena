# FPS Arena

Shooter em primeira pessoa que roda no navegador, calibrado contra as
constantes reais do DOOM (1993).

## Rodar

```bash
npm install
npm run dev        # servidor de desenvolvimento
npm run build      # typecheck + build de producao em dist/
npm test           # suite de verificacao
```

Requer Node 18 ou superior. No WSL, carregue o nvm antes:
`export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`.

## Controles

| Tecla | Acao |
|---|---|
| W A S D | mover |
| Shift | correr |
| Mouse | olhar, clique atira |
| Esc | libera o cursor |
| M | silencia o som |
| F3 | painel de diagnostico |

## Como o jogo e medido

A unidade do mundo e o *map unit* do DOOM, e a simulacao roda a 35 tics por
segundo — as duas escolhas existem para que a comparacao com a referencia seja
direta, sem fator de conversao onde possa esconder erro.

As constantes vivem em `src/core/doom.ts`, separadas em tres categorias:
citadas do source liberado pela id Software, derivadas por calculo explicito, e
lacunas declaradas. `tests/doom.test.ts` trava as derivacoes; `tests/player.test.ts`
verifica que a fisica simulada converge para elas.

Numeros de referencia atualmente travados:

| Grandeza | Valor |
|---|---|
| Corrida | 583,3 u/s |
| Caminhada | 291,7 u/s |
| Strafe correndo | 466,7 u/s |
| Rampa ate 90% da velocidade | 24 tics (686 ms) |
| Campo de visao horizontal | 90 graus |
| Altura do olho | 41 u |

## Estado

Jogavel de ponta a ponta: mover, atirar, matar, sobreviver a ondas crescentes,
morrer e recomecar. Movimento, arma, inimigos, ondas, HUD e audio prontos, com
127 testes cobrindo a simulacao.

Falta: rodar o loop adversarial sobre o nucleo sensorial e publicar.

### Divergencias declaradas do benchmark

Escolhas de escopo, nao erros de fidelidade:

- O imp e corpo a corpo. No DOOM ele lanca bola de fogo; projetil viajante e
  escopo proprio e nao entrou nesta etapa.
- O dano e a cadencia de ataque dos inimigos sao calibragem de dificuldade
  desta arena, nao valores do original — o DOOM nao e um jogo de ondas.
- A aleatoriedade usa gerador com semente proprio, e nao a tabela `P_Random`
  de 256 valores, que nao encontrei em fonte citavel.
