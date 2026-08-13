import { defineConfig } from 'vite'

// base: '' gera caminhos relativos, para o build funcionar tanto na raiz
// quanto num subdiretorio do GitHub Pages sem reconfiguracao.
export default defineConfig({
  base: '',
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
})
