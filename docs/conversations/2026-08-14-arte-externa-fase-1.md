# 2026-08-14 — Arte externa, fase 1: inimigos com anatomia

Victor acolheu a recomendação: quebrar a regra "zero asset externo" na menor
fase de risco — só os modelos dos inimigos. ADR 0003 registra a decisão; a
regra 3 do CLAUDE.md virou "asset só CC0, só em public/models/, cada arquivo
com linha no CREDITS.md" — e essa regra agora é um teste
(`tests/creditos.test.ts`).

## O que entrou

- `public/models/orc.gltf` e `demon.gltf` — pack Ultimate Monsters do
  Quaternius, CC0, ~1,3 MB cada, autossuficientes (buffer e textura base64).
  Baixados da pasta oficial do Drive via gdown em venv isolado; o conversor
  GLB foi dispensado — o GLTFLoader lê o .gltf direto e um passo de pipeline a
  menos é um passo a menos.
- `src/render/enemyModels.ts`: carrega os dois com fallback — qualquer falha
  devolve null e o jogo segue com os corpos procedurais antigos, que
  continuam no código como caminho de contingência.
- `enemyView.ts`: clone por slot do pool via SkeletonUtils, AnimationMixer por
  view, mapa estado→clipe (chase→Walk com timeScale casado ao STRIDE de 62,
  attack→Weapon/Punch, pain→HitReact, dying→Death com clampWhenFinished),
  crossfade de 0,15 s, tingimento por dano clonando materiais do glTF.
- `main.ts`: botão "jogar" espera os modelos (ou a decisão de fallback) para
  nenhuma view nascer num formato e trocar no meio da partida.

## Verificação

207 testes, tsc limpo. No navegador: Demon (imp) e Orc (zombieman) encaram o
jogador — a correção de 180° que o agente deduziu por leitura de código estava
certa; escala coerente; caminhada articulada; HitReact visível no acerto;
Death caindo para trás e ficando na pose final até o corpo ser recolhido.

De quebra, o quadro congelado entregou um defeito antigo que 60 fps escondiam:
o clarão do cano era um QUADRADO chapado cor de creme (PlaneGeometry sem
textura). Virou sprite radial aditivo — lê como luz, não como placa.

## Não verificado

- timeScale da passada: a conta fecha, mas "o pé bate no chão no ritmo certo"
  é julgamento de quem joga.
- Peso do primeiro load (~2,6 MB de modelos) em rede lenta — o botão segura
  até carregar, mas a espera real depende da conexão.
