# 2026-08-15 — Progressão de ambientes e inimigos estratégicos

O maior salto do projeto desde a fundação, aprovado por entrevista (portas
estilo DOOM, 3 ambientes, os três eixos de IA) e executado em três etapas de
agente Opus com checkpoint entre cada uma. O design consolidado vive no ADR
0006; aqui fica o que aconteceu.

## As etapas

**A (mundo):** três salas contínuas, porta como Wall recomputada, avanço por
travessia real, spawns desenhados, fase 'won'. A descoberta da etapa: as
posições de spawn da sala 1 são intocáveis — duas tentativas de "melhorá-las"
quebraram a janela de sobrevivência ou seis testes seedados; o agente reverteu
e DECLAROU a folga real (17,4u) no teste em vez de escondê-la.

**B (IA):** cobertura geométrica, flanco por paridade de id, sargento SPOS
citado do source. Os 20 testes novos passaram de primeira, e a regra da casa
("rubrica que aprova de primeira é suspeita") fez o agente rodar bateria de
MUTANTES: cada comportamento desligado mata os testes que o cobrem — um
mutante sobreviveu e está declarado em comentário. A janela de sobrevivência
saiu de 26-61 s para 32-75 s sem tocar em dano (a IA que se esconde também
atira menos), dentro do 25-90.

**C (render):** salas desenhadas por bounds com UV ladrilhada por tamanho
físico, chapas de porta animadas, ambiente por sala, sargento fardado,
sargentos nas ondas do pátio. Névoa recalibrada só no pátio (a do galpão
encobriria 93% do fundo).

**Fechamento (orquestrador):** HUD "Sala X/3 · onda", tela de Vitória,
som de porta (rangido + clank casando com os 0,8 s), estampido do sargento
com a amostra de ESCOPETA via EnemyShot.kind, causa de morte com terceiro
ramo.

## Verificação de campo (navegador, jornada completa)

Porta 1 fechada preenchendo o vão → sala limpa (staging declarado de abate; a
lógica é coberta por 27 testes de simulação) → chapa some → travessia REAL
andando com W pelo vão → "SALA 2/3" no HUD e no toast, corredores com
trincheiras altas → porta 2 → pátio amplo com sargento fardado a 420u →
fase 'won' com tela "Vitoria". Tudo pelo pipeline real de eventos.

Dois quase-sustos que eram artefato de staging, não bug: a animação da porta
anda em tempo REAL de render (advances síncronos têm delta ~0 — no jogo
normal sobe sozinha), e o "paredão de metal" era a porta fechada fotografada
antes de o tempo real correr.

## Estado

254 testes, tsc limpo, publicado. 27 testes novos de progressão/IA.

## Não verificado

- Dificuldade das salas 2-3 para jogador ativo: sem medição automatizada
  honesta — é o playtest do Victor que decide.
- O timbre do som da porta e o clique do flanco/cobertura "parecendo
  inteligente" em movimento: julgamento humano.
- Escala do tijolo à distância (fileiras viram linhas finas a 1000u — é a
  escala FÍSICA correta; se parecer "liso demais", sobe-se TILE_PAREDE).
