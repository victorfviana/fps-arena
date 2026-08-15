# Plano aprovado — progressão de ambientes e inimigos estratégicos (andaime)

Aprovado pelo Victor em 14/08/2026 via entrevista: (1) limpar a sala abre uma
porta, estilo DOOM; (2) TRÊS ambientes distintos na primeira versão; (3) IA nos
três eixos: cobertura/flanco, sargento de escopeta, emboscadas posicionadas.
Este arquivo é andaime: apagar quando a feature estiver publicada, com o que
sobreviver indo para ADR 0006.

## Desenho

**Mundo (etapa A — em execução):** `arena.ts` deixa de ser uma sala única e
vira uma sequência de 3 salas conectadas em linha por portas:

1. **Galpão** (a arena atual, 2048×2048): tijolo/concreto/metal atuais.
2. **Corredores** (~2048×1024): trincheiras de obstáculos altos formando
   corredores apertados — combate curto, escopeta brilha, imps flanqueiam
   pelos corredores paralelos.
3. **Pátio** (~2560×2048): coberturas baixas espalhadas e linhas de visão
   longas — rifle/luneta brilha, zombiemen/sargentos em posições de tiro.

Porta = segmento de parede com estado (`fechada | aberta`): fechada bloqueia
movimento E visada; aberta remove ambos. Abre quando a sala ativa zera a fila
e os vivos. O jogador cruza a porta → sala seguinte "ativa" (spawns dela
entram). Sem teleporte, sem tela de carregamento. Vitória: limpar a sala 3
(tela de fim feliz — hoje só existe morte).

**Spawns por sala (emboscadas):** cada sala carrega pontos de spawn
DESENHADOS (atrás de cobertura, em pinça nas entradas), não aleatórios. O
sorteio da semente escolhe ENTRE pontos desenhados.

**IA (etapa B):** zombieman/sargento buscam cobertura entre tiros (ponto
atrás de obstáculo mais próximo que mantenha alcance); imps flanqueiam
(preferem rota lateral em vez de linha reta — desvio perpendicular ao vetor
jogador até ~300u antes de fechar). Sargento de escopeta: novo `EnemyKind`
com constantes CITADAS do DOOM (SPOS: 3 chumbos por tiro, mesma dispersão do
jogador; vida 30; cadência mais lenta que o zombieman; usa o modelo do orc
com tingimento distinto até a fase de arte seguinte).

**Render (etapa C):** porta visível (chapa metálica que desliza para cima ao
abrir), luz/cor levemente distinta por sala (mesmos conjuntos de textura, dose
de env/sol diferente), HUD "sala X/3" no lugar de "onda N" (a onda vira
interna à sala).

**Verificação:** testes novos (porta bloqueia/abre/deixa de bloquear visada;
avanço muda sala ativa; sargento tem chumbos>1; flanco não atravessa parede;
sobrevivência parado recalibrada POR SALA nas 8 sementes), rubrica e
legibilidade intactas, captura de tela por sala, publicação.

## Estado

- [x] Plano aprovado e checkpoint
- [ ] Etapa A: mundo multi-salas + portas + avanço + spawns desenhados
- [ ] Etapa B: IA (cobertura, flanco, sargento)
- [ ] Etapa C: render de portas/salas + HUD
- [ ] Calibração multi-semente por sala + captura + publicação
