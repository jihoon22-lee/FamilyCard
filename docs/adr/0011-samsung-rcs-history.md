# ADR 0011 — 삼성 RCS 보관함 가져오기

- 상태: 채택
- 일자: 2026-09-24
- 배경: 사용자가 가져오기 누락을 보고한 메시지가 삼성 메시지 상세정보에서 ‘대화’로 확인됨
- 관련: [SMS 가져오기](0010-sms-history-import.md), [수집 설계](../design/08-android-app.md)

## 결정

현재 SMS 가져오기와 별도로 삼성 RCS 보관함 호환 경로를 추가합니다. 사용자가 **SMS·RCS
가져오기**를 실행할 때만 동작합니다. 실시간 RCS 감지와 다른 제조사 지원은 이 변경에
포함하지 않습니다. 캡처할 금융 문구를 추측하거나 거래 필드를 파싱하지 않습니다.

- Android 공개 SMS API와 삼성 비표준 RCS provider를 구분. 삼성 기기이고 `im` authority의
  소유 앱이 system/updated-system일 때만 `rcs_read_im`, `chat` 순으로 호환 조회.
  지원되는 첫 경로만 사용하며 비어 있다고 다른 경로를 중복 수집하지 않음.
- READ_SMS와 provider 접근 허용이 모두 필요. 미지원·권한 거부·필수 열 부재는 사용자에게
  상태를 표시하고 SMS 수집 결과를 유지. 스키마/권한을 우회하거나 사설 DB 파일을 열지 않음.
- 메타데이터의 `type=1`, 날짜 범위, 실행 당시/현재 등록된 문자 발신자 교집합을 검사한
  다음에만 해당 ID·주소·날짜·수신 종류의 본문을 조회. 미등록 발신자 본문은 읽지 않음.
- RCS JSON을 텍스트로 치환하거나 잘라내지 않고 원형 보존. Unicode escape 해제는 기존
  거래 어휘 확인에만 사용. 본문 최대 64,000자, 초과는 별도 제외 건수 표시.
- `MessageSource.RCS` enum 값을 추가하고 기존 `SMS_SENDER`는 SMS/RCS 공통의 사용자 등록
  문자 발신자 출처로 유지. UI 표기는 ‘문자 발신자’와 별도 ‘RCS(채팅+)’ 채널 배지.
- 원문 ID는 `samsung-rcs + provider 행 ID + 발신자 + 수신 시각 + 원문` 기반. SMS와 ID
  공간을 분리하고 재실행은 멱등 처리. 행 내용이 바뀌면 과거 원문을 덮지 않고 별도 보존.
  별도 행의 동일 본문/시각을 임의 병합하지 않음. 복원으로 행 ID가 바뀐 경우의 의미 대사는
  Phase 3의 책임이며 이 단계에서 추측 병합하지 않음.
- 긴 JSON으로 요청 바이트 상한을 넘지 않도록 업로드 묶음을 문자열 길이 기준으로 분할.
  JSON escape 최악 조건에서도 기본 6MB보다 작게 유지하고 남은 큐를 이어서 전송.
- 서버 변경은 enum 값 추가만 수행. RawMessage 삭제/재작성 없음. 먼저 보존 백업을 만들고
  격리 복원 DB에서 migration 전후 모든 RawMessage 행과 ID가 동일한지 검증.
- v4가 이미 예약한 SMS-only 작업은 입력에 RCS 플래그가 없으므로 SMS-only로 마침.

## 지원 수준과 근거

삼성 RCS는 공식 Android 공통 API가 아닙니다. 아래 직접 구현/관찰 사례를 근거로
호환 경로를 넣되 실제 사용자 기기의 허용 여부와 열/단위는 APK 실행 결과로 검증합니다.
미지원 경로를 성공으로 표시하지 않으며, `date`는 관찰된 밀리초 계약과 범위가 맞는
행만 처리합니다. 원문 데이터나 게시글의 실제 금융 예제는 코드에 복사하지 않습니다.

- [CardSMS 개발자: 삼성 RCS 지원과 제조사별 제한](https://cardsms-cc51a.web.app/faq.html)
- [삼성 Members의 개발자 직접 조회 사례](https://r1.community.samsung.com/t5/samsung-news/how-to-retrieve-images-from-chat-messages/td-p/18398310)
- [실기기 직접 조사: im/chat 메타데이터와 JSON 본문](https://dajkim76.tistory.com/548)
- [개발자 직접 조회 코드: rcs_read_im](https://snorlaxh.tistory.com/82)
- [Google Messages의 별도 기업 관리 기기용 보관 경로](https://developer.android.com/work/dpc/rcs-messages-archival)

## 검증

가공 데이터로 부분취소 JSON/Unicode escape 원문 보존, 발신자·수신 종류·기간 경계,
삭제/추가된 발신자 범위, 반복 실행과 별도 사건 보존, 크기 제한·권한/큐 실패,
최악의 JSON escape 전송 크기를 검사합니다. 실기기 RCS 제공자 접근·본문 보존·중복 재수집은
앱 업데이트 후 사용자의 재실행 확인이 필요합니다.
