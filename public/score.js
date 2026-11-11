// Only a complete form with all 40 reference items may receive CEFR guidance.
window.LJT_PUBLIC_SCORE = (rows, total) => ({
  correct: rows.filter(row => row.correct).length,
  complete: rows.length === total,
  referenceCorrect: rows.filter(row => row.reference && row.correct).length,
  referenceCount: rows.filter(row => row.reference).length
});
