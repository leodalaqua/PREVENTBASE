-- Login único Veritech: sessão central associada à sessão local
ALTER TABLE "sessions" ADD COLUMN "ssoSid" TEXT;
