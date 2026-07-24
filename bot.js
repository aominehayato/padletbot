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

    // ページ内スクリプトからAPI情報を収集するための暴露用オブジェクトを設置
    await page.evaluateOnNewDocument(() => {
      window.__capturedApiData = {
        authorization: null,
        csrf: null,
        uid: null,
        wall_id: null,
        wall_hashid: null
      };

      const captureHeaders = (headers) => {
        if (!headers) return;
        if (headers instanceof Headers) {
          const a = headers.get('authorization'); if (a) window.__capturedApiData.authorization = a;
          const c = headers.get('x-csrf-token'); if (c) window.__capturedApiData.csrf = c;
          const u = headers.get('x-uid'); if (u) window.__capturedApiData.uid = u;
          return;
        }
        for (const key in headers) {
          const lk = key.toLowerCase();
          const v = headers[key];
          if (lk === 'authorization') window.__capturedApiData.authorization = v;
          else if (lk === 'x-csrf-token') window.__capturedApiData.csrf = v;
          else if (lk === 'x-uid') window.__capturedApiData.uid = v;
        }
      };

      // fetch のフック
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const options = args[1];
        if (options) {
          captureHeaders(options.headers);
        }
        const response = await originalFetch(...args);
        return response;
      };
    });

    // Padlet公式APIリクエストの監視
    page.on("request", (req) => {
      const url = req.url();
      const headers = req.headers();

      if (url.includes("padlet.com/api")) {
        console.log("\n===== PADLET API REQUEST =====");
        console.log("URL:", url);

        if (headers.authorization) {
          console.log("[REQUEST HEADER AUTH]:", headers.authorization);
        }
      }
    });

    // Padlet公式APIレスポンスの監視
    page.on("response", async (res) => {
      const url = res.url();
      if (!url.includes("padlet.com/api")) {
        return;
      }

      console.log("\n===== PADLET API RESPONSE =====");
      console.log("Status:", res.status(), "URL:", url);

      try {
        const json = await res.json();
        console.log("Response JSON snippet:", JSON.stringify(json).slice(0, 500));
      } catch (e) {
        console.log("Response body parse failed or not JSON");
      }
    });

    // 実際のボードページへ直接遷移
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

    // ページ内でフックして収集した認証情報を取得
    const pageCapturedAuth = await page.evaluate(() => window.__capturedApiData);
    console.log("ページ内フックでキャプチャされた認証情報:", pageCapturedAuth);

    // ブラウザの全Cookieを取得
    const cookies = await page.cookies();
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join("; ");
    console.log("構築済みCookie文字列:", cookieString);

    // キャプチャされた認証情報（またはCookie）を用いて、ブラウザコンテキストから DELETE API を実行
    const authHeaderToUse = pageCapturedAuth.authorization;
    if (authHeaderToUse) {
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
              "prefer": "safe"
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
      }, authHeaderToUse);

      console.log("DELETE API 実行結果:", deleteResult);
    } else {
      console.log("警告: ページ内フックでもAuthorizationヘッダーが取得できませんでした（Cookieセッション認証の可能性があります）。");
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
