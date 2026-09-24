-- Additive: old clients continue to ingest; RawMessage is untouched.
ALTER TABLE "Device" ADD COLUMN "statusReportedAt" TIMESTAMP(3), ADD COLUMN "statusSnapshot" JSONB;
