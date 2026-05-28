const https = require("https");
const http = require("http");

const PORT = process.env.PORT || 3001;

// Fetch from Yahoo Finance with proper headers
function yahooFetch(symbol) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "query1.finance.yahoo.com",
      path: `/v8/finance/chart/${symbol}?interval=1d&range=1d`,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://finance.yahoo.com/",
        "Origin": "https://finance.yahoo.com",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("Invalid JSON from Yahoo")); }
      });
    });
    req.on("error", reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  // CORS — allow all origins so the browser app can call this freely
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // Health check
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok", service: "Shah's Portfolio Price Proxy" }));
    return;
  }

  // GET /price?symbol=RELIANCE.NS
  const url = new URL(req.url, `http://localhost`);
  if (url.pathname === "/price") {
    let symbol = url.searchParams.get("symbol") || "";
    symbol = symbol.toUpperCase().trim();
    if (!symbol) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "Missing symbol parameter" }));
      return;
    }
    if (!symbol.endsWith(".NS") && !symbol.endsWith(".BO")) symbol += ".NS";

    try {
      const data = await yahooFetch(symbol);
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta?.regularMarketPrice) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "Price not found for " + symbol }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify({
        symbol,
        price: meta.regularMarketPrice,
        prevClose: meta.previousClose || null,
        name: meta.shortName || symbol.replace(".NS", ""),
        currency: meta.currency || "INR",
        timestamp: Date.now(),
      }));
    } catch (err) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: "Upstream fetch failed: " + err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Unknown route. Use /price?symbol=RELIANCE" }));
});

server.listen(PORT, () => {
  console.log(`Shah's Portfolio Price Proxy running on port ${PORT}`);
});
