package com.familycard.collector.history

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Telephony
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.familycard.collector.capture.CaptureOriginKind
import com.familycard.collector.queue.QueueDatabase
import com.familycard.collector.queue.UploadWorker
import com.familycard.collector.settings.AppSettings
import com.familycard.collector.settings.CaptureSourceStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.util.UUID

/** 사용자가 요청할 때만 실행. 본문은 WorkManager 입력/출력/로그에 넣지 않는다. */
class SmsHistoryWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        var queued = 0
        var alreadyQueued = 0
        var missingTimestamp = 0
        fun progress(message: String): Data = workDataOf(
            SUMMARY to message,
            QUEUED to queued,
            ALREADY_QUEUED to alreadyQueued,
            MISSING_TIMESTAMP to missingTimestamp,
        )
        try {
            if (applicationContext.checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
                return@withContext Result.failure(progress("문자 읽기 권한이 필요합니다. 권한을 허용한 뒤 다시 실행해주세요."))
            }
            val range = SmsHistoryRange(inputData.getLong(FROM, 0), inputData.getLong(THROUGH, 0))
            val senders = inputData.getStringArray(SENDERS)?.toSet().orEmpty()
            if (senders.isEmpty()) return@withContext Result.failure(progress("먼저 SMS 발신자를 등록해주세요."))
            val sources = CaptureSourceStore(applicationContext)
            val queue = QueueDatabase.getInstance(applicationContext)
            val resolver = applicationContext.contentResolver
            // 앱 중단 후에도 이미 큐에 들어간 원문은 주기 업로드로 복구한다.
            UploadWorker.schedule(applicationContext)
            setProgress(progress("문자를 확인하고 있습니다."))
            // 전체 본문을 읽지 않는다. Cursor로 메타데이터만 순차 처리해 메모리를 제한한다.
            val cursor = resolver.query(
                Telephony.Sms.Inbox.CONTENT_URI,
                arrayOf(Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.DATE, Telephony.Sms.DATE_SENT),
                "${Telephony.Sms.DATE} >= ? AND ${Telephony.Sms.DATE} <= ?",
                arrayOf(range.from.toString(), range.through.toString()),
                "${Telephony.Sms._ID} ASC",
            ) ?: error("SMS metadata query unavailable")
            cursor.use {
                while (it.moveToNext()) {
                    ensureActive()
                    val entry = SmsHistoryEntry(it.getLong(0), it.getString(1), it.getLong(2), it.getLong(3))
                    val outcome = SmsHistoryImport.copyOne(
                        entry, range, senders, sources::load,
                        readBody = {
                            ensureActive()
                            // 메타데이터 조회 후 행이 바뀌었어도 다른 발신자의 본문을 읽지 않는다.
                            val bodyCursor = resolver.query(
                                Telephony.Sms.Inbox.CONTENT_URI,
                                arrayOf(Telephony.Sms.BODY),
                                "${Telephony.Sms._ID} = ? AND ${Telephony.Sms.ADDRESS} = ? AND " +
                                    "${Telephony.Sms.DATE} = ? AND ${Telephony.Sms.DATE_SENT} = ?",
                                arrayOf(entry.id.toString(), entry.sender.orEmpty(), entry.receivedAt.toString(), entry.sentAt.toString()),
                                null,
                            ) ?: error("SMS body query unavailable")
                            bodyCursor.use { body -> if (body.moveToFirst()) body.getString(0) else null }
                        },
                        enqueue = { message ->
                            ensureActive()
                            queue.enqueue(message)
                        },
                    )
                    when (outcome) {
                        SmsHistoryOutcome.QUEUED -> queued++
                        SmsHistoryOutcome.ALREADY_QUEUED -> alreadyQueued++
                        SmsHistoryOutcome.MISSING_TIMESTAMP -> missingTimestamp++
                        SmsHistoryOutcome.SKIPPED -> Unit
                    }
                    if ((it.position + 1) % 100 == 0) setProgress(progress("문자를 확인하고 있습니다."))
                }
            }
            Result.success(progress("가져오기가 완료되었습니다. 저장한 문자는 서버에 순서대로 전송합니다."))
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: SecurityException) {
            Result.failure(progress("문자 읽기 권한이 없거나 기기에서 접근을 제한했습니다. 저장된 문자는 유지됩니다."))
        } catch (_: Exception) {
            // provider/SQLite 예외 메시지는 실제 본문·발신자를 포함할 수 있어 노출하지 않는다.
            Result.failure(progress("가져오기를 완료하지 못했습니다. 저장 공간과 문자 접근을 확인한 뒤 다시 실행해주세요. 저장된 문자는 유지됩니다."))
        } finally {
            runCatching { UploadWorker.scheduleImmediate(applicationContext) }.onFailure {
                AppSettings(applicationContext).lastUploadSummary = "문자 저장됨 · 즉시 전송 예약 실패 (주기 작업 대기)"
            }
        }
    }

    companion object {
        const val SUMMARY = "summary"
        const val QUEUED = "queued"
        const val ALREADY_QUEUED = "already_queued"
        const val MISSING_TIMESTAMP = "missing_timestamp"
        private const val FROM = "from"
        private const val THROUGH = "through"
        private const val SENDERS = "senders"
        private const val WORK_NAME = "familycard-sms-history"
        private const val PREFS = "familycard_sms_history"
        private const val LAST_WORK = "last_work_id"

        fun lastWorkId(context: Context): UUID? = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(LAST_WORK, null)?.let { runCatching { UUID.fromString(it) }.getOrNull() }

        suspend fun start(context: Context, days: Int): UUID = withContext(Dispatchers.IO) {
            val range = SmsHistoryRange.recent(days, System.currentTimeMillis())
            val senders = CaptureSourceStore(context).load()
                .filter { it.kind == CaptureOriginKind.SMS_SENDER }.map { it.identifier }.toTypedArray()
            require(senders.isNotEmpty())
            val request = OneTimeWorkRequestBuilder<SmsHistoryWorker>()
                .setInputData(workDataOf(FROM to range.from, THROUGH to range.through, SENDERS to senders))
                .build()
            // 사용자의 재실행은 이전 작업을 대체하되 큐에 저장된 원문은 건드리지 않는다.
            WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, request).result.get()
            check(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(LAST_WORK, request.id.toString()).commit())
            request.id
        }
    }
}
