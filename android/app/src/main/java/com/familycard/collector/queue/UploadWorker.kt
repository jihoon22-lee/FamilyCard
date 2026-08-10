package com.familycard.collector.queue

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.familycard.collector.net.IngestClient
import com.familycard.collector.settings.AppSettings
import java.util.concurrent.TimeUnit

/**
 * 큐에 쌓인 메시지를 서버로 올린다.
 *
 * 재전송에 적극적이다. 서버가 멱등하므로(dedupeHash) 중복은 걸러지지만,
 * 유실은 되돌릴 수 없기 때문이다.
 */
class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val settings = AppSettings(applicationContext)
        if (!settings.isConfigured) {
            // 서버 주소나 토큰이 아직 없다. 큐는 그대로 두고 다음 기회를 기다린다.
            return Result.success()
        }

        val queue = QueueDatabase(applicationContext)
        val batch = queue.takeBatch(BATCH_SIZE)
        if (batch.isEmpty()) return Result.success()

        val client = IngestClient(settings.serverUrl, settings.deviceToken)

        return try {
            val response = client.upload(batch)

            if (UploadPolicy.shouldDeleteBatch(batch.size, response)) {
                queue.deleteAll(batch.map { it.id })
                settings.lastUploadAt = System.currentTimeMillis()
                settings.lastUploadSummary = "${batch.size}건 전송 (신규 ${response.accepted} · 중복 ${response.duplicates} · 거부 ${response.rejected})"
                Result.success()
            } else {
                // 서버가 보낸 개수를 전부 설명하지 못했다. 지우지 않고 재시도한다.
                queue.markAttempt(batch.map { it.id }, System.currentTimeMillis())
                settings.lastUploadSummary = "응답 개수 불일치 — 큐 유지 후 재시도"
                Result.retry()
            }
        } catch (error: Exception) {
            // 본문을 로그에 남기지 않는다. 메시지만.
            queue.markAttempt(batch.map { it.id }, System.currentTimeMillis())
            settings.lastUploadSummary = "전송 실패 — 재시도 예정"
            Result.retry()
        }
    }

    companion object {
        /** 서버의 INGEST_MAX_BATCH_SIZE 기본값과 맞춘다. */
        private const val BATCH_SIZE = 200
        private const val UNIQUE_WORK_NAME = "familycard-upload"

        /** 주기 작업을 건다. 이미 걸려 있으면 유지한다. */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<UploadWorker>(15, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                UNIQUE_WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }
    }
}
