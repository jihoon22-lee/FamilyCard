package com.familycard.collector.queue

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.familycard.collector.net.IngestClient
import com.familycard.collector.net.IngestException
import com.familycard.collector.net.IngestProtocolException
import com.familycard.collector.settings.AppSettings
import kotlinx.coroutines.CancellationException
import java.util.concurrent.TimeUnit

/** 로컬 큐를 서버에 전달한다. 애매한 응답에서는 원문을 삭제하지 않는다. */
class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val settings = AppSettings(applicationContext)
        if (!settings.isConfigured) return Result.success()

        val queue = QueueDatabase.getInstance(applicationContext)
        val client = IngestClient(settings.serverUrl, settings.deviceToken)
        var acceptedTotal = 0
        var duplicateTotal = 0
        var rejectedTotal = 0

        while (true) {
            val batch = queue.takeBatch(BATCH_SIZE)
            if (batch.isEmpty()) {
                if (acceptedTotal + duplicateTotal + rejectedTotal > 0) {
                    settings.lastUploadAt = System.currentTimeMillis()
                    settings.lastUploadSummary =
                        "전송 완료 (신규 $acceptedTotal · 중복 $duplicateTotal · 격리 $rejectedTotal)"
                }
                return Result.success()
            }

            val response = try {
                client.upload(batch)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: IngestException) {
                queue.markAttempt(batch.map { it.id }, System.currentTimeMillis())
                settings.lastUploadSummary = when (error.statusCode) {
                    401, 403 -> "인증 실패 — 기기 토큰을 확인해주세요. 큐는 유지됩니다."
                    400, 413 -> "앱·서버 계약 오류 — 업데이트가 필요합니다. 큐는 유지됩니다."
                    else -> "서버 오류 — 큐 유지 후 재시도 예정"
                }
                // 영구 오류에서 failure를 반환하면 periodic work 자체가 끝나 토큰을
                // 고친 뒤에도 안전망이 사라질 수 있다. 큐는 유지하고 이번 실행만
                // 정상 종료해 다음 주기·설정 저장·새 캡처가 다시 시도하게 한다.
                return when (UploadPolicy.failureActionForHttpStatus(error.statusCode)) {
                    UploadFailureAction.RETRY_WITH_BACKOFF -> Result.retry()
                    UploadFailureAction.WAIT_FOR_NEXT_TRIGGER -> Result.success()
                }
            } catch (_: IngestProtocolException) {
                queue.markAttempt(batch.map { it.id }, System.currentTimeMillis())
                settings.lastUploadSummary = "서버 응답 형식 오류 — 큐는 유지됩니다."
                return Result.success()
            } catch (_: Exception) {
                queue.markAttempt(batch.map { it.id }, System.currentTimeMillis())
                settings.lastUploadSummary = "전송 실패 — 큐 유지 후 재시도 예정"
                return Result.retry()
            }

            val plan = UploadPolicy.buildPlan(batch, response)
            if (plan == null) {
                queue.markAttempt(batch.map { it.id }, System.currentTimeMillis())
                settings.lastUploadSummary = "항목별 응답 불일치 — 큐 유지 (다음 주기 재시도)"
                return Result.success()
            }

            try {
                queue.applyUploadPlan(plan, System.currentTimeMillis())
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                queue.markAttempt(batch.map { it.id }, System.currentTimeMillis())
                settings.lastUploadSummary = "전송 결과 저장 실패 — 큐 유지 후 재시도"
                return Result.retry()
            }

            acceptedTotal += response.accepted
            duplicateTotal += response.duplicates
            rejectedTotal += response.rejected
            settings.lastUploadAt = System.currentTimeMillis()

            // 꽉 찬 배치였다면 뒤에 더 있을 수 있으므로 같은 작업에서 계속
            // 비운다. 15분 뒤 다음 주기까지 백로그를 방치하지 않는다.
            if (batch.size < BATCH_SIZE) {
                settings.lastUploadSummary =
                    "전송 완료 (신규 $acceptedTotal · 중복 $duplicateTotal · 격리 $rejectedTotal)"
                return Result.success()
            }
        }
    }

    companion object {
        private const val BATCH_SIZE = 200
        private const val UNIQUE_PERIODIC_WORK_NAME = "familycard-upload-periodic"
        private const val UNIQUE_IMMEDIATE_WORK_NAME = "familycard-upload-immediate"
        private fun networkConstraints(): Constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        /** 15분 주기 복구 안전망. */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<UploadWorker>(15, TimeUnit.MINUTES)
                .setConstraints(networkConstraints())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                UNIQUE_PERIODIC_WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }

        /** 새 원문 저장·설정 저장·수동 전송 직후 실행하는 일회성 작업. */
        fun scheduleImmediate(context: Context) {
            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .setConstraints(networkConstraints())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()

            // 실행 중인 작업 뒤에 하나를 보장해, 작업이 큐를 비운 직후 새 원문이
            // 들어오는 경합에서도 다음 15분 주기를 기다리지 않게 한다.
            WorkManager.getInstance(context).enqueueUniqueWork(
                UNIQUE_IMMEDIATE_WORK_NAME,
                ExistingWorkPolicy.APPEND_OR_REPLACE,
                request,
            )
        }
    }
}
