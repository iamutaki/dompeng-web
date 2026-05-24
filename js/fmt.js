/**
 * Format angka dashboard: singkat bila ≥ 1.000 (rb / jt / M / T).
 */
const SHORT_COUNT_UNITS = [
  { threshold: 1e12, divisor: 1e12, suffix: " T" },
  { threshold: 1e9, divisor: 1e9, suffix: " M" },
  { threshold: 1e6, divisor: 1e6, suffix: " jt" },
  { threshold: 1e3, divisor: 1e3, suffix: " rb" },
];

/** Singkat angka ≥ 1.000: 1 rb, 1,5 jt, 1 M, 1 T. */
function fmtShort(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "0";
  const abs = Math.abs(num);
  if (abs < 1000) return String(Math.round(num));

  for (const { threshold, divisor, suffix } of SHORT_COUNT_UNITS) {
    if (abs < threshold) continue;
    const scaled = num / divisor;
    if (scaled < 10 && Math.round(scaled) !== scaled) {
      const rounded = Math.round(scaled * 10) / 10;
      const whole = Math.trunc(rounded);
      const fracOne = Math.round(rounded * 10) % 10;
      if (fracOne) return `${whole},${fracOne}${suffix}`;
      return `${Math.round(rounded)}${suffix}`;
    }
    return `${Math.round(scaled)}${suffix}`;
  }

  return String(Math.round(num));
}

function fmt(n) {
  return fmtShort(n);
}

/**
 * Ekspresi MapLibre: nilai numerik → label singkat (sama dengan fmtShort).
 * @param {unknown[]} valueExpr
 */
function mapCountShortLabelExpr(valueExpr) {
  const absVal = ["abs", valueExpr];
  const plain = ["to-string", ["round", valueExpr]];

  function formatScaled(divisor, suffix) {
    const scaled = ["/", valueExpr, divisor];
    const roundedTenth = ["/", ["round", ["*", scaled, 10]], 10];
    const fracOne = ["%", ["round", ["*", roundedTenth, 10]], 10];
    const withDecimal = [
      "concat",
      ["to-string", ["floor", roundedTenth]],
      ",",
      ["to-string", fracOne],
      suffix,
    ];
    const roundedOneDecimal = ["concat", ["to-string", ["round", roundedTenth]], suffix];
    const rounded = ["concat", ["to-string", ["round", scaled]], suffix];
    return [
      "case",
      [
        "all",
        ["<", ["abs", scaled], 10],
        ["!=", ["round", scaled], scaled],
        ["!=", fracOne, 0],
      ],
      withDecimal,
      [
        "all",
        ["<", ["abs", scaled], 10],
        ["!=", ["round", scaled], scaled],
      ],
      roundedOneDecimal,
      rounded,
    ];
  }

  let expr = plain;
  for (let i = SHORT_COUNT_UNITS.length - 1; i >= 0; i--) {
    const { threshold, divisor, suffix } = SHORT_COUNT_UNITS[i];
    expr = ["case", [">=", absVal, threshold], formatScaled(divisor, suffix), expr];
  }
  return expr;
}

if (typeof window !== "undefined") {
  window.dompengFmtShort = fmtShort;
  window.dompengFmt = fmt;
}
