# ADR 0010 — 사용자가 실행하는 과거 SMS 가져오기

- 상태: 승인
- 일자: 2026-09-24
- 근거: 사용자가 새로 등록한 SMS 발신자의 과거 문자 수집을 요청
- 관련: [Android 설계](../design/08-android-app.md), [사건 ID](0006-client-event-idempotency.md)

## 배경

기존 앱은 RECEIVE_SMS 수신 콜백만 처리해 등록 이전 문자를 읽지 않았습니다. 폰에 보관된
SMS를 수집하기 위해 사용자가 실행하는 가져오기 기능과 READ_SMS 권한을 추가합니다.
기존의 최소 권한 결정은 이 기능에 한해 확장하며, 앱 실행·등록·권한 부여만으로
과거 문자를 자동 조회하지 않습니다. 카카오톡 과거 대화, MMS, RCS는 범위 밖입니다.

## 결정

- 설정에서 최근 30/90/365일을 선택하고 실행. 기본은 90일이며 선택 기간의 수신 SMS만 대상.
- READ_SMS는 가져오기 실행 시 요청. 권한 거부/철회/설치 환경의 제한이면 실패를 표시하고
  기존 큐와 실시간 수집 경로는 유지. 기본 문자 앱 변경을 요구하지 않음.
- WorkManager 입력에는 고정 시작/종료 시각과 실행 시 등록된 SMS 발신자 목록만 넣음.
  처리 중 현재 등록 목록과 교집합으로 확인해 삭제 반영, 새 등록으로 범위를 넓히지 않음.
- Inbox 메타데이터(_id/address/date/date_sent)만 Cursor로 순차 읽고, 허용된 발신자만
  해당 행의 본문을 별도 조회. ID·발신자·두 시각이 그대로인 행만 조회하며 저장 전에도
  등록을 재확인. 거래 어휘는 기존 CaptureFilter와 동일. 전체 본문 리스트를 만들지 않음.
- 알림 원문은 기존 SQLite 큐로 바로 보존. 서버/SQLite 스키마와 원문 불변성은 변경하지 않음.
  중지·부분 실패 뒤에도 저장된 큐는 업로드되고 재실행은 같은 사건 ID를 사용.
- 업로드 예약은 각 문자마다 만들지 않고 작업 종료/실패/중지 시 한 번 수행. 주기 작업도
  등록해 프로세스 종료 시 이미 큐에 저장한 원문을 전송할 수 있도록 함.
- UI와 WorkManager 진행/결과에는 건수와 정해진 상태 문구만 표시. 원문·발신자·예외 내용은
  로그·진행 상태에 넣지 않음. 원본 SMS의 읽음 상태나 내용을 수정/삭제하지 않음.

## SMS 사건 동일성

기존 실시간 ID `CaptureEventId.sms(원래 발신자, PDU timestamp, 결합 본문)`을 유지합니다.
AOSP SMS 수신 저장 구현은 PDU timestamp를 `DATE_SENT`에, 폰 도착 시각을 `DATE`에 둡니다.
가져오기도 DATE_SENT를 사용하므로 발신자·발신 시각·본문이 같은 문자는 업로드 후
다시 가져와도 서버의 `(deviceId, clientMessageId)` 유일 제약으로 중복되지 않습니다.
DATE_SENT가 없거나 미래/서버의 5년 하한 밖이면 DATE로 추측하지 않고 제외 건수를 표시합니다.

제조사/기본 문자 앱이 주소·본문·DATE_SENT를 수신 콜백과 다르게 저장하면 같은 ID를
보장할 수 없습니다. 이를 금액·본문 유사도나 넓은 시각 범위로 강제 병합하지 않습니다.
실기기에서 실시간 수신된 표본의 재가져오기 후 서버 건수 불변을 확인해야 합니다.
서로 다른 출처(카드 앱/카카오/SMS)의 의미 중복은 여전히 Phase 3의 책임입니다.

## 검증과 한계

- 미등록/삭제/새로 등록된 발신자의 본문 비접근, 비거래 제외, 기간 경계, ID 재사용,
  별도 시각 사건 보존, 권한 철회·큐 실패 전파를 가공 데이터 JVM 테스트로 검증.
- 실제 SMS 저장소의 DATE_SENT 채움, READ_SMS 허용, 앱 업데이트 후 가져오기·재실행·중지와
  서버 전송은 실기기 확인이 필요. 개발 환경에서 사용자 폰을 원격 조작하지 않음.
- 긴 작업이 OS에 의해 중단되면 같은 고정 범위를 다시 읽을 수 있음. 이미 저장한 항목은
  동일 ID로 재전송되므로 원문 중복 저장을 막음. 가져오기를 정기 실행하지 않음.

## 근거

- [Android SMS 열 정의](https://developer.android.com/reference/android/provider/Telephony.TextBasedSmsColumns)
- [AOSP SMS 수신 저장 코드](https://android.googlesource.com/platform/packages/apps/Mms/+/master/src/com/android/mms/transaction/SmsReceiverService.java)
- [READ_SMS 권한과 설치 프로그램 허용 제한](https://developer.android.com/reference/android/Manifest.permission#READ_SMS)
