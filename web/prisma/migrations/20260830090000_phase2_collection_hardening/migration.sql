-- 기존 RawMessage는 보존하면서 새 클라이언트 멱등 키를 부여한다.
ALTER TABLE "RawMessage" ADD COLUMN "clientMessageId" TEXT;

UPDATE "RawMessage"
SET "clientMessageId" = 'legacy-' || "id";

ALTER TABLE "RawMessage" ALTER COLUMN "clientMessageId" SET NOT NULL;

CREATE UNIQUE INDEX "RawMessage_deviceId_clientMessageId_key"
ON "RawMessage"("deviceId", "clientMessageId");

-- nonce는 60초짜리 일회성 자격증명이므로 배포 시 남아 있는 구버전 nonce를
-- 무효화해도 원문 데이터가 유실되지 않는다. 원 기기를 알 수 없는 레코드에
-- 임의의 deviceId를 추측해서 붙이지 않는다.
DELETE FROM "DeviceSessionNonce";

ALTER TABLE "DeviceSessionNonce" ADD COLUMN "deviceId" TEXT NOT NULL;

CREATE INDEX "DeviceSessionNonce_deviceId_idx"
ON "DeviceSessionNonce"("deviceId");

ALTER TABLE "DeviceSessionNonce"
ADD CONSTRAINT "DeviceSessionNonce_deviceId_fkey"
FOREIGN KEY ("deviceId") REFERENCES "Device"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
