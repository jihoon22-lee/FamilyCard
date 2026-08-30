package com.familycard.collector.ui.settings

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

/**
 * 홈 화면에서 실행 가능한 앱만 조회한다. 반환 목록은 선택기 메모리에서만 사용하고 저장하거나
 * 서버로 전송하지 않는다. Android 11+ 가시성은 manifest의 좁은 LAUNCHER intent query로 연다.
 */
object InstalledCaptureAppLoader {
    fun load(context: Context): List<InstalledCaptureApp> {
        val packageManager = context.packageManager
        val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val activities = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            packageManager.queryIntentActivities(
                launcherIntent,
                PackageManager.ResolveInfoFlags.of(0),
            )
        } else {
            @Suppress("DEPRECATION")
            packageManager.queryIntentActivities(launcherIntent, 0)
        }

        return activities
            .mapNotNull { resolved ->
                val packageName = resolved.activityInfo?.packageName?.trim().orEmpty()
                if (packageName.isEmpty()) return@mapNotNull null
                val label = runCatching {
                    resolved.activityInfo.applicationInfo
                        .loadLabel(packageManager)
                        .toString()
                        .trim()
                }.getOrDefault(packageName).ifEmpty { packageName }
                InstalledCaptureApp(packageName, label)
            }
            .distinctBy { it.packageName }
    }
}
