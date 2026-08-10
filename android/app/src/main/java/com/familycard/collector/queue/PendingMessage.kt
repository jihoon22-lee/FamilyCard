package com.familycard.collector.queue

/**
 * 아직 서버에 올리지 못한 캡처 메시지.
 *
 * `receivedAt` 은 **캡처 시각**이지 업로드 시각이 아니다. 오프라인 큐 때문에
 * 사흘 뒤에 올라갈 수도 있는데, 그때도 알림이 온 시점이 보존돼야 거래 시각이
 * 맞는다.
 */
data class PendingMessage(
    val id: Long = 0,
    /** "NOTIFICATION" 또는 "SMS" — 서버의 MessageSource enum 과 대응 */
    val source: String,
    /** 알림이면 패키지명, SMS 면 발신번호 */
    val packageName: String,
    val title: String,
    val body: String,
    /** epoch millis */
    val receivedAt: Long,
    val attemptCount: Int = 0,
    val lastAttemptAt: Long? = null,
)
