# 최종 한 번 업데이트와 서명 보존

2026-09-25 사용자 지시: 전체 작업 종료 후 버전을 한 번만 올립니다. 중간 PR은
Unreleased에 누적하고 versionCode/versionName/태그/게시 APK는 유지합니다.
현재 설치 기준은 versionCode 7입니다. 새 기능의 빌드 성공은 실기기 배포 완료가 아닙니다.

## 최신 버전 확인

앱 설정의 **최신 버전 확인**은 같은 서버의 `/downloads/familycard.json`을 읽어 설치된
versionCode와 비교합니다. 메타데이터는 APK 빌드에서 버전·패키지·SHA-256으로 생성합니다.
없는 파일/연결 실패/다른 패키지/리디렉션/4KiB 초과는 최신이라고 간주하지 않고 안내합니다.
Android가 실제 내려받은 APK의 서명을 검사하며 메타데이터 표시가 그 검사를 대체하지 않습니다.

`writeDebugApkMetadata`는 빌드 폴더만 쓰고 게시하지 않습니다. 최종 `publishDebugApk`가
APK와 JSON을 함께 복사합니다. CD의 `writeReleaseApkMetadata`도 동일 APK의 JSON을
artifact와 서버 이미지에 포함합니다. 현재 서버에 JSON을 새로 게시하지 않았습니다.

## 현재 설치를 유지하는 경로

앱 삭제·패키지명 변경·서명키 교체를 업데이트 문제 해결책으로 쓰지 않습니다.
폰의 SQLite 대기/격리 원문과 설정은 앱 삭제 시 사라지고 Android 자동 백업에서 제외됩니다.
마지막 게시 APK를 기준으로 후보 APK의 applicationId·서명 인증서·versionCode를 비교합니다.

```bash
python3 scripts/verify-apk-update.py \
  web/public/downloads/familycard.apk \
  android/app/build/outputs/apk/debug/app-debug.apk \
  --build-tools /home/jihoon/android-sdk/build-tools/36.0.0
```

SDK 경로는 환경에 맞춥니다. 이 도구는 양쪽 APK의 서명을 검증하고 메타데이터를 읽습니다.
같은 패키지/서명과 더 높은 versionCode가 아니면 exit 1로 게시를 막는 사전 판정을 합니다.
APK를 복사·게시하거나 버전을 바꾸지는 않습니다. 키 회전 증명을 지원하는 배포는 별도 검증이
필요하므로 현재 도구는 다른 인증서를 허용하지 않습니다.
현재 후보와 게시본은 같은 서명/패키지와 code 7이라 `version_code_not_increased`만 반환하는
것이 정상입니다. 최종 한 번의 버전 변경 전에는 게시하지 않습니다.

Android 업데이트의 공식 조건은 같은 applicationId와 호환 서명이며,
키 교체는 유효한 회전 증명 등 추가 조건이 필요합니다.
[Android 업데이트 조건](https://developer.android.com/google/play/app-updates),
[앱 서명 관리](https://developer.android.com/studio/publish/app-signing).

## 최종 업데이트 순서

1. 전체 작업과 필수 검증의 실제 완료 여부를 계획서에서 확인합니다. 실기기·한 사이클
   대조가 미확인이면 완료로 표시하거나 정식 완료 태그를 만들지 않습니다.
2. 운영 DB 보존 백업과 격리 복원, 현재 게시 APK/컨테이너 이미지의 복구 기준을 확보합니다.
3. 작업 완료 범위에 맞춰 앱·서버 버전과 CHANGELOG 릴리스 섹션을 **한 번만** 갱신합니다.
4. 동일 인증서로 후보 APK를 빌드하고 위 사전 검증을 통과시킵니다.
5. PR 필수 CI가 모두 성공한 뒤 GitHub에서 병합합니다.
6. 운영 DB migration → 호환 서버 → 최종 APK 순으로 반영합니다. 기기 상태 보고용 migration은
   nullable 컬럼 추가이며 구버전 앱 원문 업로드는 계속 호환됩니다.
7. HTTPS health/인증/SELF/다운로드 해시를 확인하고, 폰 덮어쓰기 뒤 설정·pending/rejected와
   원문 도착을 확인합니다. 원문을 삭제하거나 DB를 과거 백업으로 무조건 되돌리지 않습니다.
8. 해당 브랜치 HEAD의 PR 병합을 확인한 뒤 로컬/원격 브랜치·소유 임시 워크트리를 정리합니다.

## 운영 키와 백업

기존 debug 서명과 새 운영 서명은 자동으로 호환되지 않습니다. 새로운 키를 만들었다는
이유로 현재 폰을 삭제·재설치하지 않습니다. 기존 키를 보존한 채 키 회전 또는 이전 경로를
설계하고 실제 대상 Android 버전에서 데이터 보존을 검증해야 합니다.

운영 키의 암호화 이중 백업은 서로 독립된 보관 장소와 복구 관리자가 정해져야 완료입니다.
현재 사용자에게 백업 장소 두 곳을 요청했고 답변 전에는 임의의 외부 저장소로 키를 보내거나
GitHub Secrets를 교체하지 않습니다. 암호와 키 내용은 채팅/로그/Git에 남기지 않습니다.
이 조건이 미충족이므로 S02-E 운영 키 전환은 미완료입니다.

## Play Protect 경고

첨부 화면은 검사 이력이 없는 개발자에 대한 경고와 **무시하고 설치하기** 항목을 보여줍니다.
이 화면만으로 악성 판정이나 단일 원인을 확정하지 않습니다. 해당 선택지가 실제로 제공되면
기기 전체의 앱 검사를 끄는 것과 별개로 이번 APK 설치를 선택할 수 있습니다. 앱 검사 기능을
끄는 절차를 FamilyCard의 필수 설치 단계로 만들지 않습니다.

Google은 알 수 없는 앱 검사 권고, 민감 권한을 쓰는 인터넷 APK 차단, 유해 앱 차단을
구분합니다. FamilyCard의 SMS 수신/읽기·알림 접근은 수집 기능에 쓰지만 차단 검토 대상
권한에 해당할 수 있습니다. 정식 서명만으로 경고가 사라진다고 보장할 수 없습니다.
경고 유형·최종 APK의 해시/권한/수집 동의를 확인한 뒤 필요하면 공식 이의제기를 준비합니다.
검사/이의제기 제출이나 앱 업로드는 이번 작업에서 수행하지 않았습니다.
[Google의 경고별 개발자 안내](https://developers.google.com/android/play-protect/warning-dev-guidance).

기존 구현은 등록 대상만 캡처하고 문자 읽기는 사용자가 요청하며, 앱 자체 설치 권한이나
접근성 권한을 추가하지 않습니다. SMS Retriever는 인증번호 확인용이므로 과거 금융 문자
가져오기를 대체하지 않습니다. Play 배포로 전환하면 SMS 권한 적격성·등록 발신자 모든 문구
보관의 범위를 따로 심사해야 하므로, 현재 private 배포가 자동 승인되는 것으로 해석하지 않습니다.
