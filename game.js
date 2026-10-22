(function () {
  "use strict";

  const core = window.GameCore;
  const BEST_KEY = "malitgi.best";
  const SOUND_KEY = "malitgi.sound";
  const STARTERS = [
    "사과",
    "바다",
    "나무",
    "기차",
    "호랑이",
    "바나나",
    "자전거",
    "토끼",
    "무지개",
    "김밥",
    "우산",
    "시계",
    "도토리",
    "사자",
    "고양이",
    "축구",
    "하마",
    "피자",
    "안경",
    "우유",
    "가방",
    "사진"
  ];

  const dom = {
    scoreValue: document.getElementById("scoreValue"),
    bestValue: document.getElementById("bestValue"),
    soundButton: document.getElementById("soundButton"),
    rulesButton: document.getElementById("rulesButton"),
    rulesDialog: document.getElementById("rulesDialog"),
    turnBadge: document.getElementById("turnBadge"),
    startLetter: document.getElementById("startLetter"),
    mascot: document.getElementById("mascot"),
    speakerLabel: document.getElementById("speakerLabel"),
    speakButton: document.getElementById("speakButton"),
    currentWord: document.getElementById("currentWord"),
    currentPos: document.getElementById("currentPos"),
    currentMeaning: document.getElementById("currentMeaning"),
    nextCue: document.getElementById("nextCue"),
    answerForm: document.getElementById("answerForm"),
    answerInput: document.getElementById("answerInput"),
    micButton: document.getElementById("micButton"),
    submitButton: document.getElementById("submitButton"),
    feedback: document.getElementById("feedback"),
    hintButton: document.getElementById("hintButton"),
    hintPanel: document.getElementById("hintPanel"),
    hintTitle: document.getElementById("hintTitle"),
    hintNote: document.getElementById("hintNote"),
    hintList: document.getElementById("hintList"),
    restartButton: document.getElementById("restartButton"),
    wordCount: document.getElementById("wordCount"),
    dictionaryInput: document.getElementById("dictionaryInput"),
    dictionaryResults: document.getElementById("dictionaryResults"),
    historyCount: document.getElementById("historyCount"),
    historyList: document.getElementById("historyList"),
    historyEmpty: document.getElementById("historyEmpty"),
    footerWordCount: document.getElementById("footerWordCount"),
    winDialog: document.getElementById("winDialog"),
    winCopy: document.getElementById("winCopy"),
    winScore: document.getElementById("winScore"),
    winBest: document.getElementById("winBest"),
    playAgainButton: document.getElementById("playAgainButton"),
    toast: document.getElementById("toast"),
    confettiCanvas: document.getElementById("confettiCanvas"),
    speechCard: document.querySelector(".speech-card")
  };

  if (!core) {
    dom.feedback.textContent = "게임을 준비하지 못했어요. 페이지를 새로 고쳐 주세요.";
    dom.feedback.classList.add("is-error");
    return;
  }

  const rawWords = window.WORD_BOOK_RAW || "";
  const book = core.createWordBook(core.parseWordBook(rawWords));

  if (book.size === 0) {
    dom.feedback.textContent = "단어장을 불러오지 못했어요. words.js 파일을 확인해 주세요.";
    dom.feedback.classList.add("is-error");
    dom.answerInput.disabled = true;
    dom.submitButton.disabled = true;
    return;
  }

  const state = {
    current: null,
    used: new Set(),
    score: 0,
    best: readBest(),
    history: [],
    thinking: false,
    finished: false,
    soundOn: readSound(),
    lastInputMethod: "text",
    lastStarter: null,
    recognition: null,
    recognitionSupported: false,
    listening: false,
    utterance: null
  };

  let programTimer = null;
  let mascotTimer = null;
  let toastTimer = null;
  let confettiFrame = null;
  let audioContext = null;

  function readBest() {
    try {
      const value = Number.parseInt(window.localStorage.getItem(BEST_KEY), 10);
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch (error) {
      return 0;
    }
  }

  function writeBest(value) {
    try {
      window.localStorage.setItem(BEST_KEY, String(value));
    } catch (error) {
      return;
    }
  }

  function readSound() {
    try {
      return window.localStorage.getItem(SOUND_KEY) !== "off";
    } catch (error) {
      return true;
    }
  }

  function writeSound(value) {
    try {
      window.localStorage.setItem(SOUND_KEY, value ? "on" : "off");
    } catch (error) {
      return;
    }
  }

  function particleFor(character, withFinal, withoutFinal) {
    const parts = core.splitSyllable(character);
    return parts.final === 0 ? withoutFinal : withFinal;
  }

  function objectParticleFor(word) {
    return particleFor(core.lastSyllable(word), "을", "를");
  }

  function formatStartsHtml(starts) {
    return starts.map(function (start) {
      return "<strong>" + start + "</strong>";
    }).join(" 또는 ");
  }

  function currentStarts() {
    if (!state.current) {
      return [];
    }
    return core.getAllowedStarts(core.lastSyllable(state.current.word));
  }

  function updateScore(animate) {
    dom.scoreValue.textContent = String(state.score);
    dom.bestValue.textContent = String(state.best);
    if (animate) {
      dom.scoreValue.classList.remove("is-popping");
      void dom.scoreValue.offsetWidth;
      dom.scoreValue.classList.add("is-popping");
    }
  }

  function setFeedback(message, tone) {
    dom.feedback.textContent = message || "";
    dom.feedback.classList.remove("is-error", "is-success", "is-info");
    if (tone) {
      dom.feedback.classList.add("is-" + tone);
    }
  }

  function setTurnBadge(label, mode) {
    dom.turnBadge.textContent = label;
    dom.turnBadge.classList.toggle("is-thinking", mode === "thinking");
    dom.turnBadge.classList.toggle("is-finished", mode === "finished");
  }

  function updatePlaceholder() {
    if (state.listening) {
      return;
    }
    if (state.finished) {
      dom.answerInput.placeholder = "새로 시작을 눌러 주세요";
      return;
    }
    if (state.thinking) {
      dom.answerInput.placeholder = "탐험대장이 생각하고 있어요";
      return;
    }
    const starts = currentStarts();
    const particle = starts.length > 0 ? particleFor(starts[0], "으로", "로") : "로";
    dom.answerInput.placeholder = starts.length > 0
      ? "'" + starts[0] + "'" + particle + " 시작하는 단어"
      : "단어를 입력해 주세요";
  }

  function syncControls() {
    const locked = state.thinking || state.finished;
    dom.answerInput.disabled = locked;
    dom.submitButton.disabled = locked;
    dom.micButton.disabled = locked || !state.recognitionSupported;
    dom.hintButton.disabled = locked;
    updatePlaceholder();
  }

  function animateMascot(className) {
    const name = className || "is-talking";
    dom.mascot.classList.remove("is-talking", "is-listening");
    void dom.mascot.offsetWidth;
    dom.mascot.classList.add(name);
    window.clearTimeout(mascotTimer);
    mascotTimer = window.setTimeout(function () {
      dom.mascot.classList.remove(name);
    }, name === "is-listening" ? 1100 : 600);
  }

  function animateSpeechCard() {
    dom.speechCard.classList.remove("is-updated");
    void dom.speechCard.offsetWidth;
    dom.speechCard.classList.add("is-updated");
  }

  function setCurrent(entry, label, cueMode) {
    state.current = entry;
    const starts = currentStarts();
    const particle = starts.length > 0
      ? particleFor(starts[starts.length - 1], "으로", "로")
      : "로";
    dom.currentWord.textContent = entry.word;
    dom.currentPos.textContent = entry.pos || "낱말";
    dom.currentMeaning.textContent = entry.meaning || "아직 뜻을 몰라요.";
    dom.speakerLabel.textContent = label;
    dom.startLetter.textContent = starts.join(" · ");
    dom.nextCue.innerHTML = cueMode === "thinking"
      ? "탐험대장이 " + formatStartsHtml(starts) + particle + " 이어 갈 단어를 고르고 있어요."
      : "이제 " + formatStartsHtml(starts) + particle + " 시작하는 단어를 말해 봐요!";
    animateSpeechCard();
    updatePlaceholder();
  }

  function appendHistory(entry, who) {
    const item = document.createElement("li");
    item.className = "history-item";
    if (who === "child") {
      item.classList.add("history-item--child");
    }
    if (entry.unknown) {
      item.classList.add("is-unknown");
    }

    const meta = document.createElement("div");
    meta.className = "history-meta";
    const speaker = document.createElement("span");
    speaker.textContent = who === "child" ? "나" : "탐험대장";
    const turn = document.createElement("span");
    turn.textContent = String(state.history.length);
    meta.append(speaker, turn);

    const word = document.createElement("strong");
    word.textContent = entry.word;
    const meaning = document.createElement("p");
    meaning.textContent = entry.meaning;

    item.append(meta, word, meaning);
    dom.historyList.append(item);
    dom.historyEmpty.hidden = true;
    dom.historyCount.textContent = String(state.history.length);
    window.requestAnimationFrame(function () {
      dom.historyList.scrollTop = dom.historyList.scrollHeight;
    });
  }

  function chooseStarter() {
    const usable = STARTERS.map(function (word) {
      return book.byWord.get(word);
    }).filter(function (entry) {
      if (!entry) {
        return false;
      }
      return core.countContinuations(book, entry.word, new Set([entry.word]), 2) > 0;
    });
    let pool = usable.filter(function (entry) {
      return !state.lastStarter || entry.word !== state.lastStarter;
    });
    if (pool.length === 0) {
      pool = usable;
    }
    if (pool.length === 0) {
      pool = book.entries.filter(function (entry) {
        return core.countContinuations(book, entry.word, new Set([entry.word]), 2) > 0;
      });
    }
    if (pool.length === 0) {
      pool = book.entries;
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function closeHint() {
    dom.hintPanel.hidden = true;
    dom.hintButton.setAttribute("aria-expanded", "false");
    dom.hintButton.querySelector("span").textContent = "힌트 보기";
    dom.hintNote.textContent = "단어를 누르면 입력창에 들어가요";
  }

  function startNewGame(options) {
    const settings = options || {};
    window.clearTimeout(programTimer);
    programTimer = null;
    abortRecognition();
    stopConfetti();
    if (state.soundOn && typeof window.speechSynthesis !== "undefined") {
      window.speechSynthesis.cancel();
    }
    if (dom.winDialog.open) {
      dom.winDialog.close();
    }

    state.used = new Set();
    state.score = 0;
    state.history = [];
    state.thinking = false;
    state.finished = false;
    state.current = null;
    state.lastInputMethod = "text";
    state.utterance = null;

    dom.answerForm.reset();
    dom.answerForm.classList.remove("is-shaking");
    dom.historyList.replaceChildren();
    dom.historyEmpty.hidden = false;
    dom.historyCount.textContent = "0";
    dom.hintList.replaceChildren();
    closeHint();
    setFeedback("", "");
    updateScore(false);
    syncControls();

    const starter = chooseStarter();
    state.lastStarter = starter.word;
    state.used.add(starter.word);
    state.history.push({ entry: starter, who: "program" });
    appendHistory(starter, "program");
    setCurrent(starter, "탐험대장의 말", "child");
    setTurnBadge("내 차례", "idle");
    const starts = currentStarts();
    const allowed = starts.map(function (start) {
      return "'" + start + "'";
    }).join(" 또는 ");
    const particle = starts.length > 0
      ? particleFor(starts[starts.length - 1], "으로", "로")
      : "로";
    setFeedback(
      "탐험대장이 '" + starter.word + "'" + objectParticleFor(starter.word) + " 먼저 냈어요. " +
      allowed + particle + " 시작하는 단어를 말해 보세요.",
      "info"
    );
    syncControls();
    animateMascot();
    dom.answerInput.focus({ preventScroll: true });

    if (settings.announce && state.soundOn) {
      window.setTimeout(function () {
        if (state.current === starter) {
          speakEntry(starter);
        }
      }, 380);
    }
  }

  function rejectAnswer(message) {
    setFeedback(message, "error");
    dom.answerForm.classList.remove("is-shaking");
    void dom.answerForm.offsetWidth;
    dom.answerForm.classList.add("is-shaking");
    playTone("error");
    dom.answerInput.focus({ preventScroll: true });
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (state.thinking || state.finished || !state.current) {
      return;
    }
    if (state.listening) {
      abortRecognition();
    }

    const normalized = core.normalizeAnswer(dom.answerInput.value);
    if (!normalized.ok) {
      rejectAnswer(normalized.message);
      return;
    }

    const word = normalized.word;
    if (state.used.has(word)) {
      rejectAnswer("이미 나온 단어예요. 다른 단어로 이어가 볼까요?");
      return;
    }

    const starts = currentStarts();
    if (starts.indexOf(word[0]) === -1) {
      const allowed = starts.map(function (start) {
        return "'" + start + "'";
      }).join(" 또는 ");
      const particle = particleFor(starts[starts.length - 1], "으로", "로");
      rejectAnswer(allowed + particle + " 시작하는 단어를 말해 주세요. 두음법칙도 괜찮아요.");
      return;
    }

    const known = book.byWord.get(word);
    const entry = known || {
      word: word,
      meaning: "아직 뜻을 몰라요. 다음에 단어 도감에서 찾아볼까요?",
      pos: "낱말",
      unknown: true
    };

    state.used.add(word);
    state.score += 1;
    if (state.score > state.best) {
      state.best = state.score;
      writeBest(state.best);
    }
    state.history.push({ entry: entry, who: "child" });
    appendHistory(entry, "child");
    updateScore(true);
    playTone("success");
    closeHint();
    dom.answerInput.value = "";
    setCurrent(entry, "내가 낸 말", "thinking");
    setTurnBadge("탐험대장이 생각 중", "thinking");
    setFeedback(
      known
        ? "좋아요! '" + word + "'의 뜻도 함께 기억해 봐요."
        : "좋아요! 도감에 없는 단어라 뜻은 아직 몰라요. 그래도 멋진 도전이에요.",
      known ? "success" : "info"
    );
    state.thinking = true;
    syncControls();
    animateMascot();
    dom.answerInput.blur();

    const nextStart = core.lastSyllable(word);
    const delay = 680 + Math.random() * 420;
    programTimer = window.setTimeout(function () {
      playProgramTurn(nextStart);
    }, delay);
  }

  function playProgramTurn(startCharacter) {
    programTimer = null;
    if (state.finished) {
      return;
    }
    const choice = core.chooseProgramWord(book, startCharacter, state.used, Math.random);
    state.thinking = false;
    if (!choice) {
      finishGame(startCharacter);
      return;
    }

    state.used.add(choice.word);
    state.history.push({ entry: choice, who: "program" });
    appendHistory(choice, "program");
    setCurrent(choice, "탐험대장의 말", "child");
    setTurnBadge("내 차례", "idle");
    setFeedback("'" + choice.word + "'의 뜻을 함께 읽고 다음 단어를 이어 주세요.", "info");
    syncControls();
    animateMascot();
    playTone("turn");

    if (state.soundOn) {
      window.setTimeout(function () {
        if (state.current === choice) {
          speakEntry(choice);
        }
      }, 180);
    }
    if (state.lastInputMethod === "text") {
      dom.answerInput.focus({ preventScroll: true });
    }
  }

  function finishGame(startCharacter) {
    state.thinking = false;
    state.finished = true;
    syncControls();
    setTurnBadge("탐험 끝", "finished");
    const starts = core.getAllowedStarts(startCharacter);
    const labels = starts.map(function (start) {
      return "'" + start + "'";
    }).join(" 또는 ");
    const particle = starts.length > 0
      ? particleFor(starts[starts.length - 1], "으로", "로")
      : "로";
    dom.nextCue.innerHTML = "이번 탐험은 여기까지! 정말 멋졌어요.";
    dom.winCopy.textContent = "탐험대장이 " + labels + particle + " 이어 갈 단어를 찾지 못했어요. 끝까지 멋진 탐험이었어요!";
    dom.winScore.textContent = String(state.score);
    dom.winBest.textContent = String(state.best);
    setFeedback("정말 잘했어요! 새 탐험을 시작하려면 '새로 시작'을 눌러요.", "success");
    if (!dom.winDialog.open) {
      dom.winDialog.showModal();
    }
    window.setTimeout(function () {
      dom.playAgainButton.focus({ preventScroll: true });
    }, 120);
    launchConfetti();
    playTone("win");
    if (state.soundOn) {
      window.setTimeout(function () {
        if (state.finished) {
          speak("정말 잘했어요. 네가 이겼어요!");
        }
      }, 480);
    }
  }

  function openHint() {
    if (!state.current || state.thinking || state.finished) {
      return;
    }
    const starts = currentStarts();
    const hints = core.getHints(book, core.lastSyllable(state.current.word), state.used, 3, Math.random);
    dom.hintList.replaceChildren();
    if (hints.length === 0) {
      dom.hintTitle.textContent = "이번 글자는 도감에 단어가 없어요";
      const item = document.createElement("li");
      item.className = "hint-empty";
      item.textContent = "지금 단어를 내면 탐험대장이 이어 갈 수 없어요. 어떤 단어든 좋으니 도전해 보세요!";
      dom.hintList.append(item);
    } else {
      dom.hintTitle.textContent = "이런 단어는 어때요?";
      hints.forEach(function (entry) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "hint-item";
        const objectParticle = core.splitSyllable(core.lastSyllable(entry.word)).final === 0 ? "를" : "을";
        button.setAttribute("aria-label", entry.word + objectParticle + " 입력창에 넣기");

        const wordRow = document.createElement("span");
        wordRow.className = "hint-word-row";
        const word = document.createElement("span");
        word.className = "hint-word";
        word.textContent = entry.word;
        const pos = document.createElement("span");
        pos.className = "hint-pos";
        pos.textContent = entry.pos;
        wordRow.append(word, pos);

        const meaning = document.createElement("span");
        meaning.className = "hint-meaning";
        meaning.textContent = entry.meaning;
        button.append(wordRow, meaning);
        button.addEventListener("click", function () {
          if (state.thinking || state.finished) {
            return;
          }
          dom.answerInput.value = entry.word;
          state.lastInputMethod = "text";
          closeHint();
          setFeedback("'" + entry.word + "'" + objectParticleFor(entry.word) + " 입력창에 넣었어요. '내기'를 눌러 주세요.", "info");
          dom.answerInput.focus({ preventScroll: true });
        });
        item.append(button);
        dom.hintList.append(item);
      });
    }
    dom.hintPanel.hidden = false;
    dom.hintButton.setAttribute("aria-expanded", "true");
    dom.hintButton.querySelector("span").textContent = "힌트 접기";
    if (starts.length > 1) {
      dom.hintTitle.textContent = "이런 단어는 어때요?";
    }
  }

  function toggleHint() {
    if (!dom.hintPanel.hidden) {
      closeHint();
      return;
    }
    openHint();
  }

  function renderDictionary(query) {
    const text = typeof query === "string" ? query.trim() : "";
    const results = text
      ? core.searchWordBook(book, text, 24)
      : core.getSuggestedEntries(book, 6, Math.random);
    dom.dictionaryResults.replaceChildren();

    const label = document.createElement("p");
    label.className = "results-label";
    label.textContent = text ? "'" + text + "' 검색 결과" : "오늘의 추천 단어";
    dom.dictionaryResults.append(label);

    if (results.length === 0) {
      const empty = document.createElement("div");
      empty.className = "dict-empty";
      empty.textContent = "찾는 단어가 없어요. 다른 말로 검색해 보세요.";
      dom.dictionaryResults.append(empty);
      return;
    }

    results.forEach(function (entry) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dict-item";
      button.setAttribute("aria-label", entry.word + ", " + entry.pos + ". " + entry.meaning + " 뜻 듣기");

      const wordRow = document.createElement("span");
      wordRow.className = "dict-word-row";
      const word = document.createElement("span");
      word.className = "dict-word";
      word.textContent = entry.word;
      const pos = document.createElement("span");
      pos.className = "dict-pos";
      pos.textContent = entry.pos;
      wordRow.append(word, pos);

      const meaning = document.createElement("span");
      meaning.className = "dict-meaning";
      meaning.textContent = entry.meaning;
      button.append(wordRow, meaning);
      button.addEventListener("click", function () {
        speakEntry(entry);
      });
      dom.dictionaryResults.append(button);
    });
  }

  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      dom.toast.classList.remove("is-visible");
    }, 2200);
  }

  function applySoundUi() {
    dom.soundButton.classList.toggle("is-muted", !state.soundOn);
    dom.soundButton.setAttribute("aria-pressed", String(state.soundOn));
    dom.soundButton.setAttribute("aria-label", state.soundOn ? "소리 끄기" : "소리 켜기");
    dom.soundButton.title = state.soundOn ? "소리 끄기" : "소리 켜기";
  }

  function setSound(on, notify) {
    state.soundOn = on;
    writeSound(on);
    applySoundUi();
    if (!on && typeof window.speechSynthesis !== "undefined") {
      window.speechSynthesis.cancel();
    }
    if (on) {
      playTone("turn");
    }
    if (notify) {
      showToast(on ? "소리를 켰어요." : "소리를 껐어요.");
    }
  }

  function getKoreanVoice() {
    if (typeof window.speechSynthesis === "undefined") {
      return null;
    }
    const voices = window.speechSynthesis.getVoices();
    return voices.find(function (voice) {
      return voice.lang === "ko-KR";
    }) || voices.find(function (voice) {
      return voice.lang && voice.lang.toLowerCase().indexOf("ko") === 0;
    }) || null;
  }

  function speak(text) {
    if (!state.soundOn || typeof window.speechSynthesis === "undefined" || typeof window.SpeechSynthesisUtterance === "undefined") {
      return false;
    }
    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = "ko-KR";
    utterance.rate = 0.92;
    utterance.pitch = 1.03;
    utterance.volume = 1;
    const voice = getKoreanVoice();
    if (voice) {
      utterance.voice = voice;
    }
    state.utterance = utterance;
    try {
      window.speechSynthesis.speak(utterance);
      return true;
    } catch (error) {
      return false;
    }
  }

  function speakEntry(entry) {
    if (!entry) {
      return;
    }
    if (!state.soundOn) {
      showToast("소리 버튼을 켜면 단어와 뜻을 읽어 줘요.");
      return;
    }
    speak(entry.word + ". " + entry.meaning);
  }

  function ensureAudio() {
    if (!state.soundOn) {
      return null;
    }
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        return null;
      }
      audioContext = new AudioContextClass();
    }
    if (audioContext.state === "suspended") {
      audioContext.resume().catch(function () {
        return;
      });
    }
    return audioContext;
  }

  function playTone(kind) {
    const context = ensureAudio();
    if (!context) {
      return;
    }
    const specs = {
      success: [[523.25, 0, 0.12], [659.25, 0.08, 0.16]],
      turn: [[392, 0, 0.08], [523.25, 0.07, 0.1]],
      error: [[196, 0, 0.14], [146.83, 0.09, 0.18]],
      win: [[523.25, 0, 0.14], [659.25, 0.1, 0.14], [783.99, 0.2, 0.16], [1046.5, 0.31, 0.32]]
    };
    const notes = specs[kind] || specs.turn;
    const now = context.currentTime;
    notes.forEach(function (note) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = kind === "error" ? "sine" : "triangle";
      oscillator.frequency.value = note[0];
      gain.gain.setValueAtTime(0, now + note[1]);
      gain.gain.linearRampToValueAtTime(kind === "error" ? 0.035 : 0.055, now + note[1] + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note[1] + note[2]);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now + note[1]);
      oscillator.stop(now + note[1] + note[2] + 0.03);
    });
  }

  function stopListeningUi() {
    state.listening = false;
    dom.micButton.classList.remove("is-listening");
    dom.micButton.setAttribute("aria-label", "마이크로 단어 말하기");
    dom.micButton.title = "마이크로 말해 보세요";
    dom.mascot.classList.remove("is-listening");
    updatePlaceholder();
  }

  function abortRecognition() {
    if (state.recognition && state.listening) {
      try {
        state.recognition.abort();
      } catch (error) {
        stopListeningUi();
        return;
      }
    }
    stopListeningUi();
  }

  function setupRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      state.recognitionSupported = false;
      dom.micButton.disabled = true;
      dom.micButton.title = "이 브라우저는 음성 입력을 지원하지 않아요";
      dom.micButton.setAttribute("aria-label", "이 브라우저는 음성 입력을 지원하지 않아요");
      return;
    }

    try {
      const recognition = new Recognition();
      recognition.lang = "ko-KR";
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = function () {
        state.listening = true;
        dom.micButton.classList.add("is-listening");
        dom.micButton.setAttribute("aria-label", "음성 입력 멈추기");
        dom.micButton.title = "음성 입력 멈추기";
        dom.mascot.classList.add("is-listening");
        dom.answerInput.placeholder = "듣고 있어요. 단어를 말해 보세요";
        setFeedback("듣고 있어요. 단어를 또렷하게 말해 보세요.", "info");
        if (state.soundOn && typeof window.speechSynthesis !== "undefined") {
          window.speechSynthesis.cancel();
        }
      };

      recognition.onresult = function (event) {
        const result = event.results[event.results.length - 1];
        const transcript = result && result[0] ? result[0].transcript.trim() : "";
        stopListeningUi();
        if (!transcript) {
          setFeedback("소리가 잘 들리지 않았어요. 다시 말해 볼까요?", "error");
          return;
        }
        state.lastInputMethod = "voice";
        dom.answerInput.value = transcript;
        setFeedback("'" + transcript + "'라고 들었어요.", "info");
        window.setTimeout(function () {
          if (!state.thinking && !state.finished) {
            if (typeof dom.answerForm.requestSubmit === "function") {
              dom.answerForm.requestSubmit();
            } else {
              dom.answerForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            }
          }
        }, 320);
      };

      recognition.onerror = function (event) {
        stopListeningUi();
        if (event.error === "aborted") {
          return;
        }
        const messages = {
          "not-allowed": "마이크 사용을 허락해 주세요. 주소창의 마이크 권한을 확인해 보세요.",
          "service-not-allowed": "마이크 사용을 허락해 주세요. 주소창의 마이크 권한을 확인해 보세요.",
          "no-speech": "소리가 잘 들리지 않았어요. 다시 말해 볼까요?",
          "audio-capture": "마이크를 찾지 못했어요. 마이크가 연결되어 있는지 확인해 주세요.",
          network: "음성 인식에는 인터넷이 필요해요. 직접 입력해도 좋아요."
        };
        setFeedback(messages[event.error] || "음성을 알아듣지 못했어요. 직접 입력해도 좋아요.", "error");
      };

      recognition.onend = function () {
        stopListeningUi();
      };

      state.recognition = recognition;
      state.recognitionSupported = true;
    } catch (error) {
      state.recognitionSupported = false;
      dom.micButton.disabled = true;
      dom.micButton.title = "이 브라우저는 음성 입력을 지원하지 않아요";
    }
  }

  function toggleListening() {
    if (!state.recognitionSupported || !state.recognition || state.thinking || state.finished) {
      return;
    }
    if (state.listening) {
      try {
        state.recognition.stop();
      } catch (error) {
        stopListeningUi();
      }
      return;
    }
    if (state.soundOn && typeof window.speechSynthesis !== "undefined") {
      window.speechSynthesis.cancel();
    }
    try {
      state.recognition.start();
    } catch (error) {
      setFeedback("지금은 마이크를 켤 수 없어요. 직접 입력해 주세요.", "error");
    }
  }

  function stopConfetti() {
    if (confettiFrame !== null) {
      window.cancelAnimationFrame(confettiFrame);
      confettiFrame = null;
    }
    const context = dom.confettiCanvas.getContext("2d");
    if (context) {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  function launchConfetti() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const canvas = dom.confettiCanvas;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const colors = ["#e9825d", "#f4c95d", "#2f8069", "#8bcbb1", "#d9edf5", "#f6b18d"];
    const count = Math.min(150, Math.max(60, Math.floor(window.innerWidth / 9)));
    const particles = [];
    for (let i = 0; i < count; i += 1) {
      particles.push({
        x: Math.random() * window.innerWidth,
        y: -20 - Math.random() * window.innerHeight * 0.4,
        vx: (Math.random() - 0.5) * 2.6,
        vy: 1.7 + Math.random() * 2.9,
        size: 4 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.18,
        round: Math.random() < 0.24
      });
    }

    const startedAt = window.performance.now();
    const duration = 3600;
    if (confettiFrame !== null) {
      window.cancelAnimationFrame(confettiFrame);
    }

    function frame(now) {
      const elapsed = now - startedAt;
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      particles.forEach(function (particle) {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += 0.022;
        particle.rotation += particle.spin;
        context.save();
        context.globalAlpha = Math.max(0, 1 - elapsed / duration);
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.fillStyle = particle.color;
        if (particle.round) {
          context.beginPath();
          context.arc(0, 0, particle.size * 0.42, 0, Math.PI * 2);
          context.fill();
        } else {
          context.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size * 0.55);
        }
        context.restore();
      });
      if (elapsed < duration) {
        confettiFrame = window.requestAnimationFrame(frame);
      } else {
        context.clearRect(0, 0, window.innerWidth, window.innerHeight);
        confettiFrame = null;
      }
    }

    confettiFrame = window.requestAnimationFrame(frame);
  }

  function bindDialogBackdrop(dialog) {
    dialog.addEventListener("click", function (event) {
      if (event.target !== dialog) {
        return;
      }
      const rect = dialog.getBoundingClientRect();
      const outside = event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom;
      if (outside) {
        dialog.close();
      }
    });
  }

  dom.answerForm.addEventListener("submit", handleSubmit);
  dom.answerInput.addEventListener("input", function () {
    state.lastInputMethod = "text";
    if (dom.feedback.classList.contains("is-error")) {
      setFeedback("", "");
    }
  });
  dom.speakButton.addEventListener("click", function () {
    speakEntry(state.current);
  });
  dom.hintButton.addEventListener("click", toggleHint);
  dom.restartButton.addEventListener("click", function () {
    startNewGame({ announce: true });
    showToast("새 탐험을 시작했어요.");
  });
  dom.soundButton.addEventListener("click", function () {
    setSound(!state.soundOn, true);
  });
  dom.rulesButton.addEventListener("click", function () {
    if (!dom.rulesDialog.open) {
      dom.rulesDialog.showModal();
    }
  });
  dom.micButton.addEventListener("click", toggleListening);
  dom.dictionaryInput.addEventListener("input", function () {
    renderDictionary(dom.dictionaryInput.value);
  });
  dom.playAgainButton.addEventListener("click", function () {
    if (dom.winDialog.open) {
      dom.winDialog.close();
    }
    startNewGame({ announce: true });
  });
  dom.winDialog.addEventListener("close", stopConfetti);

  document.querySelectorAll("[data-close-dialog]").forEach(function (button) {
    button.addEventListener("click", function () {
      const dialog = button.closest("dialog");
      if (dialog) {
        dialog.close();
      }
    });
  });

  bindDialogBackdrop(dom.rulesDialog);
  bindDialogBackdrop(dom.winDialog);

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !dom.hintPanel.hidden && !document.querySelector("dialog[open]")) {
      closeHint();
    }
  });

  dom.wordCount.textContent = book.size.toLocaleString("ko-KR") + "개";
  dom.footerWordCount.textContent = book.size.toLocaleString("ko-KR");
  dom.bestValue.textContent = String(state.best);
  dom.hintButton.setAttribute("aria-expanded", "false");
  applySoundUi();
  setupRecognition();
  renderDictionary("");
  updateScore(false);
  startNewGame({ announce: false });

  if (typeof window.speechSynthesis !== "undefined") {
    window.speechSynthesis.getVoices();
  }

  window.addEventListener("pagehide", function () {
    abortRecognition();
    if (typeof window.speechSynthesis !== "undefined") {
      window.speechSynthesis.cancel();
    }
  });
})();

