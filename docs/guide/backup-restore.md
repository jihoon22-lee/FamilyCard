# 운영 원문 백업과 격리 복원

이 절차는 [단계별 계획 S02-B](../plan/staged-execution-plan.md)의 일회성 보존 기준선입니다.
정기 보존·실패 감시·외부 보관의 자동 운영 체계는 S09에서 확장합니다.

## 지켜야 할 경계

- DB 덤프에는 실제 원문과 자격증명 해시가 있으므로 Git·PR·메신저에 올리지 않습니다.
- `/data/`와 `*.dump`는 Git에서 제외됩니다. 폴더는 0700, 파일은 0600으로 제한합니다.
- 기존 DB에 `pg_restore --clean`, `DROP`, `prisma migrate reset`, seed를 실행하지 않습니다.
- 복원 대상은 매번 새 `familycard_verify_<UTC일시>` DB로 생성합니다. 이미 존재하면
  덮어쓰지 않고 중단합니다. 복원 성공 전 운영 연결을 바꾸지 않습니다.

## 백업 만들기

저장소 루트에서 아래 명령을 사용합니다. 파일명에는 실제 실행 UTC 일시를 넣고 기존 파일을
덮어쓰지 않습니다. 컨테이너 환경변수를 이용해 DB 암호를 명령행이나 출력에 적지 않습니다.

```bash
umask 077
mkdir -p data/backups
chmod 700 data/backups
set -o noclobber
docker compose exec -T postgres sh -c \
  'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' \
  > data/backups/familycard-live-YYYYMMDDTHHMMSSZ.dump
```

`pg_dump` 성공 종료와 파일 권한을 확인합니다. 실패 파일을 정상 백업으로 표시하지 않습니다.
오류에 실제 데이터가 포함될 수 있으므로 stderr나 덤프 본문을 그대로 공유하지 않습니다.

## 별도 DB에 복원

아래 이름은 실행할 때 실제 UTC 일시로 바꿉니다. `createdb`가 실패하면 복원 단계로
진행하지 않습니다. 특히 운영 DB 이름을 복원 대상으로 사용하지 않습니다.

```bash
docker compose exec -T postgres sh -c \
  'exec createdb -U "$POSTGRES_USER" "$1"' sh familycard_verify_YYYYMMDD_HHMMSS

docker compose exec -T postgres sh -c \
  'exec pg_restore -U "$POSTGRES_USER" -d "$1" --no-owner --no-acl --exit-on-error' \
  sh familycard_verify_YYYYMMDD_HHMMSS \
  < data/backups/familycard-live-YYYYMMDDTHHMMSSZ.dump
```

## 복원 검증

1. 앱의 `visibleMemberIds` 범위에서 복원된 기준 RawMessage를 작은 배치로 읽습니다.
2. 기준 ID별로 운영 원문의 `deviceId`, `clientMessageId`, 출처, 제목·본문, 수신 시각,
   수집 해시와 최초 생성 시각을 비교합니다. 원문은 출력하지 않고 해시를 메모리에서 비교합니다.
3. 결과는 기준 건수·누락 건수·변경 건수·보존 여부만 기록합니다. 작업 중 신규 수집 건수는
   별도로 취급합니다. 전체 건수 일치만으로 보존 성공을 판정하지 않습니다.
4. 복원 DB만 연결한 별도 앱 인스턴스를 loopback에 띄워 로그인/수집/조회/권한을 검증합니다.
   추가 검증 데이터는 가공 데이터만 사용하고 운영 DB에는 넣지 않습니다.
5. 테스트 기기는 폐기하고 인스턴스·임시 환경 파일을 정리합니다. 복원본의 실제 원문은
   보존하며, 원래 운영 인스턴스의 health와 연결을 확인합니다.

## 운영 장애에서 복구할 때

먼저 가능한 최신 원본을 별도 보존하고 수집 중단/대기열 상태를 확인합니다. 검증된 백업을
새 DB에 복원한 후 앱 후보 인스턴스에서 검사합니다. 백업 이후 새 원문이 있는 경우에는
그 차이를 보존·대사한 뒤 운영 연결 전환을 검토합니다. 이전 DB를 덮거나 삭제하지 않습니다.

이 일회성 스냅샷 이후 데이터까지 복구된다고 보장하지 않습니다. 정기/증분 백업 주기와
허용 가능한 복구 시점·소요 시간은 S09 운영 계획에서 명시합니다.

## 2026-09-25 검증 기록

- 백업: `data/backups/familycard-live-20260924T221728Z.dump` (UTC 파일명, 0600).
- 격리 복원 DB: `familycard_verify_20260924_221728`.
- 기준 원문 944건, 누락 0건, 원문 필드 변경 0건. 배포 후 재검사도 동일.
- 새 standalone 후보에서 가공 RCS 신규/재전송·기기 세션·SELF 범위·폐기 검증 통과.
- 복원 DB에는 가공 RCS 2건이 추가됐고 검증 기기는 폐기 상태입니다. 원래 백업에는 이
  검증 데이터가 없으며 운영 DB에는 삽입하지 않았습니다.
- 이 결과는 일회성 백업·복원 검증 완료이며 정기 백업 자동화 완료를 뜻하지 않습니다.
