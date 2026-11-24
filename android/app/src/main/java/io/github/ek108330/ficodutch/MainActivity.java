package io.github.ek108330.ficodutch;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

public final class MainActivity extends Activity {
    private static final String GAME_HOST = "ficodutch-preprod.onrender.com";
    private static final String GAME_URL = "https://" + GAME_HOST + "/";
    private FrameLayout browserContainer;
    private View loading;
    private View loadError;
    private TextView errorMessage;
    private WebView browser;
    private OnBackInvokedCallback backCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        browserContainer = findViewById(R.id.browser_container);
        loading = findViewById(R.id.loading);
        loadError = findViewById(R.id.load_error);
        errorMessage = findViewById(R.id.error_message);
        findViewById(R.id.retry).setOnClickListener(view -> loadGame());

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
                getWindow().setDecorFitsSystemWindows(false);
            }
            View screen = findViewById(R.id.screen);
            screen.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets padding = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(padding.left, padding.top, padding.right, padding.bottom);
                return WindowInsets.CONSUMED;
            });
            screen.requestApplyInsets();
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backCallback = this::goBackInGame;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
        loadGame();
    }

    private void goBackInGame() {
        WebView current = browser;
        if (current == null) return;
        current.evaluateJavascript("""
                (() => {
                  const dialog = document.querySelector('dialog:modal');
                  if (!dialog) return false;
                  if (typeof dialog.requestClose === 'function') dialog.requestClose();
                  else dialog.close();
                  return true;
                })()
                """, handled -> {
            if (current == browser && "false".equals(handled) && current.canGoBack()) current.goBack();
        });
    }

    @Override
    @SuppressLint("GestureBackNavigation") // Pre-Android 13 fallback; newer releases use the dispatcher.
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        goBackInGame();
    }

    private void loadGame() {
        if (browser == null) {
            try {
                browser = createBrowser();
            } catch (RuntimeException unavailableWebView) {
                showError(R.string.display_error);
                return;
            }
            browserContainer.addView(browser, new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        }

        browser.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_AUTO);
        loadError.setVisibility(View.GONE);
        loading.setVisibility(View.VISIBLE);
        browser.loadUrl(GAME_URL);
    }

    @SuppressLint("SetJavaScriptEnabled") // The interactive game runs on the allowlisted HTTPS origin.
    private WebView createBrowser() {
        WebView webView = new WebView(this);
        webView.setBackgroundColor(getColor(R.color.table_green));
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new GameClient());
        return webView;
    }

    private void showError(int message) {
        loading.setVisibility(View.GONE);
        if (browser != null) {
            browser.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        }
        errorMessage.setText(message);
        loadError.setVisibility(View.VISIBLE);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (browser != null) browser.onResume();
    }

    @Override
    protected void onPause() {
        if (browser != null) browser.onPause();
        super.onPause();
    }

    private void destroyBrowser() {
        if (browser != null) {
            browserContainer.removeView(browser);
            browser.destroy();
            browser = null;
        }
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        }
        destroyBrowser();
        super.onDestroy();
    }

    private static boolean isGameUrl(Uri url) {
        return "https".equalsIgnoreCase(url.getScheme())
                && GAME_HOST.equalsIgnoreCase(url.getHost())
                && url.getUserInfo() == null
                && (url.getPort() == -1 || url.getPort() == 443);
    }

    private final class GameClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return request.isForMainFrame() && !isGameUrl(request.getUrl());
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            loading.setVisibility(View.GONE);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showError(R.string.network_error);
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame()) showError(R.string.server_error);
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            if (view == browser) {
                destroyBrowser();
                showError(R.string.display_error);
            }
            return true;
        }
    }
}
