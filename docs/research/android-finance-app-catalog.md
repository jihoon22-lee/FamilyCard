# Android 금융 앱 추천 카탈로그 조사

- 확인일: 2026-08-30
- 목적: FamilyCard 수집 대상 선택기의 **검색·정렬 보조**
- 범위: 국내 주요 전업 카드사 앱과 널리 쓰이는 결제·자산 앱

이 목록은 수집 화이트리스트가 아닙니다. 앱이 목록에 있어도 사용자가 FamilyCard에서 직접
체크하고 최종 확인하기 전에는 알림을 읽거나 저장하지 않습니다. 목록에 없는 앱도 설치 앱
검색으로 선택할 수 있습니다.

패키지는 Google Play 공식 등록 페이지 URL의 `id` 값을 기준으로 확인했습니다. Play 등록이
공식 앱이라는 근거는 되지만, 그 앱이 현재 카드 이용알림을 실제로 발송한다는 보장은
아닙니다. 알림 지원 여부는 사용자가 해당 앱 설정과 실기기 알림으로 확인해야 합니다.

## 카드사 앱

| 추천 이름·검색 별칭 | Android 패키지 | 확인 출처 | 비고 |
|---|---|---|---|
| 신한 SOL페이·신한카드 | `com.shcard.smartpay` | [Google Play](https://play.google.com/store/apps/details?hl=ko&id=com.shcard.smartpay) | |
| KB Pay·KB국민카드 | `com.kbcard.cxh.appcard` | [Google Play](https://play.google.com/store/apps/details?hl=ko&id=com.kbcard.cxh.appcard) | |
| 모니모·삼성카드 | `net.ib.android.smcard` | [Google Play](https://play.google.com/store/apps/details?hl=ko&id=net.ib.android.smcard) | 삼성 금융 통합 앱. 카드 이용알림 제공 여부를 별도 확인 |
| 현대카드 | `com.hyundaicard.appcard` | [Google Play](https://play.google.com/store/apps/details?hl=ko&id=com.hyundaicard.appcard) | |
| 디지로카·롯데카드 | `com.lcacApp` | [Google Play](https://play.google.com/store/apps/details?hl=ko&id=com.lcacApp) | |
| 하나Pay·하나카드 | `com.hanaskcard.paycla` | [Google Play](https://play.google.com/store/apps/details?hl=ko&id=com.hanaskcard.paycla) | |
| NH pay·NH농협카드 | `nh.smart.nhallonepay` | [Google Play](https://play.google.com/store/apps/details?hl=ko&id=nh.smart.nhallonepay) | |
| 우리WON카드·우리카드 | `com.wooricard.smartapp` | [Google Play](https://play.google.com/store/apps/details?hl=ko&id=com.wooricard.smartapp) | |
| 페이북·BC카드·ISP | `kvp.jjy.MispAndroid320` | [Google Play](https://play.google.com/store/apps/details?hl=ko&id=kvp.jjy.MispAndroid320) | 카드사·결제 성격이 함께 있으나 선택기에서는 카드사 앱 추천 |

## 결제·자산 앱

| 추천 이름·검색 별칭 | Android 패키지 | 확인 출처 |
|---|---|---|
| 토스 | `viva.republica.toss` | [Google Play](https://play.google.com/store/apps/details?hl=ko&id=viva.republica.toss) |
| 카카오페이 | `com.kakaopay.app` | [Google Play](https://play.google.com/store/apps/details?hl=ko&id=com.kakaopay.app) |
| 네이버페이·Npay | `com.naverfin.payapp` | [Google Play](https://play.google.com/store/apps/details?hl=ko&id=com.naverfin.payapp) |
| PAYCO·페이코 | `com.nhnent.payapp` | [Google Play](https://play.google.com/store/apps/details?hl=ko&id=com.nhnent.payapp) |
| 삼성 월렛·삼성페이 | `com.samsung.android.spay` | [Google Play](https://play.google.com/store/apps/details?hl=ko&id=com.samsung.android.spay) |
| 11pay·11페이·SK pay | `com.elevenst.skpay` | [Google Play](https://play.google.com/store/apps/details?hl=ko&id=com.elevenst.skpay) |
| L.POINT with L.PAY·엘페이 | `com.lottemembers.android` | [Google Play](https://play.google.com/store/apps/details?hl=ko&id=com.lottemembers.android) |
| SSGPAY·쓱페이 | `com.ssg.serviceapp.android.egiftcertificate` | [Google Play](https://play.google.com/store/apps/details?hl=ko&id=com.ssg.serviceapp.android.egiftcertificate) |
| 뱅크샐러드 | `com.rainist.banksalad2` | [Google Play](https://play.google.com/store/apps/details?hl=ko&id=com.rainist.banksalad2) |

## 선택기 적용 규칙

1. 선택한 종류와 같은 공식 카탈로그 앱을 명시한 우선순위대로 먼저 표시
2. 그다음 설치 앱 표시명에 `카드`, `Card`, `페이`, `Pay`, `월렛`, `Wallet`이 들어간 앱
3. 나머지 실행 가능한 설치 앱을 표시명 순으로 표시
4. 검색은 실제 표시명·패키지명과 위 표의 별칭을 모두 대상으로 함
5. FamilyCard 자체, 카카오톡 전체, 기본 SMS 앱은 목록에서 제외하고 저장 단계에서도 거부

앱 이름·패키지·서비스 통합은 바뀔 수 있습니다. 카탈로그를 수정할 때는 현재 공식 Play
등록을 다시 확인하고 이 문서의 확인일과 해당 행을 함께 갱신합니다. 제거된 앱을 카탈로그에
남겨도 자동 허용되지는 않지만 추천 검색이 낡아지므로 Phase별 릴리스 전에 재검토합니다.
