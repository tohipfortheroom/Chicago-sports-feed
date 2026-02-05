const express = require("express");
const Parser = require("rss-parser");
const RSS = require("rss");

const app = express();
const parser = new Parser({ timeout: 10000 });
const PORT = process.env.PORT || 3000;

// Refresh interval in minutes
const REFRESH_INTERVAL = 10;

// --- Source Feeds ---
// "keywords" is optional — if present, only articles matching a keyword are kept.
// This is used for league-wide feeds (ESPN) to filter to Chicago teams only.
const FEEDS = {
  cubs: [
    { url: "https://www.bleedcubbieblue.com/rss/index.xml", label: "Cubs" },
    { url: "https://www.bleachernation.com/cubs/feed/", label: "Cubs" },
    { url: "https://chicago.suntimes.com/rss/cubs/index.xml", label: "Cubs" },
    {
      url: "https://www.espn.com/espn/rss/mlb/news",
      label: "Cubs",
      keywords: ["cubs", "wrigley"],
    },
  ],
  bulls: [
    {
      url: "https://www.espn.com/espn/rss/nba/news",
      label: "Bulls",
      keywords: ["bulls", "chicago bulls", "united center"],
    },
    {
      url: "https://www.bleachernation.com/bulls/feed/",
      label: "Bulls",
    },
    { url: "https://chicago.suntimes.com/rss/bulls/index.xml", label: "Bulls" },
  ],
  bears: [
    {
      url: "https://www.espn.com/espn/rss/nfl/news",
      label: "Bears",
      keywords: ["bears", "chicago bears", "soldier field", "caleb williams"],
    },
    { url: "https://www.bleachernation.com/bears/feed/", label: "Bears" },
    { url: "https://chicago.suntimes.com/rss/bears/index.xml", label: "Bears" },
    { url: "https://www.windycitygridiron.com/rss/index.xml", label: "Bears" },
  ],
};

// --- In-memory cache ---
let cachedItems = [];
let lastFetch = 0;

async function fetchAllFeeds() {
  const now = Date.now();
  if (cachedItems.length > 0 && now - lastFetch < REFRESH_INTERVAL * 60 * 1000) {
    return cachedItems;
  }

  const allSources = [
    ...FEEDS.cubs,
    ...FEEDS.bulls,
    ...FEEDS.bears,
  ];

  const results = await Promise.allSettled(
    allSources.map(async (source) => {
      try {
        const feed = await parser.parseURL(source.url);
        let items = feed.items.map((item) => ({
          title: item.title,
          link: item.link,
          description: item.contentSnippet || item.content || "",
          date: item.isoDate || item.pubDate || new Date().toISOString(),
          team: source.label,
          source: feed.title || source.url,
        }));
        // If source has keywords, filter to only matching articles
        if (source.keywords) {
          items = items.filter((item) => {
            const text = `${item.title} ${item.description}`.toLowerCase();
            return source.keywords.some((kw) => text.includes(kw.toLowerCase()));
          });
        }
        return items;
      } catch (err) {
        console.error(`Failed to fetch ${source.url}: ${err.message}`);
        return [];
      }
    })
  );

  const items = results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value);

  // Sort newest first
  items.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Keep latest 200 items
  cachedItems = items.slice(0, 200);
  lastFetch = now;
  console.log(
    `[${new Date().toLocaleTimeString()}] Fetched ${cachedItems.length} items from ${allSources.length} sources`
  );
  return cachedItems;
}

// --- /feed — unified RSS output ---
app.get("/feed", async (req, res) => {
  const items = await fetchAllFeeds();

  const teamFilter = req.query.team;
  let filtered = items;
  if (teamFilter) {
    const teams = teamFilter.split(",").map((t) => t.trim().toLowerCase());
    filtered = items.filter((i) => teams.includes(i.team.toLowerCase()));
  }

  const feed = new RSS({
    title: "Chicago Sports Feed — Cubs, Bulls, Bears",
    description:
      "Aggregated news feed for the Chicago Cubs, Bulls, and Bears",
    feed_url: `${req.protocol}://${req.get("host")}/feed`,
    site_url: `${req.protocol}://${req.get("host")}`,
    language: "en",
    ttl: REFRESH_INTERVAL,
  });

  for (const item of filtered) {
    feed.item({
      title: `[${item.team}] ${item.title}`,
      description: item.description.slice(0, 500),
      url: item.link,
      date: item.date,
      categories: [item.team],
      custom_elements: [{ source: item.source }],
    });
  }

  res.set("Content-Type", "application/rss+xml; charset=utf-8");
  res.send(feed.xml({ indent: true }));
});

// --- /feed.json — JSON version ---
app.get("/feed.json", async (req, res) => {
  const items = await fetchAllFeeds();

  const teamFilter = req.query.team;
  let filtered = items;
  if (teamFilter) {
    const teams = teamFilter.split(",").map((t) => t.trim().toLowerCase());
    filtered = items.filter((i) => teams.includes(i.team.toLowerCase()));
  }

  res.json({
    title: "Chicago Sports Feed",
    updated: new Date().toISOString(),
    count: filtered.length,
    items: filtered,
  });
});

// --- / — simple landing page ---
app.get("/", (req, res) => {
  res.send(`
    <html>
    <head>
      <title>Chicago Sports Feed</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; background: #111; color: #eee; }
        h1 { color: #fff; }
        a { color: #4da6ff; }
        code { background: #222; padding: 2px 6px; border-radius: 4px; }
        .team { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; margin-right: 4px; }
        .cubs { background: #0e3386; color: #cc3433; }
        .bulls { background: #ce1141; color: #fff; }
        .bears { background: #0b162a; color: #c83803; }
      </style>
    </head>
    <body>
      <h1>Chicago Sports Feed</h1>
      <p>Aggregated RSS for the
        <span class="team cubs">Cubs</span>
        <span class="team bulls">Bulls</span>
        <span class="team bears">Bears</span>
      </p>
      <h3>Subscribe in Feedly</h3>
      <p>Add this URL to your RSS reader:</p>
      <p><code>YOUR_URL/feed</code></p>
      <h3>Filter by team</h3>
      <ul>
        <li><a href="/feed?team=cubs">/feed?team=cubs</a></li>
        <li><a href="/feed?team=bulls">/feed?team=bulls</a></li>
        <li><a href="/feed?team=bears">/feed?team=bears</a></li>
        <li><a href="/feed?team=cubs,bears">/feed?team=cubs,bears</a></li>
      </ul>
      <h3>JSON API</h3>
      <p><a href="/feed.json">/feed.json</a> — same data as JSON</p>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Chicago Sports Feed running on http://localhost:${PORT}`);
  console.log(`RSS feed: http://localhost:${PORT}/feed`);
  console.log(`JSON API: http://localhost:${PORT}/feed.json`);
  // Pre-fetch on startup
  fetchAllFeeds();
});
