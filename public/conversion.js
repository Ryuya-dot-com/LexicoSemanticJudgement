window.LJT_SHORT_CONVERSION = (() => {
  'use strict';

  const LJT_TOEIC_CEFR_RANGES = [
    { ljtMin: 0, ljtMax: 20, toeicMin: 60, toeicMax: 105, cefr: 'A1' },
    { ljtMin: 21, ljtMax: 22, toeicMin: 110, toeicMax: 185, cefr: 'A2_lower' },
    { ljtMin: 23, ljtMax: 25, toeicMin: 190, toeicMax: 270, cefr: 'A2_upper' },
    { ljtMin: 26, ljtMax: 29, toeicMin: 275, toeicMax: 330, cefr: 'B1_lower' },
    { ljtMin: 30, ljtMax: 32, toeicMin: 335, toeicMax: 395, cefr: 'B1_upper' },
    { ljtMin: 33, ljtMax: 35, toeicMin: 400, toeicMax: 440, cefr: 'B2_lower' },
    { ljtMin: 36, ljtMax: 37, toeicMin: 445, toeicMax: 485, cefr: 'B2_upper' },
    { ljtMin: 38, ljtMax: 40, toeicMin: 490, toeicMax: 495, cefr: 'C1' }
  ];

  const CEFR_LISTENING_CUTS = LJT_TOEIC_CEFR_RANGES
    .map(range => ({ level: range.cefr, min: range.toeicMin }))
    .reverse();

  function estimateToeicListening({ rawScore, nItems } = {}) {
    const raw = Number(rawScore);
    const administeredItems = Number(nItems);
    if (!Number.isFinite(raw)) {
      return {
        available: false,
        status: 'invalid_input'
      };
    }
    if (!Number.isInteger(administeredItems) || administeredItems !== 40) {
      return {
        available: false,
        status: 'incomplete_form',
        rawScore: raw,
        nItems: Number.isFinite(administeredItems) ? administeredItems : null
      };
    }

    const ljtScore = clamp(Math.round(raw), 0, 40);
    const range = rangeFromRawScore(ljtScore);
    if (!range) {
      return {
        available: false,
        status: 'invalid_input'
      };
    }

    const toeicRange = `${range.toeicMin}-${range.toeicMax}`;
    return {
      available: true,
      status: 'estimated',
      rawScore: ljtScore,
      score: (range.toeicMin + range.toeicMax) / 2,
      scoreMin: range.toeicMin,
      scoreMax: range.toeicMax,
      scoreRange: toeicRange,
      toeicRange,
      cefr: range.cefr
    };
  }

  function rangeFromRawScore(rawScore) {
    const raw = Number(rawScore);
    if (!Number.isFinite(raw)) return null;
    const ljtScore = clamp(Math.round(raw), 0, 40);
    return LJT_TOEIC_CEFR_RANGES.find(range => (
      ljtScore >= range.ljtMin && ljtScore <= range.ljtMax
    )) || null;
  }

  function cefrFromRawScore(rawScore) {
    const range = rangeFromRawScore(rawScore);
    return range ? range.cefr : '';
  }

  function cefrFromToeicListening(score) {
    const numericScore = Number(score);
    if (!Number.isFinite(numericScore)) return '';
    const match = CEFR_LISTENING_CUTS.find(cut => numericScore >= cut.min);
    return match ? match.level : 'Below A1';
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  return {
    estimateToeicListening,
    rangeFromRawScore,
    cefrFromRawScore,
    cefrFromToeicListening,
    LJT_TOEIC_CEFR_RANGES,
    CEFR_LISTENING_CUTS
  };
})();
