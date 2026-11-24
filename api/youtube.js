// GET /api/youtube?q=song  ->  { items: [ { id, title, channel, thumb } ] }
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const q = String((req.query && req.query.q) || "").trim().slice(0, 100);
  if (!q) {
    return res.status(400).json({ error: "missing q" });
  }
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "server key missing" });
  }
  const url = "https://www.googleapis.com/youtube/v3/search"
    + "?part=snippet&type=video&videoEmbeddable=true&maxResults=15"
    + "&q=" + encodeURIComponent(q)
    + "&key=" + key;
  try {
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || "youtube error";
      return res.status(r.status).json({ error: msg });
    }
    const items = (data.items || [])
      .filter((i) => i.id && i.id.videoId)
      .map((i) => {
        const t = (i.snippet && i.snippet.thumbnails) || {};
        const thumb = (t.medium || t.default || {}).url || "";
        return {
          id: i.id.videoId,
          title: i.snippet.title,
          channel: i.snippet.channelTitle,
          thumb: thumb
        };
      });
    // same search within 1 hour comes from cache (saves the daily free limit)
    res.setHeader("Cache-Control", "s-maxage=3600");
    return res.status(200).json({ items: items });
  } catch (e) {
    return res.status(500).json({ error: "fetch failed" });
  }
}
