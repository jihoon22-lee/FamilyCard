package com.familycard.collector.queue

import android.content.Context
import com.familycard.collector.settings.AppSettings

/** 캡처 원문 저장과 즉시 업로드 예약을 한 경로로 묶는다. */
object CapturedMessageStore {
    fun enqueue(context: Context, message: PendingMessage) {
        val settings = AppSettings(context)
        try {
            QueueDatabase.getInstance(context).enqueue(message)
            settings.lastCaptureError = ""
            settings.lastCaptureErrorAt = 0L
        } catch (_: Exception) {
            // 제목·본문·발신자를 로그나 상태 문구에 절대 넣지 않는다.
            settings.lastCaptureError = "원문을 로컬 큐에 저장하지 못했습니다. 저장 공간을 확인해주세요."
            settings.lastCaptureErrorAt = System.currentTimeMillis()
            return
        }

        runCatching { UploadWorker.scheduleImmediate(context) }
            .onFailure {
                // 원문 저장은 끝났으므로 유실은 아니다. 주기 작업이 다시 시도한다.
                settings.lastUploadSummary = "원문 저장됨 · 즉시 전송 예약 실패 (주기 작업 대기)"
            }
    }
}
