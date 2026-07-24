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

    // Padlet自体のAPIリクエストおよびレスポンスを完全に監視・捕捉する設定
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/api/10/wishes")) {
        console.log("===== PADLET自身による WISHES API リクエスト検出 =====");
        console.log("リクエストURL:", url);
        console.log("リクエストヘッダー:", req.headers());
      }
    });

    page.on("response", async (res) => {
      const url = res.url();
      if (url.includes("/api/10/wishes")) {
        console.log("===== PADLET自身による WISHES API レスポンス検出 =====");
        console.log("ステータス:", res.status());
        try {
          const body = await res.text();
          console.log("取得したAPIレスポンスボディ抜粋:", body.slice(0, 500));
        } catch (e) {
          console.log("レスポンスボディ取得失敗:", e.message);
        }
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

    // Padletホームへアクセスし、ww_ati などのトラッキングCookieが生成されるまで待機
    console.log("Padletホームへアクセスしてセッションおよびトラッキング（ww_ati等）を初期化中...");
    await page.goto("https://padlet.com/", { waitUntil: "networkidle2" });

    try {
      await page.waitForFunction(() => document.cookie.includes("ww_ati"), { timeout: 30000 });
      console.log("ww_ati の生成を確認しました。");
    } catch (e) {
      console.log("ww_ati の生成待ちがタイムアウトしました。続行します。");
    }

    // Service Worker コントローラーを有効化するため、一度ページをリロード
    console.log("Service Worker を有効化するためページを再読み込みします...");
    await page.reload({ waitUntil: "networkidle0" });
    await new Promise(resolve => setTimeout(resolve, 5000));

    const hasSwController = await page.evaluate(() => !!navigator.serviceWorker.controller);
    console.log("Service Worker コントローラー有効状態:", hasSwController);

    // 実際のボードページへ遷移してコンテキストを完全に構築
    const boardUrl = "https://padlet.com/magnificentconferenceliteracy/padlet-wy32bauth9n4npi1";
    console.log("ボードページへ移動してSPAおよびセッションコンテキストを構築中:", boardUrl);
    await page.goto(boardUrl, { waitUntil: "networkidle2" });

    // ページの初期化とAPI自動発行を十分に待機
    console.log("Padlet内部の初期化処理とAPI自動発行を待機しています（15秒）...");
    await new Promise(resolve => setTimeout(resolve, 15000));

    // スクロール操作を行ってPadletのAPIフェッチ（無限スクロール等）を強制発火させる
    console.log("ページ内スクロールを実行してAPIリクエストの発生を促します...");
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await new Promise(resolve => setTimeout(resolve, 10000));

    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    console.log("追加のAPIレスポンスを待機しています（20秒）...");
    await new Promise(resolve => setTimeout(resolve, 20000));

    const finalCookies = await page.cookies();
    console.log("最終的な全Cookie名一覧:", finalCookies.map(c => c.name));

    console.log("処理が完了しました。ブラウザを終了します。");
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
