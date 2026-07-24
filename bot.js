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

    // Client Hints の偽装
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

    // リクエストインターセプションを有効化し、実際のネットワーク送信ヘッダーからBearer認証やCSRF、UIDを確実に捕捉する
    await page.setRequestInterception(true);

    const capturedAuth = {
      authorization: null,
      csrf: null,
      uid: null
    };

    page.on("request", (req) => {
      const url = req.url();
      const headers = req.headers();

      if (url.includes("padlet.com/api")) {
        const auth = headers["authorization"];
        const csrf = headers["x-csrf-token"];
        const uid = headers["x-uid"];

        if (auth && auth.startsWith("Bearer ")) {
          capturedAuth.authorization = auth;
          console.log("[CAPTURE] Bearer Authorization 検出:", auth);
        }
        if (csrf) {
          capturedAuth.csrf = csrf;
          console.log("[CAPTURE] CSRF Token 検出:", csrf);
        }
        if (uid) {
          capturedAuth.uid = uid;
          console.log("[CAPTURE] UID 検出:", uid);
        }
      }

      req.continue();
    });

    const boardUrl = "https://padlet.com/magnificentconferenceliteracy/padlet-wy32bauth9n4npi1";
    console.log("ボードページへ直接移動します:", boardUrl);
    await page.goto(boardUrl, { waitUntil: "domcontentloaded" });

    console.log("SPAの初期化とAPI通信の発生を待機しています（20秒）...");
    await new Promise(resolve => setTimeout(resolve, 20000));

    // ログイン状態の確認
    const loggedIn = await page.evaluate(() => {
      return !location.pathname.includes("/login");
    });
    console.log("ログイン状態:", loggedIn);

    console.log("最終的にキャプチャされた認証情報:", capturedAuth);

    // Cookie情報の取得
    const cookies = await page.cookies();
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join("; ");
    console.log("構築済みCookie文字列:", cookieString);

    // キャプチャされた必須ヘッダー（Authorization, x-csrf-token, x-uid）をすべて付与してDELETE APIを実行
    if (capturedAuth.authorization && capturedAuth.csrf && capturedAuth.uid) {
      console.log("必要な認証情報がすべて揃ったため、DELETE APIを実行します...");
      
      const apiResult = await page.evaluate(async (auth, csrf, uid) => {
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
              "x-csrf-token": csrf,
              "x-uid": uid
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
      }, capturedAuth.authorization, capturedAuth.csrf, capturedAuth.uid);

      console.log("API 実行結果:", apiResult);
    } else {
      console.log("警告: 必要な認証情報の一部がキャプチャできませんでした。待機時間を伸ばすか、ページ内で追加のアクションが必要です。");
    }

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
