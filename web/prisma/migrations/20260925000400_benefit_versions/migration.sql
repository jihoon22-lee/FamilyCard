-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "benefitOverride" TEXT,
ADD COLUMN     "categoryManual" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CardBenefitRule" ADD COLUMN     "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "effectiveTo" TIMESTAMP(3),
ADD COLUMN     "sourceUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "benefitCode" TEXT;

-- AlterTable
ALTER TABLE "MerchantRule" ADD COLUMN     "matchType" TEXT NOT NULL DEFAULT 'REGEX',
ADD COLUMN     "memberId" TEXT;

-- CreateTable
CREATE TABLE "BenefitRuleRevision" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "configuration" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenefitRuleRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitSnapshot" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "benefitMonth" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenefitSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BenefitRuleRevision_ruleId_version_key" ON "BenefitRuleRevision"("ruleId", "version");

-- CreateIndex
CREATE INDEX "BenefitSnapshot_cardId_benefitMonth_createdAt_idx" ON "BenefitSnapshot"("cardId", "benefitMonth", "createdAt");

-- AddForeignKey
ALTER TABLE "MerchantRule" ADD CONSTRAINT "MerchantRule_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitRuleRevision" ADD CONSTRAINT "BenefitRuleRevision_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CardBenefitRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitSnapshot" ADD CONSTRAINT "BenefitSnapshot_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve legacy settings as an unverified revision. A source URL must be supplied before estimates.
INSERT INTO "BenefitRuleRevision" ("id", "ruleId", "version", "effectiveFrom", "effectiveTo", "configuration")
SELECT 'legacy-benefit-' || r."id", r."id", r."version", r."effectiveFrom", r."effectiveTo",
jsonb_build_object('periodType',r."periodType",'tiers',r."tiers",'exclusions',r."exclusions",'minPerTxAmount',r."minPerTxAmount",'cancellationPolicy',r."cancellationPolicy",'sourceUrl',r."sourceUrl",'statementDay',c."statementDay")
FROM "CardBenefitRule" r JOIN "Card" c ON c."id"=r."cardId";
