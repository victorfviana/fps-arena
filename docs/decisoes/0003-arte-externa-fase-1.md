# ADR 0003 — Arte externa, fase 1: modelos de inimigos

Data: 2026-08-14
Status: aceito; os MODELOS citados aqui (orc/demon) foram substituídos pelos
humanos do ADR 0007 em 15/08 — a decisão estrutural (asset CC0 rastreado,
fallback procedural) permanece

## Contexto

O ADR 0002 mapeou o que a arte externa exigiria e decidiu esperar. Victor
autorizou o salto em 14/08/2026, na menor fase de risco: só os modelos dos
inimigos, que é onde o olho ganha mais por megabyte e onde `enemyView.ts` já
isola o desenho da simulação.

## Decisão

1. Entram DOIS arquivos: `public/models/orc.gltf` (zombieman) e
   `public/models/demon.gltf` (imp), do pack Ultimate Monsters do Quaternius,
   CC0, copiados sem alteração — autossuficientes (buffer e textura embutidos,
   ~1,3 MB cada). Nenhum conversor nem loader de compressão (DRACO/KTX2): os
   arquivos são pequenos demais para pagar qualquer complexidade extra.
2. A regra do CLAUDE.md muda de "zero asset externo" para: **asset externo só
   CC0, só em `public/models/`, e cada arquivo com linha no `CREDITS.md`** —
   conferido por teste.
3. Animações vêm dos clipes do próprio GLB via `AnimationMixer`
   (Walk/Run/Weapon/Punch/HitReact/Death). A animação procedural por rotação
   manual sai de cena para os inimigos; o restante do visual procedural fica.
4. Texturas de mundo, HDRI e áudio gravado (fases 2-4 do ADR 0002) continuam
   FORA até novo pedido do Victor.

## Consequências

- Bundle da página continua pequeno; os GLB (~2 MB) carregam assíncrono com
  indicador na tela inicial. Primeiro load deixa de ser instantâneo.
- O tingimento por dano (branco no acerto, dessaturação na morte) precisa
  clonar materiais por instância — mesma técnica de antes, aplicada aos
  materiais do GLB.
- Fallback: se o fetch dos modelos falhar (offline), o jogo cai nos corpos
  procedurais antigos em vez de quebrar — o código deles permanece.
