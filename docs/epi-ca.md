# EPI e CA/CAEPI

## Responsabilidade

Catálogo de EPI com variações (tamanho/cor/EAN), orientações de uso, periodicidade de troca e vínculo com CA (§17-§19).

## Regras

- Produto tem histórico de CA (`EpiProductCa`); trocar o CA não altera lotes antigos — o lote guarda o CA da compra.
- **CA válido na compra ≠ CA válido hoje (§19):** na entrada o lote grava `caValidityAtPurchase`/`caValidAtPurchase`. Lote comprado com CA vencido fica bloqueado para entrega; CA vencido hoje mas válido na compra gera só aviso.
- CA desconhecido na base local: entrada aceita com aviso; validade na compra pode ser informada manualmente.
- `GET /scan/:code` resolve EAN da variação ou código público do lote (`L` + 12 hex).

## CAEPI

`packages/caepi` faz parse/upsert idempotente (`rowHash`) da base oficial do MTE em `ca_master` + `ca_history`. Disparo: `POST /ca/sync` (URL), `POST /ca/import` (arquivo) ou job diário `caepi-sync` (04:15, só com `CAEPI_SOURCE_URL`). Consulta: `GET /ca/:number`, `GET /ca/syncs`.

- Formato real (`tgg_export_caepi.txt`, ~80 MB UTF-8 em ZIP de ~8 MB): `|` como separador, campos entre aspas podem conter `|`, cabeçalho `NR Registro CA|DATA DE VALIDADE|…` (aliases em `HEADER_ALIASES`). Vários laudos do mesmo CA = várias linhas, agregadas.
- Leitura em streaming (ZIP verificado por índice central + tamanho + CRC32); nada é gravado antes do arquivo inteiro ser validado. Aborta (`CaepiFileError`, base anterior mantida) se >1% de linhas malformadas ou se a base nova tiver <50% dos CAs já conhecidos.
- Download com 3 tentativas. O FTP do MTE às vezes publica ZIP truncado/corrompido: a sincronização falha limpa e tenta de novo no próximo agendamento.
- Uma sincronização por vez (`CaepiBusyError` → 409). `RUNNING` sem conclusão em 30 min vira `FAILED`; no boot o worker marca as de URL interrompidas.
- Memória: campos são copiados (`detach`) para não reter o bloco lido; base completa ≈ 40 MB de heap.

## Arquivos

`apps/api/src/modules/epi/` · `packages/caepi/` · web `(app)/epis/`, `(app)/ca/`.
