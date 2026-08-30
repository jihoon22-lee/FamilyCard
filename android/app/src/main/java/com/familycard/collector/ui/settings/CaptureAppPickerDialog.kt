package com.familycard.collector.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.familycard.collector.capture.CaptureOriginKind
import com.familycard.collector.capture.CaptureSourceConfig
import com.familycard.collector.capture.CaptureSourceRules

@Composable
fun CaptureAppPickerDialog(
    targetKind: CaptureOriginKind,
    installedApps: List<InstalledCaptureApp>,
    currentSources: List<CaptureSourceConfig>,
    onDismiss: () -> Unit,
    onSelected: (List<CaptureSourceConfig>) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var selectedPackages by remember { mutableStateOf(emptySet<String>()) }
    val registeredKinds = remember(currentSources) {
        currentSources
            .filter { it.kind == CaptureOriginKind.CARD_APP || it.kind == CaptureOriginKind.PAYMENT_APP }
            .associate { it.identifier to it.kind }
    }
    val rankedApps = remember(installedApps, targetKind, query) {
        CaptureAppPickerPolicy.filterAndSort(installedApps, targetKind, query)
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier.fillMaxSize().padding(12.dp),
            shape = MaterialTheme.shapes.large,
            tonalElevation = 6.dp,
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    if (targetKind == CaptureOriginKind.CARD_APP) {
                        "카드사 앱 여러 개 추가"
                    } else {
                        "결제·자산 앱 여러 개 추가"
                    },
                    style = MaterialTheme.typography.titleLarge,
                )
                Text(
                    "공식 앱과 이름에 카드·Card·페이·Pay 등이 들어간 앱을 먼저 보여줍니다. " +
                        "검색하거나 여러 개를 체크하세요.",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(top = 6.dp),
                )
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    label = { Text("앱 이름 또는 패키지 검색") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                )

                if (rankedApps.isEmpty()) {
                    Text(
                        "검색 결과가 없습니다.",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f).padding(top = 24.dp),
                    )
                } else {
                    LazyColumn(
                        modifier = Modifier.weight(1f).padding(top = 8.dp),
                    ) {
                        CaptureAppRecommendation.entries.forEach { recommendation ->
                            val group = rankedApps.filter { it.recommendation == recommendation }
                            if (group.isEmpty()) return@forEach
                            item(key = "header-${recommendation.name}") {
                                Text(
                                    recommendation.title(),
                                    style = MaterialTheme.typography.labelLarge,
                                    color = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.padding(top = 12.dp, bottom = 4.dp),
                                )
                            }
                            items(group, key = { it.app.packageName }) { ranked ->
                                val app = ranked.app
                                val registeredKind = registeredKinds[app.packageName]
                                val alreadyRegistered = registeredKind == targetKind
                                val checked = alreadyRegistered || app.packageName in selectedPackages
                                val enabled = !alreadyRegistered

                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable(enabled = enabled) {
                                            selectedPackages = if (checked) {
                                                selectedPackages - app.packageName
                                            } else {
                                                selectedPackages + app.packageName
                                            }
                                        }
                                        .padding(vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Checkbox(
                                        checked = checked,
                                        enabled = enabled,
                                        onCheckedChange = {
                                            selectedPackages = if (checked) {
                                                selectedPackages - app.packageName
                                            } else {
                                                selectedPackages + app.packageName
                                            }
                                        },
                                    )
                                    Column(modifier = Modifier.weight(1f).padding(start = 8.dp)) {
                                        Text(app.label, style = MaterialTheme.typography.bodyMedium)
                                        Text(
                                            app.packageName,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                        when {
                                            alreadyRegistered -> Text(
                                                "이미 등록됨",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.primary,
                                            )

                                            registeredKind != null -> Text(
                                                "다른 종류로 등록됨 · 선택하면 분류 변경",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.tertiary,
                                            )
                                        }
                                    }
                                }
                                HorizontalDivider()
                            }
                        }
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = onDismiss) { Text("취소") }
                    Button(
                        enabled = selectedPackages.isNotEmpty(),
                        onClick = {
                            val selected = installedApps
                                .filter { it.packageName in selectedPackages }
                                .mapNotNull { app ->
                                    CaptureSourceRules.normalize(
                                        targetKind,
                                        app.packageName,
                                        app.label,
                                    )
                                }
                            if (selected.isNotEmpty()) onSelected(selected)
                        },
                    ) { Text("${selectedPackages.size}개 선택") }
                }
            }
        }
    }
}

private fun CaptureAppRecommendation.title(): String = when (this) {
    CaptureAppRecommendation.OFFICIAL -> "공식 추천"
    CaptureAppRecommendation.KEYWORD -> "이름 추천"
    CaptureAppRecommendation.NONE -> "그 외 앱"
}
