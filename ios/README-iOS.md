# Producing an iOS version later

The Android app is only a ~130-line shell around `web/`. All screens, the
database logic and the ballistic solver are plain HTML/CSS/JS with no build
step, so an iOS version needs only an equivalent shell:

1. Xcode → new iOS App (SwiftUI or UIKit), iOS 13+.
2. Add the `web/` folder to the target as a **folder reference** (blue folder).
3. Host it in a `WKWebView`, and implement the storage bridge that
   `web/storage.js` already looks for:
   - at document start inject the database text as `window.__BALLISTO_DB__`;
   - receive `{op:"save", text}` and `{op:"exit"}` on the message handler
     named `ballisto`.
4. No network entitlement or ATS exceptions are needed.

Sketch (untested, for guidance only):

```swift
import UIKit
import WebKit

final class ViewController: UIViewController, WKScriptMessageHandler {
    private var web: WKWebView!
    private let dbURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("ballisto_db.json")

    override func viewDidLoad() {
        super.viewDidLoad()
        try? FileManager.default.createDirectory(at: dbURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let text = (try? String(contentsOf: dbURL, encoding: .utf8)) ?? ""
        let json = String(data: try! JSONEncoder().encode(text), encoding: .utf8)!   // safely quoted JS string
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.addUserScript(WKUserScript(source: "window.__BALLISTO_DB__ = \(json);",
                                                             injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.userContentController.add(self, name: "ballisto")
        web = WKWebView(frame: view.bounds, configuration: cfg)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(web)
        let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web")!
        web.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
    }

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else { return }
        if op == "save", let text = body["text"] as? String {
            try? text.write(to: dbURL, atomically: true, encoding: .utf8)
        }
        // op == "exit": iOS apps must not terminate themselves (App Store rule);
        // leave it as a no-op or hide the Exit menu item on iOS.
    }
}
```

Notes: Apple does not allow apps to quit themselves, so the "Exit" buttons
should be hidden on iOS (e.g. add `class="ios"` to `<body>` from the shell and
a CSS rule). There is no hardware Back button; the burger menu covers navigation.
