const dom = {
  screens: {
    welcome: document.getElementById('welcome'),
    instructions: document.getElementById('instructions'),
    stage: document.getElementById('stage'),
    summary: document.getElementById('summary'),
  },
  participantIdInput: document.getElementById('participantId'),
  startButton: document.getElementById('startButton'),
  instructionText: document.getElementById('instructionText'),
  instructionNext: document.getElementById('instructionNext'),
  stageContent: document.getElementById('stageContent'),
  summaryText: document.getElementById('summaryText'),
  downloadResultsButton: document.getElementById('downloadResultsButton'),
  downloadSummaryButton: document.getElementById('downloadSummaryButton'),
  log: document.getElementById('log'),
};

const TEXT = {
  initial: `短文意味判断課題\n\nこれから英語の短文を聞いて、\nその文が意味的に適切かどうかを判断していただきます。\n\nまず練習を行い、その後本番を行います。\n\n準備ができたらスペースキー、もしくは下のボタンを押してください。`,
  practice: `これから練習を行います。\n\n画面に「＋」が表示された後、英語の短文が流れます。\n\n文の内容が文脈上「適切」だと思ったら 'j' キーを、\n「不適切」だと思ったら 'f' キーを押してください。\n\n練習では正解・不正解のフィードバックが表示されます。\n\n準備ができたらスペースキー、もしくは下のボタンを押してください。`,
  main: `本試行を開始します。\n\nこれから合計160個の短文を英語で聞いてもらいます。\n各文の内容が文脈上、適切か不適切かを判断してください。\n\n文が流れた後に「回答してください」と表示されたら\nできるだけ速く正確に回答してください。\n\n不適切 = 'f'    適切 = 'j'\n\n本試行では正解・不正解のフィードバックはありません。\n80問終了後に休憩があります。\n\n準備ができたらスペースキー、もしくは下のボタンを押してください。`,
};

const state = {
  participantId: '',
  practiceStimuli: [],
  trialStimuli: [],
  results: [],
  sdtSummary: null,
  awaitingAdvance: null,
  awaitingResponse: null,
  responseStart: 0,
  abortSignal: false,
  audioCache: new Map(),
  logMessages: [],
};

const CSV_HEADERS = [
  'participant_id',
  'trial',
  'stimulus',
  'target_word',
  'correct_answer',
  'response',
  'correct',
  'rt_ms',
  'sdt_category',
  'is_practice',
  'timestamp',
  'word_number',
];

function setActiveScreen(id) {
  Object.values(dom.screens).forEach((section) => section.classList.remove('active'));
  const target = dom.screens[id];
  if (target) {
    target.classList.add('active');
  }
}

function toggleInstructionButton(show, label = '進む', disabled = false) {
  if (!show) {
    dom.instructionNext.style.display = 'none';
  } else {
    dom.instructionNext.style.display = 'inline-flex';
    dom.instructionNext.textContent = label;
    dom.instructionNext.disabled = disabled;
  }
}

function log(message) {
  const timestamp = new Date().toLocaleTimeString('ja-JP', { hour12: false });
  const line = `[${timestamp}] ${message}`;
  state.logMessages.push(line);
  dom.log.textContent = state.logMessages.join('\n');
  dom.log.hidden = false;
  dom.log.scrollTop = dom.log.scrollHeight;
}

function waitForAdvance(button = null) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      state.awaitingAdvance = null;
      if (button) button.removeEventListener('click', handleClick);
      resolve();
    };
    const handleClick = () => finish();
    state.awaitingAdvance = () => finish();
    if (button) button.addEventListener('click', handleClick);
  });
}

function waitForInstructionAdvance() {
  toggleInstructionButton(true, '進む');
  return waitForAdvance(dom.instructionNext);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderStage(content, { small = false } = {}) {
  dom.stageContent.classList.toggle('small', small);
  dom.stageContent.textContent = content;
}

function clearStage() {
  dom.stageContent.textContent = '';
}

function setInstructionText(text) {
  dom.instructionText.textContent = text;
}

async function beginPreparation() {
  state.participantId = dom.participantIdInput.value.trim();
  if (!state.participantId) return;

  setActiveScreen('instructions');
  toggleInstructionButton(false);
  setInstructionText('刺激リストを読み込んでいます…');

  try {
    const stimuli = await loadStimuli();
    state.practiceStimuli = stimuli.filter((item) => item.isPractice);
    state.trialStimuli = shuffle(
      stimuli.filter((item) => item.isTrial)
    );
    log(`練習刺激: ${state.practiceStimuli.length} 件, 本試行刺激: ${state.trialStimuli.length} 件`);
  } catch (error) {
    handleFatalError('刺激リストの読み込みに失敗しました。CSVの文字コードと形式をご確認ください。', error);
    return;
  }

  try {
    setInstructionText('音声ファイルを準備しています…');
    await preloadAudioFiles([...state.practiceStimuli, ...state.trialStimuli], (loaded, total, filename) => {
      setInstructionText(`音声ファイルを準備しています… (${loaded}/${total})\n${filename}`);
    });
    log('音声ファイルの事前読み込みが完了しました。');
  } catch (error) {
    handleFatalError('音声ファイルの読み込みに失敗しました。配置やファイル名をご確認ください。', error);
    return;
  }

  await showInstructionSequence();
  await runExperiment();
}

async function showInstructionSequence() {
  await showInstruction(TEXT.initial);

  if (state.practiceStimuli.length) {
    await showInstruction(TEXT.practice);
  }
}

async function showInstruction(text) {
  clearStage();
  setActiveScreen('instructions');
  setInstructionText(text);
  await waitForInstructionAdvance();
}

async function runExperiment() {
  setActiveScreen('stage');
  clearStage();

  if (state.practiceStimuli.length) {
    renderStage('練習試行', { small: false });
    await delay(2000);

    for (let i = 0; i < state.practiceStimuli.length; i += 1) {
      const stimulus = state.practiceStimuli[i];
      const result = await runTrial(stimulus, i + 1, { isPractice: true });
      if (!result) {
        handleFatalError('実験が中断されました。', new Error('Practice aborted'));
        return;
      }
      state.results.push(result);
    }
  }

  await showInstruction(TEXT.main);

  setActiveScreen('stage');
  clearStage();
  renderStage('Ready', { small: false });
  await delay(1000);

  renderStage('本試行開始', { small: false });
  await delay(2000);

  const practiceCount = state.practiceStimuli.length;

  for (let i = 0; i < state.trialStimuli.length; i += 1) {
    const stimulus = state.trialStimuli[i];
    const result = await runTrial(stimulus, practiceCount + i + 1, { isPractice: false, trialIndex: i + 1 });
    if (!result) {
      handleFatalError('実験が中断されました。', new Error('Main trial aborted'));
      return;
    }
    state.results.push(result);

    if (i + 1 === 80 && i + 1 < state.trialStimuli.length) {
      await showBreak(i + 1, state.trialStimuli.length);
    }
  }

  await concludeExperiment();
}

async function runTrial(stimulus, absoluteTrialNumber, { isPractice, trialIndex = null }) {
  state.abortSignal = false;

  renderStage('+', { small: false });
  await delay(500);

  const success = await playStimulusAudio(stimulus);
  if (!success) {
    log(`音声再生に失敗: ${stimulus.filename}`);
  }

  renderStage("回答してください\n\n不適切 = 'f'    適切 = 'j'", { small: true });

  const { response, rt } = await waitForResponse();

  const correct = response === stimulus.answer;
  const sdtCategory = calculateSdtCategory(stimulus.answer, response);

  if (isPractice) {
    await showFeedback(correct);
  }

  return {
    participant_id: state.participantId,
    trial: absoluteTrialNumber,
    stimulus: stimulus.filename,
    target_word: stimulus.targetWord,
    correct_answer: stimulus.answer,
    response,
    correct,
    rt_ms: Math.round(rt),
    sdt_category: sdtCategory,
    is_practice: isPractice,
    timestamp: new Date().toISOString(),
    word_number: stimulus.wordNumber,
  };
}

async function waitForResponse() {
  return new Promise((resolve) => {
    state.responseStart = performance.now();
    state.awaitingResponse = (key) => {
      const rt = performance.now() - state.responseStart;
      const response = key === 'f' ? '不適切' : '適切';
      state.awaitingResponse = null;
      resolve({ response, rt });
    };
  });
}

async function showFeedback(correct) {
  renderStage(correct ? '正解！' : '不正解', { small: false });
  dom.stageContent.classList.toggle('feedback', true);
  dom.stageContent.classList.toggle('correct', correct);
  dom.stageContent.classList.toggle('incorrect', !correct);
  await delay(1000);
  dom.stageContent.classList.remove('feedback', 'correct', 'incorrect');
}

async function showBreak(completed, total) {
  renderStage(`休憩時間です\n\n完了: ${completed} / ${total}\n\n準備ができたらスペースキーを押してください`, { small: true });
  await waitForAdvance();
}

async function concludeExperiment() {
  renderStage('実験終了\n\nご協力ありがとうございました\n\nデータを整理しています…', { small: true });
  await delay(1500);
  computeSummary();
  await showSummary();
}

function releaseAudioResources() {
  for (const url of state.audioCache.values()) {
    URL.revokeObjectURL(url);
  }
  state.audioCache.clear();
}

async function showSummary() {
  setActiveScreen('summary');
  releaseAudioResources();
  const trialResults = state.results.filter((row) => !row.is_practice);
  const accuracy = trialResults.length
    ? trialResults.filter((row) => row.correct).length / trialResults.length
    : 0;
  const meanRt = trialResults.length
    ? Math.round(trialResults.reduce((sum, row) => sum + row.rt_ms, 0) / trialResults.length)
    : 0;

  dom.summaryText.textContent = [
    `参加者ID: ${state.participantId}`,
    `総試行数: ${trialResults.length}`,
    `正答率: ${(accuracy * 100).toFixed(2)}%`,
    `平均反応時間: ${meanRt} ms`,
    state.sdtSummary
      ? `d': ${state.sdtSummary.d_prime.toFixed(3)}, c: ${state.sdtSummary.criterion_c.toFixed(3)}`
      : 'SDT指標: 計算対象の試行が不足しています',
  ].join('\n');

  dom.downloadResultsButton.addEventListener('click', handleDownloadResults);
  dom.downloadSummaryButton.addEventListener('click', handleDownloadSummary);
}

function computeSummary() {
  const trialRows = state.results.filter((row) => !row.is_practice);
  if (!trialRows.length) {
    state.sdtSummary = null;
    return;
  }

  const counts = trialRows.reduce((acc, row) => {
    acc[row.sdt_category] = (acc[row.sdt_category] || 0) + 1;
    return acc;
  }, {});

  const hits = counts.Hit || 0;
  const misses = counts.Miss || 0;
  const fas = counts.FA || 0;
  const crs = counts.CR || 0;

  const hitRate = (hits + 0.5) / (hits + misses + 1);
  const faRate = (fas + 0.5) / (fas + crs + 1);

  const zHit = inverseNormalCdf(hitRate);
  const zFa = inverseNormalCdf(faRate);

  const dPrime = zHit - zFa;
  const c = -0.5 * (zHit + zFa);

  const meanRt = trialRows.reduce((sum, row) => sum + row.rt_ms, 0) / trialRows.length;
  const variance = trialRows.reduce((sum, row) => sum + (row.rt_ms - meanRt) ** 2, 0) / trialRows.length;
  const stdRt = Math.sqrt(variance);

  state.sdtSummary = {
    participant_id: state.participantId,
    date: new Date().toISOString(),
    task_type: 'LJT',
    total_trials: trialRows.length,
    practice_trials: state.results.filter((row) => row.is_practice).length,
    hit_count: hits,
    miss_count: misses,
    false_alarm_count: fas,
    correct_rejection_count: crs,
    hit_rate: hitRate,
    false_alarm_rate: faRate,
    d_prime: dPrime,
    criterion_c: c,
    overall_accuracy: trialRows.filter((row) => row.correct).length / trialRows.length,
    mean_rt: meanRt,
    std_rt: stdRt,
    experiment_completed: trialRows.length === state.trialStimuli.length,
  };
}

function handleDownloadResults() {
  const rows = state.results.map((row) => ({
    ...row,
    correct: row.correct ? 1 : 0,
    is_practice: row.is_practice ? 'True' : 'False',
  }));
  const csv = buildCsv(CSV_HEADERS, rows);
  triggerDownload(`${state.participantId}_ljt_results.csv`, csv);
}

function handleDownloadSummary() {
  if (!state.sdtSummary) {
    alert('SDTサマリーを作成するには本試行のデータが必要です。');
    return;
  }
  const summaryRow = {
    ...state.sdtSummary,
    experiment_completed: state.sdtSummary.experiment_completed ? 'True' : 'False',
  };
  const headers = Object.keys(summaryRow);
  const csv = buildCsv(headers, [summaryRow]);
  triggerDownload(`${state.participantId}_ljt_sdt_summary.csv`, csv);
}

function buildCsv(headers, rows) {
  const lines = [];
  lines.push(headers.join(','));
  for (const row of rows) {
    const values = headers.map((header) => formatCsvValue(row[header]));
    lines.push(values.join(','));
  }
  const content = lines.join('\r\n');
  const bom = '\ufeff';
  return `${bom}${content}`;
}

function formatCsvValue(value) {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function triggerDownload(filename, csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function calculateSdtCategory(stimulusType, responseType) {
  if (stimulusType === '適切' && responseType === '適切') return 'Hit';
  if (stimulusType === '適切' && responseType === '不適切') return 'Miss';
  if (stimulusType === '不適切' && responseType === '適切') return 'FA';
  if (stimulusType === '不適切' && responseType === '不適切') return 'CR';
  return 'Unknown';
}

async function loadStimuli() {
  const response = await fetch('LJT stimuli list.csv');
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  let decoded;
  try {
    decoded = new TextDecoder('shift_jis').decode(buffer);
  } catch (error) {
    decoded = new TextDecoder('utf-8').decode(buffer);
  }

  const rows = parseCsv(decoded);
  const [header, ...dataRows] = rows;

  if (!header || header.length < 3) {
    throw new Error('CSVヘッダーが見つかりません。');
  }

  const stimuli = [];

  for (const row of dataRows) {
    if (!row.length) continue;
    const display = row[0]?.trim();
    const answer = row[1]?.trim();
    const filename = row[2]?.trim();
    const wordNumber = row[5]?.trim() || '';
    const targetWord = row[6]?.trim() || '';

    if (!display || display === 'Ready' || display === 'Instruction') continue;
    if (!filename) continue;

    stimuli.push({
      display,
      answer,
      filename,
      wordNumber,
      targetWord,
      isPractice: display.startsWith('Practice'),
      isTrial: display === 'Trial',
      audioPath: display.startsWith('Practice')
        ? `LJT practice stimuli/${filename}`
        : `LJT stimuli/${filename}`,
    });
  }

  return stimuli;
}

function parseCsv(text) {
  const rows = [];
  let current = [];
  let currentValue = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (insideQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          currentValue += '"';
          i += 1;
        } else {
          insideQuotes = false;
        }
      } else {
        currentValue += char;
      }
    } else if (char === '"') {
      insideQuotes = true;
    } else if (char === ',') {
      current.push(currentValue);
      currentValue = '';
    } else if (char === '\r') {
      continue;
    } else if (char === '\n') {
      current.push(currentValue);
      rows.push(current);
      current = [];
      currentValue = '';
    } else {
      currentValue += char;
    }
  }

  if (current.length || currentValue) {
    current.push(currentValue);
    rows.push(current);
  }

  return rows;
}

async function preloadAudioFiles(stimuli, onProgress) {
  const unique = new Map();
  for (const item of stimuli) {
    if (!item.filename || unique.has(item.filename)) continue;
    unique.set(item.filename, item.audioPath);
  }

  const entries = Array.from(unique.entries());
  let loaded = 0;

  for (const [filename, path] of entries) {
    const audioUrl = await fetchAudioAsObjectUrl(path);
    state.audioCache.set(filename, audioUrl);
    loaded += 1;
    if (typeof onProgress === 'function') {
      onProgress(loaded, entries.length, filename);
    }
  }
}

async function fetchAudioAsObjectUrl(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`音声ファイルの取得に失敗: ${path}`);
  }
  const buffer = await response.arrayBuffer();
  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

async function playStimulusAudio(stimulus) {
  const url = state.audioCache.get(stimulus.filename);
  if (!url) return false;

  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.addEventListener('ended', () => {
      resolve(true);
    }, { once: true });
    audio.addEventListener('error', () => {
      resolve(false);
    }, { once: true });
    audio.play().catch(() => resolve(false));
  });
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function inverseNormalCdf(p) {
  if (p <= 0 || p >= 1) {
    throw new Error('p must be in (0, 1)');
  }

  const a = [
    -39.69683028665376,
    220.9460984245205,
    -275.9285104469687,
    138.357751867269,
    -30.66479806614716,
    2.506628277459239,
  ];

  const b = [
    -54.47609879822406,
    161.5858368580409,
    -155.6989798598866,
    66.80131188771972,
    -13.28068155288572,
  ];

  const c = [
    -0.007784894002430293,
    -0.3223964580411365,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783,
  ];

  const d = [
    0.007784695709041462,
    0.3224671290700398,
    2.445134137142996,
    3.754408661907416,
  ];

  let q;

  if (p < 0.02425) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  if (p > 1 - 0.02425) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  q = p - 0.5;
  const r = q * q;

  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function handleFatalError(message, error) {
  console.error(message, error);
  log(`ERROR: ${message}`);
  setActiveScreen('instructions');
  setInstructionText(`${message}\n\n${error.message}`);
  toggleInstructionButton(true, '最初に戻る', false);
  waitForInstructionAdvance().then(() => {
    window.location.reload();
  });
}

function handleKeydown(event) {
  if (state.awaitingResponse) {
    const key = event.key.toLowerCase();
    if (key === 'f' || key === 'j') {
      event.preventDefault();
      const handler = state.awaitingResponse;
      state.awaitingResponse = null;
      handler(key);
    }
    return;
  }

  if (state.awaitingAdvance && (event.code === 'Space' || event.code === 'Enter')) {
    event.preventDefault();
    const handler = state.awaitingAdvance;
    state.awaitingAdvance = null;
    handler();
  }
}

function init() {
  dom.participantIdInput.addEventListener('input', () => {
    dom.startButton.disabled = dom.participantIdInput.value.trim().length === 0;
  });

  dom.startButton.addEventListener('click', () => {
    beginPreparation();
  });

  window.addEventListener('keydown', handleKeydown);
}

init();
