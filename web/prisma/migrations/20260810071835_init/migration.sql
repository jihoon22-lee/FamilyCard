-- CreateEnum
CREATE TYPE "FamilyRole" AS ENUM ('MEMBER', 'ADMIN');

-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "CardAliasType" AS ENUM ('MASKED_DIGITS', 'NICKNAME', 'RAW_TOKEN');

-- CreateEnum
CREATE TYPE "MessageSource" AS ENUM ('NOTIFICATION', 'SMS', 'MANUAL', 'STATEMENT');

-- CreateEnum
CREATE TYPE "ParseStatus" AS ENUM ('PENDING', 'PARSED', 'NEEDS_CARD', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('APPROVAL', 'CANCELLATION');

-- CreateEnum
CREATE TYPE "BenefitPeriodType" AS ENUM ('PREV_CALENDAR_MONTH', 'STATEMENT_CYCLE');

-- CreateEnum
CREATE TYPE "CancellationPolicy" AS ENUM ('DEDUCT_FROM_ORIGINAL', 'DEDUCT_FROM_CANCEL_PERIOD');

-- CreateTable
CREATE TABLE "FamilyMember" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "FamilyRole" NOT NULL DEFAULT 'MEMBER',
    "displayColor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "cardType" "CardType" NOT NULL,
    "statementDay" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardAlias" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "aliasType" "CardAliasType" NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawMessage" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "source" "MessageSource" NOT NULL,
    "packageName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "dedupeHash" TEXT NOT NULL,
    "parseStatus" "ParseStatus" NOT NULL DEFAULT 'PENDING',
    "parserRuleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RawMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParserRule" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "matchPattern" TEXT NOT NULL,
    "extractPattern" TEXT NOT NULL,
    "fieldMap" JSONB NOT NULL,
    "priority" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sampleText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParserRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "rawMessageId" TEXT NOT NULL,
    "cardId" TEXT,
    "memberId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "canceledAmount" INTEGER NOT NULL DEFAULT 0,
    "txType" "TransactionType" NOT NULL,
    "canceledTxId" TEXT,
    "isOrphanCancellation" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "merchantName" TEXT NOT NULL,
    "installmentMonths" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "foreignAmount" INTEGER,
    "categoryId" TEXT,
    "excludeReason" TEXT,
    "isManuallyEdited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardBenefitRule" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "periodType" "BenefitPeriodType" NOT NULL,
    "tiers" JSONB NOT NULL,
    "exclusions" JSONB NOT NULL,
    "minPerTxAmount" INTEGER NOT NULL DEFAULT 0,
    "cancellationPolicy" "CancellationPolicy" NOT NULL DEFAULT 'DEDUCT_FROM_ORIGINAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardBenefitRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantRule" (
    "id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "memberId" TEXT,
    "categoryId" TEXT,
    "month" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FamilyMember_name_key" ON "FamilyMember"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Device_tokenHash_key" ON "Device"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Card_memberId_issuer_last4_key" ON "Card"("memberId", "issuer", "last4");

-- CreateIndex
CREATE INDEX "CardAlias_token_idx" ON "CardAlias"("token");

-- CreateIndex
CREATE UNIQUE INDEX "RawMessage_dedupeHash_key" ON "RawMessage"("dedupeHash");

-- CreateIndex
CREATE INDEX "RawMessage_parseStatus_receivedAt_idx" ON "RawMessage"("parseStatus", "receivedAt");

-- CreateIndex
CREATE INDEX "RawMessage_deviceId_receivedAt_idx" ON "RawMessage"("deviceId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_rawMessageId_key" ON "Transaction"("rawMessageId");

-- CreateIndex
CREATE INDEX "Transaction_memberId_approvedAt_idx" ON "Transaction"("memberId", "approvedAt");

-- CreateIndex
CREATE INDEX "Transaction_cardId_approvedAt_idx" ON "Transaction"("cardId", "approvedAt");

-- CreateIndex
CREATE INDEX "Transaction_cardId_amount_approvedAt_idx" ON "Transaction"("cardId", "amount", "approvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CardBenefitRule_cardId_key" ON "CardBenefitRule"("cardId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAlias" ADD CONSTRAINT "CardAlias_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMessage" ADD CONSTRAINT "RawMessage_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMessage" ADD CONSTRAINT "RawMessage_parserRuleId_fkey" FOREIGN KEY ("parserRuleId") REFERENCES "ParserRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_rawMessageId_fkey" FOREIGN KEY ("rawMessageId") REFERENCES "RawMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_canceledTxId_fkey" FOREIGN KEY ("canceledTxId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardBenefitRule" ADD CONSTRAINT "CardBenefitRule_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantRule" ADD CONSTRAINT "MerchantRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
