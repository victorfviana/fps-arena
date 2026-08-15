# 2026-08-14 — Traçado nítido do projétil, texturas PBR e HDRI

Dois pedidos do Victor na mesma leva: "caminho do projétil mais direto e menos
difuso, mostrando o trajeto e o efeito no alvo" e as fases 2-3 da arte externa
(texturas de mundo + HDRI, ADR 0005).

## Traçado

- Feixe em volume (cilindro aditivo) no lugar da linha de 1 px, nascendo 72
  unidades À FRENTE do cano — colado na câmera ele virava uma cunha branca de
  meia tela (pego em captura congelada).
- Flash de impacto no ponto final: quente na parede, avermelhado no inimigo.
- Jato de sangue mais denso e coerente com a direção do tiro (saindo do lado
  oposto ao impacto — antes ia na direção do atirador, fisicamente errado).
- As 7 linhas de chumbo da escopeta saíram de cena (opacidade 0): eram
  exatamente o "difuso" da reclamação, e em quadro congelado apareciam como
  fios verticais. A dispersão REAL continua na simulação.
- Clarão do viewmodel reduzido (0,34→0,19): com o sprite radial virava um sol
  descolado da arma.

## Texturas e HDRI — a calibração foi o trabalho de verdade

Poly Haven CC0: brick_wall_12 (paredes), concrete_floor_02 (piso), metal_plate
(teto/obstáculos), abandoned_workshop (environment). Três lições medidas em
captura, não supostas:

1. **Repeat não se herda do procedural**: o "bloco" procedural de 128u carrega
   um padrão desenhado para 128u; a foto 2K cobre ~2 m físicos. Herdar o
   repeat esticava tijolo em 5 m e concreto em 10 m (piso parecia tábua
   corrida). Agora o ladrilho é físico (TILE_* em map units).
2. **Luz calibrada para albedo escura lava albedo clara**: as fotos reais
   refletem muito mais que o canvas escuro procedural — o sol caiu para 0,7 e
   o ambiente para 0,45 quando as texturas reais entram.
3. **scene.environmentIntensity se mostrou inerte** nesta versão (A/B ao
   vivo: 0,32 setado e a cena continuava lavada; environment nulo e o humor
   voltava). A alavanca que o renderer respeita é o `envMapIntensity` POR
   MATERIAL: 0,3 nos dielétricos, 0,6 no metal (sem env, o metal vira breu).

## Estado

207 testes, tsc limpo, publicado. Fallback procedural integral preservado
para tudo (modelos, sons, texturas, HDRI).

## Não verificado

- O gosto: paleta quente da oficina abandonada + tijolo areia é uma
  identidade nova — o veredito é do Victor (alavancas: HDRI_*, SOL_*, TILE_*
  no topo de renderer.ts).
- Anisotropia e tiling só se avaliam em movimento.
