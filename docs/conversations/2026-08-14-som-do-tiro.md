# 2026-08-14 — Som do tiro

Victor pediu o som de tiro mais proximo do real. Feito sem nenhum arquivo de
audio: o que faltava nao era amostra, era estrutura acustica.

## O que mudou

A versao anterior era um estouro de ruido com envelope simples. Agora cada
disparo tem as quatro camadas que o ouvido usa para reconhecer arma de fogo:

1. **Onda de choque** — grave, forte, com o filtro caindo enquanto expande.
2. **Estalo** — banda alta, curtissimo. E o que faz o tiro parecer perto.
3. **Mecanica** — bomba ou ferrolho, atrasados. Identificam o tipo da arma.
4. **Cauda do ambiente** — convolucao com resposta ao impulso gerada aqui,
   com reflexoes iniciais discretas e agudos morrendo antes dos graves.

A cauda e o item que mais aproxima do real e faltava por inteiro.

Tambem: saturacao suave (arma de perto satura qualquer captacao, e o ouvido
espera isso), variacao entre disparos por leitura aleatoria de um buffer de
ruido pre-gerado, e **tiro inimigo posicionado no estereo**, abafado conforme a
distancia — porque o ar absorve agudo antes de grave, e e essa diferenca de
timbre que o ouvido usa para estimar distancia. O som virou o segundo canal do
aviso de direcao que ja existia na tela.

## A verificacao, que aqui foi o mais interessante

Nao consigo ouvir. Entao "soa real" viraria opiniao — e opiniao sobre som e
ainda mais escorregadia que sobre imagem.

O `Sfx` passou a aceitar um `AudioContext` injetado. Com um
`OfflineAudioContext` da para renderizar um disparo fora do tempo real e medir
o sinal: ataque, cauda, energia por banda, variacao entre disparos.

**Isso pegou tres defeitos que meu ouvido nao pegaria — e um deles era do
proprio aferidor.**

### 1. O aferidor media a coisa errada

A primeira versao procurava a maior AMOSTRA para achar o ataque. Em sinal
ruidoso, o valor instantaneo e aleatorio e o maior deles cai em qualquer ponto
da envoltoria — reportou "ataque em 37 ms" para um envelope que sobe em menos
de um milissegundo. Quase corrigi o que nao estava quebrado.

Passou a medir o **envelope por RMS** em janelas de 1 ms, que e o que
corresponde ao ataque percebido.

### 2. A arena soava mais alto que a arma

Com o envelope correto, o pico do disparo caia em **25 ms** — exatamente a
reflexao de 23 ms da resposta ao impulso. As reflexoes iniciais estavam mais
fortes que o som direto, que e o som de quem esta longe do tiro, nao de quem
atirou. Forcas reduzidas para menos da metade.

### 3. O compressor bombeava

Ainda com pico tardio, em 41 ms: as camadas somadas acionavam o compressor a
cada disparo, que abaixava o transiente e soltava logo depois. Limiar de -9 dB
para -3 dB, taxa menor, e ganhos das camadas reduzidos — o compressor voltou a
ser rede de seguranca em vez de ferramenta de timbre.

### 4. E a consequencia da propria correcao

Reduzir as camadas principais sem reduzir os cliques mecanicos fez o clique da
bomba, em 240 ms, virar o ponto mais alto do som inteiro. Mecanica de arma se
ouve depois do tiro, nunca por cima dele.

## Numeros finais

```
escopeta  ataque 10 ms · brilho inicial 4350 Hz · variacao entre disparos confirmada
rifle     ataque  9 ms · brilho inicial 5125 Hz
```

O ataque ideal seria abaixo de 2 ms. Os 9–10 ms restantes vem da difusao que a
saturacao, o compressor e as primeiras reflexoes introduzem; e o teto desta
cadeia sem partir para amostras gravadas.

## O que continua nao verificado

**Se soa bom.** A estrutura esta medida e correta, e isso e o que dava para
provar. Timbre agradavel e julgamento humano — o veredito e de quem ouve.
