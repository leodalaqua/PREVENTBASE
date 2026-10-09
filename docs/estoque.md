# Estoque, lotes e inventário

## Responsabilidade

Almoxarifados/locais, lotes, saldo por lote e local, movimentos, FEFO, transferências, ajustes, níveis mín./máx. e inventário cego (§14-§16, §27-§28).

## Regras

- Todo saldo muda só por `StockService.move` (movimento imutável + `stock_balances`); saldo negativo recusado (422) e protegido por `CHECK` no banco.
- FEFO: lote com validade mais próxima, não vencido, com CA válido na compra e saldo (`GET /stock/fefo`).
- Entrada é idempotente pelo header `Idempotency-Key` (mesma chave → mesmo movimento).
- Inventário: criar → iniciar (congela itens) → contagem cega (1 ou 2 rodadas) → enviar → aprovar (gera ajustes) → fechar. Cancelar exige `inventory.approve` + motivo.
- Alertas do worker (de hora em hora): `LOW_STOCK`, `LOT_EXPIRING`/`LOT_EXPIRED` (`lotExpiryAlertDays`, padrão 60), `CA_*`; `STOCK_DRIFT` na reconciliação diária saldo × soma de movimentos.

## API

`/stock/warehouses` · `/stock/entries` · `/stock/lots` · `/stock/balances` · `/stock/fefo` · `/stock/movements` · `/stock/transfers` · `/stock/adjustments` · `/stock/levels` · `/stock/alerts` · `/inventory-counts/*`.

## Arquivos

`apps/api/src/modules/inventory/` · web `(app)/estoque/`, `(app)/estoque/inventarios/`.
