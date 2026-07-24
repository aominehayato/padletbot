const puppeteer = require("puppeteer");
const path = require("path");

(async () => {
  let browser = null;
  try {
    console.log("ブラウザを起動しています...");
    // ログインセッションを永続化するために userDataDir を指定
    browser = await puppeteer.launch({
      headless: false,
      userDataDir: path.join(__dirname, "padlet-profile"),
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled"
      ]
    });

    const page = await browser.newPage();

    // navigator.webdriver の秘匿化
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined
      });
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.129 Safari/537.36"
    );

    // 全てのAPI通信およびナビゲーションリクエスト・リダイレクトの追跡・監視設定
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/api/")) {
        console.log("API REQUEST:", req.method(), url);
      }
      if (req.isNavigationRequest()) {
        console.log("NAV REQUEST:", req.url());
      }
    });

    page.on("response", async (res) => {
      const url = res.url();
      if (url.includes("/api/")) {
        console.log("API RESPONSE:", res.status(), url);
      }
      if (res.status() >= 300 && res.status() < 400) {
        const headers = res.headers();
        console.log("REDIRECT DETECTED:", res.status(), url, "->", headers["location"] || "No Location");
      }
    });

    const cookiesJson = process.env.PADLET_COOKIES_JSON;
    const sessionCookie = process.env.PADLET_SESSION_COOKIE;
    
    // ご自身の環境に合わせて、取得したverification_token付きURLをここに直接設定してください
    const verificationUrl = process.env.PADLET_VERIFICATION_URL || "";

    // 事前認証用Cookieのインポート処理
    if (cookiesJson) {
      console.log("環境変数 PADLET_COOKIES_JSON からCookie一括設定を実行中...");
      try {
        const parsedCookies = JSON.parse(cookiesJson);
        if (Array.isArray(parsedCookies)) {
          for (const cookie of parsedCookies) {
            await page.setCookie({
              name: cookie.name,
              value: cookie.value,
              domain: cookie.domain || ".padlet.com",
              path: cookie.path || "/",
              httpOnly: cookie.httpOnly !== undefined ? cookie.httpOnly : true,
              secure: cookie.secure !== undefined ? cookie.secure : true
            });
          }
        }
      } catch (err) {
        console.error("PADLET_COOKIES_JSON のパースに失敗しました:", err.message);
      }
    } else if (sessionCookie) {
      console.log("環境変数 PADLET_SESSION_COOKIE からセッションCookieを設定中...");
      await page.setCookie({
        name: "ww_s",
        value: sessionCookie,
        domain: ".padlet.com",
        path: "/",
        httpOnly: true,
        secure: true
      });
    }

    // verificationUrl が指定されている場合は直接認証URLへアクセスしてセッションを確立する
    if (verificationUrl) {
      console.log("メール認証用URLへ直接アクセスしてセッションを確立します:", verificationUrl);
      await page.goto(verificationUrl, { waitUntil: "networkidle0", timeout: 120000 });
      await new Promise(resolve => setTimeout(resolve, 5000));
      console.log("認証完了後のURL:", page.url());
      
      console.log("認証後に取得されたCookie詳細:");
      console.log(JSON.stringify(await page.cookies(), null, 2));
    }

    // Padletホームへアクセスしてログイン状態を確認中
    console.log("Padletホームへアクセスしてログイン状態を確認中...");
    await page.goto("https://padlet.com/", { waitUntil: "networkidle2" });
    console.log("ホーム画面タイトル:", await page.evaluate(() => document.title));
    console.log("ホーム画面URL:", await page.evaluate(() => location.href));

    // ユーザー情報取得API（/api/5/users/me）でログインが完全に成功しているか検証
    console.log("ログイン確認API (/api/5/users/me) を実行中...");
    const meResult = await page.evaluate(async () => {
      const r = await fetch("/api/5/users/me", {
        method: "GET",
        credentials: "include",
        headers: {
          "accept": "application/json"
        }
      });
      return {
        status: r.status,
        text: await r.text()
      };
    });
    console.log("ユーザー確認APIステータス:", meResult.status);
    console.log("ユーザー確認APIレスポンス:", meResult.text);

    // 実際のボードページへ一度遷移してリファラーやセッション文脈を完全に一致させる
    const boardUrl = "https://padlet.com/magnificentconferenceliteracy/padlet-wy32bauth9n4npi1";
    console.log("ボードページへ移動してコンテキストを構築中:", boardUrl);
    await page.goto(boardUrl, { waitUntil: "networkidle0" });

    // ページを一度リロードしてSPAの状態を同期
    await page.reload({ waitUntil: "networkidle0" });

    const allCookies = await page.cookies();
    console.log("API直前の全Cookie一覧:", allCookies.map(c => `${c.name}=${c.value}`).join("; "));
    console.log("API直前のlocation.href:", await page.evaluate(() => location.href));
    console.log("API直前のデバッグ情報:", JSON.stringify(await page.evaluate(() => ({
      localStorageKeys: Object.keys(localStorage),
      url: location.href
    })), null, 2));

    const apiUrl = "https://padlet.com/api/10/wishes?wall_hashid=board_Y0KryDdQrj0GyPBb&page_start=&v=1784862836";

    console.log("ボードページを経由したコンテキストで非公開APIへアクセス中...");
    
    const apiResult = await page.evaluate(async (targetApiUrl) => {
      const res = await fetch(targetApiUrl, {
        method: "GET",
        credentials: "include",
        headers: {
          "accept": "*/*",
          "prefer": "safe",
          "cache-control": "no-cache"
        }
      });
      return {
        status: res.status,
        body: await res.text()
      };
    }, apiUrl);

    console.log("--- APIレスポンス結果詳細 ---");
    console.log("ステータス:", apiResult.status);
    console.log("レスポンスボディ:", apiResult.body);
    console.log("-----------------------------");

    await browser.close();
    process.exit(0);
  } catch (error) {
    console.error("エラーが発生しました:", error);
    if (browser) {
      await browser.close();
    }
    process.exit(1);
  }
})();
