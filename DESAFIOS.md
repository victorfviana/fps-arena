# DESAFIOS — fricções que podem se repetir

Registro do que NÃO tem correção barata agora. O que era corrigível foi corrigido
na hora (regra do CLAUDE.md global). Ler no início de cada sessão.

## CI não exercita o caminho do usuário

`deploy.yml` roda `npm test` + `npm run build` e publica. Pointer lock, clique em
"jogar" e WebGL real não são exercitáveis em headless barato — a classe de bug
que já quebrou o jogo publicado (menu por cima da partida) passaria de novo pelo
CI. Mitigação vigente: verificação N3 manual no navegador ANTES de todo push que
toque em `main.ts`/`menu.ts`/`index.html`, conforme o CLAUDE.md do projeto.
Correção de verdade exigiria Playwright no CI (headed) — custo alto para um
projeto de exercício; reavaliar se o jogo ganhar público.

## Áudio não roda em teste de node

WebAudio não existe em node/jsdom. A verificação do som é
`__fpsArena.medirTiro()` no navegador real (OfflineAudioContext) — manual por
natureza. Se a cadeia de áudio mudar, medir de novo; a suíte não cobre.

## Framerate real e governador de qualidade sob automação

Aba automatizada fica oculta → `requestAnimationFrame` não roda → FPS real e a
reação do governador nunca foram medidos de verdade. A lógica do governador é
testada como função pura (`tests/qualidade.test.ts`), mas o comportamento na
máquina do jogador é não verificado — declarado, não escondido.

## Ambiente Windows + WSL

- `wsl.exe -e bash -c '...'` NÃO carrega o nvm (shell não interativo): o `npx`
  que resolve é o do Windows herdado pelo PATH, e o erro parece outra coisa
  ("CMD.EXE... caminhos UNC"). Prefixo obrigatório:
  `[ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh"; ...`
- Ler/editar arquivos direto pelo UNC `\\wsl.localhost\Ubuntu\...`; o shell só
  para executar.
