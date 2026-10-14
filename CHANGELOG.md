# Histórico de versões — PreventBase

Formato `AA.MM.DD.N`: data do commit + sequência daquele dia. Gerado a partir dos commits por
`C:\ROBBY\scripts\versioning\release.mjs` — não editar à mão (ajuste a mensagem do commit).

## 26.10.14.1 — 2026-10-14

### Novidades

- **ui:** transições mais fluidas ([8861ec4](https://github.com/leodalaqua/PREVENTBASE/commit/8861ec4805fcdb0c63c98a54c3fd922dbf81876d))

## 26.10.13.2 — 2026-10-13

### Novidades

- **frontend:** formulários compactos em grade e Salvar fixo no rodapé ([738b133](https://github.com/leodalaqua/PREVENTBASE/commit/738b1339d52916be3a54e9b63943ccd94c2910f7))

## 26.10.13.1 — 2026-10-13

### Novidades

- **web:** login pela central e menus pelas permissões do /me ([3d5585c](https://github.com/leodalaqua/PREVENTBASE/commit/3d5585cb7ec1027ca052ed2afefbb709550d5984))
- **auth:** acesso só pela central Veritech (permissões da sessão, conta local via /sso/password) ([bd00f11](https://github.com/leodalaqua/PREVENTBASE/commit/bd00f11bd4d24a3274c5642dec436c8303aeccf6))

### Documentação

- **identidade:** acesso pela central Veritech ([b41fbbb](https://github.com/leodalaqua/PREVENTBASE/commit/b41fbbb1433afdb756beba1b758f89a6d681674b))

## 26.10.12.5 — 2026-10-12

### Desempenho

- **docker:** healthchecks a cada 30s para aliviar a CPU do servidor ([0e7b6c6](https://github.com/leodalaqua/PREVENTBASE/commit/0e7b6c6b5cb21ec639a55c016985b39e326e250c))

## 26.10.12.4 — 2026-10-12

### Novidades

- **admin:** liberar acesso escolhendo perfis e empresa ([d1eb277](https://github.com/leodalaqua/PREVENTBASE/commit/d1eb277493e90b1d659a4d96292c208344c627d0))

## 26.10.12.3 — 2026-10-12

### Novidades

- **identidade:** login único cria acesso pendente e aceita 2FA da central ([dcffe40](https://github.com/leodalaqua/PREVENTBASE/commit/dcffe405f5bee9c20afecf249f0f99050f526741))

## 26.10.12.2 — 2026-10-12

### Novidades

- **passkey:** botão principal da biometria com a cor da marca ([31159f8](https://github.com/leodalaqua/PREVENTBASE/commit/31159f8d122966a44b7e641a3c4dadd2946753d3))

## 26.10.12.1 — 2026-10-12

### Novidades

- **web:** telas de entrega, biometria e listas mais legíveis em campo ([c9a5bbd](https://github.com/leodalaqua/PREVENTBASE/commit/c9a5bbd8ed79edb849bd0c95baa664f65fd18e78))
- **web:** base de UI com ícones SVG, foco visível e alvos de toque ([59da36a](https://github.com/leodalaqua/PREVENTBASE/commit/59da36a3e99ecd21335a58ce576cad914eeb1bcd))

## 26.10.11.1 — 2026-10-11

### Novidades

- **auth:** login único Veritech ([06df334](https://github.com/leodalaqua/PREVENTBASE/commit/06df334cd26b515b42fa4959006f33f980cfa2c1))

### Manutenção

- **cursor:** regras pt-BR, grafo de código (MCP) e IA só gratuita ([766b226](https://github.com/leodalaqua/PREVENTBASE/commit/766b226573a8e6d0077ca28c5f429d5b22fcd143))

## 26.10.09.2 — 2026-10-09

### Novidades

- **web:** PWA com marca PreventBase (icones, offline, atalhos) e telas responsivas ([31b3ebd](https://github.com/leodalaqua/PREVENTBASE/commit/31b3ebd8893eac6f3186083dd36162fb8107ebb9))

### Documentação

- **modulos:** documentacao por modulo da fase 1 (EPI no ar) e SUMMARY atualizado ([b7e88c3](https://github.com/leodalaqua/PREVENTBASE/commit/b7e88c3fc4693b8f0fd60cbbbc3785f33bdb5e74))

## 26.10.09.1 — 2026-10-09

### Novidades

- **identidade:** login por biometria (passkey/WebAuthn) com access+refresh e sem TOTP ([9c77af4](https://github.com/leodalaqua/PREVENTBASE/commit/9c77af4c57c86066ee7b325bbfe922653a1af0f0))

### Correções

- **auth:** passkey no iPhone/portal com options pré-buscadas (kit Robby) ([e33e6e1](https://github.com/leodalaqua/PREVENTBASE/commit/e33e6e1ec8e766ca01651f4a6d1edf53ed3bb6ed))

### Documentação

- **regras:** publicar com versionamento AA.MM.DD.N (release.mjs do Robby) ([ed5c27b](https://github.com/leodalaqua/PREVENTBASE/commit/ed5c27b72ed70e626287c3a276bc6bc24de89701))

## 26.10.08.1 — 2026-10-08

### Correções

- **caepi:** sincronizacao em streaming, validacao do ZIP e formato atual do MTE ([94b1039](https://github.com/leodalaqua/PREVENTBASE/commit/94b103902d46599dee2a704914b780963c9a32c4))

## 26.10.07.1 — 2026-10-07

### Manutenção

- commit inicial do repositorio ([0551f95](https://github.com/leodalaqua/PREVENTBASE/commit/0551f954a506c34afc004e07b24ac60fbe04f7dc))
