package com.familycard.collector.status

import org.json.JSONObject

/** Fixed metadata contract: no text, message identifiers, senders or credentials. */
data class DeviceStatusPayload(
    val versionCode: Int,
    val pending: Int,
    val rejected: Int,
    val sampledAt: Long,
    val lastQueuedAt: Long,
    val lastUploadAttemptAt: Long,
    val lastUploadAt: Long,
    val rcsAttemptedAt: Long,
    val rcsCompletedThrough: Long,
    val rcsEnabled: Boolean,
    val notificationGranted: Boolean,
    val smsGranted: Boolean,
    val smsReadGranted: Boolean,
) {
    fun json(): String = JSONObject().apply {
        put("protocol", 1)
        put("versionCode", versionCode)
        put("pending", pending)
        put("rejected", rejected)
        put("sampledAt", sampledAt)
        put("lastQueuedAt", lastQueuedAt)
        put("lastUploadAttemptAt", lastUploadAttemptAt)
        put("lastUploadAt", lastUploadAt)
        put("rcsAttemptedAt", rcsAttemptedAt)
        put("rcsCompletedThrough", rcsCompletedThrough)
        put("rcsEnabled", rcsEnabled)
        put("notificationGranted", notificationGranted)
        put("smsGranted", smsGranted)
        put("smsReadGranted", smsReadGranted)
    }.toString()
}
