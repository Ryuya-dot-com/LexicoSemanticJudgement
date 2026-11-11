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
    screen(`<p class="eyebrow">LISTEN · THINK · CHOOSE</p>
      <h1 tabindex="-1">英語の意味、<br>どこまで聞き取れる？</h1>
      <p class="lead">短い英文を聞いて、言葉の使い方が自然かどうかを選ぶテストです。</p>
      <div class="facts"><span>本番 <strong>${config.items.length}問</strong></span><span>練習 <strong>4問</strong></span><span>時間制限なし</span></div>
      <div class="guide"><h2>聞く。判断する。それだけ。</h2>
        <p>文の中で、言葉が意味に合って使われていれば「適切」、合わなければ「不適切」を選びます。</p>
        <p class="example"><b>適切な例</b> “I drink tea every morning.”<br><b>不適切な例</b> “I wear tea every morning.”</p>
        <p>音声を最後まで聞いてから回答してください。静かな場所で、イヤホンやヘッドホンの使用をおすすめします。${config.items.length > 40 ? '80問目の後に休憩できます。' : ''}</p>
      </div>
      <button class="primary" id="start">音声を確認して始める <span aria-hidden="true">→</span></button>
      <p class="small">名前・登録は不要です。回答と結果は外部へ送信せず、この画面でのみ扱います。ページを閉じたり再読み込みすると消えます。</p>
      ${config.long ? '<p class="small">CEFRの参考目安は、Short版と共通する40問の得点から表示します。</p>' : ''}`);
    $('start').onclick = soundCheck;
  }

  function soundCheck() {
    phase = 'sound';
    screen(`<p class="eyebrow">GET READY</p><h2 tabindex="-1">音は聞こえますか？</h2>
      <p class="lead">音量を調整して、英文がはっきり聞こえることを確認してください。</p>
      <div class="listening" aria-hidden="true">♪</div>
      <p id="status" role="status">「音声を再生」を押してください。</p>
      <button class="secondary" id="check">音声を再生</button>
      <button class="primary" id="practice" disabled>聞こえたので、練習へ →</button>
      <p class="small">練習は4問です。練習中は、回答の後に正解が表示されます。</p>`);
    $('check').onclick = () => {
      busy = true;
      $('check').disabled = true;
      $('practice').disabled = true;
      $('status').textContent = '再生しています…';
      play(config.practice[0].audio_path, () => {
        busy = false;
        $('status').textContent = 'はっきり聞こえたら、練習へ進んでください。';
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
    screen(`<div class="progress-label"><span>${phase === 'practice' ? '練習' : '本番'}</span><span>${index + 1} / ${total}</span></div>
      <progress value="${index}" max="${total}" aria-label="${phase === 'practice' ? '練習' : '本番'}の進み具合"></progress>
      <div class="trial-content"><div class="listening" aria-hidden="true">♪</div>
      <h2 tabindex="-1" id="prompt">英文を聞いてください</h2>
      <p id="status" role="status">再生しています…</p></div>
      <div class="answers"><button id="no" class="answer" disabled>不適切 <kbd>F</kbd></button><button id="yes" class="answer" disabled>適切 <kbd>J</kbd></button></div>
      <div id="recovery" hidden><button class="primary" id="retry">音声をもう一度再生</button><button class="text-button" id="stop">ここで終了する</button></div>
      <div id="feedback" role="status"></div><button class="primary" id="next" hidden>次へ →</button>
      <p class="small">音声が終わったら、ボタンか F / J キーで回答してください。</p>`);
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
    $('prompt').textContent = '英文を聞いてください';
    $('status').textContent = '再生しています…';
    play(currentItem().audio_path, () => {
      busy = false;
      accepting = true;
      $('prompt').textContent = '言葉の使い方は自然ですか？';
      $('status').textContent = '「適切」か「不適切」を選んでください。';
      $('yes').disabled = false;
      $('no').disabled = false;
    }, audioFailure);
  }

  function audioFailure() {
    busy = false;
    accepting = false;
    $('prompt').textContent = '音声をもう一度聞いてください';
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
      screen(`<p class="eyebrow">READY</p><h2 tabindex="-1">次は、本番です。</h2><p class="lead">全部で${config.items.length}問です。練習と同じように回答してください。本番では、正解は表示されません。</p><button class="primary" id="main">本番を始める →</button>`);
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
      screen(`<p class="eyebrow">TAKE A BREAK</p><h2 tabindex="-1">ここで、ひと休み。</h2><p class="lead">80 / ${ordered.length}問が終わりました。準備ができたら続けてください。</p><button class="primary" id="resume">続ける →</button><p class="small">このページは閉じずにお待ちください。</p>`);
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
    screen(`<p class="eyebrow">YOUR RESULT</p><h2 tabindex="-1">${score.complete ? 'おつかれさまでした。' : 'ここまでの結果です。'}</h2>
      <div class="result-grid"><div class="score-card"><p>${score.complete ? 'あなたの得点' : '回答済みの得点'}</p><div class="score" id="score">${score.correct}<span> / ${score.complete ? config.items.length : rows.length}</span></div><p>正答率 ${rows.length ? Math.round(score.correct / rows.length * 100) : 0}%${score.complete ? '' : `・全${config.items.length}問中${rows.length}問回答`}</p></div>
      <div class="score-card cefr"><p>CEFR 参考目安</p><div class="score" id="cefr">${cefr}</div><p>${band || (estimate.available ? '既存の換算表に基づく目安' : '未完了のため換算なし')}</p></div></div>
      ${config.long && estimate.available ? `<p class="basis">Short版と共通する40問：<strong>${score.referenceCorrect} / 40点</strong><br>CEFRは、この40問の得点をShort版の換算表に当てはめた参考値です。160問全体の得点からの換算ではありません。</p>` : ''}
      <p class="small">CEFRは言語の熟達度を表す国際的な尺度です。この表示はLJT-Sの既存換算表による参考目安で、公式のCEFR判定や英語4技能全体の評価ではありません。${config.long ? 'Long版は出題順・疲労の条件が異なり、Short版を単独で受けた場合との同等性は未確認です。' : ''}</p>
      <button class="secondary" id="restart">最初の画面に戻る</button><p class="small">結果は保存・送信されません。このページを閉じると消えます。</p>`);
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
