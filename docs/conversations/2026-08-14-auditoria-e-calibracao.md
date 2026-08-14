# 2026-08-14 — Auditoria geral, correções e calibração de dificuldade

Victor pediu: auditar tudo, corrigir falhas e lacunas, melhorar o que desse —
inclusive o salto de realismo — e mapear os caminhos das melhorias gráficas.

Quatro varreduras paralelas (simulação, render, áudio, testes/docs) sobre o
commit 751038c, depois quatro agentes de correção em arquivos disjuntos, com o
wiring de `main.ts` centralizado no orquestrador.

## O que a auditoria achou e foi corrigido

**Simulação.** Trocar de arma recriava o `WeaponState` e zerava o cooldown —
um round-trip de ~14 tics anulava a recarga de 44 da escopeta. Agora o estado
vive num `Map` por arma e o tempo passa para as guardadas. `requestSwap` ganhou
guarda contra troca com disparo pendente (inalcançável hoje; era regressão
silenciosa esperando `delayTics` maior). A separação de inimigos lia posições
já mutadas no mesmo tic (viés de ordem) — snapshot no início do tic.
`restart()` não zerava os IDs de inimigo.

**Render.** A névoa começava além da maior linha de visão da arena — inerte
desde sempre. O governador de qualidade era catraca: um engasgo do SO no início
rebaixava o visual da sessão inteira, e reiniciar não zerava; ganhou
recuperação com histerese, trava anti-oscilação e reset no restart. O tamanho
por espécie de partícula era definido e nunca lido (um `Points` por espécie
agora). Textura de parede gerada duas vezes; uniform de cor reenviado todo
quadro; `textures.ts` morto desde a troca por `materials.ts`.

**Áudio.** Caminho seco paralelo (fora de saturação e compressor) só para a
borda do ataque: **ataque medido caiu de 9-10 ms para 0 ms** (abaixo da
resolução de 1 ms do aferidor) nas duas armas. `toggleMute` passou a silenciar
o caminho seco. Morte do jogador ganhou som próprio antes do jingle. Passos do
jogador e dos inimigos (o dado `distanceWalked` já existia). Auto-resume do
`AudioContext` em `visibilitychange`. `pistol` fantasma removida do `ShotKind`.

**Testes.** `menu.test.ts` não testava a regressão que dizia guardar — o
wiring de pointer lock foi extraído para `menu.ts` e testado com DOM falso,
reproduzindo o bug histórico de ouvinte com espelho desatualizado. Dois testes
de spawn tinham `expect` dentro de `if` sem prova de execução. README dizia
157 testes; eram 185 (hoje, 205).

## O achado que só a verificação de campo pegou

Jogando no navegador, o jogador parado morria em **17 s** — fora da janela de
30-90 s do design. O teste de sobrevivência passava porque media a semente 17
(31,8 s), não a 0x1d1a que o jogo publicado usa. Sondagem em 8 sementes:
10,5-31,8 s. O problema já existia antes do lote (confirmado em worktree do
commit base).

Causa raiz dupla, ambas divergências não declaradas do benchmark: o zombieman
daqui atirava no DOBRO da cadência do POSS do DOOM e com pontaria perfeita —
no DOOM, `P_GunShot` com `accurate=false` erra a maior parte a média
distância.

Correção derivada do benchmark: chance de acerto decrescente com a distância
(determinística, semente do jogo), cadência 28→50 tics, e o tiro que erra
produz um **traço visivelmente desviado** — a dispersão virou informação de
legibilidade, não só número. Imp calibrado junto (7→4 de dano, 20→32 tics).
Varredura paramétrica de sementes fechou em 26-61 s (mediana 46 s). O teste de
sobrevivência agora mede TODAS as 8 sementes, incluindo a publicada, com piso
25 s — documentado no próprio teste por que 25 e não 30: cerco corpo a corpo
fecha o teto de quem fica imóvel, igual ao benchmark.

O aviso vermelho de dano agora só acende com acerto real; o traço e o som
continuam para o tiro que errou.

## Verificação de campo (navegador real, preview do build publicado)

- `medirTiro`: ataque 0 ms nas duas armas; brilho inicial 9075/10225 Hz (a
  borda seca domina o início, como deveria).
- Sequência de combate exercitada pelo caminho real de input: imp piscando
  branco no acerto, morte com queda e sangue, zombieman com passada articulada
  e sombra de contato, traço de erro cruzando a tela, decal nascendo colado na
  parede leste na altura do olho, fumaça agora redonda.
- Dois sustos que NÃO eram bugs: tela cinza uniforme (câmera com NaN vindo de
  comando sintético incompleto MEU — o jogo real monta o comando sempre
  completo) e uma "pirâmide gigante" que era o chifre do imp em close durante
  a animação de morte, na cor pálida da dessaturação.
- Um defeito real pego só na tela: partículas eram QUADRADOS de tela
  (PointsMaterial sem sprite); o tamanho novo da fumaça escancarou. Sprite
  radial compartilhado corrigiu.

## Estado final

205 testes, tsc limpo, build 946 ms, publicado. `DESAFIOS.md` criado com os
limites estruturais (CI sem caminho do usuário, áudio sem teste em node, FPS
real não medível sob automação, armadilha do nvm no WSL).

## Não verificado, dito com clareza

- Som dos passos e da morte: estrutura correta e medível, timbre é veredito
  de quem ouve.
- Luz de mundo do clarão: presente no código e sem estouro de bloom nos
  quadros capturados, mas o pulso é curto demais para prova visual sob
  automação.
- Recuperação do governador de qualidade: provada como lógica pura em teste;
  o comportamento na máquina real do jogador continua não verificado (aba
  oculta não tem rAF).
- A sensação da dificuldade nova: os números fecham a janela do design, mas
  "está justo" é julgamento de quem joga.
