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

    const email = process.env.PADLET_EMAIL;
    const password = process.env.PADLET_PASSWORD;

    if (email && password) {
      console.log("Padletログインページへアクセス中...");
      await page.goto("https://padlet.com/auth/login", { waitUntil: "networkidle2" });

      console.log("CSRFトークンを取得中...");
      const csrfToken = await page.evaluate(() => {
        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.content : null;
      });

      console.log("取得したCSRFトークン:", csrfToken);

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

      console.log("通信完了まで3秒間待機します...");
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const cookies = await page.cookies();
      console.log("ログイン後に取得されたCookie一覧:", cookies.map((c) => c.name));
    } else {
      console.log("ログイン環境変数が設定されていないため、未認証の状態で処理を継続します。");
    }

    console.log("Padletの目的のボードページへアクセス中...");
    await page.goto("https://padlet.com/magnificentconferenceliteracy/padlet-wy32bauth9n4npi1", {
      waitUntil: "networkidle2"
    });

    const apiUrl = "https://padlet.com/api/10/wishes?wall_hashid=board_Y0KryDdQrj0GyPBb&page_start=&v=1784862836";

    console.log("確立された認証セッションを用いて非公開APIへリクエストを送信中...");
    const apiResult = await page.evaluate(async (url) => {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "accept": "*/*",
          "prefer": "safe"
        }
      });
      return await response.text();
    }, apiUrl);

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
