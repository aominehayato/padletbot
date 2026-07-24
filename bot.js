const puppeteer = require("puppeteer");

(async () => {
  let browser = null;
  try {
    const account = process.argv[2] || "bot";
    console.log(`使用プロファイル: ${account}`);

    console.log("ブラウザを起動しています...");
    browser = await puppeteer.launch({
      headless: true,
      userDataDir: `./profiles/${account}`,
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

    // トラッキングCookie（ww_ati等）の生成を確認
    try {
      await page.goto("https://padlet.com/", { waitUntil: "networkidle2" });
      await page.waitForFunction(() => document.cookie.includes("ww_ati"), { timeout: 15000 });
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

    // ログイン状態の確認処理
    const loggedIn = await page.evaluate(() => {
      return !location.pathname.includes("/login");
    });
    console.log("ログイン状態:", loggedIn);

    // ページの初期化とAPI自動発行を十分に待機
    console.log("Padlet内部の初期化処理とAPI自動発行を待機しています（15秒）...");
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Padlet API 初回 wishes取得の実行
    console.log("WISHES API 初回取得を実行します...");
    const apiResult = await page.evaluate(async () => {
      const url = "https://padlet.com/api/10/wishes?wall_hashid=board_Y0KryDdQrj0GyPBb&page_start=&v=" + Date.now();
      try {
        const response = await fetch(url, {
          method: "GET",
          credentials: "include",
          headers: {
            "accept": "application/json, application/vnd.api+json",
            "accept-language": "ja,en;q=0.9,en-GB;q=0.8,en-US;q=0.7",
            "cache-control": "no-cache",
            "pragma": "no-cache",
            "prefer": "safe",
            "priority": "u=1, i",
            "sec-ch-ua": "\"Not;A=Brand\";v=\"8\", \"Chromium\";v=\"150\", \"Microsoft Edge\";v=\"150\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"Windows\"",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin"
          }
        });
        const text = await response.text();
        return {
          status: response.status,
          text: text
        };
      } catch (err) {
        return {
          status: 500,
          text: err.toString()
        };
      }
    });

    console.log("WISHES API status:", apiResult.status);
    console.log("レスポンス抜粋:", apiResult.text.slice(0, 500));

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
