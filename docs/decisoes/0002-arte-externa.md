# ADR 0002 — O teto do visual sem arte externa, e o que mudaria com ela

Data: 2026-08-14
Status: aceito (mantida a regra de zero asset externo)

## Contexto

O ADR 0001 fixou o benchmark. Esta decisao trata de outra coisa: ate onde o
visual chega com geometria e shaders escritos a mao, e o que exatamente
mudaria se o projeto passasse a consumir arte de terceiros.

A regra atual — nenhum arquivo externo, texturas em canvas, audio sintetizado
— foi escolhida no plano inicial por tres razoes: sem download, sem licenca a
rastrear e sem peso no bundle. O bundle inteiro tem 560 KB.

## O que ja foi extraido dessa restricao

Materiais PBR com normal e roughness derivados de mapa de altura, sombras
projetadas, tone mapping ACES, bloom, viewmodel com bracos e maos articuladas,
inimigos com torso, cabeca, bracos e pernas animados por distancia percorrida,
e particulas em deposito circular.

O resultado e um estilizado solido — a familia de um Dusk ou Ultrakill. E o
teto honesto deste caminho. O que falta para parecer um jogo comercial nao e
mais engenho: e material que so um artista produz.

## O que arte externa exigiria

**Assets, e onde vivem:**

| Tipo | O que resolve | Fontes CC0/gratuitas | Peso tipico |
|---|---|---|---|
| Modelos glTF riggados | Inimigos com anatomia e animacao de verdade | Mixamo, Quaternius, Kenney | 1–5 MB cada |
| Texturas PBR 2K | Superficies com historia, nao ruido procedural | Poly Haven, ambientCG | 2–8 MB por conjunto |
| HDRI | Iluminacao baseada em imagem, reflexo coerente | Poly Haven | 2–10 MB |
| Audio | Tiro e passos gravados, no lugar de osciladores | Freesound, Sonniss GDC | 5–30 MB |

**Mudancas tecnicas:**

1. `GLTFLoader` com compressao (DRACO ou meshopt) e `KTX2Loader` para texturas
   comprimidas em GPU — sem isso, 2K descomprimida ocupa memoria de video
   demais.
2. `AnimationMixer` no lugar da animacao por rotacao manual que existe hoje.
   As poses atuais viram transicoes entre clipes.
3. Carregamento assincrono com tela de progresso. Hoje o jogo abre instantaneo;
   com assets passaria a ter espera de segundos.
4. `PMREMGenerator` para o HDRI virar mapa de ambiente.
5. Rastreio de licenca por arquivo, num `CREDITS.md`.

**Consequencias:**

- Bundle sai de 0,56 MB para algo entre 15 e 50 MB. GitHub Pages aguenta
  (limite de 1 GB por repositorio, 100 MB por arquivo), mas o primeiro
  carregamento deixa de ser imediato.
- A regra "zero asset externo" do CLAUDE.md do projeto cai, e com ela a
  simplicidade de nao ter nada para licenciar.

## Decisao

**Manter zero asset externo por enquanto.** O ganho marginal de trocar
geometria estilizada por modelos de biblioteca nao paga a perda de simplicidade
enquanto o jogo nao tiver publico. Se e quando isso mudar, o caminho esta
descrito acima e nao exige refazer nada: `enemyView.ts` e `viewmodel.ts` ja
isolam o desenho da simulacao, entao trocar a fonte das malhas nao toca em
regra de jogo nenhuma.

## Divisao de trabalho, dita com clareza

Integrar, animar, iluminar e otimizar asset e codigo — e codigo eu escrevo.
**Criar o asset nao.** Nao produzo textura fotografica nem malha organica
convincente; o que escrevo e geometria e shader. Um salto para "parece
comercial" depende de material vindo de fora, seja de biblioteca CC0, seja de
um artista, seja de geracao por imagem feita fora daqui.
