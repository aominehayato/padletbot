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

    // 認証情報（Authorization, x-csrf-token, x-uid）を保持するための変数
    let capturedHeaders = {
      authorization: null,
      "x-csrf-token": null,
      "x-uid": null
    };

    // すべての Fetch / XHR リクエストを包括的に監視し、必要な認証ヘッダーをキャプチャする設定
    page.on("request", (req) => {
      const type = req.resourceType();
      const url = req.url();
      const headers = req.headers();

      if (headers.authorization && !capturedHeaders.authorization) {
        capturedHeaders.authorization = headers.authorization;
        console.log("\n[API AUTH CAPTURED] Authorization:", headers.authorization);
      }

      if (headers["x-csrf-token"] && !capturedHeaders["x-csrf-token"]) {
        capturedHeaders["x-csrf-token"] = headers["x-csrf-token"];
        console.log("\n[API AUTH CAPTURED] x-csrf-token:", headers["x-csrf-token"]);
      }

      if (headers["x-uid"] && !capturedHeaders["x-uid"]) {
        capturedHeaders["x-uid"] = headers["x-uid"];
        console.log("\n[API AUTH CAPTURED] x-uid:", headers["x-uid"]);
      }

      if (type === "xhr" || type === "fetch") {
        console.log("\n===== FETCH / XHR REQUEST =====");
        console.log("URL:", url);

        const postData = req.postData();
        if (postData) {
          console.log("BODY:", postData);
        }
      }
    });

    // すべての Fetch / XHR レスポンスを包括的に監視・ログ出力する設定（修正済み）
    page.on("response", async (res) => {
      const req = res.request();
      const type = req.resourceType();

      if (type === "xhr" || type === "fetch") {
        console.log("\n===== FETCH / XHR RESPONSE =====");
        console.log("Status:", res.status(), "URL:", res.url());

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

    // ページの初期化とAPI自動発行を促すためのインタラクション実行
    console.log("Padlet内部の初期化処理とAPI自動発行を促すため、マウス移動とスクロールを実行します...");
    await page.mouse.move(500, 500);
    await page.mouse.click(500, 500);
    await page.keyboard.press("PageDown");
    await new Promise(resolve => setTimeout(resolve, 5000));

    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await new Promise(resolve => setTimeout(resolve, 10000));

    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    console.log("追加のAPIレスポンスを待機しています（15秒）...");
    await new Promise(resolve => setTimeout(resolve, 15000));

    // キャプチャされた認証情報の確認
    console.log("キャプチャされた認証ヘッダー情報:", capturedHeaders);

    // キャプチャされた認証情報を用いて、ブラウザコンテキストから DELETE API を実行
    if (capturedHeaders.authorization && capturedHeaders["x-csrf-token"]) {
      console.log("必要な認証情報が揃ったため、DELETE APIを実行します...");
      const deleteResult = await page.evaluate(async (auth, csrf, uid) => {
        try {
          const res = await fetch("https://padlet.com/api/9/wishes/post_4b3zaM2NjG76Q2j7?soft_delete=true", {
            method: "DELETE",
            credentials: "include",
            headers: {
              "accept": "application/json, application/vnd.api+json",
              "accept-language": "ja,en;q=0.9,en-GB;q=0.8,en-US;q=0.7",
              "authorization": auth,
              "cache-control": "no-cache",
              "content-type": "application/json; charset=utf-8",
              "pragma": "no-cache",
              "prefer": "safe",
              "priority": "u=1, i",
              "sec-ch-ua": "\"Not;A=Brand\";v=\"8\", \"Chromium\";v=\"150\", \"Microsoft Edge\";v=\"150\"",
              "sec-ch-ua-mobile": "?0",
              "sec-ch-ua-platform": "\"Windows\"",
              "sec-fetch-dest": "empty",
              "sec-fetch-mode": "same-origin",
              "sec-fetch-site": "same-origin",
              "x-csrf-token": csrf,
              "x-uid": uid || ""
            }
          });
          return {
            status: res.status,
            ok: res.ok,
            text: await res.text()
          };
        } catch (err) {
          return { error: err.message };
        }
      }, capturedHeaders.authorization, capturedHeaders["x-csrf-token"], capturedHeaders["x-uid"]);

      console.log("DELETE API 実行結果:", deleteResult);
    } else {
      console.log("警告: 必要な認証ヘッダー（Authorization または x-csrf-token）がキャプチャされませんでした。");
    }

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
