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

    // ページ内 fetch / XHR を強力にフックして認証情報（Authorization, x-csrf-token, x-uid）を自動キャプチャする
    await page.evaluateOnNewDocument(() => {
      window.__padletAuth = {
        authorization: null,
        csrf: null,
        uid: null
      };

      const parseHeaders = (headers) => {
        if (!headers) return;
        if (headers instanceof Headers) {
          const auth = headers.get('authorization');
          const csrf = headers.get('x-csrf-token');
          const uid = headers.get('x-uid');
          if (auth) window.__padletAuth.authorization = auth;
          if (csrf) window.__padletAuth.csrf = csrf;
          if (uid) window.__padletAuth.uid = uid;
        } else if (typeof headers === 'object') {
          for (const key in headers) {
            const lk = key.toLowerCase();
            const val = headers[key];
            if (lk === 'authorization') window.__padletAuth.authorization = val;
            if (lk === 'x-csrf-token') window.__padletAuth.csrf = val;
            if (lk === 'x-uid') window.__padletAuth.uid = val;
          }
        }
      };

      // fetch のフック
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        if (args[1] && args[1].headers) {
          parseHeaders(args[1].headers);
        }
        const res = await originalFetch(...args);
        return res;
      };

      // XHR のフック
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
      
      XMLHttpRequest.prototype.open = function(method, url) {
        this._requestHeaders = {};
        return originalOpen.apply(this, arguments);
      };

      XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
        if (this._requestHeaders) {
          this._requestHeaders[header] = value;
          parseHeaders(this._requestHeaders);
        }
        return originalSetRequestHeader.apply(this, arguments);
      };
    });

    const boardUrl = "https://padlet.com/magnificentconferenceliteracy/padlet-wy32bauth9n4npi1";
    console.log("ボードページへ直接移動します:", boardUrl);
    await page.goto(boardUrl, { waitUntil: "domcontentloaded" });

    console.log("SPAの初期化とAPI通信の発生を待機しています（15秒）...");
    await new Promise(resolve => setTimeout(resolve, 15000));

    // ログイン状態の確認
    const loggedIn = await page.evaluate(() => {
      return !location.pathname.includes("/login");
    });
    console.log("ログイン状態:", loggedIn);

    // キャプチャされた認証情報の取得
    const capturedAuth = await page.evaluate(() => window.__padletAuth);
    console.log("キャプチャされた認証情報:", capturedAuth);

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
      console.log("警告: 必要な認証情報の一部がキャプチャできませんでした。待機時間を伸ばすか、追加のアクションが必要です。");
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
