#!/usr/bin/env node
// scripts/seed.mjs
// Runs on Railway as a cron job every 6 hours.
// Fetches lottery-related articles from GDELT Doc API and stores them in Upstash Redis.

import { Redis } from '@upstash/redis';

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!REDIS_URL || !REDIS_TOKEN) {
  console.error('Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN');
  process.exit(1);
}

const redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });

const CACHE_KEY    = 'lottery:gdelt:v1';
const CACHE_TTL    = 60 * 60 * 8;   // 8 hours — outlasts the 6h cron window
const TIMELINE_TTL = 60 * 60 * 12;  // 12 hours for tone/vol timelines
const GDELT_API    = 'https://api.gdeltproject.org/api/v2/doc/doc';
const CHROME_UA    = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const TOPIC_DELAY  = 20_000; // 20s between topics to avoid 429s

const TOPICS = [
  {
    id: 'jackpot',
    name: 'Jackpots',
    icon: '🎰',
    query: '(lottery jackpot OR "powerball" OR "mega millions" OR "euromillions" OR "lottery winner") sourcelang:eng',
  },
  {
    id: 'winners',
    name: 'Winners',
    icon: '🏆',
    query: '("lottery winner" OR "won the lottery" OR "lucky winner" OR "prize winner" OR "lotto winner") sourcelang:eng',
  },
  {
    id: 'draws',
    name: 'Draws & Results',
    icon: '🎱',
    query: '("lottery draw" OR "winning numbers" OR "lottery results" OR "lotto draw" OR "prize draw") sourcelang:eng',
  },
  {
    id: 'regulation',
    name: 'Regulation',
    icon: '⚖️',
    query: '("lottery regulation" OR "gambling law" OR "lottery ban" OR "lottery commission" OR "gaming authority") sourcelang:eng',
  },
  {
    id: 'scams',
    name: 'Scams & Fraud',
    icon: '⚠️',
    query: '("lottery scam" OR "lottery fraud" OR "fake lottery" OR "lottery phishing" OR "prize scam") sourcelang:eng',
  },
  {
    id: 'fundraising',
    name: 'Charity & Fundraising',
    icon: '❤️',
    query: '("charity lottery" OR "raffle" OR "lottery fundraiser" OR "national lottery good causes" OR "lottery grant") sourcelang:eng',
  },
];

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchArticles(topic) {
  const url = new URL(GDELT_API);
  url.searchParams.set('query',      topic.query);
  url.searchParams.set('mode',       'artlist');
  url.searchParams.set('maxrecords', '10');
  url.searchParams.set('format',     'json');
  url.searchParams.set('sort',       'date');
  url.searchParams.set('timespan',   '24h');

  const resp = await fetch(url.toString(), {
    headers: { 'User-Agent': CHROME_UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();

  return (data.articles || [])
    .filter(a => isValidUrl(a.url || ''))
    .map(a => ({
      title:    String(a.title  || '').slice(0, 300),
      url:      a.url,
      source:   String(a.domain || '').slice(0, 100),
      date:     String(a.seendate || ''),
      image:    isValidUrl(a.socialimage || '') ? a.socialimage : '',
      tone:     typeof a.tone === 'number' ? a.tone : 0,
    }));
}

async function fetchTimeline(topic, mode) {
  const url = new URL(GDELT_API);
  url.searchParams.set('query',    topic.query);
  url.searchParams.set('mode',     mode);
  url.searchParams.set('format',   'json');
  url.searchParams.set('timespan', '14d');

  try {
    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': CHROME_UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const raw  = data?.timeline ?? data?.data ?? [];
    return raw
      .map(pt => ({ date: String(pt.date || pt.datetime || ''), value: typeof pt.value === 'number' ? pt.value : 0 }))
      .filter(pt => pt.date);
  } catch { return []; }
}

async function fetchTopicWithRetry(topic, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchArticles(topic);
    } catch (err) {
      const is429 = err.message?.includes('429');
      if (!is429 || attempt === maxRetries) {
        console.warn(`  [${topic.id}] gave up after ${attempt + 1} attempts: ${err.message}`);
        return [];
      }
      const backoff = 60_000 * Math.pow(2, attempt);
      console.log(`  [${topic.id}] 429 — waiting ${backoff / 1000}s...`);
      await sleep(backoff);
    }
  }
}

async function run() {
  console.log('=== Lottery GDELT Seed ===');
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  Topics: ${TOPICS.map(t => t.id).join(', ')}\n`);

  // Load previous snapshot so we can preserve articles for rate-limited topics
  let previous = null;
  try { previous = await redis.get(CACHE_KEY); } catch { /* ignore */ }
  const prevMap = new Map((previous?.topics || []).map(t => [t.id, t]));

  const topics = [];

  for (let i = 0; i < TOPICS.length; i++) {
    if (i > 0) await sleep(TOPIC_DELAY);
    const topic = TOPICS[i];
    console.log(`  Fetching ${topic.id}...`);

    const articles = await fetchTopicWithRetry(topic);

    // Fetch tone/vol timelines in parallel (best-effort)
    const [tone, vol] = await Promise.all([
      fetchTimeline(topic, 'TimelineTone'),
      fetchTimeline(topic, 'TimelineVol'),
    ]);

    // Fall back to cached articles if rate-limited
    const finalArticles = articles.length > 0
      ? articles
      : (prevMap.get(topic.id)?.articles || []);

    if (articles.length === 0 && finalArticles.length > 0) {
      console.log(`  [${topic.id}] rate-limited — using ${finalArticles.length} cached articles`);
    } else {
      console.log(`  [${topic.id}] ${finalArticles.length} articles, ${tone.length} tone pts, ${vol.length} vol pts`);
    }

    topics.push({
      id:        topic.id,
      name:      topic.name,
      icon:      topic.icon,
      articles:  finalArticles,
      fetchedAt: new Date().toISOString(),
    });

    // Write per-topic timeline keys
    if (tone.length > 0) await redis.set(`lottery:tone:${topic.id}`, { data: tone, fetchedAt: new Date().toISOString() }, { ex: TIMELINE_TTL });
    if (vol.length  > 0) await redis.set(`lottery:vol:${topic.id}`,  { data: vol,  fetchedAt: new Date().toISOString() }, { ex: TIMELINE_TTL });
  }

  const populated = topics.filter(t => t.articles.length > 0).length;
  if (populated < 2) {
    console.warn(`\n  Only ${populated}/6 topics have articles — skipping write to preserve cache`);
    process.exit(0);
  }

  const payload = { topics, fetchedAt: new Date().toISOString() };
  await redis.set(CACHE_KEY, payload, { ex: CACHE_TTL });

  console.log(`\n=== Done — ${topics.reduce((n, t) => n + t.articles.length, 0)} total articles written ===`);
}

run().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
