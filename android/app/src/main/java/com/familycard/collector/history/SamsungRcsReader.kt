package com.familycard.collector.history

import android.content.Context
import android.content.pm.ApplicationInfo
import android.database.Cursor
import android.database.sqlite.SQLiteException
import android.net.Uri
import android.os.Build
import com.familycard.collector.capture.CaptureSourceConfig
import com.familycard.collector.queue.PendingMessage
import com.familycard.collector.queue.QueueEnqueueResult
import kotlinx.coroutines.CancellationException

/** 비표준 삼성 provider 호환 경로. 권한/스키마 미지원은 건너뛰고 SMS 결과는 유지한다. */
class SamsungRcsReader(private val context: Context) {
    suspend fun collect(
        range: SmsHistoryRange,
        approvedSenders: Set<String>,
        currentSources: () -> List<CaptureSourceConfig>,
        checkActive: () -> Unit,
        enqueue: (PendingMessage) -> QueueEnqueueResult,
        onOutcome: suspend (SmsHistoryOutcome) -> Unit,
        includeAllText: () -> Boolean = { false },
    ): RcsReadResult {
        if (!Build.MANUFACTURER.equals("samsung", ignoreCase = true)) return RcsReadResult.UNSUPPORTED_DEVICE
        val provider = context.packageManager.resolveContentProvider("im", 0)
        val flags = provider?.applicationInfo?.flags ?: 0
        if (flags and (ApplicationInfo.FLAG_SYSTEM or ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) == 0) {
            return RcsReadResult.UNAVAILABLE
        }
        var denied = false
        // 최신 호환 경로 우선. 둘은 같은 보관함의 별칭일 수 있어 하나만 선택한다.
        for (path in listOf("content://im/rcs_read_im", "content://im/chat")) {
            checkActive()
            val uri = Uri.parse(path)
            val projection = arrayOf("_id", "address", "date", "type")
            val metadata: Cursor = try {
                context.contentResolver.query(
                    uri, projection, "type = ? AND date >= ? AND date <= ?",
                    arrayOf("1", range.from.toString(), range.through.toString()), "_id ASC",
                ) ?: continue
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: SecurityException) {
                denied = true
                continue
            } catch (_: IllegalArgumentException) {
                continue
            } catch (_: SQLiteException) {
                continue
            }
            metadata.use { cursor ->
                val columns = projection.map(cursor::getColumnIndex)
                if (columns.any { it < 0 }) return@use
                while (cursor.moveToNext()) {
                    checkActive()
                    val entry = SmsHistoryEntry(
                        cursor.getLong(columns[0]), cursor.getString(columns[1]), cursor.getLong(columns[2]), 0,
                    )
                    val outcome = RcsHistoryImport.copyOne(
                        entry, cursor.getInt(columns[3]), range, approvedSenders, currentSources,
                        readBody = {
                            checkActive()
                            val bodyCursor = context.contentResolver.query(
                                uri, arrayOf("body"), "_id = ? AND address = ? AND date = ? AND type = ?",
                                arrayOf(entry.id.toString(), entry.sender.orEmpty(), entry.receivedAt.toString(), "1"), null,
                            ) ?: error("RCS body query unavailable")
                            bodyCursor.use { if (it.moveToFirst()) it.getString(it.getColumnIndexOrThrow("body")) else null }
                        },
                        enqueue = enqueue,
                        includeAllText = includeAllText,
                    )
                    onOutcome(outcome)
                }
                return RcsReadResult.COMPLETE
            }
        }
        return if (denied) RcsReadResult.DENIED else RcsReadResult.UNSUPPORTED_FORMAT
    }
}
