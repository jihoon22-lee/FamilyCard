package com.familycard.collector.ui.dashboard

import android.annotation.SuppressLint
import android.content.Intent
import android.view.ViewGroup
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.familycard.collector.net.DeviceSessionClient
import com.familycard.collector.settings.AppSettings
import com.familycard.collector.settings.ServerUrlPolicy
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 서버 화면을 그대로 띄우는 WebView 탭.
 *
 * UI 를 서버가 그리므로 화면이 바뀌어도 APK 를 다시 깔 필요가 없다.
 * → ADR 0003
 */
@SuppressLint("SetJavaScriptEnabled") // Next.js 대시보드에 필수. 같은 origin만 WebView 안에서 허용한다.
@Composable
fun DashboardScreen(modifier: Modifier = Modifier, onOpenSettings: () -> Unit = {}) {
    val context = LocalContext.current
    val appSettings = remember { AppSettings(context) }

    var state by remember { mutableStateOf<DashboardState>(DashboardState.Loading) }
    var reloadKey by remember { mutableIntStateOf(0) }
    var webView by remember { mutableStateOf<WebView?>(null) }

    // 뒤로가기: WebView 히스토리가 있으면 그쪽으로.
    BackHandler(enabled = webView?.canGoBack() == true) { webView?.goBack() }

    LaunchedEffect(reloadKey) {
        state = DashboardState.Loading
        if (!appSettings.isConfigured) {
            state = DashboardState.NotConfigured
            return@LaunchedEffect
        }
        val url = withContext(Dispatchers.IO) {
            DeviceSessionClient(appSettings.serverUrl, appSettings.deviceToken).requestSessionUrl()
        }
        state = if (url == null) DashboardState.Error else DashboardState.Ready(url)
    }

    when (val current = state) {
        DashboardState.Loading -> CenteredMessage(modifier, "불러오는 중…")

        DashboardState.NotConfigured -> CenteredMessage(
            modifier,
            title = "서버 설정이 필요합니다",
            body = "설정 탭에서 서버 주소와 기기 토큰을 입력해주세요.",
        )

        // 집 서버는 Tailscale 이 꺼져 있으면 접근이 안 된다. 빈 흰 화면을 보여주면
        // 사용자는 앱이 고장 났다고 생각한다. 원인 후보와 재시도를 함께 보여준다.
        DashboardState.Error -> ConnectionError(
            modifier = modifier,
            onRetry = { reloadKey++ },
            onOpenSettings = onOpenSettings,
        )

        is DashboardState.Ready -> AndroidView(
            modifier = modifier.fillMaxSize(),
            factory = { ctx ->
                WebView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    // 보안: 로컬 파일·콘텐트 프로바이더 접근 차단
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false

                    webViewClient = HostBoundWebViewClient(
                        allowedOrigin = current.url,
                        onError = { state = DashboardState.Error },
                    )
                    loadUrl(current.url)
                    webView = this
                }
            },
        )
    }
}

private sealed interface DashboardState {
    data object Loading : DashboardState
    data object NotConfigured : DashboardState
    data object Error : DashboardState
    data class Ready(val url: String) : DashboardState
}

/**
 * 서버 호스트 밖의 URL 은 WebView 안에서 열지 않고 시스템 브라우저로 넘긴다.
 * WebView 안에서 아무 사이트나 열리면 그 페이지가 세션 쿠키가 있는 컨텍스트에서
 * 돈다.
 */
private class HostBoundWebViewClient(
    private val allowedOrigin: String,
    private val onError: () -> Unit,
) : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        if (ServerUrlPolicy.isSameOrigin(allowedOrigin, request.url.toString())) return false

        view.context.startActivity(Intent(Intent.ACTION_VIEW, request.url))
        return true
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        // 메인 프레임 실패만 오류 화면으로. 이미지 하나 실패로 화면을 갈아엎지 않는다.
        if (request.isForMainFrame) onError()
    }

    override fun onReceivedHttpError(
        view: WebView,
        request: WebResourceRequest,
        errorResponse: WebResourceResponse,
    ) {
        // 401/500 같은 메인 문서 HTTP 오류도 서버 연결 안내로 전환한다.
        if (request.isForMainFrame && errorResponse.statusCode >= 400) onError()
    }
}

@Composable
private fun CenteredMessage(modifier: Modifier, title: String, body: String? = null) {
    Column(
        modifier = modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        body?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}

@Composable
private fun ConnectionError(
    modifier: Modifier,
    onRetry: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("📡", style = MaterialTheme.typography.displaySmall)
        Text(
            "집 서버에 연결할 수 없습니다",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(top = 12.dp),
        )
        Text(
            "· Tailscale 이 켜져 있나요?\n· 집 서버가 켜져 있나요?",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(top = 12.dp),
        )
        // 화면이 안 보이는 것과 수집이 멈추는 것은 별개다. 안심시킨다.
        Text(
            "결제 내역은 계속 저장되고 있습니다.",
            style = MaterialTheme.typography.bodySmall,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 16.dp),
        )
        Button(onClick = onRetry, modifier = Modifier.padding(top = 24.dp)) { Text("다시 시도") }
        OutlinedButton(onClick = onOpenSettings, modifier = Modifier.padding(top = 8.dp)) {
            Text("설정 열기")
        }
    }
}
