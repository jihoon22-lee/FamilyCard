# ADR 0009 — FamilyCard 서버를 통한 APK 업데이트 전달

- 상태: 승인
- 일자: 2026-08-30
- 관련: [Android 앱 설계](../design/08-android-app.md),
  [관리자 가이드](../guide/admin-guide.md), [사용자 가이드](../guide/user-guide.md)

## 배경

대시보드와 파서는 서버에 있어 APK를 다시 설치하지 않아도 바뀌지만, 알림 수집·권한·네이티브
설정 화면을 고치면 새 APK가 필요합니다. 파일을 PC에서 각 폰으로 옮기는 방식은 가족이
늘어날수록 반복 작업이 되고, USB를 사용자 배포 절차로 요구할 수 없습니다.

FamilyCard는 Play 스토어가 아니라 가족 tailnet 안에서 배포합니다. 일반 sideload 앱은
Android 보안상 사용자 동의 없는 자동 설치를 할 수 없으며, 기존 앱 위에 설치하려면 같은
application ID·서명키와 더 높은 `versionCode`가 필요합니다.

## 결정

1. FamilyCard 서버의 고정 경로 `/downloads/familycard.apk`에서 최신 APK를 제공합니다.
   경로는 설정한 서버와 같은 HTTPS origin이므로 기존 tailnet 접근 경계를 그대로 씁니다.
2. Android 설정에 현재 버전과 **최신 APK 받기** 버튼을 둡니다. 버튼은 캐시 방지 쿼리를
   붙인 URL을 외부 브라우저로 열고, 브라우저 다운로드와 Android 설치 확인을 사용합니다.
3. 앱이 APK를 직접 설치하지 않으므로 `REQUEST_INSTALL_PACKAGES`를 추가하지 않습니다.
   무인·silent update를 가장하지 않고 마지막 설치 확인이 필수임을 UI에 표시합니다.
4. 태그 CD가 서명 APK를 만들 수 있으면 같은 artifact를 GitHub Release에 첨부하고 web
   이미지의 고정 경로에도 포함합니다. NAS가 그 web 이미지를 pull하면 가족이 바로 받습니다.
5. 개발 중에는 `./gradlew publishDebugApk`가 같은 머신의 debug key로 서명된 APK를
   `web/public/downloads/familycard.apk`에 복사합니다. APK 파일 자체는 Git에서 무시합니다.
6. 서명키를 잃거나 바꾸면 덮어쓰기 설치가 불가능하므로 기존의 암호화 이중 백업과 CD
   signing 검증을 필수 조건으로 유지합니다.

## 결과

- 이번 기능이 들어간 APK를 한 번 설치한 뒤에는 PC→폰 파일 복사 없이 앱에서 다운로드를
  시작할 수 있습니다.
- 서버와 APK가 같은 릴리스 artifact를 제공해 GitHub 링크와 집 서버 파일이 달라질 가능성을
  줄입니다.
- Android의 사용자 설치 확인과 서명 검증은 그대로 유지됩니다. 완전 자동 업데이트는
  제공하지 않습니다.
- 현재 설치된 구버전에는 다운로드 버튼이 없으므로 이번 한 번은 브라우저에서 고정 주소를
  직접 열어 덮어쓰기 설치해야 합니다.

## 남는 위험과 완화

- 서버에 최신 APK가 아직 게시되지 않았으면 다운로드가 404가 됩니다. CD signing이 구성된
  릴리스 또는 로컬 `publishDebugApk` 완료 뒤에만 링크를 안내합니다.
- 서버가 침해돼 다른 APK로 교체되어도 Android는 기존 서명과 다르면 업데이트 설치를
  거부합니다. 다만 신규 설치자는 이 보호를 받기 전이므로 tailnet 주소만 사용합니다.
- 버튼은 서버의 버전을 질의하지 않고 최신 파일을 엽니다. 자동 버전 확인·다운로드 알림은
  실제 가족 배포가 시작된 뒤 별도 기능으로 검토합니다.

## 기각한 대안

- **USB·메신저로 APK 전달**: 사용자마다 반복되는 수동 파일 이동을 없애지 못합니다.
- **앱 자체 silent install**: 일반 사용자 앱 권한으로 지원되지 않고 보안 경계를 약화합니다.
- **Google Play 인앱 업데이트**: Play로 설치된 앱에 맞는 API이며 현재의 tailnet 가족 배포와
  맞지 않습니다. SMS 권한을 포함한 배포 정책 검토도 별도로 필요합니다.
- **서버에서 임의 APK 업로드 UI 제공**: 관리자 계정 탈취가 곧 신규 APK 배포로 이어지고,
  소스 태그·CI·서명 검증과 artifact 연결이 끊깁니다.

## 참고 근거

- [Android Developers — 인앱 업데이트는 Google Play 배포 앱을 전제로 함](https://developer.android.com/guide/playcore/in-app-updates)
- [Android Developers — PackageInstaller의 사용자 작업 요구 상태](https://developer.android.com/reference/android/content/pm/PackageInstaller.html)
- [Google Play — SMS·통화 기록 권한 정책](https://support.google.com/googleplay/android-developer/answer/10208820)
