package com.waysproperty.ballisto

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream
import java.io.File

/**
 * Ballisto host activity.
 *
 * The app is a thin native shell around the shared web app in /web (packaged
 * as APK assets): HTML/CSS for the screens, and ballistics.js for the solver.
 * The shell only
 *   - shows the web app in a WebView loaded from file:///android_asset/,
 *   - provides a tiny JavaScript bridge to read/write the database, which is
 *     a single plain-text JSON file in the app's private files directory,
 *   - forwards the Back button and closes the app on "Exit".
 *
 * The app has no INTERNET permission, and the WebView additionally blocks
 * every non-asset load, so it cannot reach the network at all.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private val dbFile: File by lazy { File(filesDir, "ballisto_db.json") }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        setContentView(webView)

        val s = webView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = false          // storage goes through the bridge, not localStorage
        s.allowFileAccess = false            // android_asset URLs work without this
        s.allowContentAccess = false
        s.blockNetworkLoads = true
        s.cacheMode = WebSettings.LOAD_NO_CACHE
        s.setGeolocationEnabled(false)
        s.mediaPlaybackRequiresUserGesture = true
        s.textZoom = 100                     // layout is responsive; avoid double scaling

        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Never navigate away from the bundled app.
                return !request.url.toString().startsWith(ASSET_ROOT)
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val url = request.url.toString()
                if (url.startsWith(ASSET_ROOT)) return null
                // Anything else (should never happen) gets an empty response.
                return WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
            }
        }
        webView.addJavascriptInterface(NativeBridge(), "BallistoNative")
        webView.loadUrl(ASSET_ROOT + "index.html")
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // Let the web app step back through its own screens first.
        webView.evaluateJavascript("(window.BallistoBack && window.BallistoBack()) ? 'y' : 'n'") { r ->
            if (r == null || !r.contains("y")) {
                @Suppress("DEPRECATION")
                super.onBackPressed()
            }
        }
    }

    override fun onDestroy() {
        webView.removeJavascriptInterface("BallistoNative")
        webView.destroy()
        super.onDestroy()
    }

    /** Methods called from web/storage.js. Runs on a WebView background thread. */
    inner class NativeBridge {
        private val lock = Any()

        @JavascriptInterface
        fun loadDb(): String = synchronized(lock) {
            try {
                if (dbFile.exists()) dbFile.readText(Charsets.UTF_8) else ""
            } catch (e: Exception) {
                ""
            }
        }

        /** Atomic write: temp file then rename; keeps the previous copy as .bak. */
        @JavascriptInterface
        fun saveDb(text: String): Boolean = synchronized(lock) {
            try {
                val tmp = File(filesDir, "ballisto_db.json.tmp")
                tmp.writeText(text, Charsets.UTF_8)
                if (dbFile.exists()) dbFile.copyTo(File(filesDir, "ballisto_db.json.bak"), overwrite = true)
                if (!tmp.renameTo(dbFile)) {
                    dbFile.writeText(text, Charsets.UTF_8)
                    tmp.delete()
                }
                true
            } catch (e: Exception) {
                false
            }
        }

        @JavascriptInterface
        fun exitApp() {
            runOnUiThread { finishAndRemoveTask() }
        }
    }

    companion object {
        private const val ASSET_ROOT = "file:///android_asset/"
    }
}
