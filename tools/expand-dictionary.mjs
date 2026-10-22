import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORDS_PATH = path.join(ROOT, "words.js");
const ENV_PATH = path.join(ROOT, ".env");
const CACHE_DIR = path.join(ROOT, ".cache", "krdict");
const API_URL = "https://krdict.korean.go.kr/api/search";
const NUM = 100;
const MAX_START_OFFSET = 1000;
const MAX_WORD_LENGTH = 10;
const MAX_MEANING_LENGTH = 240;
const DEFAULT_DELAY_MS = 350;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const refresh = args.has("--refresh");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const delayArg = process.argv.find((arg) => arg.startsWith("--delay="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : Number.POSITIVE_INFINITY;
const delayMs = delayArg ? Number(delayArg.split("=")[1]) : DEFAULT_DELAY_MS;

let requestCount = 0;
let lastRequestAt = 0;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readKey() {
  const source = await fs.readFile(ENV_PATH, "utf8");
  const match = source.match(/^\s*KRDICT_API_KEY\s*=\s*(.*)\s*$/m);
  const key = match ? match[1].trim().replace(/^["']|["']$/g, "") : "";
  if (!/^[0-9a-fA-F]{32}$/.test(key)) {
    throw new Error("KRDICT_API_KEY is missing or is not a 32-character hexadecimal key in .env");
  }
  return key;
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function cleanText(value) {
  let text = String(value || "");
  text = text.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1");
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeXml(text);
  return text.replace(/\s+/g, " ").trim();
}

function getTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? cleanText(match[1]) : "";
}

function parseTotal(xml) {
  const match = xml.match(/<total>(\d+)<\/total>/);
  return match ? Number(match[1]) : 0;
}

function parseItems(xml) {
  const entries = [];
  const itemPattern = /<item>([\s\S]*?)<\/item>/g;
  let itemMatch;
  while ((itemMatch = itemPattern.exec(xml))) {
    const block = itemMatch[1];
    const word = getTag(block, "word");
    const pos = getTag(block, "pos");
    const grade = getTag(block, "word_grade") || "중급";
    const definitions = [];
    const definitionPattern = /<definition>([\s\S]*?)<\/definition>/g;
    let definitionMatch;
    while ((definitionMatch = definitionPattern.exec(block))) {
      const definition = cleanText(definitionMatch[1]);
      if (definition) {
        definitions.push(definition);
      }
    }
    if (!/^[가-힣]{2,10}$/.test(word) || pos !== "명사" || definitions.length === 0) {
      continue;
    }
    const selected = definitions.slice(0, 2);
    let meaning = selected.length > 1
      ? selected.map((definition, index) => `${index + 1}) ${definition}`).join(" ")
      : selected[0];
    if (meaning.length > MAX_MEANING_LENGTH) {
      meaning = `${meaning.slice(0, MAX_MEANING_LENGTH - 1).trimEnd()}…`;
    }
    entries.push({
      word,
      meaning,
      pos,
      grade: grade === "초급" ? "초급" : "중급",
      targetCode: getTag(block, "target_code"),
      supNo: getTag(block, "sup_no")
    });
  }
  return entries;
}

async function throttle() {
  const wait = delayMs - (Date.now() - lastRequestAt);
  if (wait > 0) {
    await sleep(wait);
  }
  lastRequestAt = Date.now();
}

async function fetchPage(key, query, start) {
  const params = new URLSearchParams({
    key,
    q: query,
    method: "start",
    part: "word",
    advanced: "y",
    pos: "1",
    level: "level1,level2",
    type1: "word",
    letter_s: "2",
    letter_e: String(MAX_WORD_LENGTH),
    num: String(NUM),
    start: String(start),
    sort: "popular"
  });
  const url = `${API_URL}?${params.toString()}`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await throttle();
    requestCount += 1;
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/xml,text/xml",
          "User-Agent": "wordgame-dictionary-builder/1.0"
        },
        signal: AbortSignal.timeout(30000)
      });
      const body = await response.text();
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const errorCode = body.match(/<error_code>([^<]+)<\/error_code>/);
      if (errorCode) {
        const message = getTag(body, "message") || "unknown API error";
        throw new Error(`KRDICT ${errorCode[1]}: ${message}`);
      }
      return body;
    } catch (error) {
      if (attempt === 4) {
        throw error;
      }
      await sleep(1500 * 2 ** attempt);
    }
  }
  throw new Error("request failed");
}

function cachePath(query) {
  return path.join(CACHE_DIR, `u${query.codePointAt(0).toString(16)}.json`);
}

async function readCache(query) {
  if (refresh) {
    return null;
  }
  try {
    const raw = await fs.readFile(cachePath(query), "utf8");
    const cached = JSON.parse(raw);
    return Array.isArray(cached.items) ? cached : null;
  } catch (error) {
    return null;
  }
}

async function writeCache(query, data) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cachePath(query), `${JSON.stringify(data)}\n`, "utf8");
}

async function fetchStart(key, query) {
  const cached = await readCache(query);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  const firstXml = await fetchPage(key, query, 1);
  const total = parseTotal(firstXml);
  const items = parseItems(firstXml);
  const maximum = Math.min(total, MAX_START_OFFSET);
  for (let start = NUM + 1; start <= maximum; start += NUM) {
    const xml = await fetchPage(key, query, start);
    items.push(...parseItems(xml));
  }
  const result = {
    q: query,
    total,
    capped: total > MAX_START_OFFSET,
    items,
    fetchedAt: new Date().toISOString()
  };
  await writeCache(query, result);
  return { ...result, fromCache: false };
}

function parseWordBook(source) {
  const first = source.indexOf("`");
  const last = source.lastIndexOf("`");
  if (first === -1 || last <= first) {
    throw new Error("Could not find the WORD_BOOK_RAW template literal");
  }
  const body = source.slice(first + 1, last).replace(/^\uFEFF/, "");
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const entries = [];
  for (const line of lines) {
    const parts = line.split("|");
    const word = (parts[0] || "").trim();
    const meaning = (parts[1] || "").trim();
    const pos = (parts[2] || "명사").trim();
    const grade = (parts[3] || "기존").trim();
    if (word && meaning) {
      entries.push({ word, meaning, pos, grade, line });
    }
  }
  return { entries, lines };
}

function sanitizeField(value) {
  return String(value)
    .replace(/\|/g, "·")
    .replace(/`/g, "'")
    .replace(/\$\{/g, "$ {")
    .replace(/\\/g, "\\\\")
    .replace(/\s+/g, " ")
    .trim();
}

function makeLine(entry) {
  return [
    sanitizeField(entry.word),
    sanitizeField(entry.meaning),
    sanitizeField(entry.pos || "명사"),
    sanitizeField(entry.grade || "중급")
  ].join("|");
}

async function main() {
  if (!Number.isFinite(limit) && limit !== Number.POSITIVE_INFINITY) {
    throw new Error("--limit must be a number");
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error("--delay must be a non-negative number");
  }

  const key = await readKey();
  const source = await fs.readFile(WORDS_PATH, "utf8");
  const { entries: existing, lines: existingLines } = parseWordBook(source);
  const existingByWord = new Map(existing.map((entry) => [entry.word, entry]));

  const endingCounts = new Map();
  for (const entry of existing) {
    const ending = entry.word.slice(-1);
    endingCounts.set(ending, (endingCounts.get(ending) || 0) + 1);
  }
  const endings = Array.from(endingCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
    .map(([ending]) => ending);
  const selectedEndings = Number.isFinite(limit) ? endings.slice(0, Math.max(0, limit)) : endings;

  console.log(`existing=${existing.length} endingSyllables=${endings.length} selected=${selectedEndings.length} delayMs=${delayMs}`);

  const addedByWord = new Map();
  let processed = 0;
  let cacheHits = 0;
  let apiItems = 0;

  for (const ending of selectedEndings) {
    const result = await fetchStart(key, ending);
    processed += 1;
    if (result.fromCache) {
      cacheHits += 1;
    }
    apiItems += result.items.length;
    for (const entry of result.items) {
      if (!existingByWord.has(entry.word) && !addedByWord.has(entry.word)) {
        addedByWord.set(entry.word, entry);
      }
    }
    if (processed % 20 === 0 || processed === selectedEndings.length) {
      console.log(`progress=${processed}/${selectedEndings.length} cacheHits=${cacheHits} apiItems=${apiItems} newWords=${addedByWord.size} requests=${requestCount}`);
    }
  }

  const added = Array.from(addedByWord.values()).sort((a, b) => a.word.localeCompare(b.word, "ko"));
  const totalWords = existing.length + added.length;

  console.log(`done existing=${existing.length} added=${added.length} total=${totalWords} cacheHits=${cacheHits} requests=${requestCount}`);

  if (dryRun) {
    for (const entry of added.slice(0, 20)) {
      console.log(`${entry.word}|${entry.meaning}|${entry.pos}|${entry.grade}`);
    }
    return;
  }

  const outputLines = existingLines.concat(added.map(makeLine));
  const output = `window.WORD_BOOK_RAW = \`\n${outputLines.join("\n")}\n\`;\n`;
  await fs.writeFile(WORDS_PATH, output, "utf8");
  console.log(`wrote ${WORDS_PATH}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
