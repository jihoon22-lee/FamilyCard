# 수집 서버 자원 감시

`python3 scripts/monitor-resources.py`는 원문·거래·기기 토큰을 읽지 않고 다음만 관찰합니다.

- Docker web/DB 컨테이너 메모리·CPU·프로세스 수
- 마지막 백업 성공 경과 시간·실패 여부·파일 존재/크기 (덤프 본문은 읽지 않음)
- 현재 운영 DB 크기·연결 수·활성 연결·idle in transaction (관찰 쿼리 자체 제외)
- 로컬 `/api/health` 상태·응답 시간 (프록시 및 리디렉션 미사용)
- 저장소가 있는 파일시스템 여유 공간. 다른 파티션의 Docker 볼륨 여유를 뜻하지 않음

조회 실패는 0으로 기록하지 않고 null과 오류 코드를 남깁니다. 예외/로그/환경변수의
원문 문자열은 기록하지 않습니다. exit 1은 관찰 실패 또는 경고, exit 0은 관찰 성공입니다.
초기 경고 기준은 web 512MiB 이상, DB 연결 20개 이상, idle in transaction 존재,
파일시스템 여유 20% 미만, 백업 성공 36시간 초과/마지막 실패/파일 누락·크기 변경입니다. 운영 추이를 본 뒤 조정하며 자동 재시작·데이터 삭제는 하지 않습니다.

## 실행과 보관

저장소 루트에서:

```bash
python3 scripts/monitor-resources.py --record
```

`data/monitoring/YYYY-MM-DD.jsonl`에 UTC 관찰 시각과 숫자를 기록합니다.
디렉터리 0700·파일 0600, Git 제외. 90일 이전의 날짜 형식 `.jsonl` 지표만 정리합니다.
백업·RawMessage·임의 파일은 정리 대상이 아닙니다. 15분 간격으로 하루 96개 표본입니다.

## WSL 사용자 systemd timer

제공된 unit은 현재 작업 위치 `%h/projects/FamilyCard`에 맞춰져 있습니다.
다른 위치/서비스명/포트의 NAS에는 해당 설정을 먼저 맞춥니다.

```bash
mkdir -p ~/.config/systemd/user
cp scripts/systemd/familycard-monitor.service scripts/systemd/familycard-monitor.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now familycard-monitor.timer
systemctl --user start familycard-monitor.service
systemctl --user status familycard-monitor.timer --no-pager
```

15분마다 실행하며 꺼져 있던 동안 놓친 실행은 켜진 뒤 한 번 보충합니다. WSL/사용자
systemd가 정지한 동안 관찰할 수 없으며, 이를 정상 표본으로 채우지 않습니다.
외부 알림을 전송하지 않습니다. 실패한 service 상태와 private 기록으로 확인합니다.

해제 시 timer를 disable --now하고 이 두 unit만 제거합니다. 원문 DB나 지표는 제거하지 않습니다.

현재 WSL에서 PR #26 병합 뒤 timer를 설치·활성화했고 첫 서비스 실행 success를 확인했습니다.

## 검증과 해석

2026-09-25 첫 관찰은 web 약 86MiB, health 200/13ms, 경고·관찰 실패 없음입니다.
단위 변환·관찰 실패 비노출·부분 관찰 거부·경고·90일 지표 보존 경계를 자동 테스트합니다.
이 측정은 메모리 누수가 없다는 결론이 아닙니다. 다음 날/수일 후 메모리와 연결 수를 비교하고,
증가가 지속될 때만 heap/쿼리/인덱스를 추가 조사합니다. RCS 재조회 비용과 기기 작업 적체는
폰 상태 신호가 추가된 뒤 별도로 계측합니다.
