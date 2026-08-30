package com.familycard.collector.ui.settings

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.familycard.collector.capture.CaptureOriginKind
import com.familycard.collector.capture.CaptureSourceConfig
import com.familycard.collector.capture.CaptureSourceRules
import com.familycard.collector.settings.CaptureSourceStore

private data class PendingAppSource(
    val source: CaptureSourceConfig,
)

private data class CaptureSourceMessage(
    val text: String,
    val isError: Boolean,
)

/** 사용자가 개발자 도움이나 USB 연결 없이 폰 안에서 수집 대상을 관리한다. */
@Composable
fun CaptureSourcesSection() {
    val context = LocalContext.current
    val store = remember { CaptureSourceStore(context) }
    var sources by remember { mutableStateOf(store.load()) }
    var appKindToPick by remember { mutableStateOf<CaptureOriginKind?>(null) }
    var pendingApp by remember { mutableStateOf<PendingAppSource?>(null) }
    var pendingRemoval by remember { mutableStateOf<CaptureSourceConfig?>(null) }
    var showKakaoDialog by remember { mutableStateOf(false) }
    var showSmsDialog by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<CaptureSourceMessage?>(null) }

    fun refresh() {
        sources = store.load()
    }

    fun save(source: CaptureSourceConfig) {
        if (store.add(source)) {
            refresh()
            message = CaptureSourceMessage(
                "수집 대상을 등록했습니다. 다음 알림부터 적용됩니다.",
                isError = false,
            )
        } else {
            message = CaptureSourceMessage(
                "수집 대상을 저장하지 못했습니다. 입력값과 저장 공간을 확인해주세요.",
                isError = true,
            )
        }
    }

    val appPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val requestedKind = appKindToPick
        appKindToPick = null
        if (result.resultCode != Activity.RESULT_OK || requestedKind == null) {
            return@rememberLauncherForActivityResult
        }

        val component = result.data?.component
        if (component == null) {
            message = CaptureSourceMessage(
                "선택한 앱을 확인할 수 없습니다. 다시 시도해주세요.",
                isError = true,
            )
            return@rememberLauncherForActivityResult
        }

        val selectedPackage = component.packageName
        val rejection = CaptureAppSelectionPolicy.rejectionFor(
            selectedPackage = selectedPackage,
            familyCardPackage = context.packageName,
            defaultSmsPackage = Telephony.Sms.getDefaultSmsPackage(context),
        )
        if (rejection != null) {
            message = CaptureSourceMessage(rejection.userMessage(), isError = true)
            return@rememberLauncherForActivityResult
        }

        val label = loadActivityLabel(context, component)
        val source = CaptureSourceRules.normalize(requestedKind, selectedPackage, label)
            ?: CaptureSourceRules.normalize(requestedKind, selectedPackage, selectedPackage)
        if (source == null) {
            message = CaptureSourceMessage(
                "선택한 앱 정보를 저장할 수 없습니다. 다른 앱을 선택해주세요.",
                isError = true,
            )
            return@rememberLauncherForActivityResult
        }
        pendingApp = PendingAppSource(source)
    }

    fun openAppPicker(kind: CaptureOriginKind) {
        appKindToPick = kind
        message = null
        runCatching { appPicker.launch(buildAppPickerIntent()) }
            .onFailure {
                appKindToPick = null
                message = CaptureSourceMessage(
                    "이 기기에서 앱 선택 화면을 열 수 없습니다.",
                    isError = true,
                )
            }
    }

    SectionCard("수집 대상") {
        Text(
            "이 폰에서 실제로 쓰는 앱·채널·발신자만 등록하세요. 등록하지 않은 알림은 " +
                "로컬 큐에도 저장하지 않습니다.",
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            "같은 결제가 카드사 앱과 토스 같은 결제 앱에서 함께 와도 두 원문을 출처별로 " +
                "보존하며, 거래 단계에서 한 건으로 대사합니다.",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(top = 6.dp),
        )

        Button(
            onClick = { openAppPicker(CaptureOriginKind.CARD_APP) },
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        ) { Text("카드사 앱 추가") }
        OutlinedButton(
            onClick = { openAppPicker(CaptureOriginKind.PAYMENT_APP) },
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        ) { Text("결제·자산 앱 추가 (토스·카카오페이 등)") }
        OutlinedButton(
            onClick = { showKakaoDialog = true; message = null },
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        ) { Text("카카오 공식 채널 추가") }
        OutlinedButton(
            onClick = { showSmsDialog = true; message = null },
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        ) { Text("SMS 발신자 추가") }

        message?.let {
            Text(
                it.text,
                color = if (it.isError) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.primary
                },
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 8.dp),
            )
        }

        if (sources.isEmpty()) {
            Text(
                "등록된 수집 대상이 없습니다. 현재 모든 알림과 문자를 거부합니다.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 12.dp),
            )
        } else {
            SourceGroup("카드사 앱", sources, CaptureOriginKind.CARD_APP) { pendingRemoval = it }
            SourceGroup("결제·자산 앱", sources, CaptureOriginKind.PAYMENT_APP) { pendingRemoval = it }
            SourceGroup("카카오 공식 채널", sources, CaptureOriginKind.KAKAO_CHANNEL) {
                pendingRemoval = it
            }
            SourceGroup("SMS 발신자", sources, CaptureOriginKind.SMS_SENDER) { pendingRemoval = it }
        }
    }

    pendingApp?.let { pending ->
        AlertDialog(
            onDismissRequest = { pendingApp = null },
            title = { Text("${pending.source.displayName} 등록") },
            text = {
                Text(
                    "이 앱이 보내는 모든 알림 본문이 수집 대상이 됩니다. 공식 카드사 또는 " +
                        "결제·자산 앱이 맞는지 확인하세요.\n\n${pending.source.identifier}",
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        save(pending.source)
                        pendingApp = null
                    },
                ) { Text("등록") }
            },
            dismissButton = {
                TextButton(onClick = { pendingApp = null }) { Text("취소") }
            },
        )
    }

    if (showKakaoDialog) {
        KakaoChannelDialog(
            onDismiss = { showKakaoDialog = false },
            onSave = {
                save(it)
                showKakaoDialog = false
            },
        )
    }

    if (showSmsDialog) {
        SmsSenderDialog(
            onDismiss = { showSmsDialog = false },
            onSave = {
                save(it)
                showSmsDialog = false
            },
        )
    }

    pendingRemoval?.let { source ->
        AlertDialog(
            onDismissRequest = { pendingRemoval = null },
            title = { Text("수집 대상에서 삭제") },
            text = {
                Text(
                    "${source.displayName}의 새 알림 수집을 중단합니다. 이미 폰 큐나 서버에 " +
                        "보존된 원문은 삭제되지 않습니다.",
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (store.remove(source)) {
                            refresh()
                            message = CaptureSourceMessage(
                                "수집 대상에서 삭제했습니다.",
                                isError = false,
                            )
                        } else {
                            message = CaptureSourceMessage(
                                "수집 대상을 삭제하지 못했습니다. 저장 공간을 확인해주세요.",
                                isError = true,
                            )
                        }
                        pendingRemoval = null
                    },
                ) { Text("삭제") }
            },
            dismissButton = {
                TextButton(onClick = { pendingRemoval = null }) { Text("취소") }
            },
        )
    }
}

@Composable
private fun SourceGroup(
    title: String,
    allSources: List<CaptureSourceConfig>,
    kind: CaptureOriginKind,
    onRemove: (CaptureSourceConfig) -> Unit,
) {
    val sources = allSources.filter { it.kind == kind }
    if (sources.isEmpty()) return

    Text(
        title,
        style = MaterialTheme.typography.labelLarge,
        modifier = Modifier.padding(top = 16.dp, bottom = 4.dp),
    )
    sources.sortedBy { it.displayName }.forEachIndexed { index, source ->
        if (index > 0) HorizontalDivider()
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(source.displayName, style = MaterialTheme.typography.bodyMedium)
                Text(
                    source.identifier,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            TextButton(onClick = { onRemove(source) }) { Text("삭제") }
        }
    }
}

@Composable
private fun KakaoChannelDialog(
    onDismiss: () -> Unit,
    onSave: (CaptureSourceConfig) -> Unit,
) {
    var title by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("카카오 공식 채널 추가") },
        text = {
            Column {
                Text(
                    "카드 알림톡 알림에 표시되는 공식 채널 제목을 정확히 입력하세요. 같은 이름의 " +
                        "일반 대화방은 구분할 수 없으므로 해당 이름을 개인 대화에 사용하지 마세요.",
                    style = MaterialTheme.typography.bodySmall,
                )
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it; error = null },
                    label = { Text("공식 채널 제목") },
                    singleLine = true,
                    isError = error != null,
                    supportingText = { error?.let { Text(it) } },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val source = CaptureSourceRules.normalize(
                        CaptureOriginKind.KAKAO_CHANNEL,
                        title,
                        title,
                    )
                    if (source == null) error = "채널 제목을 확인해주세요." else onSave(source)
                },
            ) { Text("등록") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("취소") } },
    )
}

@Composable
private fun SmsSenderDialog(
    onDismiss: () -> Unit,
    onSave: (CaptureSourceConfig) -> Unit,
) {
    var sender by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("SMS 발신자 추가") },
        text = {
            Column {
                Text(
                    "카드 결제 문자에 표시되는 발신번호 또는 영문 발신자 ID를 입력하세요. " +
                        "등록된 발신자이면서 승인·취소 등 거래 문구가 있는 문자만 수집합니다.",
                    style = MaterialTheme.typography.bodySmall,
                )
                OutlinedTextField(
                    value = sender,
                    onValueChange = { sender = it; error = null },
                    label = { Text("발신번호 또는 발신자 ID") },
                    placeholder = { Text("1588-0000") },
                    singleLine = true,
                    isError = error != null,
                    supportingText = { error?.let { Text(it) } },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
                OutlinedTextField(
                    value = displayName,
                    onValueChange = { displayName = it; error = null },
                    label = { Text("표시 이름 (선택)") },
                    placeholder = { Text("○○카드 문자") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val source = CaptureSourceRules.normalize(
                        CaptureOriginKind.SMS_SENDER,
                        sender,
                        displayName,
                    )
                    if (source == null) error = "발신자 정보를 확인해주세요." else onSave(source)
                },
            ) { Text("등록") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("취소") } },
    )
}

private fun buildAppPickerIntent(): Intent = Intent(Intent.ACTION_PICK_ACTIVITY).apply {
    putExtra(
        Intent.EXTRA_INTENT,
        Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER),
    )
    putExtra(Intent.EXTRA_TITLE, "수집할 앱 선택")
}

@Suppress("DEPRECATION")
private fun loadActivityLabel(context: Context, component: ComponentName): String =
    runCatching {
        context.packageManager
            .getActivityInfo(component, 0)
            .loadLabel(context.packageManager)
            .toString()
    }.getOrDefault(component.packageName)

private fun AppSelectionRejection.userMessage(): String = when (this) {
    AppSelectionRejection.INVALID_PACKAGE -> "선택한 앱의 패키지 정보를 확인할 수 없습니다."
    AppSelectionRejection.FAMILYCARD_ITSELF -> "FamilyCard 자체는 수집 대상으로 등록할 수 없습니다."
    AppSelectionRejection.KAKAO_TALK ->
        "카카오톡 전체를 등록하면 개인 대화가 수집될 수 있습니다. 공식 채널 제목으로 추가해주세요."

    AppSelectionRejection.DEFAULT_SMS_APP ->
        "문자 앱 전체를 등록하면 개인 문자가 수집될 수 있습니다. SMS 발신자로 추가해주세요."
}
