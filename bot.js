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

    // 全通信から認証情報を動的に捕捉するための変数
    let capturedAuth = null;
    let capturedCsrf = null;
    let capturedUid = null;

    // 流れてくるすべてのリクエストを監視して認証ヘッダーを網羅的に探す
    page.on("request", (req) => {
      const url = req.url();
      const headers = req.headers();
      const auth = headers["authorization"];
      const csrf = headers["x-csrf-token"];
      const uid = headers["x-uid"];

      if (auth || csrf || uid) {
        console.log(`\n===== 認証関連ヘッダー検出 [${req.method()}] ${url} =====`);
        if (auth) {
          capturedAuth = auth;
          console.log("authorization 発見:", auth.slice(0, 30) + "...");
        }
        if (csrf) {
          capturedCsrf = csrf;
          console.log("x-csrf-token 発見:", csrf.slice(0, 30) + "...");
        }
        if (uid) {
          capturedUid = uid;
          console.log("x-uid 発見:", uid);
        }
      }
    });

    // レスポンスヘッダー側もすべて監視する
    page.on("response", async (res) => {
      const url = res.url();
      const headers = res.headers();
      if (headers["set-cookie"] || headers["x-csrf-token"]) {
        console.log(`\n===== レスポンス認証ヘッダー検出: ${url} =====`);
        if (headers["x-csrf-token"]) {
          console.log("レスポンス内 x-csrf-token:", headers["x-csrf-token"]);
        }
      }
    });

    // 実際のボードページへ遷移
    const boardUrl = "https://padlet.com/magnificentconferenceliteracy/padlet-wy32bauth9n4npi1";
    console.log("ボードページへ直接移動します:", boardUrl);
    await page.goto(boardUrl, { waitUntil: "domcontentloaded" });

    // ログイン状態の確認処理
    const loggedIn = await page.evaluate(() => {
      return !location.pathname.includes("/login");
    });
    console.log("ログイン状態:", loggedIn);

    // document.cookie の出力
    const docCookie = await page.evaluate(() => document.cookie);
    console.log("document.cookie の内容:", docCookie);

    // LocalStorage の内容確認
    const localStorages = await page.evaluate(() => {
      const items = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        items.push({ key: key, value: localStorage.getItem(key)?.slice(0, 100) });
      }
      return items;
    });
    console.log("LocalStorage一覧:", localStorages);

    // SPA全体の初期化と認証トークン発行通信を確実に行わせるため30秒間待機
    console.log("Padlet内部の初期化処理と認証通信の発生を30秒間待ち受けます...");
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (capturedAuth && capturedCsrf && capturedUid) {
        console.log("すべての必要ヘッダーが揃いました。");
        break;
      }
    }

    console.log("キャプチャ状況 -> authorization:", !!capturedAuth, "x-csrf-token:", !!capturedCsrf, "x-uid:", !!capturedUid);

    // キャプチャしたヘッダーを使って WISHES API を明示的に実行
    console.log("WISHES API の認証付きカスタム取得を実行します...");
    const apiResult = await page.evaluate(async (auth, csrf, uid) => {
      const url = "https://padlet.com/api/10/wishes?wall_hashid=board_Y0KryDdQrj0GyPBb&page_start=&v=" + Date.now();
      try {
        const headers = {
          "accept": "application/json, application/vnd.api+json",
          "prefer": "safe"
        };
        if (auth) headers["authorization"] = auth;
        if (csrf) headers["x-csrf-token"] = csrf;
        if (uid) headers["x-uid"] = uid;

        const response = await fetch(url, {
          method: "GET",
          credentials: "include",
          headers: headers
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
    }, capturedAuth, capturedCsrf, capturedUid);

    console.log("WISHES API status:", apiResult.status);
    console.log("レスポンス抜粋:", apiResult.text.slice(0, 500));

    // ページ内スクロールを行って追加のトリガーを発生させる
    console.log("ページ内スクロールを実行します...");
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise(resolve => setTimeout(resolve, 10000));

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
