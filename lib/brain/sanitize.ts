interface SanitizeResult {
  sanitized: string;
  redactedCount: number;
}

interface Pattern {
  label: string;
  regex: RegExp;
  validate?: (match: string) => boolean;
}

function luhnCheck(digits: string): boolean {
  const nums = digits.replace(/\D/g, "");
  if (nums.length < 13 || nums.length > 19) return false;
  let sum = 0;
  let alternate = false;
  for (let i = nums.length - 1; i >= 0; i--) {
    let n = parseInt(nums[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function tfnCheck(digits: string): boolean {
  const nums = digits.replace(/\D/g, "");
  if (nums.length !== 9) return false;
  const weights = [1, 4, 3, 7, 5, 8, 6, 9, 10];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(nums[i], 10) * weights[i];
  }
  return sum % 11 === 0;
}

const PATTERNS: Pattern[] = [
  {
    label: "CARD",
    regex: /\b\d(?:[ -]?\d){12,18}\b/g,
    validate: (m) => luhnCheck(m),
  },
  {
    label: "EMAIL",
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  },
  {
    label: "KEY",
    regex: /\b(?:sk-[a-zA-Z0-9]{20,}|pk_[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}|ghp_[a-zA-Z0-9]{36}|xox[bpras]-[a-zA-Z0-9-]+)\b/g,
  },
  {
    label: "TFN",
    regex: /\b\d{3}[ -]?\d{3}[ -]?\d{3}\b/g,
    validate: (m) => tfnCheck(m),
  },
  {
    label: "MEDICARE",
    regex: /\b[2-6]\d{3}[ -]?\d{5}[ -]?\d\b/g,
  },
  {
    label: "PHONE",
    regex: /\b(?:\+?61[ -]?|0)[2-478](?:[ -]?\d){8}\b/g,
  },
  {
    label: "PHONE",
    regex: /\+\d{1,3}[ -]?(?:\d[ -]?){4,14}\d\b/g,
  },
  {
    label: "PASSPORT",
    regex: /\b[A-Z]{1,2}\d{7}\b/g,
  },
];

const MAX_CONTENT_BYTES = 50_000;

export function sanitizeForBrain(text: string): SanitizeResult {
  if (!text) return { sanitized: "", redactedCount: 0 };

  let working = text;
  if (working.length > MAX_CONTENT_BYTES) {
    working = working.slice(0, MAX_CONTENT_BYTES) + "\n[TRUNCATED]";
  }

  let redactedCount = 0;

  for (const pattern of PATTERNS) {
    working = working.replace(pattern.regex, (match) => {
      if (pattern.validate && !pattern.validate(match)) return match;
      redactedCount++;
      return `[REDACTED:${pattern.label}]`;
    });
  }

  return { sanitized: working, redactedCount };
}
