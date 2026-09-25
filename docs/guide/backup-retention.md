# 백업 보존과 독립 암호화 복사

로컬 백업은 매일 생성하며 일 7·주 4·월 12의 최신 대표본을 보존 대상으로 계산합니다.
`python3 scripts/backup-retention.py` 기본 실행은 **계획만 기록**하며 파일을 삭제하지 않습니다.
수동 백업과 `data/backups/pinned.json`에 기록된 기준선 백업은 보존 정책에서 항상 보호합니다.
이번 개발 전에 존재하던 실제 dump는 모두 고정했고 복원 DB도 삭제하지 않았습니다.

독립 저장소의 위치는 사용자가 정해야 합니다. 설정하지 않은 상태는 외부 백업 완료가
아니며 최종 운영 검증 대기입니다. 운영 서명 키의 두 백업 위치도 별도로 확정해야 합니다.

## 외부 복사 활성화 준비

`data/secrets/backup-offsite.env`를 권한 0600으로 작성합니다. 실제 값은 Git에 넣지 않습니다.

```dotenv
FAMILYCARD_EXTERNAL_BACKUP_DIR=/사용자가-선택한-독립-파일시스템/백업폴더
FAMILYCARD_BACKUP_PASSPHRASE_FILE=/home/jihoon/projects/FamilyCard/data/secrets/backup-passphrase
FAMILYCARD_PRUNE_BACKUPS=false
```

- 대상 폴더는 미리 생성하고 마운트를 확인합니다. 작업 폴더와 다른 파일시스템만 허용하지만,
  이것만으로 물리적 독립성·재해 복구가 증명되지는 않습니다. NAS/외장/원격 저장소의 장애
  범위와 암호화 키의 별도 보관 위치를 확인해야 합니다.
- 로컬 private `backup-passphrase`는 준비됐으며 출력하지 않았습니다. 이 키를 분실하면
  외부 암호화 백업을 복호화할 수 없으므로 암호화 파일과 별도의 안전한 위치에 백업하세요.
- GnuPG AES256으로 암호화하고 복호화 스트림의 SHA-256을 원본과 비교한 뒤 게시합니다.
  기존 암호화 파일은 덮어쓰지 않고 동일 원본인지 재검증합니다.
- 로컬 백업 성공 뒤 systemd의 `ExecStartPost`가 계획/선택 외부 복사를 수행합니다.
  외부 실패는 service 실패와 `offsite-last-attempt.json`에 남고 자원 감시에도 표시됩니다.

## 삭제를 켜기 전

외부 복사와 실제 복원 리허설을 확인한 뒤에만 `FAMILYCARD_PRUNE_BACKUPS=true`로 바꿉니다.
모든 선택 백업의 외부 복호화·해시 검증이 끝나야 보존 대상 밖 로컬 자동 백업을 정리합니다.
삭제 직전에도 다시 검증하며 수동/고정 백업은 건드리지 않습니다. 외부 암호화 백업은 이
스크립트가 삭제하지 않습니다. 그 보존 주기는 저장소 확정 뒤 별도로 정합니다.

현재 독립 저장소 경로가 미정이라 외부 복사와 로컬 삭제는 **활성화하지 않았습니다**.
