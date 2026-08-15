# ADR 0004 — Áudio gravado, só para os tiros, em cadeia híbrida

Data: 2026-08-14
Status: aceito

## Contexto

A síntese chegou ao teto medível (ataque 0 ms, quatro camadas, convolução) e
o ouvido do Victor ainda não comprou o tiro. O gatilho documentado na fase de
som ("amostra só se a síntese não convencer ao ouvir") disparou.

## Decisão

1. Entram DOIS arquivos: `public/sounds/shotgun.wav` e `rifle.wav`, do pack
   "Chaingun, pistol, rifle, shotgun shots" de Michel Baradari
   (opengameart.org), **CC-BY 3.0** — a regra do projeto passa a aceitar
   CC-BY além de CC0, com a atribuição cumprida pelo CREDITS.md e pelo
   rodapé do menu do jogo. WAV 44,1 kHz sem conversão: 550 KB os dois,
   `decodeAudioData` lê nativo, e conversor é um passo de pipeline a mais
   sem ganho.
2. **Cadeia híbrida, não amostra crua**: a gravação vira o CORPO do som e
   passa pela acústica existente (saturação, compressor, reverb por
   convolução da arena, abafamento por distância e pan do tiro inimigo).
   A borda seca de ataque (<2 ms) e o grave sintético continuam por cima.
   Amostra tocada crua soa colada na tela; passando pela sala, senta nela.
3. Variação entre disparos por jitter de playbackRate — uma gravação só por
   arma, sem inflar o repositório.
4. **Fallback integral**: fetch falhou → cadeia sintética de antes, intacta.
5. Passos, dor, morte e interface continuam sintéticos — só o tiro tinha
   veto do ouvido.

## Consequências

- +550 KB no primeiro load, atrás do mesmo portão de carregamento dos
  modelos.
- `medirTiro` continua sendo o instrumento: a amostra entra na renderização
  offline pelos mesmos bytes (cache de ArrayBuffer decodificado por
  contexto).
