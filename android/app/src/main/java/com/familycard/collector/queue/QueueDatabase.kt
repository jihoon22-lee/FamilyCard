package com.familycard.collector.queue

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.util.UUID

enum class QueueEnqueueResult { INSERTED, ALREADY_QUEUED }

/**
 * 미전송 원문 큐와 서버 거부 격리함.
 *
 * 업그레이드에서 큐 테이블을 DROP하지 않는다. 미전송 원문은 다른 곳에서
 * 복구할 수 없기 때문에 모든 마이그레이션은 보존 방식이어야 한다.
 */
class QueueDatabase private constructor(context: Context) :
    SQLiteOpenHelper(context.applicationContext, DATABASE_NAME, null, DATABASE_VERSION) {

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
            createRejectedTable(db)
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
                rows += PendingMessage(
                    id = cursor.getLong(cursor.getColumnIndexOrThrow("id")),
                    clientMessageId = cursor.getString(
                        cursor.getColumnIndexOrThrow("client_message_id"),
                    ),
                    source = cursor.getString(cursor.getColumnIndexOrThrow("source")),
                    packageName = cursor.getString(cursor.getColumnIndexOrThrow("package_name")),
                    title = cursor.getString(cursor.getColumnIndexOrThrow("title")),
                    body = cursor.getString(cursor.getColumnIndexOrThrow("body")),
                    receivedAt = cursor.getLong(cursor.getColumnIndexOrThrow("received_at")),
                    attemptCount = cursor.getInt(cursor.getColumnIndexOrThrow("attempt_count")),
                    lastAttemptAt = cursor.getColumnIndexOrThrow("last_attempt_at").let { index ->
                        if (cursor.isNull(index)) null else cursor.getLong(index)
                    },
                )
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
                db.insertWithOnConflict(
                    REJECTED_TABLE,
                    null,
                    values,
                    SQLiteDatabase.CONFLICT_IGNORE,
                )
            }

            val processedIds = plan.deleteIds + plan.quarantined.map { it.message.id }
            deleteAll(db, processedIds)
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

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

    companion object {
        private const val DATABASE_NAME = "familycard_queue.db"
        private const val DATABASE_VERSION = 2
        private const val PENDING_TABLE = "pending_message"
        private const val REJECTED_TABLE = "rejected_message"

        @Volatile
        private var instance: QueueDatabase? = null

        fun getInstance(context: Context): QueueDatabase = instance ?: synchronized(this) {
            instance ?: QueueDatabase(context.applicationContext).also { instance = it }
        }
    }
}
