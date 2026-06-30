# LOKXMaxing

PWA experimental para mapeamento facial local, relatório estético bilíngue e
comparação consentida de fotos. O projeto usa MediaPipe Face Landmarker no
navegador e não envia os frames faciais para um servidor de análise.

> **Estado:** protótipo experimental. PSL, tiers e termos de looksmaxxing são
> taxonomias informais de comunidades online, não medições científicas de
> beleza, diagnósticos médicos ou avaliações de valor pessoal.

## Recursos

- captura guiada com 478 landmarks e controle de qualidade;
- upload local de JPG, PNG ou WEBP;
- modos de análise masculino, feminino e neutro/editorial;
- relatório com PSL-inspired score, tier, traits bilíngues e auditoria de penalidades;
- painel para webcams físicas e virtuais, incluindo fontes como Iriun;
- comparação versus com consentimento;
- exportação do relatório para PDF pelo diálogo nativo do navegador;
- manifesto, service worker, ícones e modo standalone de PWA;
- processamento local com ciclo de vida biométrico de uso único.

## Executar localmente

### Windows

Clique duas vezes em `ABRIR SITE.bat` ou execute:

```powershell
powershell -ExecutionPolicy Bypass -File .\iniciar-site.ps1
```

### Qualquer sistema com Python

```bash
python -m http.server 8080
```

Depois abra `http://localhost:8080`.

## HTTPS e instalação no celular

`localhost` é considerado contexto seguro no próprio computador. Em outro
dispositivo, câmera, service worker e instalação PWA exigem uma origem HTTPS
válida. Um endereço LAN como `http://192.168.x.x:8080` serve para visualizar o
layout, mas não garante acesso à câmera no celular.

## Privacidade

- câmera e upload dependem de consentimento explícito;
- frames e fotos não são enviados para uma API de análise;
- fotos, frames e landmarks não são gravados em `localStorage`, IndexedDB ou Cache API;
- preferências de câmera, espelhamento e modo podem ser salvas no `localStorage`;
- o resumo derivado usa uma transferência de navegação com validade máxima de 60 segundos,
  é removido do `sessionStorage` antes da renderização e permanece somente na memória;
- ao sair do relatório, após 15 minutos ou após 5 minutos em segundo plano, a interface
  e as referências em memória são descartadas;
- o service worker armazena somente a interface, imagens estáticas e modelos locais;
- sexo, gênero, personalidade, saúde e ancestralidade não são inferidos;
- arquivos enviados por usuários, capturas e relatórios estão no `.gitignore`.

O PDF só existe se o usuário o salvar pelo diálogo do navegador; a partir daí ele fica
sob controle do sistema operacional. Extensões maliciosas, DevTools ou um dispositivo já
comprometido ainda podem ler a memória da página enquanto a análise está aberta.

Consulte também [`privacidade.html`](privacidade.html) e [`cookies.html`](cookies.html).

## Metodologia e limites

O motor separa heurísticas de fórum, antropometria aproximada e observações de
pesquisa. Medidas 2D variam com lente, distância, pose, expressão e iluminação.
Sinais de pele e contraste são proxies visuais de baixa confiança e não medem
saúde. Projeção do queixo, estrutura óssea, deep-set eyes e hunter eyes são
rotulados como proxies quando uma imagem frontal não sustenta uma conclusão.

As configurações dos três modos estão documentadas em
[`knowledge/psl_model.json`](knowledge/psl_model.json), e as fontes catalogadas
ficam em [`knowledge/sources.json`](knowledge/sources.json).

## Estrutura

```text
index.html                 tela inicial, consentimento e scanner
scanner.js                 câmera, upload e captura guiada
analysis-engine.js         métricas, modos, PSL-inspired e penalidades
resultado.html/js/css      relatório, versus e PDF
cameras.html/js/css        painel multicâmera
knowledge/                 fontes e modelos de conhecimento
assets/mediapipe/          runtime e modelo executados localmente
manifest.webmanifest       configuração PWA
sw.js                      cache offline
```

## Desenvolvimento seguro

Nunca faça commit de fotos faciais, relatórios reais, arquivos `.env`, tokens,
certificados ou credenciais. Antes de contribuir, revise o staged diff e rode
uma ferramenta de secret scanning quando disponível.

O arquivo `_headers` aplica CSP, bloqueio de frames, política de permissões e `no-store`
em plataformas compatíveis (como Netlify e Cloudflare Pages). GitHub Pages não interpreta
esse arquivo; por isso as páginas também incluem CSP e política de referrer no próprio HTML.

## Licença

O código original está disponível sob a [licença MIT](LICENSE). Dependências e
artefatos de terceiros mantêm suas próprias licenças; veja
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

As colagens visuais em `assets/*-collage.webp` não recebem automaticamente a
licença MIT: reutilize-as somente se você possuir os direitos necessários sobre
os materiais que as compõem.
