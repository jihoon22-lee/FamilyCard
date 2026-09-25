-- CreateTable
CREATE TABLE "ReprocessingRun" (
    "id" TEXT NOT NULL,
    "actorMemberId" TEXT NOT NULL,
    "memberIds" TEXT[],
    "mode" TEXT NOT NULL,
    "state" "ProcessingState" NOT NULL DEFAULT 'PENDING',
    "filters" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "cutoff" TIMESTAMP(3) NOT NULL,
    "cursor" TEXT,
    "summary" JSONB NOT NULL,
    "previewId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReprocessingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReprocessingTarget" (
    "runId" TEXT NOT NULL,
    "rawMessageId" TEXT NOT NULL,

    CONSTRAINT "ReprocessingTarget_pkey" PRIMARY KEY ("runId","rawMessageId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReprocessingRun_previewId_key" ON "ReprocessingRun"("previewId");

-- CreateIndex
CREATE INDEX "ReprocessingRun_state_createdAt_idx" ON "ReprocessingRun"("state", "createdAt");

-- CreateIndex
CREATE INDEX "ReprocessingRun_actorMemberId_createdAt_idx" ON "ReprocessingRun"("actorMemberId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReprocessingRun" ADD CONSTRAINT "ReprocessingRun_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "FamilyMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReprocessingTarget" ADD CONSTRAINT "ReprocessingTarget_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReprocessingRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReprocessingTarget" ADD CONSTRAINT "ReprocessingTarget_rawMessageId_fkey" FOREIGN KEY ("rawMessageId") REFERENCES "RawMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

