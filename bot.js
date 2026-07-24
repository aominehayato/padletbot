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
        "--disable-blink-features=AutomationControlled",
        "--window-size=1920,1080"
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

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

    // すべての Fetch / XHR リクエストを包括的に監視・ログ出力する設定
    page.on("request", (req) => {
      const type = req.resourceType();
      const url = req.url();

      if (type === "xhr" || type === "fetch") {
        console.log("\n===== FETCH / XHR REQUEST =====");
        console.log("URL:", url);
        console.log("Headers:", JSON.stringify(req.headers(), null, 2));

        const postData = req.postData();
        if (postData) {
          console.log("BODY:", postData);
        }
      }
    });

    // すべての Fetch / XHR レスポンスを包括的に監視・ログ出力する設定
    page.on("response", async (res) => {
      const req = res.request();
      const type = req.resourceType();

      if (type === "xhr" || type === "fetch") {
        console.log("\n===== FETCH / XHR RESPONSE =====");
        console.log("Status:", res.status(), "URL:", res.url());
        console.log("Response headers:", JSON.stringify(res.headers(), null, 2));

        try {
          const text = await res.text();
          console.log("Response body snippet:", text.substring(0, 300));
        } catch (e) {
          console.log("Response body read failed:", e.message);
        }
      }
    });

    // requestfinished イベントの追加
    page.on("requestfinished", async (req) => {
      const type = req.resourceType();
      if (type === "xhr" || type === "fetch") {
        const response = await req.response();
        if (response) {
          console.log("\n===== REQUEST FINISHED =====");
          console.log("URL:", req.url(), "Status:", response.status());
          try {
            const body = await response.text();
            console.log("Body snippet:", body.substring(0, 500));
          } catch (e) {
            console.log("Body read failed:", e.message);
          }
        }
      }
    });

    // WebSocketの監視追加
    page.on("websocket", (ws) => {
      console.log("\n===== WEBSOCKET CREATED =====");
      console.log("URL:", ws.url());

      ws.on("framereceived", (frame) => {
        if (frame.payloadData) {
          console.log("WS DATA RECEIVED:", frame.payloadData.substring(0, 300));
        }
      });
    });

    // 実際のボードページへ直接遷移してセッションコンテキストを構築
    const boardUrl = "https://padlet.com/magnificentconferenceliteracy/padlet-wy32bauth9n4npi1";
    console.log("ボードページへ直接移動します:", boardUrl);
    await page.goto(boardUrl, { waitUntil: "networkidle2" });

    // ログイン状態の確認処理
    const loggedIn = await page.evaluate(() => {
      return !location.pathname.includes("/login");
    });
    console.log("ログイン状態:", loggedIn);

    // document.cookie の出力
    const docCookie = await page.evaluate(() => document.cookie);
    console.log("document.cookie の内容:", docCookie);

    // LocalStorage の内容を確認
    const localStorages = await page.evaluate(() => {
      const items = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        items.push({ key: key, value: localStorage.getItem(key)?.slice(0, 100) });
      }
      return items;
    });
    console.log("LocalStorage一覧:", localStorages);

    // Performance API を使ったリソース確認
    const resources = await page.evaluate(() => {
      return performance.getEntriesByType("resource")
        .map(x => x.name)
        .filter(x => x.includes("/api") || x.includes("/v1") || x.includes("padlet"));
    });
    console.log("Performance API Resources:", resources);

    // HTML内の Initial State / 投稿データの探索
    const htmlInfo = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      return {
        hasInitial: html.includes("__INITIAL") || html.includes("__STATE__") || html.includes("initialState"),
        hasWallId: html.includes("wallId") || html.includes("266991839"),
        hasPosts: html.includes("posts") || html.includes("content")
      };
    });
    console.log("HTML内容の初期状態チェック:", htmlInfo);

    // ページの初期化とAPI自動発行を十分に待機（30秒）
    console.log("Padlet内部の初期化処理とAPI自動発行を待機しています（30秒）...");
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // ページ内スクロールやインタラクションを実行してAPIリクエストを強制発火
    console.log("ページ内スクロールを実行してAPIリクエストの発生を促します...");
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await new Promise(resolve => setTimeout(resolve, 10000));

    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    console.log("追加のAPIレスポンスを待機しています（15秒）...");
    await new Promise(resolve => setTimeout(resolve, 15000));

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
