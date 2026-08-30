package com.familycard.collector.capture

import java.nio.charset.StandardCharsets
import java.util.UUID

/** 같은 OS 캡처 이벤트가 중복 콜백돼도 동일한 clientMessageId를 만든다. */
object CaptureEventId {
    fun notification(notificationKey: String, receivedAt: Long, body: String): String =
        stableUuid("notification|$notificationKey|$receivedAt|$body")

    fun sms(sender: String, receivedAt: Long, body: String): String =
        stableUuid("sms|$sender|$receivedAt|$body")

    private fun stableUuid(value: String): String =
        UUID.nameUUIDFromBytes(value.toByteArray(StandardCharsets.UTF_8)).toString()
}
