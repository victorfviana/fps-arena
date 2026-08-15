# ADR 0007 — Definição: inimigos humanos e cenário com objetos escaneados

Data: 2026-08-15
Status: aceito (veredito de playtest do Victor: "inimigos com forma humana
detalhada e movimentos definidos" + "caixas, muros baixos, objetos com mais
definição"; entrevista confirmou Quaternius já e imp humano)

## Decisão

1. **Inimigos humanos** (Zombie Apocalypse Kit, Quaternius, CC0, obtidos via
   poly.pizza porque o Drive estourou cota): zombieman e sargento são DOIS
   sobreviventes armados distintos (`Walk_Gun` na perseguição, `Idle_Gun` na
   pontaria, HitReact, Death); o imp virou o brutamontes (`Run_Arms` — corrida
   de braços estendidos — e `Punch`). Sem tinta: a diferenciação vem dos
   próprios modelos.
2. **Armas brancas ocultas**: os sobreviventes vêm de fábrica com faca/machado
   na mão ("Knife"/"Axe"), errado para atiradores; ficam invisíveis. Anexar um
   rifle ao osso da mão é refinamento futuro declarado.
3. **Props escaneados** (Poly Haven, CC0, glTF 2K): caixa militar, barril,
   mureta de concreto e caixa de munição, como `Box.visual` em 50 obstáculos
   novos + 14 coberturas re-vestidas, com regras duras verificadas por teste:
   nada invade spawn, nada no vão das portas, nada vira cobertura de IA nova,
   janela de sobrevivência idêntica na casa decimal.
4. **Mureta repete o módulo** (jersey barrier de ~2 m) em fileiras em vez de
   esticar o modelo; peças assentam no chão pela cota real do Box3 com as
   transformações de nó aplicadas (o AABB cru mentia 45% na caixa de tampa
   aberta).
5. Armadilha registrada: as texturas dos modelos do Poly Haven vivem em
   `Models/jpg/<res>/`, NÃO ao lado do gltf em `Models/gltf/<res>/` — baixar
   pela URL "óbvia" grava corpos de 404 como .jpg. Usar o campo `include` da
   API `/files/<slug>`.

## Limites conhecidos

- Sobreviventes miram de mãos vazias (item 2).
- ~200 peças novas de cena; o custo real de draw call sob o governador de
  qualidade continua não medido (aba oculta).
