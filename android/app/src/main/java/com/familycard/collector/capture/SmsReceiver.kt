package com.familycard.collector.capture

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.familycard.collector.queue.PendingMessage
import com.familycard.collector.queue.CapturedMessageStore

/**
 * 카드사 결제 문자 수신. 일부 카드사·일부 카드는 여전히 SMS 로 온다.
 *
 * `READ_SMS` 는 요청하지 않는다 — 수신 알림만 필요하고 과거 문자를 읽을 이유가
 * 없다.
 */
class SmsReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        // 긴 문자는 여러 PDU 로 쪼개져 오므로 발신번호별로 이어 붙인다.
        Telephony.Sms.Intents.getMessagesFromIntent(intent)
            ?.groupBy { it.originatingAddress }
            ?.forEach { (sender, parts) ->
                val body = parts.joinToString("") { it.messageBody.orEmpty() }
                val receivedAt = parts.firstOrNull()?.timestampMillis ?: System.currentTimeMillis()

                // ★ 저장 전에 판정.
                if (!CaptureFilter.shouldCaptureSms(sender, body)) return@forEach

                CapturedMessageStore.enqueue(
                    context,
                    PendingMessage(
                        clientMessageId = CaptureEventId.sms(sender.orEmpty(), receivedAt, body),
                        source = "SMS",
                        packageName = sender.orEmpty(),
                        title = "",
                        body = body,
                        receivedAt = receivedAt,
                    ),
                )
            }
    }
}
