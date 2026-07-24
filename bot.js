const puppeteer = require("puppeteer");

(async () => {
  let browser = null;
  try {
    console.log("ブラウザを起動しています...");
    browser = await puppeteer.launch({
      headless: "new",
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

    console.log("PadletのページへアクセスしてCookieを自動取得中...");
    await page.goto("https://padlet.com/magnificentconferenceliteracy/padlet-wy32bauth9n4npi1", {
      waitUntil: "networkidle2"
    });

    const apiUrl = "https://padlet.com/api/10/wishes?wall_hashid=board_Y0KryDdQrj0GyPBb&page_start=&v=1784862836";

    console.log("取得したCookieとセッションを用いて非公開APIへリクエストを送信中...");
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
