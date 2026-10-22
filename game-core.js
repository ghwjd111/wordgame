(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.GameCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const HANGUL_BASE = 0xac00;
  const HANGUL_LAST = 0xd7a3;
  const JUNG_COUNT = 21;
  const JONG_COUNT = 28;
  const IOTIZED_VOWELS = new Set([2, 3, 6, 7, 12, 17, 20]);
  const EASY_WORDS = [
    "사과",
    "바다",
    "나무",
    "기차",
    "호랑이",
    "무지개",
    "김밥",
    "안경",
    "자전거",
    "우유",
    "피자",
    "축구",
    "바나나",
    "토끼",
    "도토리",
    "고양이"
  ];

  function isHangulSyllable(character) {
    const code = character.charCodeAt(0);
    return code >= HANGUL_BASE && code <= HANGUL_LAST;
  }

  function isHangulWord(value) {
    if (typeof value !== "string" || value.length === 0) {
      return false;
    }
    return Array.from(value).every(isHangulSyllable);
  }

  function splitSyllable(character) {
    const index = character.charCodeAt(0) - HANGUL_BASE;
    return {
      initial: Math.floor(index / (JUNG_COUNT * JONG_COUNT)),
      vowel: Math.floor((index % (JUNG_COUNT * JONG_COUNT)) / JONG_COUNT),
      final: index % JONG_COUNT
    };
  }

  function composeSyllable(initial, vowel, final) {
    return String.fromCharCode(HANGUL_BASE + initial * JUNG_COUNT * JONG_COUNT + vowel * JONG_COUNT + final);
  }

  function lastSyllable(word) {
    return word.slice(-1);
  }

  function getAllowedStarts(character) {
    if (typeof character !== "string" || character.length === 0 || !isHangulSyllable(character)) {
      return [];
    }
    const parts = splitSyllable(character);
    const starts = [character];
    if (parts.initial === 5) {
      const nextInitial = IOTIZED_VOWELS.has(parts.vowel) ? 11 : 2;
      starts.push(composeSyllable(nextInitial, parts.vowel, parts.final));
    } else if (parts.initial === 2 && IOTIZED_VOWELS.has(parts.vowel)) {
      starts.push(composeSyllable(11, parts.vowel, parts.final));
    }
    return Array.from(new Set(starts));
  }

  function normalizeAnswer(raw) {
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return { ok: false, message: "단어를 입력해 주세요." };
    }
    let value = raw.trim().replace(/\s+/g, "");
    value = value.replace(/^[.,!?~'"“”‘’…·]+|[.,!?~'"“”‘’…·]+$/g, "");
    if (!value) {
      return { ok: false, message: "단어를 입력해 주세요." };
    }
    if (!isHangulWord(value)) {
      return { ok: false, message: "한글 단어만 입력할 수 있어요. 예: 사과" };
    }
    if (Array.from(value).length > 12) {
      return { ok: false, message: "단어는 12글자까지 입력할 수 있어요." };
    }
    return { ok: true, word: value };
  }

  function parseWordBook(raw) {
    if (typeof raw !== "string") {
      return [];
    }
    const entries = [];
    raw.split(/\r?\n/).forEach(function (line) {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      const parts = trimmed.split("|");
      const word = (parts[0] || "").trim();
      const meaning = (parts[1] || "").trim();
      const partOfSpeech = (parts[2] || "명사").trim();
      if (word && meaning && isHangulWord(word)) {
        entries.push({ word: word, meaning: meaning, pos: partOfSpeech });
      }
    });
    return entries;
  }

  function createWordBook(entries) {
    const byWord = new Map();
    (entries || []).forEach(function (entry) {
      if (entry && entry.word && entry.meaning && isHangulWord(entry.word) && !byWord.has(entry.word)) {
        byWord.set(entry.word, {
          word: entry.word,
          meaning: entry.meaning,
          pos: entry.pos || "명사"
        });
      }
    });
    const words = Array.from(byWord.values()).sort(function (a, b) {
      return a.word.localeCompare(b.word, "ko");
    });
    const byStart = new Map();
    words.forEach(function (entry) {
      const start = entry.word[0];
      if (!byStart.has(start)) {
        byStart.set(start, []);
      }
      byStart.get(start).push(entry);
    });
    return {
      entries: words,
      byWord: byWord,
      byStart: byStart,
      size: words.length
    };
  }

  function asUsedSet(usedWords) {
    if (usedWords instanceof Set) {
      return usedWords;
    }
    return new Set(Array.isArray(usedWords) ? usedWords : []);
  }

  function findCandidates(book, character, usedWords) {
    const used = asUsedSet(usedWords);
    const starts = getAllowedStarts(character);
    const found = new Map();
    starts.forEach(function (start) {
      const list = book.byStart.get(start) || [];
      list.forEach(function (entry) {
        if (!used.has(entry.word) && !found.has(entry.word)) {
          found.set(entry.word, entry);
        }
      });
    });
    return Array.from(found.values());
  }

  function countContinuations(book, word, usedWords, limit) {
    const used = asUsedSet(usedWords);
    const maximum = limit || 4;
    const starts = getAllowedStarts(lastSyllable(word));
    const seen = new Set();
    let count = 0;
    for (let i = 0; i < starts.length; i += 1) {
      const list = book.byStart.get(starts[i]) || [];
      for (let j = 0; j < list.length; j += 1) {
        const candidate = list[j].word;
        if (candidate === word || used.has(candidate) || seen.has(candidate)) {
          continue;
        }
        seen.add(candidate);
        count += 1;
        if (count >= maximum) {
          return count;
        }
      }
    }
    return count;
  }

  function shuffle(list, random) {
    const result = list.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
      const index = Math.floor(random() * (i + 1));
      const temporary = result[i];
      result[i] = result[index];
      result[index] = temporary;
    }
    return result;
  }

  function chooseProgramWord(book, character, usedWords, random) {
    const generator = typeof random === "function" ? random : Math.random;
    const candidates = findCandidates(book, character, usedWords);
    if (candidates.length === 0) {
      return null;
    }
    const used = asUsedSet(usedWords);
    const enriched = candidates.map(function (entry) {
      return {
        entry: entry,
        continuations: countContinuations(book, entry.word, used)
      };
    });
    const safe = enriched.filter(function (item) {
      return item.continuations > 0;
    });
    const safeReadable = safe.filter(function (item) {
      return Array.from(item.entry.word).length >= 2;
    });
    const readable = enriched.filter(function (item) {
      return Array.from(item.entry.word).length >= 2;
    });
    let pool = enriched;
    if (safeReadable.length > 0) {
      pool = safeReadable;
    } else if (safe.length > 0) {
      pool = safe;
    } else if (readable.length > 0) {
      pool = readable;
    }
    const shortest = Math.min.apply(null, pool.map(function (item) {
      return Array.from(item.entry.word).length;
    }));
    const friendlyLimit = Math.max(3, shortest + 1);
    const friendly = pool.filter(function (item) {
      return Array.from(item.entry.word).length <= friendlyLimit;
    });
    const chosen = friendly[Math.floor(generator() * friendly.length)];
    return chosen ? chosen.entry : pool[0].entry;
  }

  function getHints(book, character, usedWords, count, random) {
    const generator = typeof random === "function" ? random : Math.random;
    const candidates = findCandidates(book, character, usedWords);
    if (candidates.length === 0) {
      return [];
    }
    const used = asUsedSet(usedWords);
    const scored = candidates.map(function (entry) {
      const continuations = countContinuations(book, entry.word, used, 2);
      return {
        entry: entry,
        safe: continuations > 0,
        length: Array.from(entry.word).length
      };
    });
    scored.sort(function (a, b) {
      if (a.safe !== b.safe) {
        return a.safe ? -1 : 1;
      }
      if (a.length !== b.length) {
        return a.length - b.length;
      }
      return a.entry.word.localeCompare(b.entry.word, "ko");
    });
    const shuffled = shuffle(scored, generator);
    shuffled.sort(function (a, b) {
      if (a.safe !== b.safe) {
        return a.safe ? -1 : 1;
      }
      const aScore = a.length + (a.safe ? 0 : 20);
      const bScore = b.length + (b.safe ? 0 : 20);
      return aScore - bScore;
    });
    return shuffled.slice(0, count || 3).map(function (item) {
      return item.entry;
    });
  }

  function searchWordBook(book, query, limit) {
    const text = typeof query === "string" ? query.trim() : "";
    if (!text) {
      return [];
    }
    const compact = text.replace(/\s+/g, "");
    const maximum = limit || 24;
    const results = [];
    book.entries.forEach(function (entry) {
      let score = 99;
      if (entry.word === compact) {
        score = 0;
      } else if (entry.word.startsWith(compact)) {
        score = 1;
      } else if (entry.word.includes(compact)) {
        score = 2;
      } else if (entry.meaning.includes(text) || entry.meaning.includes(compact)) {
        score = 3;
      }
      if (score < 99) {
        results.push({ entry: entry, score: score });
      }
    });
    results.sort(function (a, b) {
      if (a.score !== b.score) {
        return a.score - b.score;
      }
      if (a.entry.word.length !== b.entry.word.length) {
        return a.entry.word.length - b.entry.word.length;
      }
      return a.entry.word.localeCompare(b.entry.word, "ko");
    });
    return results.slice(0, maximum).map(function (item) {
      return item.entry;
    });
  }

  function getSuggestedEntries(book, count, random) {
    const generator = typeof random === "function" ? random : Math.random;
    const found = [];
    const seen = new Set();
    EASY_WORDS.forEach(function (word) {
      const entry = book.byWord.get(word);
      if (entry && !seen.has(word)) {
        seen.add(word);
        found.push(entry);
      }
    });
    const simple = book.entries.filter(function (entry) {
      const length = Array.from(entry.word).length;
      return length >= 2 && length <= 3 && !seen.has(entry.word);
    });
    const extra = shuffle(simple, generator);
    for (let i = 0; i < extra.length && found.length < (count || 6); i += 1) {
      found.push(extra[i]);
    }
    return shuffle(found, generator).slice(0, count || 6);
  }

  function formatStarts(starts) {
    if (!starts || starts.length === 0) {
      return "";
    }
    return starts.join(" · ");
  }

  return {
    isHangulSyllable: isHangulSyllable,
    isHangulWord: isHangulWord,
    splitSyllable: splitSyllable,
    composeSyllable: composeSyllable,
    lastSyllable: lastSyllable,
    getAllowedStarts: getAllowedStarts,
    normalizeAnswer: normalizeAnswer,
    parseWordBook: parseWordBook,
    createWordBook: createWordBook,
    findCandidates: findCandidates,
    countContinuations: countContinuations,
    chooseProgramWord: chooseProgramWord,
    getHints: getHints,
    searchWordBook: searchWordBook,
    getSuggestedEntries: getSuggestedEntries,
    formatStarts: formatStarts
  };
});
