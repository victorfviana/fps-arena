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
| Mouse | olhar |
| Esc | libera o cursor |
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

Fundacao pronta e verificada: loop de passo fixo, colisao, arena, movimento do
jogador e render. Faltam armas, inimigos, ondas, HUD e audio.
