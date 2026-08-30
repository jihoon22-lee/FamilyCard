package com.familycard.collector.capture

/**
 * Android 알림 extras에서 꺼낸 후보 중 가장 완전한 본문을 고른다.
 *
 * 펼침형 알림은 EXTRA_TEXT가 축약본이고 EXTRA_BIG_TEXT 또는
 * EXTRA_TEXT_LINES에 전체 문구가 있을 수 있다. 줄 배열은 원문의 경계를
 * 보존하도록 개행으로 합친다.
 */
object NotificationBodyExtractor {
    fun selectBody(
        bigText: CharSequence?,
        text: CharSequence?,
        textLines: Iterable<CharSequence>?,
    ): String {
        val expanded = bigText?.toString().orEmpty()
        if (expanded.isNotBlank()) return expanded

        val joinedLines = textLines
            ?.map(CharSequence::toString)
            ?.filter(String::isNotBlank)
            ?.joinToString("\n")
            .orEmpty()
        if (joinedLines.isNotBlank()) return joinedLines

        return text?.toString().orEmpty()
    }
}
