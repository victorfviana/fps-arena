# 2026-08-15 — Definição: humanos animados e cenário com objetos reais

Veredito do playtest: som e mira aprovados; pedido de "cenários mais
realistas, caixas, muros baixos, mais definição" e "inimigos de forma humana
detalhada com movimentos definidos". Entrevista fechou: Quaternius já (o
fotorrealismo humano exige login em Mixamo/Sketchfab) e imp humano também.
Decisões consolidadas no ADR 0007.

## A caça aos assets teve plot twist duplo

1. O Google Drive do Quaternius estourou a cota pública ("many accesses")
   depois dos packs antigos virem SEM glTF (2019 = só FBX/Blend). Rota que
   funcionou: poly.pizza espelha o Zombie Apocalypse Kit (março/2024) com GLB
   direto em CDN — raspei o bundle (54 modelos), li o chunk JSON binário de
   cada GLB para identificar personagens e clipes, e escolhi dois
   sobreviventes armados (20 clipes cada, com Walk_Gun/Idle_Gun/Run_Gun) e o
   zumbi de braços grandes (Run_Arms/Punch).
2. As texturas dos modelos do Poly Haven NÃO moram ao lado do gltf: baixar
   pela URL "óbvia" gravou corpos de 404 de 94 bytes como .jpg — os props
   renderizavam brancos estourados. O campo `include` da API dá as URLs
   reais (`Models/jpg/2k/...`). Registrado no ADR.

## O que entrou

- Dois agentes em paralelo (humanos: Sonnet; cenário: Opus), arquivos
  disjuntos, wiring meu. 260 testes no fim.
- Zombieman e sargento = sobreviventes distintos SEM tinta; brutamontes com a
  corrida de braços estendidos como assinatura. Faca/machado de fábrica
  ocultados (atirador mirando com faca lia como defeito).
- 50 obstáculos novos + 14 coberturas re-vestidas de mureta de concreto, com
  as caixas militares estêncil e barris; janela de sobrevivência idêntica na
  casa decimal (medida semente a semente antes/depois pelo agente).
- envMapIntensity dos props alinhado ao mundo (chegavam em 1,0 de fábrica e
  brilhavam acima do cenário).

## Verificação de campo

Console pegou as texturas 404 (defeito real); capturas confirmaram:
sobrevivente de jaqueta laranja perseguindo com arma em punho, brutamontes de
braços abertos por cima da mureta, depósito de caixas "HE-2 9-32" com caixa
de munição, fileiras de mureta suja de estrada. 260 testes, tsc limpo.

## Próximo passo (retomada)

Playtest do Victor na versão publicada. Refinamentos declarados e não feitos:
rifle no osso da mão dos atiradores (hoje miram de mãos vazias), crossfade de
luz entre salas, custo de draw call das ~200 peças sob o governador. Nome do
jogo segue pendente.

## Não verificado

- Sargento de perto (mesma família do atirador, roupa distinta — conferido só
  pela estrutura do GLB, não em captura).
- A leitura das animações em movimento contínuo (crossfades) — só o playtest.
- FPS real com a cena mais pesada.
