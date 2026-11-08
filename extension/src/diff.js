// Word-level diff + text direction. Same algorithm as desktop/wa_core/diffing.py (keep in sync).
(function () {
  function tokenize(text) {
    return text.split(/(\s+)/).filter((t) => t !== "");
  }

  function wordDiff(a, b) {
    const x = tokenize(a), y = tokenize(b);
    const n = x.length, m = y.length;
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops = [];
    const push = (op, text) => {
      const last = ops[ops.length - 1];
      if (last && last.op === op) last.text += text; else ops.push({ op, text });
    };
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { push("equal", x[i]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { push("delete", x[i]); i++; }
      else { push("insert", y[j]); j++; }
    }
    while (i < n) push("delete", x[i++]);
    while (j < m) push("insert", y[j++]);
    return ops;
  }

  const HEBREW = /[֐-׿יִ-ﭏ]/;
  function detectDirection(text) {
    const letters = text.match(/\p{L}/gu) || [];
    if (!letters.length) return "ltr";
    const heb = letters.filter((c) => HEBREW.test(c)).length;
    return heb / letters.length > 0.3 ? "rtl" : "ltr";
  }

  globalThis.WA_DIFF = { tokenize, wordDiff, detectDirection };
  if (typeof module !== "undefined") module.exports = globalThis.WA_DIFF;
})();
