# ADR 0005 — Arte externa, fases 2-3: texturas PBR e HDRI

Data: 2026-08-14
Status: aceito

## Contexto

Victor aprovou os modelos (fase 1) e o som gravado (fase 4) e autorizou "as
demais fases". Restavam as texturas de mundo e a iluminacao por imagem do
mapa do ADR 0002.

## Decisão

1. Entram do Poly Haven (tudo CC0, download direto, autores no CREDITS.md):
   `brick_wall_12` (paredes), `concrete_floor_02` (piso), `metal_plate`
   (teto/obstaculos) — 2K JPG com diff/nor_gl/rough — e o HDRI
   `abandoned_workshop` 2K (.hdr), ~29 MB no total.
2. **Sem KTX2/DRACO**: tres conjuntos de textura nao pagam a infraestrutura
   de transcoder. JPG 2K decodifica nativo e a VRAM de ~9 mapas 2K e trivial
   para desktop. Reavaliar so se o numero de conjuntos crescer.
3. O HDRI vira environment map via PMREMGenerator (reflexo e luz ambiente
   coerentes nos materiais PBR). A arena e fechada — o HDRI nao aparece como
   ceu, so como luz.
4. Carregamento assincrono atras do MESMO portao dos modelos/sons; fallback
   integral para os materiais procedurais (que continuam no codigo).

## Consequências

- Primeiro load sobe para ~30 MB. GitHub Pages aguenta; conexao lenta espera
  mais no botao "carregando".
- O visual procedural deixa de ser o rosto do jogo e vira contingencia.
