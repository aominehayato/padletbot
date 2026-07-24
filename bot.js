const puppeteer = require("puppeteer");

(async () => {
  let browser = null;
  try {
    console.log("ブラウザを起動しています...");
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
    );

    // 通信の監視設定
    page.on("request", (req) => {
      if (req.url().includes("login_as_user") || req.url().includes("verify_login")) {
        console.log("REQUEST:", req.url());
      }
    });

    page.on("response", async (response) => {
      if (response.url().includes("login_as_user") || response.url().includes("verify_login")) {
        console.log("RESPONSE:", response.status(), response.url());
      }
    });

    const email = process.env.PADLET_EMAIL;
    const password = process.env.PADLET_PASSWORD;
    const cookiesJson = process.env.PADLET_COOKIES_JSON;
    const sessionCookie = process.env.PADLET_SESSION_COOKIE;

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

    if (email && password && !cookiesJson && !sessionCookie) {
      console.log("Padletログインページへアクセス中...");
      await page.goto("https://padlet.com/auth/login", { waitUntil: "networkidle2" });

      console.log("CSRFトークンを取得中...");
      const csrfToken = await page.evaluate(() => {
        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.content : null;
      });

      console.log("取得したCSRFトークン:", csrfToken);

      console.log("事前チェックAPI（check-if-can-login）を実行中...");
      await page.evaluate(async (userEmail) => {
        await fetch(`/api/5/auth/check-if-can-login?email_or_username=${encodeURIComponent(userEmail)}`, {
          method: "GET",
          headers: { "accept": "*/*", "prefer": "safe" },
          credentials: "include"
        });
      }, email);

      console.log("ログインマニフェスト取得APIを実行中...");
      await page.evaluate(async (userEmail) => {
        await fetch(`/api/auth/login?email_or_username=${encodeURIComponent(userEmail)}`, {
          method: "GET",
          headers: { "accept": "application/json, application/vnd.api+json", "prefer": "safe" },
          credentials: "include"
        });
      }, email);

      console.log("認証API経由でログイン処理を実行中...");
      const loginResponse = await page.evaluate(
        async (userEmail, userPassword, token) => {
          const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: {
              "accept": "application/json, application/vnd.api+json",
              "content-type": "application/json",
              "prefer": "safe",
              "x-csrf-token": token || ""
            },
            credentials: "include",
            body: JSON.stringify({
              username: userEmail,
              password: userPassword
            })
          });
          return {
            status: res.status,
            body: await res.text()
          };
        },
        email,
        password,
        csrfToken
      );

      console.log("ログインAPIレスポンスステータス:", loginResponse.status);
      console.log("ログインAPIレスポンス結果:", loginResponse.body);

      try {
        const responseData = JSON.parse(loginResponse.body);
        if (responseData && responseData.data && responseData.data.attributes) {
          const targetUrl = responseData.data.attributes.loginUrl || responseData.data.attributes.redirectUrl;
          if (targetUrl) {
            console.log("レスポンスから取得した検証URLへアクセス中:", targetUrl);
            await page.goto(targetUrl, {
              waitUntil: "networkidle2",
              timeout: 30000
            });

            console.log("遷移後のURL:", page.url());

            // 状態確認用のスクリーンショットを保存
            await page.screenshot({ path: "login_result.png", fullPage: true });
            console.log("スクリーンショット 'login_result.png' を保存しました。");

            // 認証完了まで待機
            await page.waitForFunction(
              () =>
                location.pathname.includes("verify_login") ||
                location.pathname.includes("home") ||
                location.pathname.includes("dashboard") ||
                location.pathname.includes("verify-login-email-address"),
              { timeout: 15000 }
            ).catch(() => {});

            console.log("待機完了後の現在のURL:", page.url());
          }
        }
      } catch (e) {
        console.log("レスポンスJSONの自動解析または検証URLアクセスに失敗しました:", e.message);
      }

      const currentCookies = await page.cookies();
      console.log("--- ログイン後に取得されたCookie詳細 ---");
      console.log(JSON.stringify(currentCookies, null, 2));
      console.log("----------------------------------------");
    }

    console.log("Padletの目的のボードページへアクセス中...");
    await page.goto("https://padlet.com/magnificentconferenceliteracy/padlet-wy32bauth9n4npi1", {
      waitUntil: "networkidle2"
    });

    console.log("ボードページ上の最新CSRFトークンを再取得中...");
    const boardCsrfToken = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="csrf-token"]');
      return meta ? meta.content : null;
    });

    const apiUrl = "https://padlet.com/api/10/wishes?wall_hashid=board_Y0KryDdQrj0GyPBb&page_start=&v=1784862836";

    console.log("確立された認証セッションを用いて非公開APIへリクエストを送信中...");
    const apiResult = await page.evaluate(
      async (url, token) => {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "accept": "*/*",
            "prefer": "safe",
            "x-csrf-token": token || ""
          },
          credentials: "include"
        });
        return await response.text();
      },
      apiUrl,
      boardCsrfToken
    );

    console.log("--- APIレスポンス結果 ---");
    console.log(apiResult);
    console.log("------------------------");

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
