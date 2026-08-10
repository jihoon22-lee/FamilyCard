package com.familycard.collector.queue

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * 오프라인 큐 저장소.
 *
 * ### 왜 Room 이 아닌가
 *
 * 설계 문서(08-android-app)는 Room 을 명시했다. 실제로는 `SQLiteOpenHelper` 를
 * 쓴다. Room 은 애노테이션 프로세서(KSP)를 요구하고 KSP 버전은 Kotlin 버전에
 * 정확히 묶여 있어(`<kotlin>-<ksp>` 형태) 툴체인을 올릴 때마다 같이 맞춰야 한다.
 * 이 앱의 큐는 **테이블 하나에 FIFO 삽입·조회·삭제뿐**이라 Room 이 주는 이점
 * (컴파일 타임 SQL 검증, 보일러플레이트 감소)이 그 결합 비용을 넘지 않는다.
 *
 * 큐가 복잡해지면(관계, 마이그레이션, Flow 관찰) 그때 Room 으로 옮기는 편이
 * 낫다. 지금은 의존성을 하나라도 줄이는 쪽을 택했다.
 *
 * ### 저장 실패에 대해
 *
 * 캡처 즉시 여기에 넣고 업로드는 나중에 한다. 로컬 디스크 쓰기라 거의 실패하지
 * 않는다. 네트워크는 나중 문제다 — 놓친 알림은 카드사가 다시 보내주지 않으므로
 * 유실 방지가 제1 목표다.
 */
class QueueDatabase(context: Context) :
    SQLiteOpenHelper(context.applicationContext, DATABASE_NAME, null, DATABASE_VERSION) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE $TABLE (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                source         TEXT    NOT NULL,
                package_name   TEXT    NOT NULL,
                title          TEXT    NOT NULL,
                body           TEXT    NOT NULL,
                received_at    INTEGER NOT NULL,
                attempt_count  INTEGER NOT NULL DEFAULT 0,
                last_attempt_at INTEGER
            )
            """.trimIndent(),
        )
        // 오래된 것부터 올리기 위한 정렬 인덱스.
        db.execSQL("CREATE INDEX idx_${TABLE}_received_at ON $TABLE(received_at)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // 아직 스키마 변경 이력이 없다. 변경이 생기면 여기서 마이그레이션한다.
        // ⚠️ 큐를 DROP 하면 아직 못 올린 결제 알림이 사라진다. 절대 하지 말 것.
    }

    fun enqueue(message: PendingMessage): Long {
        val values = ContentValues().apply {
            put("source", message.source)
            put("package_name", message.packageName)
            put("title", message.title)
            put("body", message.body)
            put("received_at", message.receivedAt)
            put("attempt_count", message.attemptCount)
            message.lastAttemptAt?.let { put("last_attempt_at", it) }
        }
        return writableDatabase.insert(TABLE, null, values)
    }

    /** 오래된 것부터 최대 [limit] 건. */
    fun takeBatch(limit: Int): List<PendingMessage> {
        val rows = mutableListOf<PendingMessage>()
        readableDatabase.query(
            TABLE, null, null, null, null, null, "received_at ASC, id ASC", limit.toString(),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                rows += PendingMessage(
                    id = cursor.getLong(cursor.getColumnIndexOrThrow("id")),
                    source = cursor.getString(cursor.getColumnIndexOrThrow("source")),
                    packageName = cursor.getString(cursor.getColumnIndexOrThrow("package_name")),
                    title = cursor.getString(cursor.getColumnIndexOrThrow("title")),
                    body = cursor.getString(cursor.getColumnIndexOrThrow("body")),
                    receivedAt = cursor.getLong(cursor.getColumnIndexOrThrow("received_at")),
                    attemptCount = cursor.getInt(cursor.getColumnIndexOrThrow("attempt_count")),
                    lastAttemptAt = cursor.getColumnIndexOrThrow("last_attempt_at").let { idx ->
                        if (cursor.isNull(idx)) null else cursor.getLong(idx)
                    },
                )
            }
        }
        return rows
    }

    /**
     * 업로드에 성공한 건을 지운다.
     *
     * **서버 응답을 확인한 뒤에만 호출할 것.** HTTP 200 만 보고 지우면 서버가
     * 일부만 처리했을 때 그 차이만큼 영구 유실된다.
     */
    fun deleteAll(ids: List<Long>) {
        if (ids.isEmpty()) return
        val placeholders = ids.joinToString(",") { "?" }
        writableDatabase.delete(TABLE, "id IN ($placeholders)", ids.map(Long::toString).toTypedArray())
    }

    /** 실패한 배치의 재시도 횟수를 올린다. 진단용이며 삭제 판단에는 쓰지 않는다. */
    fun markAttempt(ids: List<Long>, at: Long) {
        if (ids.isEmpty()) return
        val placeholders = ids.joinToString(",") { "?" }
        writableDatabase.execSQL(
            "UPDATE $TABLE SET attempt_count = attempt_count + 1, last_attempt_at = ? " +
                "WHERE id IN ($placeholders)",
            (listOf(at) + ids).toTypedArray(),
        )
    }

    fun pendingCount(): Int =
        readableDatabase.rawQuery("SELECT COUNT(*) FROM $TABLE", null).use { cursor ->
            if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }

    companion object {
        private const val DATABASE_NAME = "familycard_queue.db"
        private const val DATABASE_VERSION = 1
        private const val TABLE = "pending_message"
    }
}
