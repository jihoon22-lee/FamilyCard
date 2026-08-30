package com.familycard.collector.settings

import android.content.Context
import com.familycard.collector.capture.CaptureOriginKind
import com.familycard.collector.capture.CaptureSourceConfig
import com.familycard.collector.capture.CaptureSourceRules
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** 앱 private 저장소에 사용자별 수집 대상을 보관한다. 원문이나 카드 정보는 담지 않는다. */
class CaptureSourceStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun load(): List<CaptureSourceConfig> = synchronized(LOCK) { loadUnlocked() }

    /** 같은 앱을 다시 추가하면 종류(카드사/결제·자산 앱)를 새 선택으로 바꾼다. */
    fun add(source: CaptureSourceConfig): Boolean = synchronized(LOCK) {
        val normalized = CaptureSourceRules.normalize(source.kind, source.identifier, source.displayName)
            ?: return@synchronized false
        val key = CaptureSourceRules.identityKey(normalized)
        val updated = loadUnlocked()
            .filterNot { CaptureSourceRules.identityKey(it) == key }
            .plus(normalized)
        prefs.edit().putString(KEY_SOURCES, CaptureSourceCodec.encode(updated)).commit()
    }

    /** 등록만 제거한다. 이미 큐나 서버에 보존된 원문은 절대 삭제하지 않는다. */
    fun remove(source: CaptureSourceConfig): Boolean = synchronized(LOCK) {
        val key = CaptureSourceRules.identityKey(source)
        val current = loadUnlocked()
        val updated = current.filterNot { CaptureSourceRules.identityKey(it) == key }
        if (updated.size == current.size) return@synchronized true
        prefs.edit().putString(KEY_SOURCES, CaptureSourceCodec.encode(updated)).commit()
    }

    private fun loadUnlocked(): List<CaptureSourceConfig> = runCatching {
        CaptureSourceCodec.decode(prefs.getString(KEY_SOURCES, null))
    }.getOrDefault(emptyList())

    private companion object {
        const val NAME = "familycard_capture_sources"
        const val KEY_SOURCES = "sources_json_v1"
        val LOCK = Any()
    }
}

/** JSON이 손상되거나 알 수 없는 값이 있어도 해당 항목을 무시해 수집 범위를 넓히지 않는다. */
object CaptureSourceCodec {
    fun encode(sources: List<CaptureSourceConfig>): String {
        val array = JSONArray()
        sources
            .sortedWith(compareBy<CaptureSourceConfig> { it.kind.ordinal }.thenBy { it.displayName })
            .forEach { source ->
                array.put(
                    JSONObject()
                        .put("kind", source.kind.wireValue)
                        .put("identifier", source.identifier)
                        .put("displayName", source.displayName),
                )
            }
        return array.toString()
    }

    fun decode(raw: String?): List<CaptureSourceConfig> {
        if (raw.isNullOrBlank()) return emptyList()
        return try {
            val byIdentity = linkedMapOf<String, CaptureSourceConfig>()
            val array = JSONArray(raw)
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val kind = CaptureOriginKind.fromWireValue(item.optString("kind")) ?: continue
                val source = CaptureSourceRules.normalize(
                    kind = kind,
                    identifier = item.optString("identifier"),
                    displayName = item.optString("displayName"),
                ) ?: continue
                byIdentity[CaptureSourceRules.identityKey(source)] = source
            }
            byIdentity.values.toList()
        } catch (_: JSONException) {
            emptyList()
        }
    }
}
