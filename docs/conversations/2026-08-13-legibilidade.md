# 2026-08-13 — Legibilidade de combate

Victor jogou e relatou tres coisas: graficos toscos, nao saber por que o jogo
acaba, e ser atingido por algo enquanto os alvos pareciam estaticos.

As duas ultimas eram a mesma falha, e eu a tinha classificado como a dimensao
menos importante da rubrica — peso 10%, nota 4.

## Os defeitos

**Inimigo virava estatua.** `advance()` retornava cedo quando a distancia ja
era a preferida, entao o zumbi parava a 400 unidades e nunca mais se mexia. A
combinacao era a pior possivel: parecia alvo de estande e matava de longe.

**Ataque inimigo era invisivel.** O golpe so produzia `damageTaken`. Nao havia
rastro, origem, nem som posicionado — chegava um clarao vermelho uniforme na
borda da tela e a vida caia. Eu tinha construido rastro visivel para o tiro do
jogador e esquecido inteiramente do tiro que vem nele. A assimetria que eu
mesmo evitei na logica dos inimigos (linha de visao simetrica) foi cometida na
camada de desenho.

**A morte nao se explicava.** A tela de fim dizia onda e pontos, nada sobre a
causa.

## Correcoes

- Inimigo circula o jogador ao chegar na distancia de tiro, trocando de lado a
  cada 25–70 tics, com correcao suave de raio.
- `EnemyShot` carrega origem, tipo, dano e se foi corpo a corpo. Desenhado em
  vermelho, com meia-vida de 260 ms — bem maior que a do disparo do jogador,
  porque quem levou o tiro precisa de tempo para virar a cabeca e achar a
  origem.
- Marcador em arco que gira ate a direcao real do golpe, em torno do centro da
  tela. Aponta para o golpe mais forte do tic; varios avisos competindo pela
  mesma borda nao informariam nada.
- Tela de fim descreve a morte: tipo do inimigo, de perto ou de longe, e a que
  distancia.

## Verificacao

`tests/legibilidade.test.ts`, 10 testes. Suite completa em 173.

Um deles falhou por defeito do proprio teste: eu recriava o gerador aleatorio
com a mesma semente a cada tic, entao todo sorteio devolvia o mesmo valor e o
inimigo escolhia eternamente o mesmo lado. O teste acusava uma imobilidade que
so existia nele. No jogo o gerador e unico e persistente.

Conferido no publicado, com medicao no DOM: marcador concentrico ao centro da
tela (960, 456 contra 960, 455.5), tiro inimigo com origem coincidindo com a
posicao do atirador, e a frase de morte saindo correta — "Um zumbi atirou de
longe, a 400 passos."

## O que fica para o metodo

Peso de legibilidade subiu de 10% para 25%. A licao e que **as dimensoes que
descrevem se o jogador entende o que esta acontecendo valem mais que as
dimensoes finas de fidelidade**. Um erro de 1% na velocidade de corrida nao
custa nada a quem joga; nao saber de onde veio o tiro custa a partida inteira.

## Nao resolvido

Graficos. Segue geometria simples com boa iluminacao, por escolha declarada
desde o plano: nao gero arte, e sprite mal feito afunda um FPS. Melhorar sem
arte externa e possivel — sombras projetadas, luzes espalhadas, animacao de
caminhada, particulas — mas tira do tosco para o geometrico limpo, nao vira
jogo bonito.
