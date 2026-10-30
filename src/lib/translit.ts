"use client";

/**
 * translit.ts — v4.0: বাংলাদেশি উচ্চারণে নাম ডাকা (Bangla pronunciation for
 * English-spelled names).
 *
 * Owner (round-15): "নামটা টোটালি ইংলিশেই থাকবে — কিন্তু কথাটা বলবে বাংলার
 * মাধ্যমে, বাংলাদেশি উচ্চারণে। ইংলিশ প্রনাউন্স (ব্রিটিশ ইত্যাদি) দিয়ে নাম
 * সুন্দর শোনায় না।"
 *
 * The DISPLAY name stays English everywhere. Only the SPOKEN sentence (the
 * alarm `speak` text / reels warning) gets the Bangla spelling, so a bn-BD
 * TTS voice reads the name exactly the way a Bangladeshi person would say
 * it. Google TTS reading Latin letters inside a Bangla voice sounds foreign
 * or letter-by-letter — this module fixes that.
 *
 * How: phonetic letter-by-letter transliteration, the way Bangla names are
 * actually written — Sakib→সাকিব, Tahmid→তাহমিদ, Jamil→জামিল, Anowar→আনোয়ার,
 * Nadiramoni→নাদিরামনি, Priya→প্রিয়া, Sadia→সাদিয়া — plus a small dictionary
 * for spellings the algorithm can't infer (Hossain→হোসেন, Uddin→উদ্দিন…).
 * If the name is already Bangla script (or has no Latin letters at all) it
 * is returned unchanged.
 */

// ---------- dictionary: spellings the algorithm would mangle ----------
// keys are lowercase single words (dots/apostrophes/hyphens are stripped
// before lookup).
const KNOWN: Record<string, string> = {
  hossain: "হোসেন", husain: "হোসেন", hussain: "হোসেন", hosain: "হোসেন",
  hossen: "হোসেন", hossin: "হোসেন",
  hasan: "হাসান", hassan: "হাসান", hasen: "হাসান",
  mohammad: "মোহাম্মদ", muhammad: "মুহাম্মদ", mohammed: "মোহাম্মদ",
  mahammad: "মোহাম্মদ",
  md: "মোঃ",
  rahman: "রহমান", rahmann: "রহমান",
  islam: "ইসলাম",
  uddin: "উদ্দিন",
  khan: "খান",
  akhtar: "আখতার", akhter: "আখতার",
  tahmid: "তাহমিদ",
  yousuf: "ইউসুফ", yusuf: "ইউসুফ", yousif: "ইউসুফ",
  begum: "বেগম",
  sheikh: "শেখ", shek: "শেখ",
  aisha: "আয়েশা", ayesha: "আয়েশা", aysha: "আয়েশা", ayisha: "আয়েশা",
  ali: "আলী",
  allah: "আল্লাহ",
  ummah: "উম্মাহ",
};

// ---------- single-letter maps ----------
const CONS: Record<string, string> = {
  b: "ব", c: "ক", d: "দ", f: "ফ", g: "গ", h: "হ", j: "জ", k: "ক",
  l: "ল", m: "ম", n: "ন", p: "প", q: "ক", r: "র", s: "স", t: "ত",
  v: "ভ", x: "ক্স", z: "জ",
};
// digraphs (checked before singles)
const CONS2: Record<string, string> = {
  chh: "ছ", kh: "খ", gh: "ঘ", ch: "চ", jh: "ঝ", th: "থ", dh: "ধ",
  ph: "ফ", bh: "ভ", sh: "শ", ck: "ক", ng: "ং", wh: "ও",
};

// vowel signs (after a consonant), longest cluster first
// v4.0.1: au → "াউ" (Rezaul→রেজাউল, Kausar→কাউসার — the a+u split is how
// Bangladeshi names actually sound; single-sound ৌ stayed for ou/ৌ)
const SIGN: Array<[string, string]> = [
  ["aiy", "াইয়"], ["ia", "িয়া"], ["ea", "া"], ["oa", "োয়া"],
  ["ou", "ৌ"], ["au", "াউ"], ["ai", "ৈ"], ["oi", "ৈ"],
  ["aa", "া"], ["ee", "ী"], ["oo", "ূ"],
  ["a", "া"], ["i", "ি"], ["u", "ু"], ["e", "ে"], ["o", "ো"],
];
// independent vowels (word start / after a vowel), longest first
const INDEP: Array<[string, string]> = [
  ["ai", "আই"], ["ou", "ঔ"], ["au", "আউ"], ["oi", "ঐ"],
  ["aa", "আ"], ["ee", "ঈ"], ["oo", "ঊ"],
  ["a", "আ"], ["i", "ই"], ["u", "উ"], ["e", "এ"], ["o", "ও"],
];

const VOWELS = "aeiou";
const isVowel = (c: string) => VOWELS.includes(c);

function translitWord(raw: string): string {
  const w = raw.toLowerCase();
  if (!w) return "";
  if (KNOWN[w]) return KNOWN[w];

  let out = "";
  let i = 0;
  let lastUnitConsonant = false; // does a consonant precede position i?
  const n = w.length;

  while (i < n) {
    const c = w[i];

    // ----- special letters -----
    if (c === "y") {
      const prev = i > 0 ? w[i - 1] : "";
      const next = i + 1 < n ? w[i + 1] : "";
      if (i === 0) {
        // word-initial y + vowel → ইয় + the vowel as a SIGN on য়
        // (Yasin → ইয়াসিন, Yeasin → ইয়াসিন)
        out += "ইয়";
        lastUnitConsonant = true;
        i++;
        continue;
      }
      if (isVowel(prev) && isVowel(next)) {
        out += "য়"; // Maya → মায়া (Anowar's w follows the same rule below)
        lastUnitConsonant = true;
        i++;
        continue;
      }
      if (i === n - 1) {
        // word-final y: after a vowel → য় (Joy→জয়), after a consonant → ই (Mary→মারই)
        out += isVowel(prev) ? "য়" : "ই";
        lastUnitConsonant = false;
        i++;
        continue;
      }
      // y between vowel and consonant (Sayed, Priya): vowel sign already
      // emitted → y acts as the consonant য় carrying the next vowel sign
      if (isVowel(prev) && !isVowel(next) && next !== "") {
        out += "য়";
        lastUnitConsonant = true;
        i++;
        continue;
      }
      out += "য়";
      lastUnitConsonant = true;
      i++;
      continue;
    }

    if (c === "w") {
      const prev = i > 0 ? w[i - 1] : "";
      const next = i + 1 < n ? w[i + 1] : "";
      if (i === 0) {
        out += "ওয়"; // Wasim → ওয়াসিম
        lastUnitConsonant = true;
        i++;
        continue;
      }
      if (isVowel(prev) && isVowel(next)) {
        out += "য়"; // Anowar → আনোয়ার
        lastUnitConsonant = true;
        i++;
        continue;
      }
      out += "ওয়"; // Anwar → আনওয়ার (w after a consonant, vowel follows)
      lastUnitConsonant = true;
      i++;
      continue;
    }

    // ----- vowels -----
    if (isVowel(c)) {
      const table = lastUnitConsonant ? SIGN : INDEP;
      let matched = false;
      for (const [k, v] of table) {
        if (w.startsWith(k, i)) {
          out += v;
          matched = true;
          i += k.length;
          break;
        }
      }
      if (!matched) {
        out += "আ"; // unreachable safety
        i++;
      }
      // v4.0.1: a cluster that ENDS in য় (like াইয়) leaves a consonant-like
      // unit — the next vowel becomes its SIGN (Sumaiya → সুমাইয়া, not the
      // broken সুমাইয়আ).
      lastUnitConsonant = out.endsWith("য়");
      continue;
    }

    // ----- consonants -----
    // doubled consonant → conjunct (Uddin → উদ্দিন, Abdullah → আব্দুল্লাহ)
    if (i + 1 < n && w[i + 1] === c && "bcdfghklmnprstvz".includes(c)) {
      const base = CONS[c] || "ক";
      // keep the cluster open if a vowel follows (the sign lands on the
      // second consonant: দ্দি), otherwise close it: দ্দ + hasant would be
      // wrong at word end — bare double at end stays a double (Allah → আল্লাহ
      // final হ handled separately)
      out += base + "্" + base;
      lastUnitConsonant = true;
      i += 2;
      // if a vowel follows, its SIGN will attach right here (উদ্দিন) ✓
      continue;
    }

    // digraphs first (longest): chh/kh/gh/ch/jh/th/dh/ph/bh/sh/ck/ng/wh
    let cons = "";
    let consumed = 0;
    for (const k of ["chh", "kh", "gh", "ch", "jh", "th", "dh", "ph", "bh", "sh", "ck", "ng", "wh"]) {
      if (w.startsWith(k, i)) {
        cons = CONS2[k];
        consumed = k.length;
        break;
      }
    }
    if (!cons) {
      let base = CONS[c];
      if (c === "c") {
        const next = i + 1 < n ? w[i + 1] : "";
        base = ["e", "i", "y"].includes(next) ? "স" : "ক"; // Celina→সেলিনা, Carim→কারিম
      }
      cons = base || "ক";
      consumed = 1;
    }

    // what follows the consonant?
    const nextIdx = i + consumed;
    const next = nextIdx < n ? w[nextIdx] : "";
    if (next === "" || !isVowel(next)) {
      if (next === "") {
        out += cons; // word end → bare consonant (Sakib → সাকিব)
      } else if (next === "y" || next === "w") {
        out += cons; // y/w are handled as their own units next round
      } else {
        out += cons + "্"; // consonant cluster (Priya → প্রিয়া, Abdullah → আব্দুল্লাহ)
      }
      lastUnitConsonant = true;
      i += consumed;
      continue;
    }
    // a vowel follows → bare consonant; the vowel loop attaches its SIGN
    out += cons;
    lastUnitConsonant = true;
    i += consumed;
    continue;
  }

  return out || w;
}

/**
 * The SPOKEN form of a name for Bangla TTS:
 *  • already Bangla script / no Latin letters → returned unchanged
 *  • "Md. Tahmid Jamil" → "মোঃ তাহমিদ জামিল"
 *  • "Nadiramoni" → "নাদিরামনি"
 */
export function banglaNameFromEnglish(name: string | null | undefined): string {
  const s = (name || "").trim();
  if (!s) return "";
  // no Latin letters at all (already Bangla / emoji / empty) → unchanged
  if (!/[A-Za-z]/.test(s)) return s;
  return s
    .replace(/[’'`]/g, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map(translitWord)
    .join(" ");
}
