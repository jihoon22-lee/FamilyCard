-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "revokedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DeviceSessionNonce" (
    "id" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceSessionNonce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceSessionNonce_nonceHash_key" ON "DeviceSessionNonce"("nonceHash");

-- CreateIndex
CREATE INDEX "DeviceSessionNonce_expiresAt_idx" ON "DeviceSessionNonce"("expiresAt");

-- AddForeignKey
ALTER TABLE "DeviceSessionNonce" ADD CONSTRAINT "DeviceSessionNonce_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
