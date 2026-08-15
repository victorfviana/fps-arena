# 2026-08-14 — Tiro gravado: cadeia híbrida, e o aferidor que media a si mesmo

Victor: "quero o som do tiro mais realista". A síntese tinha batido no teto
medível; o gatilho documentado (amostra só se o ouvido não comprar) disparou.

## O que entrou

- `public/sounds/shotgun.wav` e `rifle.wav` — pack do Michel Baradari
  (opengameart.org), **CC-BY 3.0**. A regra do projeto passou a aceitar CC-BY
  além de CC0; a atribuição vive no CREDITS.md e no rodapé do menu (ADR 0004).
- Cadeia HÍBRIDA (`samples.ts` novo + `sfx.ts`): a gravação é o corpo; a
  borda seca (<2 ms), o grave de pressão, a mecânica e a cauda de convolução
  continuam por cima. Jitter de playbackRate entre disparos. Tiro inimigo usa
  a mesma gravação com o abafamento por distância e pan existentes. Fallback
  integral: sem rede, o sintético de antes.

## A caçada que valeu a sessão: quatro suspeitos até o verdadeiro

A primeira medição deu pico de envelope em 228 ms — som de tiro atrasado.

1. **Suspeita: silêncio de entrada nos WAV.** Implementei recorte por limiar.
   Falso: o arquivo começa alto no 0 ms (medido em python). O recorte ficou
   (não faz mal), mas não era isso.
2. **Suspeita: sala em dobro** (a gravação já tem a própria cauda e eu
   mandava 0,5 dela para a convolução da arena). Reduzi o envio — o pico
   tardio nem se mexeu. Também não era (o envio menor ficou: soa certo).
3. **Suspeita: o `tanh` normalizado**, que levanta o trecho quieto ~2× e
   achata a dinâmica. Meio-verdadeiro: tirei o corpo gravado da saturação
   (mesmo precedente do `tom()` — captação de arma já satura na origem) e
   estreitei o knee do compressor de 10 para 4 dB. Melhorou o timbre, mas o
   pico continuou em ~216 ms.
4. **O verdadeiro: o instrumento.** A/B no console — a mesma amostra pela
   mesma cadeia, com e sem compressor: primeira janela 0,181 sem, **0,008**
   com. O `DynamicsCompressor` parte de estado FRIO num contexto recém-criado
   e engole o início numa rampa de centenas de ms. No jogo real ele está
   quente há minutos; só o aferidor criava um novo e atirava no t=0. Todas as
   medições de "228 ms" mediam o artefato do próprio aferidor.

Conserto no instrumento: o disparo medido sai em t=0,4 s via
`OfflineAudioContext.suspend/resume`, e a análise corta os primeiros 400 ms.

## Números finais (navegador real)

```
escopeta  subida 0,018→0,23 em 8 ms · pico 0,35 aos 30 ms (crista da própria gravação)
rifle     pico 0,30 aos 28 ms · cauda 2,6 s · variação entre disparos confirmada
207 testes · tsc limpo
```

A lição repete a da fundação: **os defeitos mais caros estavam no instrumento
de medição** — e um aferidor que reprova som bom é tão perigoso quanto um que
aprova som ruim.

## Não verificado

Se soa bom — como sempre, veredito de quem ouve. As alavancas de calibração
estão nomeadas no topo de `sfx.ts` (`GANHO_CORPO_AMOSTRA_*`,
`REVERB_CORPO_AMOSTRA_*`).
