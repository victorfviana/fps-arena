# Checkpoint — auditoria geral de 14/08/2026 (andaime; apagar quando as correções entrarem)

Quatro varreduras (simulação, render, áudio, testes/docs) sobre o commit 751038c.
Baseline: 185/185 testes, tsc limpo, site publicado = dist local (index-Ckix7pl0.js).

## Achados que serão corrigidos, por domínio

### Simulação (agente A — weapon.ts, aiming.ts, game.ts, enemy.ts, tests/armas-e-ordem.test.ts)
1. ALTA: trocar de arma recria WeaponState e zera cooldown — round-trip de ~14 tics anula
   recarga de 44 tics da escopeta (game.ts:162-167). Fix: Map<LoadoutId, WeaponState>,
   cooldown das armas guardadas continua decrementando.
2. MÉDIA: separação de inimigos lê posições já mutadas no mesmo tic (viés de ordem).
   Fix: snapshot de posições no início do tic.
3. Guarda: requestSwap recusa enquanto fuseTics >= 0 (tiro pendente sumiria).
4. restart() não chama resetEnemyIds() — wiring em main.ts (fica com o orquestrador).
5. Invariantes sem guarda: ATTACK_POSE_TICS < menor attackCooldown; obstáculos fora da
   faixa de altura 33–49 (view bob vs SHOT_HEIGHT). Virarão testes.

### Render (agente B — renderer.ts, particles.ts, enemyView.ts, quality.ts, index.html, tests/qualidade.test.ts)
6. Névoa inerte: near 2252 numa arena com visada máxima 2896. Fix: near 0.35×, far 1.0×.
7. Governador de qualidade só desce e restart não zera. Fix: recuperação com histerese +
   trava anti-oscilação + reset() (wiring do reset fica com o orquestrador).
8. Perfil.tamanho nunca lido — partículas todas com size 6. Fix: um Points por espécie.
9. Textura de parede gerada 2× — clonar em vez de regerar.
10. aplicarCor() reenvia uniform todo quadro — guardar health/state anterior.
11. textures.ts morto — remover.
12. Realismo barato: luz de mundo no clarão do tiro (flashTimer), vinheta CSS,
    blob shadow sob inimigos (vale ouro com sombras desligadas), decal de impacto
    com normal aproximada por eixo dominante.

### Áudio (agente C — sfx.ts apenas; wiring de main.ts com o orquestrador)
13. Ataque <2ms: barramento seco paralelo direto ao destination (fora de saturação e
    compressor), camada extra de 10ms highpass ganho ≤0.18, toggleMute passa a zerar
    o dryBus também.
14. Remover ShotKind 'pistol' (arma não existe).
15. playerDeath() dedicado antes do jingle de gameOver.
16. Passos: playerStep() e enemyStep(pan, perto) — dado dos inimigos já existe
    (distanceWalked); só os próximos/audíveis tocam.
17. Auto-resume do AudioContext em visibilitychange.
18. Documentar intenção do perto² na banda aguda do tiro inimigo.

### Testes/docs (agente D — menu.ts, tests/menu|game|rubrica.test.ts)
19. menu.test.ts não testa a regressão que diz guardar. Fix: extrair o wiring de pointer
    lock de main.ts:359-369 para menu.ts (função exportada) e testar com DOM falso;
    snippet de substituição em main.ts vai para o orquestrador aplicar.
20. Testes de spawn com expect dentro de if sem prova de execução — contar e afirmar >0.
21. README diz 157 testes; são 185 (orquestrador atualiza no fim, com a contagem final).
22. DESAFIOS.md não existe — orquestrador cria.
23. CI não exercita caminho do usuário — limite declarado, vai para DESAFIOS.md.

## Fora de escopo, com motivo
- InstancedMesh para inimigos: 14 inimigos não pagam a mudança de arquitetura.
- Merge dos 8 obstáculos: ganho de 7 draw calls em ~126 — irrelevante.
- Recarga animada: não existe mecânica de recarga (munição infinita por design).
