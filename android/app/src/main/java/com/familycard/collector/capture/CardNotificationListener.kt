package com.familycard.collector.capture

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.familycard.collector.queue.PendingMessage
import com.familycard.collector.queue.QueueDatabase
import com.familycard.collector.queue.UploadWorker

/**
 * 폰에 오는 모든 알림을 받아 카드사 것만 큐에 넣는다.
 *
 * 사용자가 **설정 > 알림 접근 허용**에서 직접 켜야 한다. 앱이 코드로 부여할 수
 * 없다.
 */
class CardNotificationListener : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val extras = sbn.notification.extras
        val title = extras.getString(Notification.EXTRA_TITLE).orEmpty()

        // ★ 저장하기 전에 판정한다. 일단 저장하고 나중에 거르는 구조는 금지.
        //   걸러진 알림은 여기서 그대로 버려지고 변수에도 남지 않는다.
        if (!CaptureFilter.shouldCaptureNotification(sbn.packageName, title)) return

        val body = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
        if (body.isBlank()) return

        QueueDatabase(this).enqueue(
            PendingMessage(
                source = "NOTIFICATION",
                packageName = sbn.packageName,
                title = title,
                body = body,
                receivedAt = sbn.postTime,
            ),
        )
        // 로그를 남기지 않는다 — 제목·본문이 logcat 에 들어가면 버그 리포트에 딸려 간다.
    }

    override fun onListenerDisconnected() {
        // 안드로이드가 서비스를 끊었을 때 재연결을 시도한다. 조용히 멈추는 것이
        // 이 앱의 가장 위험한 실패 모드다.
        requestRebind(android.content.ComponentName(this, CardNotificationListener::class.java))
    }

    override fun onListenerConnected() {
        UploadWorker.schedule(this)
    }
}
