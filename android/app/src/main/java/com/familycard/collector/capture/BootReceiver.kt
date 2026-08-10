package com.familycard.collector.capture

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.familycard.collector.queue.UploadWorker

/**
 * 재부팅 후 업로드 주기 작업을 다시 건다.
 *
 * 알림 리스너 자체는 시스템이 되살리지만, WorkManager 주기 작업은 앱 프로세스가
 * 한 번 떠야 등록된다. 재부팅 후 사용자가 앱을 열지 않으면 큐가 쌓이기만 한다.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        UploadWorker.schedule(context)
    }
}
