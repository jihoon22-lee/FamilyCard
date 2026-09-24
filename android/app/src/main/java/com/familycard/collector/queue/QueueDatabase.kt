package com.familycard.collector.queue

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.util.UUID
import com.familycard.collector.settings.AppSettings

enum class QueueEnqueueResult { INSERTED, ALREADY_QUEUED }

/**
 * 미전송 원문 큐와 서버 거부 격리함.
 *
 * 업그레이드에서 큐 테이블을 DROP하지 않는다. 미전송 원문은 다른 곳에서
 * 복구할 수 없기 때문에 모든 마이그레이션은 보존 방식이어야 한다.
 */
class QueueDatabase internal constructor(context: Context) :
    SQLiteOpenHelper(context.applicationContext, DATABASE_NAME, null, DATABASE_VERSION) {

    private val settings = AppSettings(context)

    override fun onCreate(db: SQLiteDatabase) {
        createPendingTable(db)
        createRejectedTable(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            // v1 큐의 기존 원문마다 안정적인 ID를 한 번 부여한다. 행을 지우거나
            // 다시 만들지 않아 업그레이드 도중에도 원문이 보존된다.
            db.execSQL("ALTER TABLE $PENDING_TABLE ADD COLUMN client_message_id TEXT")
            db.query(PENDING_TABLE, arrayOf("id"), null, null, null, null, null).use { cursor ->
                while (cursor.moveToNext()) {
                    val id = cursor.getLong(0)
                    val values = ContentValues().apply {
                        put("client_message_id", UUID.randomUUID().toString())
                    }
                    db.update(PENDING_TABLE, values, "id = ?", arrayOf(id.toString()))
                }
            }
            db.execSQL(
                "CREATE UNIQUE INDEX idx_${PENDING_TABLE}_client_message_id " +
                    "ON $PENDING_TABLE(client_message_id)",
            )
        }

        if (oldVersion < 3) {
            addAndBackfillOriginKind(db, PENDING_TABLE)
            if (oldVersion < 2) {
                // v1에는 rejected_message가 없었다. 최신 구조로 새로 만든다.
                createRejectedTable(db)
            } else {
                addAndBackfillOriginKind(db, REJECTED_TABLE)
            }
        }
    }

    fun enqueue(message: PendingMessage): QueueEnqueueResult {
        require(message.clientMessageId.isNotBlank()) { "clientMessageId must not be blank" }
        val values = pendingValues(message)
        val rowId = writableDatabase.insertWithOnConflict(
            PENDING_TABLE,
            null,
            values,
            SQLiteDatabase.CONFLICT_IGNORE,
        )
        if (rowId != -1L) settings.lastQueuedAt = System.currentTimeMillis()
        // 테이블의 유일한 충돌 가능 제약은 client_message_id UNIQUE다. 같은
        // OS 콜백이 다시 온 것은 이미 보존된 사건이므로 오류가 아니다.
        return if (rowId == -1L) QueueEnqueueResult.ALREADY_QUEUED else QueueEnqueueResult.INSERTED
    }

    /** 오래된 것부터 최대 [limit]건. */
    fun takeBatch(limit: Int): List<PendingMessage> {
        val rows = mutableListOf<PendingMessage>()
        readableDatabase.query(
            PENDING_TABLE,
            null,
            null,
            null,
            null,
            null,
            "received_at ASC, id ASC",
            limit.toString(),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                rows += readMessage(cursor)
            }
        }
        return rows
    }

    /**
     * 승인·중복 삭제와 거부 격리를 하나의 SQLite 트랜잭션으로 적용한다.
     * 격리 INSERT가 끝나기 전에는 대응하는 큐 행을 삭제하지 않는다.
     */
    fun applyUploadPlan(plan: UploadPlan, rejectedAt: Long) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            plan.quarantined.forEach { item ->
                val values = pendingValues(item.message).apply {
                    put("rejection_reason", item.reason)
                    put("rejected_at", rejectedAt)
                }
                insertPreserving(db, REJECTED_TABLE, item.message, values)
                // 재실패한 항목의 원문은 그대로 두고 마지막 사유만 갱신한다.
                db.update(REJECTED_TABLE, ContentValues().apply {
                    put("rejection_reason", item.reason)
                    put("rejected_at", rejectedAt)
                }, "client_message_id = ?", arrayOf(item.message.clientMessageId))
            }

            val processedIds = plan.deleteIds + plan.quarantined.map { it.message.id }
            deleteAll(db, processedIds)
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    /** 화면을 열었을 때만 최대 20건의 메타데이터 조회. 본문은 상세 열기 때 한 건씩. */
    fun rejectedPage(beforeId: Long = Long.MAX_VALUE): List<RejectedMessageSummary> = buildList {
        readableDatabase.query(
            REJECTED_TABLE, arrayOf("id", "source", "received_at", "rejected_at", "rejection_reason"),
            "id < ?", arrayOf(beforeId.toString()), null, null, "id DESC", "20",
        ).use { cursor ->
            while (cursor.moveToNext()) add(RejectedMessageSummary(
                id = cursor.getLong(0), source = cursor.getString(1), receivedAt = cursor.getLong(2),
                rejectedAt = cursor.getLong(3), reason = cursor.getString(4),
            ))
        }
    }

    fun rejectedMessage(id: Long): PendingMessage? = readableDatabase.query(
        REJECTED_TABLE, null, "id = ?", arrayOf(id.toString()), null, null, null,
    ).use { cursor -> if (cursor.moveToFirst()) readMessage(cursor) else null }

    /** 같은 사건 ID·원문으로 대기열 저장을 확인한 뒤에만 격리함에서 이동한다. */
    fun retryRejected(id: Long): Boolean {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val message = rejectedMessage(id) ?: return false
            insertPreserving(db, PENDING_TABLE, message, pendingValues(message))
            check(db.delete(REJECTED_TABLE, "id = ?", arrayOf(id.toString())) == 1)
            db.setTransactionSuccessful()
            return true
        } finally {
            db.endTransaction()
        }
    }

    private fun insertPreserving(db: SQLiteDatabase, table: String, message: PendingMessage, values: ContentValues) {
        db.insertWithOnConflict(table, null, values, SQLiteDatabase.CONFLICT_IGNORE)
        // INSERT 실패 또는 다른 원문과 ID 충돌이면 삭제하지 않고 전체 작업을 롤백한다.
        val saved = db.query(table, null, "client_message_id = ?", arrayOf(message.clientMessageId),
            null, null, null).use { cursor -> if (cursor.moveToFirst()) readMessage(cursor) else null }
        check(saved != null && saved.copy(id = message.id, attemptCount = message.attemptCount,
            lastAttemptAt = message.lastAttemptAt) == message) { "Queue preservation check failed" }
    }

    private fun readMessage(cursor: Cursor): PendingMessage = PendingMessage(
        id = cursor.getLong(cursor.getColumnIndexOrThrow("id")),
        clientMessageId = cursor.getString(cursor.getColumnIndexOrThrow("client_message_id")),
        source = cursor.getString(cursor.getColumnIndexOrThrow("source")),
        originKind = cursor.getString(cursor.getColumnIndexOrThrow("origin_kind")),
        packageName = cursor.getString(cursor.getColumnIndexOrThrow("package_name")),
        title = cursor.getString(cursor.getColumnIndexOrThrow("title")),
        body = cursor.getString(cursor.getColumnIndexOrThrow("body")),
        receivedAt = cursor.getLong(cursor.getColumnIndexOrThrow("received_at")),
        attemptCount = cursor.getInt(cursor.getColumnIndexOrThrow("attempt_count")),
        lastAttemptAt = cursor.getColumnIndexOrThrow("last_attempt_at").let { index ->
            if (cursor.isNull(index)) null else cursor.getLong(index)
        },
    )

    /** 실패한 배치의 재시도 횟수를 올린다. 진단용이며 자동 폐기하지 않는다. */
    fun markAttempt(ids: List<Long>, at: Long) {
        if (ids.isEmpty()) return
        val placeholders = ids.joinToString(",") { "?" }
        writableDatabase.execSQL(
            "UPDATE $PENDING_TABLE " +
                "SET attempt_count = attempt_count + 1, last_attempt_at = ? " +
                "WHERE id IN ($placeholders)",
            (listOf(at) + ids).toTypedArray(),
        )
    }

    fun pendingCount(): Int = countRows(PENDING_TABLE)

    fun rejectedCount(): Int = countRows(REJECTED_TABLE)

    private fun countRows(table: String): Int =
        readableDatabase.rawQuery("SELECT COUNT(*) FROM $table", null).use { cursor ->
            if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }

    private fun pendingValues(message: PendingMessage): ContentValues = ContentValues().apply {
        put("client_message_id", message.clientMessageId)
        put("source", message.source)
        put("origin_kind", message.originKind)
        put("package_name", message.packageName)
        put("title", message.title)
        put("body", message.body)
        put("received_at", message.receivedAt)
        put("attempt_count", message.attemptCount)
        message.lastAttemptAt?.let { put("last_attempt_at", it) }
    }

    private fun deleteAll(db: SQLiteDatabase, ids: List<Long>) {
        if (ids.isEmpty()) return
        val placeholders = ids.joinToString(",") { "?" }
        db.delete(PENDING_TABLE, "id IN ($placeholders)", ids.map(Long::toString).toTypedArray())
    }

    private fun createPendingTable(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE $PENDING_TABLE (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                client_message_id TEXT    NOT NULL UNIQUE,
                source            TEXT    NOT NULL,
                origin_kind       TEXT    NOT NULL,
                package_name      TEXT    NOT NULL,
                title             TEXT    NOT NULL,
                body              TEXT    NOT NULL,
                received_at       INTEGER NOT NULL,
                attempt_count     INTEGER NOT NULL DEFAULT 0,
                last_attempt_at   INTEGER
            )
            """.trimIndent(),
        )
        db.execSQL("CREATE INDEX idx_${PENDING_TABLE}_received_at ON $PENDING_TABLE(received_at)")
    }

    private fun createRejectedTable(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS $REJECTED_TABLE (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                client_message_id TEXT    NOT NULL UNIQUE,
                source            TEXT    NOT NULL,
                origin_kind       TEXT    NOT NULL,
                package_name      TEXT    NOT NULL,
                title             TEXT    NOT NULL,
                body              TEXT    NOT NULL,
                received_at       INTEGER NOT NULL,
                attempt_count     INTEGER NOT NULL,
                last_attempt_at   INTEGER,
                rejection_reason  TEXT    NOT NULL,
                rejected_at       INTEGER NOT NULL
            )
            """.trimIndent(),
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS idx_${REJECTED_TABLE}_rejected_at " +
                "ON $REJECTED_TABLE(rejected_at)",
        )
    }

    /** v1/v2 행을 삭제하거나 테이블을 재작성하지 않고 출처 종류를 보수적으로 채운다. */
    private fun addAndBackfillOriginKind(db: SQLiteDatabase, table: String) {
        db.execSQL("ALTER TABLE $table ADD COLUMN origin_kind TEXT")
        db.execSQL(
            """
            UPDATE $table
            SET origin_kind = CASE
                WHEN source = 'SMS' THEN 'SMS_SENDER'
                WHEN package_name = 'com.kakao.talk' THEN 'KAKAO_CHANNEL'
                ELSE 'UNKNOWN_APP'
            END
            """.trimIndent(),
        )
    }

    companion object {
        private const val DATABASE_NAME = "familycard_queue.db"
        private const val DATABASE_VERSION = 3
        private const val PENDING_TABLE = "pending_message"
        private const val REJECTED_TABLE = "rejected_message"

        @Volatile
        private var instance: QueueDatabase? = null

        fun getInstance(context: Context): QueueDatabase = instance ?: synchronized(this) {
            instance ?: QueueDatabase(context.applicationContext).also { instance = it }
        }
    }
}
