package com.familycard.collector.history

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.work.BackoffPolicy
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.familycard.collector.capture.CaptureOriginKind
import com.familycard.collector.queue.QueueDatabase
import com.familycard.collector.queue.UploadWorker
import com.familycard.collector.settings.AppSettings
import com.familycard.collector.settings.CaptureSourceStore
import com.familycard.collector.settings.RcsAutoSettings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/** 사용자가 켠 기기에서만 실행하는 로컬 보관함 보충. 네트워크 없이도 큐에 보존한다. */
class RcsAutoWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        scanLock.withLock {
            val store = RcsAutoSettings(applicationContext)
            val state = store.load()
            if (!state.enabled) return@withLock Result.success()
            // 예약 시점이 아닌 실행 시작의 선택을 고정한다. 켜기/복구 예약 경합으로
            // 오래된 입력이 남아도 주기 작업이 영구히 무시되지 않게 한다.
            val generation = state.generation
            var queued = 0
            var alreadyQueued = 0
            val settings = AppSettings(applicationContext)
            val allTextAtStart = settings.captureAllRegisteredMessageText
            val sources = CaptureSourceStore(applicationContext)
            val senders = sources.load().filter { it.kind == CaptureOriginKind.SMS_SENDER }
                .map { it.identifier }.toSet()
            val coroutineContext = coroutineContext
            val checkActive = {
                coroutineContext.ensureActive()
                store.whileCurrent(generation) { Unit }
            }
            try {
                store.attempted(generation, System.currentTimeMillis())
                if (applicationContext.checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
                    store.summary(generation, "문자 읽기 권한이 필요합니다. 자동 보충 설정에서 권한을 확인해주세요.")
                    return@withLock Result.success()
                }
                if (senders.isEmpty()) {
                    store.summary(generation, "등록한 문자 발신자가 없습니다. 발신자 등록 후 다시 확인합니다.")
                    return@withLock Result.success()
                }
                val queue = QueueDatabase.getInstance(applicationContext)
                UploadWorker.schedule(applicationContext)
                val outcome = RcsAutoScan.catchUp(
                    state.since, state.completedThrough, System.currentTimeMillis(), checkActive,
                    collect = { range ->
                        SamsungRcsReader(applicationContext).collect(
                            range, senders, sources::load, checkActive,
                            enqueue = { message ->
                                checkActive()
                                store.whileCurrent(generation) { queue.enqueue(message) }
                            },
                            onOutcome = {
                                when (it) {
                                    SmsHistoryOutcome.QUEUED -> queued++
                                    SmsHistoryOutcome.ALREADY_QUEUED -> alreadyQueued++
                                    SmsHistoryOutcome.OVERSIZED -> store.warnOversized(generation)
                                    else -> Unit
                                }
                            },
                            includeAllText = { allTextAtStart && settings.captureAllRegisteredMessageText },
                        )
                    },
                    checkpoint = { store.checkpoint(generation, it) },
                )
                store.summary(generation, when (outcome) {
                    RcsReadResult.COMPLETE -> "RCS 확인 완료 · 대기열 저장 $queued 건 · 이미 대기 중 $alreadyQueued 건"
                    null -> "폰의 날짜·시간을 확인해주세요. 완료한 조회 구간은 유지됩니다."
                    else -> outcome.summary
                })
                Result.success()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: SecurityException) {
                store.summary(generation, "기기가 문자 보관함 접근을 제한했습니다. 권한을 확인해주세요.")
                Result.success()
            } catch (_: Exception) {
                // provider/SQLite 오류에 본문·발신자가 들어갈 수 있으므로 예외 문자열을 표시하지 않는다.
                store.summary(generation, "RCS 자동 보충 실패 — 저장한 원문과 조회 위치를 유지하고 재시도합니다.")
                Result.retry()
            } finally {
                // 중지/실패 전 저장한 원문도 전송. 예약 실패는 기존 주기 업로드가 복구한다.
                if (queued > 0) runCatching { UploadWorker.scheduleImmediate(applicationContext) }.onFailure {
                    settings.lastUploadSummary = "RCS 저장됨 · 즉시 전송 예약 실패 (주기 작업 대기)"
                }
            }
        }
    }

    companion object {
        private const val PERIODIC = "familycard-rcs-auto"
        private const val IMMEDIATE = "familycard-rcs-auto-now"
        private val scanLock = Mutex()

        /** 앱 시작/재부팅은 기존 선택만 복구한다. 자동 활성화하지 않는다. */
        fun restore(context: Context) {
            val state = RcsAutoSettings(context).load()
            if (!state.enabled) return
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC, ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<RcsAutoWorker>(15, TimeUnit.MINUTES)
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                    .build(),
            )
        }

        suspend fun configure(context: Context, enabled: Boolean) = withContext(Dispatchers.IO) {
            if (enabled) {
                check(context.checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED)
                check(CaptureSourceStore(context).load().any { it.kind == CaptureOriginKind.SMS_SENDER })
            }
            val store = RcsAutoSettings(context)
            val manager = WorkManager.getInstance(context)
            store.disable() // 이전 실행의 저장/진행 시각 갱신을 먼저 차단한다.
            manager.cancelUniqueWork(PERIODIC).result.get()
            manager.cancelUniqueWork(IMMEDIATE).result.get()
            if (enabled) {
                store.enable(System.currentTimeMillis())
                restore(context)
                checkNow(context)
            }
        }

        suspend fun checkNow(context: Context) = withContext(Dispatchers.IO) {
            val state = RcsAutoSettings(context).load()
            check(state.enabled)
            WorkManager.getInstance(context).enqueueUniqueWork(
                IMMEDIATE, ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<RcsAutoWorker>()
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                    .build(),
            ).result.get()
        }
    }
}
