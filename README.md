# Lumina Bulk — Extensão Chrome de Coleta & Exportação de Fotos em Massa

Extensão ultra-leve e rápida (Manifest V3) projetada para **coletar e exportar fotos em massa em resolução máxima de qualquer site** em **1 único arquivo `.ZIP`** (ou pasta organizada em `Downloads/LuminaExport/`) — pronta para jogar em lote na sua ferramenta ou API de IA favorita!

---

## Recursos

- **Cesta Multi-Sites Persistente**: colete fotos navegando por quantas páginas e abas quiser (o ícone da extensão mostra o contador ao vivo) e exporte tudo de uma só vez em 1 arquivo `.ZIP` (6 downloads paralelos, sem spam de popups do Chrome).
- **Coletor Multi-Clique (`Alt+Shift+P`)**: atravessa camadas transparentes de proteção (Instagram, Pinterest), **Shadow DOM** (Reddit, YouTube), fundos CSS (`background-image` / `image-set()`), `<canvas>` e `<video>`. Fica ativo enquanto você clica em quantas fotos quiser (`ESC` para sair).
- **Auto-Scroll para Páginas Infinitas**: rola automaticamente galerias com *lazy-loading* (Pinterest, Instagram, Google Imagens, ArtStation, Unsplash) capturando todas as fotos conforme carregam.
- **Upgrade Automático para Resolução Original (CDNs)**: busca automaticamente a versão em alta resolução original em X/Twitter, Pinterest, Amazon, Shopify, WordPress, Wikimedia, Unsplash, YouTube, Google Photos e Medium + **bypass de proteção Hotlink/Referer**.
- **Filtros Inteligentes no Painel (`Alt+Shift+S`)**: filtre por resolução mínima (`≥48px`, `≥150px`, `≥400px`, `≥800px`), orientação (Paisagem / Retrato / Quadrada) e tipo (`IMG`, `Fundo CSS`, `Canvas`).
- **Botão Flutuante + Pausar por Site**: passe o mouse em qualquer foto para clicar em `➕ Cesta` ou `⬇`, e pause em sites específicos com 1 clique no Popup.

---

## Como Atualizar / Carregar no Chrome

1. Abra `chrome://extensions/`
2. Clique em **↻ (Recarregar)** no cartão da **Lumina** (ou carregue a pasta `/Users/barbaracohen/google-extension/dist` via *Carregar sem compactação*).
3. Atualize as abas abertas (`Cmd+R` / `F5`).
