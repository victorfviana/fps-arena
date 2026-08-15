# ADR 0006 — Progressão de ambientes e IA estratégica

Data: 2026-08-15
Status: aceito (design aprovado pelo Victor em entrevista de 14/08)

## Decisão

1. **Três salas contínuas em -Z** (galpão 2048², corredores 2048×1024 com
   trincheiras altas, pátio 2560×2048 com coberturas baixas), conectadas por
   vãos de 256 com portas. Limpar as 3 ondas da sala abre a porta; cruzar o
   vão ativa a sala seguinte; limpar a terceira vence (`phase: 'won'`).
2. **Porta = Wall recomputada**, não flag: fechada entra em `arena.walls` e
   barra corpo e visada sem `collision.ts` saber que portas existem;
   `abrirPorta` muta o array in-place porque os consumidores guardam a
   referência (travado por teste). A chapa visual sobe em 0,8 s e é só
   aparência — a regra libera a passagem no tic do evento.
3. **Ondas por sala como VIÉS de mistura** sobre a mesma curva (corredores
   +imps, pátio +zombiemen/sargentos), com o total por onda idêntico — o
   sargento é promovido da fatia dos zumbis. Sala 1 byte a byte igual à
   de antes: os testes de sobrevivência multi-semente medem ela.
4. **Spawns desenhados por sala** (emboscadas atrás de cobertura, pinça nas
   entradas); o sorteio da semente escolhe entre pontos desenhados, validados
   geometricamente por teste.
5. **IA**: zombieman/sargento buscam cobertura que corta a visada entre tiros
   (raio limitado pelo que dá para andar num cooldown — 100u, não os 400 do
   plano); imp flanqueia com desvio perpendicular do ponto de mira, lado
   estável pela paridade do id; sargento SPOS com constantes CITADAS
   (3 chumbos, cadência 30/26 do POSS, vida 30) agregados num único ataque.
6. **Sargento no visual**: mesmo orc.gltf tingido azul-ardósia (multiplicação
   sobre o atlas + emissive leve), sem segundo download.
7. **Ambiente por sala**: dose multiplicativa de luz (corredores frios e
   escuros, pátio claro e quente) e névoa ×1,9 só no pátio — a névoa
   calibrada na diagonal do galpão encobriria 93% do fundo da sala cujo
   propósito é visada longa.

## Limites conhecidos

- A dificuldade das salas 2 e 3 para jogador ATIVO não tem medição
  automatizada (a janela multi-semente parado só faz sentido na sala 1);
  o veredito é do playtest humano.
- Transição de luz entre salas é instantânea (refinamento futuro).
- A animação da porta anda em tempo REAL de render — sob automação de
  `loop.advance` síncrono ela não progride; no jogo normal, sobe sozinha.
