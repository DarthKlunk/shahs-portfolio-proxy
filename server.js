const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, "portfolio_data.json");

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return null; }
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data), "utf8");
}

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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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

  // GET /history?symbol=RELIANCE.NS&days=180
  if (url.pathname === "/history") {
    let symbol = url.searchParams.get("symbol") || "";
    const days = Math.min(parseInt(url.searchParams.get("days") || "180"), 365);
    symbol = symbol.toUpperCase().trim();
    if (!symbol.endsWith(".NS") && !symbol.endsWith(".BO")) symbol += ".NS";

    try {
      const range = days <= 30 ? "1mo" : days <= 90 ? "3mo" : days <= 180 ? "6mo" : "1y";
      const histUrl = `/v8/finance/chart/${symbol}?interval=1d&range=${range}`;
      const data = await new Promise((resolve, reject) => {
        const opts = {
          hostname: "query1.finance.yahoo.com",
          path: histUrl,
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json",
            "Referer": "https://finance.yahoo.com/",
          },
        };
        const req = https.request(opts, (res) => {
          let d = "";
          res.on("data", c => d += c);
          res.on("end", () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
        });
        req.on("error", reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error("Timeout")); });
        req.end();
      });

      const result = data?.chart?.result?.[0];
      if (!result) { res.writeHead(404); res.end(JSON.stringify({ error: "No data" })); return; }

      const timestamps = result.timestamp || [];
      const q = result.indicators?.quote?.[0] || {};
      const candles = timestamps.map((t, i) => ({
        time: t,
        open: q.open?.[i],
        high: q.high?.[i],
        low: q.low?.[i],
        close: q.close?.[i],
        volume: q.volume?.[i],
      })).filter(c => c.open && c.high && c.low && c.close);

      res.writeHead(200);
      res.end(JSON.stringify({ symbol, candles, name: result.meta?.shortName || symbol }));
    } catch (err) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: "History fetch failed: " + err.message }));
    }
    return;
  }

  // GET /data — load all portfolios
  if (url.pathname === "/data" && req.method === "GET") {
    const data = loadData();
    if (!data) { res.writeHead(404); res.end(JSON.stringify({ error: "No data yet" })); return; }
    res.writeHead(200);
    res.end(JSON.stringify(data));
    return;
  }

  // POST /data — save all portfolios
  if (url.pathname === "/data" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        saveData(data);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Unknown route. Use /price?symbol=RELIANCE or /history?symbol=RELIANCE" }));
});

server.listen(PORT, () => {
  console.log(`Shah's Portfolio Price Proxy running on port ${PORT}`);
});
