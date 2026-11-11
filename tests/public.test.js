const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({ window: {} });
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
for (const match of html.matchAll(/<script src="([^"?]+)/g)) {
  if (match[1] === 'app.js') continue;
  vm.runInContext(fs.readFileSync(path.resolve(root, 'public', match[1]), 'utf8'), context);
}
const config = context.window.LJT_PUBLIC;
const summarize = context.window.LJT_PUBLIC_SCORE;
const conversion = context.window.LJT_SHORT_CONVERSION;

test('the form and reference subset are complete, balanced, and backed by audio files', () => {
  assert.equal(config.items.length, config.long ? 160 : 40);
  assert.equal(config.practice.length, 4);
  assert.equal(config.items.filter(x => x.reference).length, 40);
  assert.equal(config.items.filter(x => x.reference && x.correct_answer === 'appropriate').length, 20);
  assert.equal(new Set(config.items.map(x => x.audio_path)).size, config.items.length);
  for (const item of [...config.items, ...config.practice]) {
    assert.ok(['appropriate', 'inappropriate'].includes(item.correct_answer));
    assert.ok(fs.statSync(path.resolve(root, 'public', item.audio_path)).size > 0);
  }
});

test('ordering keeps every item once; short-form constraints are preserved', () => {
  for (let sample = 0; sample < 10; sample++) {
    const ordered = config.order(config.items);
    assert.equal(ordered.length, config.items.length);
    assert.equal(new Set(ordered.map(x => x.audio_path)).size, config.items.length);
    if (!config.long) {
      let run = 0, last = null;
      for (const item of ordered) {
        run = last === item.correct_answer ? run + 1 : 1;
        last = item.correct_answer;
        assert.ok(run <= 2);
      }
    }
  }
});

test('score extremes and every reference boundary agree with the established table', () => {
  for (const [points, band] of [[0,'A1'],[20,'A1'],[21,'A2_lower'],[22,'A2_lower'],[23,'A2_upper'],[25,'A2_upper'],[26,'B1_lower'],[29,'B1_lower'],[30,'B1_upper'],[32,'B1_upper'],[33,'B2_lower'],[35,'B2_lower'],[36,'B2_upper'],[37,'B2_upper'],[38,'C1'],[40,'C1']]) {
    let used = 0;
    const rows = config.items.map(item => ({reference:item.reference, correct:item.reference ? used++ < points : true}));
    const score = summarize(rows, config.items.length);
    assert.equal(score.referenceCorrect, points);
    assert.equal(score.referenceCount, 40);
    assert.equal(score.complete, true);
    assert.equal(conversion.estimateToeicListening({rawScore:score.referenceCorrect,nItems:score.referenceCount}).cefr, band);
  }
  assert.equal(summarize([], config.items.length).complete, false);
  const rows = config.items.slice(0,-1).map(item => ({reference:item.reference,correct:true}));
  assert.equal(summarize(rows, config.items.length).complete, false);
});

test('long total score cannot substitute for the common-40 score', () => {
  if (!config.long) return;
  const commonCorrect = config.items.map(item => ({ reference:item.reference, correct:item.reference }));
  let used = 0;
  const otherCorrect = config.items.map(item => ({ reference:item.reference, correct:!item.reference && used++ < 40 }));
  assert.equal(summarize(commonCorrect,160).correct, 40);
  assert.equal(summarize(otherCorrect,160).correct, 40);
  assert.equal(summarize(commonCorrect,160).referenceCorrect,40);
  assert.equal(summarize(otherCorrect,160).referenceCorrect,0);
});
