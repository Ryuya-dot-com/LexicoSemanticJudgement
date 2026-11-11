(() => {
  'use strict';
  const config = window.LJT_PUBLIC;
  const app = document.getElementById('app');
  const audio = new Audio();
  audio.preload = 'auto';
  let phase = 'welcome';
  let index = 0;
  let ordered = [];
  let rows = [];
  let accepting = false;
  let busy = false;
  let active = false;
  let cancelAudio = () => {};
  let nextTimer;
  const $ = id => document.getElementById(id);
  const label = answer => answer === 'appropriate' ? '適切' : '不適切';

  function screen(markup) {
    app.dataset.screen = phase;
    app.innerHTML = markup;
    app.querySelector('h1, h2')?.focus({ preventScroll: true });
  }

  function play(path, done, failed) {
    cancelAudio();
    let settled = false;
    let watchdog;
    const cleanup = () => {
      clearTimeout(watchdog);
      audio.removeEventListener('ended', ended);
      audio.removeEventListener('error', error);
      audio.removeEventListener('timeupdate', progress);
    };
    const finish = callback => {
      if (settled) return;
      settled = true;
      cleanup();
      audio.pause();
      callback();
    };
    const ended = () => finish(done);
    const error = () => finish(failed);
    const progress = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(error, 15000);
    };
    cancelAudio = () => finish(() => {});
    audio.addEventListener('ended', ended);
    audio.addEventListener('error', error);
    audio.addEventListener('timeupdate', progress);
    audio.src = path;
    progress();
    try { audio.play().catch(error); } catch { error(); }
  }

  function welcome() {
    phase = 'welcome';
    active = false;
    screen(`<h1 tabindex="-1">Lexicosemantic Judgement Test (LJT)</h1>
      <p>${config.long ? 'Long' : 'Short'}版 · 練習4問＋本番${config.items.length}問 · 時間制限なし</p>
      <p>英文を聞き、言葉の使い方が適切か不適切かを選んでください。音声が終わってから、ボタンまたは F / J キーで回答できます。</p>
      <p class="example">適切な例：I drink tea every morning.<br>不適切な例：I wear tea every morning.</p>
      <p>イヤホン・ヘッドホンの使用をおすすめします。${config.long ? '80問目の後に休憩があります。' : ''}</p>
      <button class="primary" id="start">始める</button>
      <p class="small">名前・登録は不要です。回答と結果は送信・保存されません。ページを閉じたり再読み込みすると消えます。</p>`);
    $('start').onclick = soundCheck;
  }

  function soundCheck() {
    phase = 'sound';
    screen(`<h2 tabindex="-1">音声の確認</h2>
      <p>音量を調整して、英文が聞こえることを確認してください。</p>
      <p id="status" role="status">「音声を再生」を押してください。</p>
      <button class="secondary" id="check">音声を再生</button>
      <button class="primary" id="practice" disabled>練習へ進む</button>
      <p class="small">練習4問では、回答後に正解が表示されます。</p>`);
    $('check').onclick = () => {
      busy = true;
      $('check').disabled = true;
      $('practice').disabled = true;
      $('status').textContent = '再生しています…';
      play(config.practice[0].audio_path, () => {
        busy = false;
        $('status').textContent = '聞こえたら、練習へ進んでください。';
        $('check').disabled = false;
        $('check').textContent = 'もう一度聞く';
        $('practice').disabled = false;
      }, () => {
        busy = false;
        $('status').textContent = '再生できませんでした。音量・通信環境を確認して、もう一度お試しください。';
        $('check').disabled = false;
      });
    };
    $('practice').onclick = () => {
      active = true;
      phase = 'practice';
      index = 0;
      trial();
    };
  }

  function currentItem() { return (phase === 'practice' ? config.practice : ordered)[index]; }

  function trial() {
    accepting = false;
    busy = false;
    const total = phase === 'practice' ? config.practice.length : ordered.length;
    screen(`<p class="trial-progress">${phase === 'practice' ? '練習' : '本番'} ${index + 1} / ${total}</p>
      <h2 tabindex="-1" class="sr-only">回答</h2>
      <p id="status" role="status">音声を聞いてください。</p>
      <div class="answers"><button id="no" class="answer" disabled>不適切 <kbd>F</kbd></button><button id="yes" class="answer" disabled>適切 <kbd>J</kbd></button></div>
      <div id="recovery" hidden><button class="primary" id="retry">音声をもう一度再生</button><button class="text-button" id="stop">ここで終了する</button></div>
      <div id="feedback" role="status"></div><button class="primary" id="next" hidden>次へ</button>`);
    $('no').onclick = () => respond('inappropriate');
    $('yes').onclick = () => respond('appropriate');
    $('retry').onclick = listen;
    $('stop').onclick = () => {
      if (window.confirm('ここまでで終了しますか？ 未完了の場合、CEFRの参考目安は表示されません。')) result();
    };
    listen();
  }

  function listen() {
    if (busy || accepting) return;
    if (document.hidden) { audioFailure(); return; }
    busy = true;
    $('recovery').hidden = true;
    $('status').textContent = '音声を聞いてください。';
    play(currentItem().audio_path, () => {
      busy = false;
      accepting = true;
      $('status').textContent = '回答してください。';
      $('yes').disabled = false;
      $('no').disabled = false;
    }, audioFailure);
  }

  function audioFailure() {
    busy = false;
    accepting = false;
    $('status').textContent = '再生が中断されたか、音声を読み込めませんでした。通信環境を確認して再生してください。';
    $('recovery').hidden = false;
  }

  function respond(answer) {
    if (!accepting) return;
    accepting = false;
    $('yes').disabled = true;
    $('no').disabled = true;
    const item = currentItem();
    const correct = answer === item.correct_answer;
    if (phase === 'practice') {
      $('feedback').textContent = correct ? '正解です。' : `正解は「${label(item.correct_answer)}」です。`;
      $('next').hidden = false;
      $('next').onclick = advance;
      $('next').focus();
    } else {
      rows.push({ correct, reference: item.reference });
      $('status').textContent = '回答しました。';
      nextTimer = setTimeout(advance, 250);
    }
  }

  function advance() {
    if (phase !== 'practice' && phase !== 'main') return;
    index += 1;
    if (phase === 'practice' && index === config.practice.length) {
      phase = 'ready';
      screen(`<h2 tabindex="-1">本番</h2><p>全部で${config.items.length}問です。正解は表示されません。</p><button class="primary" id="main">本番を始める</button>`);
      $('main').onclick = () => {
        ordered = config.order(config.items);
        phase = 'main';
        index = 0;
        trial();
      };
    } else if (phase === 'main' && index === ordered.length) {
      result();
    } else if (phase === 'main' && index === 80 && ordered.length > 80) {
      phase = 'break';
      screen(`<h2 tabindex="-1">休憩</h2><p>80 / ${ordered.length}問が終わりました。準備ができたら続けてください。</p><button class="primary" id="resume">続ける</button><p class="small">このページは閉じずにお待ちください。</p>`);
      $('resume').onclick = () => { phase = 'main'; trial(); };
    } else { trial(); }
  }

  function result() {
    clearTimeout(nextTimer);
    cancelAudio();
    phase = 'result';
    active = false;
    busy = false;
    accepting = false;
    const score = window.LJT_PUBLIC_SCORE(rows, config.items.length);
    const estimate = score.complete ? window.LJT_SHORT_CONVERSION.estimateToeicListening({ rawScore: score.referenceCorrect, nItems: score.referenceCount }) : { available: false };
    const cefr = estimate.available ? estimate.cefr.split('_')[0] : '—';
    const band = estimate.available && estimate.cefr.includes('_') ? (estimate.cefr.endsWith('lower') ? '下位帯' : '上位帯') : '';
    screen(`<h2 tabindex="-1">${score.complete ? '結果' : '途中の結果'}</h2>
      <dl class="results"><div><dt>得点</dt><dd id="score">${score.correct} / ${score.complete ? config.items.length : rows.length}</dd></div>
      <div><dt>正答率</dt><dd>${rows.length ? Math.round(score.correct / rows.length * 100) : 0}%${score.complete ? '' : `（全${config.items.length}問中${rows.length}問回答）`}</dd></div>
      <div><dt>CEFR 参考目安</dt><dd><span id="cefr">${cefr}</span>${band ? `（${band}）` : ''}${estimate.available ? '' : '（未完了のため換算なし）'}</dd></div></dl>
      ${config.long && estimate.available ? `<p class="basis">Short版と共通する40問：<strong>${score.referenceCorrect} / 40点</strong><br>CEFRは、この40問の得点をShort版の換算表に当てはめた参考値です。160問全体の得点からの換算ではありません。</p>` : ''}
      <p class="small">CEFRは言語の熟達度を表す国際的な尺度です。この表示はLJT-Sの既存換算表による参考目安で、公式のCEFR判定や英語4技能全体の評価ではありません。${config.long ? 'Long版は出題順・疲労の条件が異なり、Short版を単独で受けた場合との同等性は未確認です。' : ''}</p>
      <button class="secondary" id="restart">最初に戻る</button><p class="small">結果は保存・送信されません。このページを閉じると消えます。</p>
      <section class="references" aria-labelledby="references-title"><h3 id="references-title">LJTの原典論文</h3>
        <p>Uchihara, T., Saito, K., Kurokawa, S., Takizawa, K., &amp; Suzukida, Y. (2025).
        <a href="https://doi.org/10.1111/lang.12668" target="_blank" rel="noopener noreferrer">Declarative and automatized phonological vocabulary knowledge: Recognition, recall, lexicosemantic judgment, and listening-focused employability of second language words.</a>
        <i>Language Learning, 75</i>(2), 458–492.</p>
        <p>Saito, K., Uchihara, T., Takizawa, K., &amp; Suzukida, Y. (2025).
        <a href="https://doi.org/10.1017/S027226312300044X" target="_blank" rel="noopener noreferrer">Individual differences in L2 listening proficiency revisited: Roles of form, meaning, and use aspects of phonological vocabulary knowledge.</a>
        <i>Studies in Second Language Acquisition, 47</i>(1), 26–52.</p>
        <p class="small">上記はLJTの開発・検証に関する論文です。このWeb版のCEFR換算を直接検証したものではありません。</p>
      </section><footer class="credit">Web版作成：小室竜也 (Ryuya Komuro)｜東北大学 PD</footer>`);
    $('restart').onclick = () => { rows = []; ordered = []; index = 0; welcome(); };
  }

  document.addEventListener('keydown', event => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (accepting && (key === 'f' || key === 'j')) {
      event.preventDefault();
      respond(key === 'f' ? 'inappropriate' : 'appropriate');
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && busy) {
      cancelAudio();
      busy = false;
      if (phase === 'main' || phase === 'practice') audioFailure();
      else if (phase === 'sound') soundCheck();
    }
  });
  window.addEventListener('beforeunload', event => {
    if (active) { event.preventDefault(); event.returnValue = ''; }
  });
  welcome();
})();
