# Security policy

## Dados que não devem entrar no repositório

- fotos, vídeos ou landmarks identificáveis de pessoas reais;
- relatórios exportados de usuários;
- tokens, senhas, cookies de sessão e arquivos `.env`;
- chaves privadas, certificados e credenciais de deploy;
- dumps de `localStorage`, `sessionStorage` ou logs do navegador.

O `.gitignore` cobre os caminhos locais mais comuns, mas cada contribuição deve
revisar manualmente o conteúdo staged antes do commit.

## Ciclo de vida biométrico

- fotos e frames são decodificados em memória e descartados depois da análise;
- landmarks brutos não são expostos em variáveis globais nem gravados no navegador;
- o resumo derivado cruza somente uma navegação, expira em 60 segundos e é consumido
  antes de o relatório ser renderizado;
- o relatório é removido da memória ao sair, após 15 minutos ou após 5 minutos oculto;
- o cache offline aceita somente o shell estático e arquivos sob `assets/`;
- rotas de uploads, capturas, gravações, relatórios e exportações nunca entram no cache.

JavaScript não garante apagamento físico de RAM ou do armazenamento interno do navegador.
Estas medidas reduzem retenção acidental; não protegem contra malware, extensões invasivas,
DevTools abertos ou um sistema operacional comprometido. PDFs salvos pelo usuário também
ficam fora do ciclo de exclusão do site.

## Reportar uma vulnerabilidade

Use o recurso **Security > Report a vulnerability** do GitHub quando estiver
disponível. Não publique credenciais, biometria ou provas de conceito sensíveis
em uma issue pública.
