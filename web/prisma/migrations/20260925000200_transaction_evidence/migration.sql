-- CreateEnum
CREATE TYPE "RuleAction" AS ENUM ('PARSE', 'IGNORE');

-- CreateEnum
CREATE TYPE "ProcessingState" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "TransactionState" AS ENUM ('CONFIRMED', 'REVIEW', 'MERGED');

-- CreateEnum
CREATE TYPE "TimePrecision" AS ENUM ('SECOND', 'MINUTE', 'DAY', 'RECEIVED');

-- DropIndex
DROP INDEX "Card_memberId_issuer_last4_key";

-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "validFrom" TIMESTAMP(3),
ADD COLUMN     "validTo" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CardAlias" ADD COLUMN     "validFrom" TIMESTAMP(3),
ADD COLUMN     "validTo" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RawMessage" ADD COLUMN     "ownerMemberId" TEXT,
ADD COLUMN     "parseReason" TEXT,
ADD COLUMN     "parsedFields" JSONB,
ADD COLUMN     "parserVersion" INTEGER,
ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "statementImportId" TEXT,
ALTER COLUMN "deviceId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ParserRule" ADD COLUMN     "action" "RuleAction" NOT NULL DEFAULT 'PARSE',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "approvalReference" TEXT,
ADD COLUMN     "cardToken" TEXT,
ADD COLUMN     "foreignScale" INTEGER,
ADD COLUMN     "issuer" TEXT,
ADD COLUMN     "mergedIntoId" TEXT,
ADD COLUMN     "originalApprovedAt" TIMESTAMP(3),
ADD COLUMN     "reviewReason" TEXT,
ADD COLUMN     "state" "TransactionState" NOT NULL DEFAULT 'CONFIRMED',
ADD COLUMN     "timePrecision" "TimePrecision" NOT NULL DEFAULT 'MINUTE',
ALTER COLUMN "amount" DROP NOT NULL;

-- CreateTable
CREATE TABLE "TransactionEvidence" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "rawMessageId" TEXT NOT NULL,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParserRuleRevision" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "configuration" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParserRuleRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingJob" (
    "rawMessageId" TEXT NOT NULL,
    "state" "ProcessingState" NOT NULL DEFAULT 'PENDING',
    "generation" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("rawMessageId")
);

-- CreateTable
CREATE TABLE "ReviewDecision" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "actorMemberId" TEXT,
    "action" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatementImport" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "originalFile" BYTEA NOT NULL,
    "mapping" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransactionEvidence_rawMessageId_key" ON "TransactionEvidence"("rawMessageId");

-- CreateIndex
CREATE INDEX "TransactionEvidence_transactionId_idx" ON "TransactionEvidence"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ParserRuleRevision_ruleId_version_key" ON "ParserRuleRevision"("ruleId", "version");

-- CreateIndex
CREATE INDEX "ProcessingJob_state_nextAttemptAt_idx" ON "ProcessingJob"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ReviewDecision_memberId_createdAt_idx" ON "ReviewDecision"("memberId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StatementImport_memberId_fileHash_key" ON "StatementImport"("memberId", "fileHash");

-- CreateIndex
CREATE INDEX "Card_memberId_issuer_last4_idx" ON "Card"("memberId", "issuer", "last4");

-- CreateIndex
CREATE INDEX "RawMessage_ownerMemberId_createdAt_idx" ON "RawMessage"("ownerMemberId", "createdAt");

-- AddForeignKey
ALTER TABLE "RawMessage" ADD CONSTRAINT "RawMessage_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "FamilyMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMessage" ADD CONSTRAINT "RawMessage_statementImportId_fkey" FOREIGN KEY ("statementImportId") REFERENCES "StatementImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionEvidence" ADD CONSTRAINT "TransactionEvidence_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionEvidence" ADD CONSTRAINT "TransactionEvidence_rawMessageId_fkey" FOREIGN KEY ("rawMessageId") REFERENCES "RawMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParserRuleRevision" ADD CONSTRAINT "ParserRuleRevision_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ParserRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_rawMessageId_fkey" FOREIGN KEY ("rawMessageId") REFERENCES "RawMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "FamilyMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve existing representatives as explicit evidence; no original rows are removed.
INSERT INTO "TransactionEvidence" ("id", "transactionId", "rawMessageId", "isManual")
SELECT 'legacy-' || md5("id"), "id", "rawMessageId", "isManuallyEdited" FROM "Transaction";

INSERT INTO "ParserRuleRevision" ("id", "ruleId", "version", "configuration")
SELECT 'legacy-' || md5("id"), "id", "version", to_jsonb(r) FROM "ParserRule" r;

INSERT INTO "ProcessingJob" ("rawMessageId", "state", "createdAt", "updatedAt")
SELECT "id", CASE WHEN "parseStatus" IN ('PARSED', 'IGNORED') THEN 'DONE'::"ProcessingState"
  ELSE 'PENDING'::"ProcessingState" END, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "RawMessage";

ALTER TABLE "RawMessage" ADD CONSTRAINT "RawMessage_has_owner"
  CHECK ("deviceId" IS NOT NULL OR "ownerMemberId" IS NOT NULL);
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_amount_bounds"
  CHECK (("amount" IS NULL AND "canceledAmount" = 0) OR
    ("amount" >= 0 AND "canceledAmount" >= 0 AND "canceledAmount" <= "amount"));
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_foreign_scale_bounds"
  CHECK ("foreignScale" IS NULL OR "foreignScale" BETWEEN 0 AND 6);
ALTER TABLE "Card" ADD CONSTRAINT "Card_valid_interval"
  CHECK ("validFrom" IS NULL OR "validTo" IS NULL OR "validFrom" < "validTo");
ALTER TABLE "CardAlias" ADD CONSTRAINT "CardAlias_valid_interval"
  CHECK ("validFrom" IS NULL OR "validTo" IS NULL OR "validFrom" < "validTo");
