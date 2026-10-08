-- Integridade no banco (MASTER-PLAN §14, §52, §79): reforça no Postgres o que a API já garante.

ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_quantity_nonnegative" CHECK ("quantity" >= 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_nonzero" CHECK ("quantity" <> 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_balance_nonnegative" CHECK ("balanceAfter" >= 0);
ALTER TABLE "epi_delivery_items" ADD CONSTRAINT "epi_delivery_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "epi_returns" ADD CONSTRAINT "epi_returns_quantity_positive" CHECK ("quantity" > 0);

CREATE OR REPLACE FUNCTION pb_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PreventBase: % em % é proibido (registro imutável)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION pb_forbid_mutation();
CREATE TRIGGER epi_delivery_items_immutable BEFORE UPDATE OR DELETE ON "epi_delivery_items"
  FOR EACH ROW EXECUTE FUNCTION pb_forbid_mutation();
CREATE TRIGGER delivery_evidence_immutable BEFORE UPDATE OR DELETE ON "delivery_evidence"
  FOR EACH ROW EXECUTE FUNCTION pb_forbid_mutation();
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION pb_forbid_mutation();
CREATE TRIGGER ca_history_immutable BEFORE UPDATE OR DELETE ON "ca_history"
  FOR EACH ROW EXECUTE FUNCTION pb_forbid_mutation();
CREATE TRIGGER document_versions_immutable BEFORE UPDATE OR DELETE ON "document_versions"
  FOR EACH ROW EXECUTE FUNCTION pb_forbid_mutation();
CREATE TRIGGER employee_history_immutable BEFORE UPDATE OR DELETE ON "employee_history"
  FOR EACH ROW EXECUTE FUNCTION pb_forbid_mutation();
CREATE TRIGGER epi_return_steps_immutable BEFORE UPDATE OR DELETE ON "epi_return_steps"
  FOR EACH ROW EXECUTE FUNCTION pb_forbid_mutation();

CREATE TRIGGER epi_deliveries_no_delete BEFORE DELETE ON "epi_deliveries"
  FOR EACH ROW EXECUTE FUNCTION pb_forbid_mutation();
CREATE TRIGGER epi_returns_no_delete BEFORE DELETE ON "epi_returns"
  FOR EACH ROW EXECUTE FUNCTION pb_forbid_mutation();
CREATE TRIGGER documents_no_delete BEFORE DELETE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION pb_forbid_mutation();
CREATE TRIGGER biometric_profiles_no_delete BEFORE DELETE ON "biometric_profiles"
  FOR EACH ROW EXECUTE FUNCTION pb_forbid_mutation();
CREATE TRIGGER biometric_verifications_no_delete BEFORE DELETE ON "biometric_verifications"
  FOR EACH ROW EXECUTE FUNCTION pb_forbid_mutation();
CREATE TRIGGER stock_lots_no_delete BEFORE DELETE ON "stock_lots"
  FOR EACH ROW EXECUTE FUNCTION pb_forbid_mutation();

-- Entrega: única alteração permitida é ACTIVE -> CANCELLED preenchendo os campos de cancelamento.
CREATE OR REPLACE FUNCTION pb_delivery_update_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'ACTIVE' OR NEW."status" <> 'CANCELLED'
     OR NEW."cancelledAt" IS NULL OR NEW."cancelledById" IS NULL OR coalesce(NEW."cancellationReason", '') = ''
     OR (to_jsonb(NEW) - 'status' - 'cancelledAt' - 'cancelledById' - 'cancellationReason')
        IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'cancelledAt' - 'cancelledById' - 'cancellationReason') THEN
    RAISE EXCEPTION 'PreventBase: entrega de EPI é imutável (somente cancelamento é permitido)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER epi_deliveries_update_guard BEFORE UPDATE ON "epi_deliveries"
  FOR EACH ROW EXECUTE FUNCTION pb_delivery_update_guard();

-- Verificação biométrica: só pode ser consumida uma vez (anti-replay, §80).
CREATE OR REPLACE FUNCTION pb_biometric_verification_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."consumedAt" IS NOT NULL
     OR (to_jsonb(NEW) - 'consumedAt' - 'consumedByDeliveryId')
        IS DISTINCT FROM (to_jsonb(OLD) - 'consumedAt' - 'consumedByDeliveryId') THEN
    RAISE EXCEPTION 'PreventBase: verificação biométrica é imutável e de uso único'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER biometric_verifications_update_guard BEFORE UPDATE ON "biometric_verifications"
  FOR EACH ROW EXECUTE FUNCTION pb_biometric_verification_guard();
