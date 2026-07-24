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

    // 認証情報を保持するための変数
    let capturedAuth = {
      authorization: null
    };

    // Padlet公式APIリクエストのみを対象に監視・キャプチャを設定
    page.on("request", (req) => {
      const url = req.url();
      const headers = req.headers();

      if (url.includes("padlet.com/api")) {
        console.log("\n===== PADLET API REQUEST =====");
        console.log("URL:", url);

        if (headers.authorization && !capturedAuth.authorization) {
          capturedAuth.authorization = headers.authorization;
          console.log("[API AUTH CAPTURED] Authorization:", headers.authorization);
        }

        const postData = req.postData();
        if (postData) {
          console.log("BODY:", postData);
        }
      }
    });

    // Padlet公式APIレスポンスのみを対象にJSONを解析して監視
    page.on("response", async (res) => {
      const url = res.url();

      if (!url.includes("padlet.com/api")) {
        return;
      }

      console.log("\n===== PADLET API RESPONSE =====");
      console.log("Status:", res.status(), "URL:", url);

      try {
        const json = await res.json();
        console.log("Response JSON snippet:", JSON.stringify(json).slice(0, 1000));
      } catch (e) {
        console.log("Response body parse failed or not JSON");
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

    // 実際のボードページへ直接遷移（SPAの初期化を確実にするため domcontentloaded を採用）
    const boardUrl = "https://padlet.com/magnificentconferenceliteracy/padlet-wy32bauth9n4npi1";
    console.log("ボードページへ直接移動します:", boardUrl);
    await page.goto(boardUrl, { waitUntil: "domcontentloaded" });

    // SPAの完全な初期化とAPI自動発行を待機
    console.log("SPAの初期化とAPI呼び出しを待機しています（15秒）...");
    await new Promise(resolve => setTimeout(resolve, 15000));

    // ログイン状態の確認処理
    const loggedIn = await page.evaluate(() => {
      return !location.pathname.includes("/login");
    });
    console.log("ログイン状態:", loggedIn);

    // document.cookie の出力
    const docCookie = await page.evaluate(() => document.cookie);
    console.log("document.cookie の内容:", docCookie);

    // キャプチャされた認証情報の確認
    console.log("キャプチャされた認証情報:", capturedAuth);

    // ブラウザの全Cookieを取得
    const cookies = await page.cookies();
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join("; ");
    console.log("構築済みCookie文字列:", cookieString);

    // キャプチャされた認証情報を用いて、ブラウザコンテキストから DELETE API を実行
    if (capturedAuth.authorization) {
      console.log("Authorizationが取得できたため、DELETE APIを実行します...");
      const deleteResult = await page.evaluate(async (auth) => {
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
              "sec-fetch-site": "same-origin"
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
      }, capturedAuth.authorization);

      console.log("DELETE API 実行結果:", deleteResult);
    } else {
      console.log("警告: Authorizationヘッダーがキャプチャされませんでした。");
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
