package com.familycard.collector.capture

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.familycard.collector.queue.PendingMessage
import com.familycard.collector.queue.CapturedMessageStore
import com.familycard.collector.settings.CaptureSourceStore

/**
 * 카드사 결제 문자 수신. 일부 카드사·일부 카드는 여전히 SMS 로 온다.
 *
 * `READ_SMS` 는 요청하지 않는다 — 수신 알림만 필요하고 과거 문자를 읽을 이유가
 * 없다.
 */
class SmsReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val sources = CaptureSourceStore(context).load()

        // 긴 문자는 여러 PDU 로 쪼개져 오므로 발신번호별로 묶는다. 본문을 이어
        // 붙이기 전에 발신자 화이트리스트를 먼저 확인한다.
        Telephony.Sms.Intents.getMessagesFromIntent(intent)
            ?.groupBy { it.originatingAddress }
            ?.forEach { (sender, parts) ->
                val captureSource = CaptureFilter.matchSmsSender(sender, sources) ?: return@forEach
                val body = parts.joinToString("") { it.messageBody.orEmpty() }
                if (!CaptureFilter.hasTransactionKeyword(body)) return@forEach

                val receivedAt = parts.firstOrNull()?.timestampMillis ?: System.currentTimeMillis()
                CapturedMessageStore.enqueue(
                    context,
                    PendingMessage(
                        clientMessageId = CaptureEventId.sms(sender.orEmpty(), receivedAt, body),
                        source = "SMS",
                        originKind = captureSource.kind.wireValue,
                        packageName = sender.orEmpty(),
                        title = "",
                        body = body,
                        receivedAt = receivedAt,
                    ),
                )
            }
    }
}
