# 2026-08-14 — Visual novo, maos e arsenal com luneta

Victor pediu visual mais real, mao do atirador segurando a arma, mira
telescopica, e "reconfigurar as escolhas iniciais". Escolhas fechadas por
entrevista, todas nas recomendadas:

| Decisao | Escolha |
|---|---|
| Fisica | Hibrido: base DOOM + camadas modernas por cima |
| Arsenal | Escopeta + rifle com luneta |
| Qualidade | Alta, com ajuste automatico por framerate |

O que foi dito antes de comecar, e vale repetir: **nao existe "gerar arte
profissional"** aqui. Escrevo geometria e shaders. O teto e sair do geometrico
tosco e chegar num estilizado solido com iluminacao de verdade — padrao de um
Dusk, nao de um Call of Duty.

## Decisao estrutural: viewmodel em cena e camera proprias

O mundo usa os 90 graus horizontais do DOOM. Com esse campo de visao, tudo que
esta perto da camera estica: a arma sairia com o cano em forma de funil.

O viewmodel passou a ter cena, camera (48 graus) e iluminacao proprias,
desenhado numa segunda passada que limpa so a profundidade. Alem de corrigir a
deformacao, isso impede que a arma seja recortada por parede encostada.

A escala ali e propria — cerca de 1 unidade por metro — e nao os map units do
mundo. As duas nunca se cruzam.

## Procedencia continua separada

O rifle e a mira apontada nao existem no DOOM. Ficam em `weapons/loadout.ts`,
declarados como design; `core/doom.ts` segue so com o que veio do source. A
escopeta continua com cadencia, atraso, chumbos e dano citados do original.

## Defeitos encontrados olhando a tela

Nenhum apareceu em teste. Todos vieram de capturar e comparar.

1. **Tijolos de dois metros.** A repeticao da textura estava a cada 320
   unidades. Corrigida para 128, o que da blocos de cerca de 21 unidades — uns
   65 cm na escala do jogo.
2. **Conjunto braco-arma quase preto.** Os materiais eram realistas demais em
   valor: metal escuro contra chao claro vira mancha sem forma. Clareados, com
   tres luzes proprias (principal, preenchimento frio e contraluz).
3. **Coronha colada na camera.** A distancia do viewmodel se mede pela peca
   MAIS PROXIMA, nao pela origem do grupo: com a raiz a 34 cm, a coronha ficava
   a 8 cm do olho e tomava metade da tela. Empurrada para 74 cm.
4. **Antebracos como troncos.** Espessos (0,052 de raio) e quase horizontais,
   boiavam ao lado da arma. Afinados e inclinados para sairem pela borda
   inferior — e o angulo, mais que o tamanho, que faz ler como braco.
5. **Luneta que o codigo julgava ativa e a tela nao mostrava.** A mascara CSS
   com `-webkit-mask` e `var()` dentro de `calc()` nao pintava nada. Trocada
   por gradiente radial no proprio fundo.
6. **Arma aparecendo dentro da luneta.** A visibilidade era aplicada depois de
   `render()`, entao valia so no quadro seguinte. Como a luneta abre de uma
   vez, o olho pegava exatamente esse instante.
7. **Dominante avermelhada, duas vezes.** Luz quente somada a textura quente. A
   iluminacao ficou neutra e o bloom, contido a um limiar alto.

## Armadilha de verificacao que custou varias tentativas

Sob automacao a aba fica oculta: `requestAnimationFrame` nao roda e transicoes
CSS congelam. Pior, a captura de tela reativa a aba por um instante, o loop
volta a rodar e **desfaz o estado que eu tinha montado** — a mira abria sozinha
antes do print, e eu via a tela errada concluindo coisa errada.

A solucao foi `loop.stop()` antes de capturar. Fica como metodo: para
inspecionar um estado transitorio sob automacao, congelar o loop primeiro.

Tambem foi criado `__fpsArena.trocarArma`, que troca pelo mesmo caminho do
jogador. Mexer em `game.aim` direto contorna o tratador de eventos do loop e
mede um estado que o jogo real nunca atinge — foi o que fez o rotulo do painel
parecer quebrado quando nao estava.

## Verificacao

173 testes, `tsc` limpo, build ok, e conferencia visual dos dois estados no
site publicado: quadril com a escopeta e luneta fechada com o rifle.

## Nao verificado

Framerate real e o ajuste automatico de qualidade. Ambos dependem de
`requestAnimationFrame` num navegador visivel. O governador de qualidade tem a
logica coberta por construcao (so desce, com janela de observacao e
aquecimento), mas nunca foi visto reagindo de verdade.
