const puppeteer = require("puppeteer");

(async () => {
  let browser = null;
  try {
    const account = process.argv[2] || "bot";
    const apiKey = process.env.PADLET_API_KEY || "YOUR_API_KEY_HERE";
    const boardId = "wy32bauth9n4npi1";
    const boardUrl = `https://padlet.com/magnificentconferenceliteracy/padlet-${boardId}`;

    console.log(`使用プロファイル: ${account}`);

    // Step 1: Node.js標準の fetch を使用して公式APIから左端のセクションIDを取得
    console.log("公式APIを使用してボード情報（セクション）を取得しています...");
    const boardRes = await fetch(`https://api.padlet.dev/v1/boards/${boardId}?include=posts,sections`, {
      method: "GET",
      headers: {
        "X-API-KEY": apiKey,
        "accept": "application/vnd.api+json"
      }
    });

    if (!boardRes.ok) {
      const errText = await boardRes.text();
      throw new Error(`ボード情報の取得に失敗しました: ${boardRes.status} ${errText}`);
    }

    const boardData = await boardRes.json();
    const sections = boardData.included ? boardData.included.filter(x => x.type === "section") : [];
    if (!sections || sections.length === 0) {
      throw new Error("セクションが見つかりませんでした。");
    }
    const targetSectionId = sections[0].id;
    console.log(`一番左側のセクションIDを取得しました: ${targetSectionId}`);

    // Step 2: 公式APIを使用して指定セクションに投稿を作成
    console.log("公式APIを使用して新しい投稿を作成しています...");
    const createRes = await fetch(`https://api.padlet.dev/v1/boards/${boardId}/posts`, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "content-type": "application/vnd.api+json",
        "accept": "application/vnd.api+json"
      },
      body: JSON.stringify({
        data: {
          type: "post",
          attributes: {
            content: {
              subject: "自動テスト投稿",
              body: "API経由で作成された投稿です。"
            },
            color: "red"
          },
          relationships: {
            section: {
              data: {
                id: targetSectionId
              }
            }
          }
        }
      })
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`投稿の作成に失敗しました: ${createRes.status} ${errText}`);
    }

    const createData = await createRes.json();
    const createdPostId = createData.data.id;
    console.log(`投稿の作成に成功しました。作成された投稿ID: ${createdPostId}`);

    // Step 3: Puppeteerを起動してネットワーク通信の全容をCDPで監視・キャプチャする
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

    // CDPセッションで全リクエストを監視し、送受信されるヘッダーをすべてログ出力・捕捉する
    const client = await page.target().createCDPSession();
    await client.send("Network.enable");

    const capturedAuth = {
      authorization: null,
      csrf: null,
      uid: null
    };

    client.on("Network.requestWillBeSent", (event) => {
      const url = event.request.url;
      const method = event.request.method;
      const headers = event.request.headers;

      console.log(`[REQUEST] ${method} ${url}`);

      // すべてのリクエストから条件に合う認証情報を探索
      const auth = headers["authorization"] || headers["Authorization"];
      const csrf = headers["x-csrf-token"] || headers["X-CSRF-Token"];
      const uid = headers["x-uid"] || headers["X-UID"];

      if (auth) {
        console.log(`[CDP CAPTURE] Authorization 検出 (${auth.substring(0, 15)}...):`, auth);
        if (auth.startsWith("Bearer ")) {
          capturedAuth.authorization = auth;
        }
      }
      if (csrf) {
        capturedAuth.csrf = csrf;
        console.log("[CDP CAPTURE] CSRF Token 検出:", csrf);
      }
      if (uid) {
        capturedAuth.uid = uid;
        console.log("[CDP CAPTURE] UID 検出:", uid);
      }
    });

    console.log("ボードページへ移動します:", boardUrl);
    await page.goto(boardUrl, { waitUntil: "domcontentloaded" });

    console.log("SPAの初期化と通信発生を待機しています（20秒）...");
    await new Promise(resolve => setTimeout(resolve, 20000));

    // ログイン状態の確認
    const loggedIn = await page.evaluate(() => {
      return !location.pathname.includes("/login");
    });
    console.log("ログイン状態:", loggedIn);

    console.log("最終的にキャプチャされた認証情報:", capturedAuth);

    // キャプチャされた必須ヘッダーを用いて、作成した投稿を対象に非公開DELETE APIを直接実行
    if (capturedAuth.authorization && capturedAuth.csrf && capturedAuth.uid) {
      console.log("必要な認証情報がすべて揃ったため、DELETE APIを実行します...");

      const apiResult = await page.evaluate(async (postId, auth, csrf, uid) => {
        try {
          const res = await fetch(`https://padlet.com/api/9/wishes/${postId}?soft_delete=true`, {
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
      }, createdPostId, capturedAuth.authorization, capturedAuth.csrf, capturedAuth.uid);

      console.log("API 実行結果:", apiResult);
    } else {
      console.log("警告: 必要な認証情報の一部がキャプチャできませんでした。");
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
