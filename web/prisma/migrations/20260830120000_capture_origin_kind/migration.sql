-- 카드사 앱·간편결제 앱·카카오 채널 등 같은 결제의 복수 알림을 구분한다.
CREATE TYPE "CaptureOriginKind" AS ENUM (
    'CARD_APP',
    'PAYMENT_APP',
    'KAKAO_CHANNEL',
    'SMS_SENDER',
    'MANUAL_ENTRY',
    'STATEMENT_UPLOAD',
    'UNKNOWN_APP'
);

-- 기존 원문은 한 건도 삭제하지 않고, 확실히 알 수 있는 범위까지만 보수적으로
-- 분류한다. 기존 일반 앱 알림은 카드사/결제 앱 여부를 추측하지 않는다.
ALTER TABLE "RawMessage" ADD COLUMN "originKind" "CaptureOriginKind";

UPDATE "RawMessage"
SET "originKind" = CASE
    WHEN "source" = 'SMS' THEN 'SMS_SENDER'::"CaptureOriginKind"
    WHEN "source" = 'NOTIFICATION' AND "packageName" = 'com.kakao.talk'
        THEN 'KAKAO_CHANNEL'::"CaptureOriginKind"
    WHEN "source" = 'MANUAL' THEN 'MANUAL_ENTRY'::"CaptureOriginKind"
    WHEN "source" = 'STATEMENT' THEN 'STATEMENT_UPLOAD'::"CaptureOriginKind"
    ELSE 'UNKNOWN_APP'::"CaptureOriginKind"
END;

ALTER TABLE "RawMessage" ALTER COLUMN "originKind" SET NOT NULL;
