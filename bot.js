const puppeteer = require("puppeteer");

(async () => {
  let browser = null;
  try {
    console.log("ブラウザを起動しています...");
    browser = await puppeteer.launch({
      headless: true,
      userDataDir: "./padlet-profile",
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

    // Client Hints の偽装（Microsoft Edge環境を模倣）
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'userAgentData', {
        get() {
          return {
            brands: [
              { brand: "Not;A=Brand", version: "8" },
              { brand: "Chromium", version: "150" },
              { brand: "Microsoft Edge", version: "150" }
            ],
            mobile: false,
            platform: "Windows"
          };
        }
      });
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0"
    );

    await page.setExtraHTTPHeaders({
      "accept-language": "ja,en;q=0.9,en-GB;q=0.8,en-US;q=0.7"
    });

    // ネットワーク監視の設定（Padlet自体のAPIリクエスト成功を検知）
    page.on("response", async (res) => {
      const url = res.url();
      if (url.includes("/api/10/wishes")) {
        console.log("===== 検出された WISHES API レスポンス =====");
        console.log("ステータス:", res.status());
        console.log("リクエストヘッダー:", res.request().headers());
      }
    });

    const cookiesJson = process.env.PADLET_COOKIES_JSON;
    const sessionCookie = process.env.PADLET_SESSION_COOKIE;
    const verificationUrl = process.env.PADLET_VERIFICATION_URL;

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

    // メール認証用URLが指定されている場合の直接アクセス
    if (verificationUrl) {
      console.log("メール認証用URLへ直接アクセスしてセッションを確立します:", verificationUrl);
      await page.goto(verificationUrl, { waitUntil: "networkidle0", timeout: 120000 });
      await new Promise(resolve => setTimeout(resolve, 10000));
    }

    // Padletホームへアクセスし、ww_atiなどのトラッキングCookieやStorageを完全に初期化
    console.log("Padletホームへアクセスしてセッションおよびトラッキングを初期化中...");
    await page.goto("https://padlet.com/", { waitUntil: "networkidle0" });
    await new Promise(resolve => setTimeout(resolve, 10000));

    const initialCookies = await page.cookies();
    console.log("初期化後の全Cookie名一覧:", initialCookies.map(c => c.name));

    // 実際のボードページへ遷移してセッション文脈を同期
    const boardUrl = "https://padlet.com/magnificentconferenceliteracy/padlet-wy32bauth9n4npi1";
    console.log("ボードページへ移動してコンテキストを構築中:", boardUrl);
    await page.goto(boardUrl, { waitUntil: "networkidle0" });
    await new Promise(resolve => setTimeout(resolve, 5000));

    // ページのリロードによりSPA上の状態を完全に同期
    await page.reload({ waitUntil: "networkidle0" });
    await new Promise(resolve => setTimeout(resolve, 3000));

    const finalCookies = await page.cookies();
    console.log("API直前の全Cookie名一覧:", finalCookies.map(c => c.name));

    // ボードページ上のコンテキストで相対パスを用いたAPIフェッチを実行
    const apiUrlPath = "/api/10/wishes?wall_hashid=board_Y0KryDdQrj0GyPBb&page_start=&v=" + Date.now();
    console.log("ボードページのコンテキストでAPIへアクセス中:", apiUrlPath);

    const apiResult = await page.evaluate(async (targetUrl) => {
      const res = await fetch(targetUrl, {
        method: "GET",
        credentials: "include",
        headers: {
          "accept": "application/vnd.api+json, */*",
          "prefer": "safe",
          "cache-control": "no-cache",
          "pragma": "no-cache"
        }
      });
      return {
        status: res.status,
        body: await res.text()
      };
    }, apiUrlPath);

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
