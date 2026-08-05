"use strict";
const fse = require("fs-extra");
const path = require("path");
const pdfParse = require("pdf-parse");
const { v4: uuidv4 } = require("uuid");
const { OUTPUT_DIR } = require("../config/constants");
const logger = require("../utils/logger");

// Google Gemini — completely free tier (15 RPM, 1M tokens/day)
// Set GEMINI_API_KEY in .env — get one free at https://aistudio.google.com/apikey
let geminiModel = null;
const getGemini = () => {
  if (!geminiModel) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not configured. Get a free key at https://aistudio.google.com/apikey");
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(key);
    geminiModel = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || "gemini-2.5-flash" });
  }
  return geminiModel;
};

const MAX_CONTEXT_CHARS = 14_000;

const extractPdfText = async (pdfPath) => {
  const buf  = await fse.readFile(pdfPath);
  const data = await pdfParse(buf);
  return data.text.slice(0, MAX_CONTEXT_CHARS);
};

/** Server-side DOCX extraction — `mammoth` was already a declared backend
 *  dependency but unused; this is the same `extractRawText` call already
 *  proven client-side in the ATS checker's old browser-only extraction. */
const extractDocxText = async (docxPath) => {
  const mammoth = require("mammoth");
  const buf = await fse.readFile(docxPath);
  const result = await mammoth.extractRawText({ buffer: buf });
  return (result.value || "").slice(0, MAX_CONTEXT_CHARS);
};

const ask = async (prompt) => {
  const model  = getGemini();
  const result = await model.generateContent(prompt);
  return result.response.text();
};

// ── Summarize PDF ────────────────────────────────────────────────────────────
const summarizePdf = async (pdfPath, { length = "medium", language = "English" } = {}) => {
  const text      = await extractPdfText(pdfPath);
  const wordCount = { short: 100, medium: 250, long: 500 }[length] || 250;

  const prompt = `You are a document analysis assistant. Summarize the following document in approximately ${wordCount} words in ${language}. Focus on key points, conclusions, and important details.\n\n${text}`;
  const summary = await ask(prompt);

  const fileName   = `summary-${uuidv4()}.txt`;
  const outputPath = path.join(OUTPUT_DIR, fileName);
  await fse.writeFile(outputPath, summary, "utf8");
  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size, summary, tokensUsed: 0 };
};

// ── Chat with PDF ────────────────────────────────────────────────────────────
const chatWithPdf = async (pdfPath, question, conversationHistory = []) => {
  const text = await extractPdfText(pdfPath);

  const historyText = conversationHistory
    .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  const prompt = `You are a helpful assistant answering questions about the following document:\n\n---\n${text}\n---\n\nAnswer based only on the document content. If the answer is not in the document, say so.\n\n${historyText}\nUser: ${question}\nAssistant:`;
  const answer = await ask(prompt);
  return { answer, tokensUsed: 0 };
};

// ── Extract Keywords ─────────────────────────────────────────────────────────
const extractKeywords = async (pdfPath) => {
  const text   = await extractPdfText(pdfPath);
  const prompt = `Extract the 20 most important keywords and key phrases from this document. Return ONLY a valid JSON object like: {"keywords": ["word1","word2",...]}. No explanation.\n\n${text}`;
  const raw    = await ask(prompt);

  let keywords = [];
  try {
    const clean  = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    keywords = parsed.keywords || parsed.key_phrases || Object.values(parsed)[0] || [];
  } catch { keywords = []; }

  const fileName   = `keywords-${uuidv4()}.json`;
  const outputPath = path.join(OUTPUT_DIR, fileName);
  await fse.writeFile(outputPath, JSON.stringify({ keywords }, null, 2), "utf8");
  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size, keywords, tokensUsed: 0 };
};

// ── Auto Form Fill ────────────────────────────────────────────────────────────
const extractFormData = async (pdfPath) => {
  const text   = await extractPdfText(pdfPath);
  const prompt = `Extract all form field data from this document. Return ONLY a valid JSON object with field names as keys and extracted values as values. Common fields: name, email, date, address, phone, etc. No explanation.\n\n${text}`;
  const raw    = await ask(prompt);

  let formData = {};
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    formData = JSON.parse(clean);
  } catch { formData = {}; }

  const fileName   = `form-data-${uuidv4()}.json`;
  const outputPath = path.join(OUTPUT_DIR, fileName);
  await fse.writeFile(outputPath, JSON.stringify(formData, null, 2), "utf8");
  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size, formData, tokensUsed: 0 };
};

// ── Resume Bullet Suggestions (resume builder feature) ───────────────────────
const generateResumeBullets = async ({ jobTitle, company, description, count = 4 }) => {
  const context = description ? `Context about the role:\n${description.slice(0, 500)}` : "";
  const prompt  = `You are an expert resume writer specializing in ATS-optimized resumes for the Indian job market.
Generate exactly ${count} powerful resume bullet points for the role of "${jobTitle}"${company ? ` at ${company}` : ""}.
${context}

Rules:
- Start each bullet with a strong action verb (Led, Built, Increased, Reduced, Designed, etc.)
- Include quantified metrics where realistic (%, ₹, users, time saved, team size, etc.)
- Keep each bullet under 20 words
- Be specific and achievement-focused, not task-focused
- Tailor for ATS keyword density

Return ONLY a JSON object: {"bullets": ["bullet 1","bullet 2","bullet 3","bullet 4"]}`;

  const raw = await ask(prompt);
  let bullets = [];
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    bullets = JSON.parse(clean).bullets || [];
  } catch {
    bullets = raw.split("\n").filter(l => l.trim().startsWith("-") || l.match(/^\d\./)).map(l => l.replace(/^[-\d.]\s*/, "").trim()).filter(Boolean).slice(0, count);
  }
  return { bullets };
};

// ── Cover Letter Generation ───────────────────────────────────────────────────
const generateCoverLetter = async ({ name, jobTitle, company, skills, experience, jobDescription }) => {
  const skillsText = Array.isArray(skills) ? skills.slice(0, 8).join(", ") : skills || "";
  const jdText     = jobDescription ? `\nJob description snippet:\n${jobDescription.slice(0, 600)}` : "";

  const prompt = `You are an expert career coach writing a professional cover letter for the Indian job market.

Candidate: ${name || "the applicant"}
Applying for: ${jobTitle || "this position"} at ${company || "your company"}
Key skills: ${skillsText}
Experience summary: ${(experience || "").slice(0, 400)}${jdText}

Write a professional, concise cover letter (3 paragraphs, under 250 words).
- Opening: enthusiasm + brief intro
- Middle: 2-3 specific achievements / skills matched to the role
- Closing: call to action

Use formal but warm tone. Do NOT use placeholders like [Your Name]. Write it as a finished letter starting with "Dear Hiring Manager,".`;

  const letter = await ask(prompt);
  return { letter: letter.trim() };
};

// ── Resume Text Transform (AI dock: grammar/tone/length/translate) ──────────
const TRANSFORM_PROMPTS = {
  grammar: (text) => `You are a professional resume editor. Fix all grammar, spelling, and punctuation errors in the following resume text. Keep the meaning, facts, and tone unchanged.\n\nText:\n${text}\n\nReturn ONLY the corrected text. No explanation, no markdown, no quotes.`,
  deepcheck: (text) => `You are a senior resume reviewer. Perform a deep pass on the following resume text: fix grammar, tighten wording, improve clarity, strengthen weak verbs, and make it more ATS-friendly. Keep it factually the same.\n\nText:\n${text}\n\nReturn ONLY the improved text. No explanation, no markdown, no quotes.`,
  professional: (text) => `You are an expert resume writer. Rewrite the following resume text in a polished, professional tone suitable for corporate job applications. Keep the facts unchanged.\n\nText:\n${text}\n\nReturn ONLY the rewritten text. No explanation, no markdown, no quotes.`,
  executive: (text) => `You are an executive resume writer. Rewrite the following resume text in a confident, strategic, leadership-oriented tone suitable for senior/C-level roles. Keep the facts unchanged.\n\nText:\n${text}\n\nReturn ONLY the rewritten text. No explanation, no markdown, no quotes.`,
  shorten: (text) => `You are a resume editor. Rewrite the following resume text to be significantly more concise — cut at least a third of the words — while keeping every key fact and metric.\n\nText:\n${text}\n\nReturn ONLY the shortened text. No explanation, no markdown, no quotes.`,
  expand: (text) => `You are a resume writer. Expand the following resume text with more specific, realistic detail — scope, tools, metrics, outcomes — while staying truthful to what's given and professional in tone.\n\nText:\n${text}\n\nReturn ONLY the expanded text. No explanation, no markdown, no quotes.`,
  translate: (text, targetLanguage) => `You are a professional translator specializing in resumes. Translate the following resume text into ${targetLanguage || "Hindi"}, preserving professional tone and formatting.\n\nText:\n${text}\n\nReturn ONLY the translated text. No explanation, no markdown, no quotes.`,
};

const transformResumeText = async ({ mode, text, targetLanguage }) => {
  const builder = TRANSFORM_PROMPTS[mode];
  if (!builder) throw new Error(`Unsupported transform mode: ${mode}`);
  const prompt = builder(text.slice(0, 3000), targetLanguage);
  const result = (await ask(prompt)).trim();
  return { result };
};

// ── AI ATS Deep Analysis (resume builder — real Gemini-backed audit) ────────
const ATS_MAX_CONTEXT_CHARS = 12_000;

/** Renders the resume's structured data into a compact, readable text block for
 *  the AI prompt — mirrors what the frontend's `AtsScoreService.extractAllText`
 *  does client-side for the free heuristic checker, but this runs server-side
 *  since the deep analysis call itself is server-side. */
function resumeToPromptText(resume) {
  const lines = [];
  const p = resume.personal || {};
  lines.push(`NAME: ${p.fullName || ""}`);
  lines.push(`TARGET TITLE: ${p.jobTitle || ""}`);
  lines.push(`CONTACT: email=${p.email || "MISSING"}, phone=${p.phone || "MISSING"}, location=${p.location || "MISSING"}, linkedin=${p.linkedin || "none"}, github=${p.github || "none"}, portfolio=${p.portfolio || "none"}`);

  lines.push(`\nSUMMARY:\n${resume.summary || "(empty)"}`);

  lines.push(`\nEXPERIENCE (${(resume.experience || []).length} entries, indexed 0-based):`);
  (resume.experience || []).forEach((e, i) => {
    lines.push(`  [${i}] ${e.role || ""} at ${e.company || ""} (${e.startDate || ""} – ${e.current ? "Present" : e.endDate || ""})`);
    (e.bullets || []).forEach((b, bi) => lines.push(`      bullet[${bi}]: ${b}`));
  });

  lines.push(`\nEDUCATION (${(resume.education || []).length} entries):`);
  (resume.education || []).forEach(e => {
    lines.push(`  - ${e.degree || ""} ${e.field || ""} — ${e.institution || ""} (${e.startDate || ""} – ${e.endDate || ""})`);
  });

  lines.push(`\nPROJECTS (${(resume.projects || []).length} entries, indexed 0-based):`);
  (resume.projects || []).forEach((proj, i) => {
    lines.push(`  [${i}] ${proj.name || ""} (tech: ${proj.techStack || ""})`);
    (proj.bullets || []).forEach((b, bi) => lines.push(`      bullet[${bi}]: ${b}`));
  });

  lines.push(`\nSKILLS:`);
  (resume.skills || []).forEach(g => lines.push(`  - ${g.category || "General"}: ${(g.items || []).join(", ")}`));

  if ((resume.certifications || []).length) {
    lines.push(`\nCERTIFICATIONS: ${resume.certifications.map(c => c.name).filter(Boolean).join(", ")}`);
  }
  if ((resume.achievements || []).length) {
    lines.push(`\nACHIEVEMENTS: ${resume.achievements.filter(Boolean).join("; ")}`);
  }
  if ((resume.languages || []).length) {
    lines.push(`\nLANGUAGES: ${resume.languages.map(l => l.name).filter(Boolean).join(", ")}`);
  }
  lines.push(`\nSECTION ORDER: ${(resume.sectionOrder || []).join(" > ")}`);

  return lines.join("\n").slice(0, ATS_MAX_CONTEXT_CHARS);
}

const ATS_ANALYZE_PROMPT = `You are a senior ATS (Applicant Tracking System) resume auditor, evaluating resumes the way EnhanceCV, Resume.io, Kickresume, and Teal do.

Deeply analyze the resume below across ALL of these dimensions: overall structure, section ordering, missing sections, contact information completeness, keyword usage and density, action verbs, skills relevance, experience quality, education, projects, grammar, readability, ATS compatibility, formatting consistency, bullet-point consistency, quantified achievements (numbers/%/metrics), and job-title relevance.

Return ONLY a single valid JSON object — no markdown, no code fences, no explanation — matching EXACTLY this shape:
{
  "score": <0-100 overall ATS score>,
  "breakdown": {
    "formatting": <0-100>, "keywords": <0-100>, "experience": <0-100>,
    "education": <0-100>, "skills": <0-100>, "readability": <0-100>, "atsCompatibility": <0-100>
  },
  "strengths": ["short, specific, positive observation", ...up to 6],
  "weaknesses": ["short, specific, actionable observation", ...up to 6],
  "criticalIssues": ["a blocking/serious problem, e.g. missing contact info or no measurable results", ...up to 5, empty array if none],
  "suggestions": [
    {
      "id": "short-kebab-slug",
      "category": "formatting" | "keywords" | "experience" | "education" | "skills" | "readability" | "ats" | "summary",
      "severity": "critical" | "warning" | "info",
      "title": "short imperative title, e.g. Add measurable achievements",
      "detail": "one to two sentence explanation of why and how",
      "apply": null OR {
        "type": "summary",
        "value": "a fully rewritten, improved professional summary (only when type is summary)"
      } OR {
        "type": "bullet",
        "scope": "experience" | "project",
        "index": <0-based index into the EXPERIENCE or PROJECTS list above>,
        "bulletIndex": <0-based index into that entry's bullets>,
        "value": "the rewritten bullet: strong action verb, quantified where realistic, under 25 words"
      } OR {
        "type": "skills",
        "skillItems": ["missing", "relevant", "technical", "skill", "names", "up to 8"]
      }
    }
    ... up to 10 suggestions, ordered most-impactful first. Only include "apply" when you can produce a concrete, ready-to-use value — otherwise use null.
  ],
  "suggestedSkills": ["technical or role-relevant skills the resume is missing, up to 12"]
}

Be honest and specific — base every score and claim only on what is actually present in the resume text below. Do not invent facts.

RESUME:
"""
{{RESUME_TEXT}}
"""`;

const SEVERITIES = new Set(["critical", "warning", "info"]);
const APPLY_TYPES = new Set(["summary", "bullet", "skills"]);
const BREAKDOWN_KEYS = ["formatting", "keywords", "experience", "education", "skills", "readability", "atsCompatibility"];

function clampScore(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
}

function sanitizeStringArray(arr, max, maxLen = 220) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(s => typeof s === "string" && s.trim())
    .map(s => s.trim().slice(0, maxLen))
    .slice(0, max);
}

/** Validates and clamps an `apply` block from the AI against the actual resume
 *  shape so the frontend never has to trust unvalidated AI output structurally —
 *  a bad/hallucinated index or unknown type is dropped rather than passed through. */
function sanitizeApply(apply, resume) {
  if (!apply || typeof apply !== "object") return undefined;
  if (!APPLY_TYPES.has(apply.type)) return undefined;

  if (apply.type === "summary") {
    if (typeof apply.value !== "string" || !apply.value.trim()) return undefined;
    return { type: "summary", value: apply.value.trim().slice(0, 1200) };
  }

  if (apply.type === "skills") {
    const items = sanitizeStringArray(apply.skillItems, 8, 40);
    if (!items.length) return undefined;
    return { type: "skills", skillItems: items };
  }

  if (apply.type === "bullet") {
    const scope = apply.scope === "project" ? "project" : "experience";
    const list = scope === "project" ? (resume.projects || []) : (resume.experience || []);
    const index = Number(apply.index);
    const bulletIndex = Number(apply.bulletIndex);
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return undefined;
    const bullets = list[index]?.bullets || [];
    if (!Number.isInteger(bulletIndex) || bulletIndex < 0 || bulletIndex >= bullets.length) return undefined;
    if (typeof apply.value !== "string" || !apply.value.trim()) return undefined;
    return { type: "bullet", scope, index, bulletIndex, value: apply.value.trim().slice(0, 400) };
  }

  return undefined;
}

function emptyAtsResult() {
  return {
    score: 0,
    breakdown: { formatting: 0, keywords: 0, experience: 0, education: 0, skills: 0, readability: 0, atsCompatibility: 0 },
    strengths: [], weaknesses: [], criticalIssues: [], suggestions: [], suggestedSkills: [],
  };
}

const analyzeResumeAts = async ({ resume }) => {
  if (!resume || typeof resume !== "object") return emptyAtsResult();

  const resumeText = resumeToPromptText(resume);
  const prompt = ATS_ANALYZE_PROMPT.replace("{{RESUME_TEXT}}", resumeText);

  let raw;
  try {
    raw = await ask(prompt);
  } catch (err) {
    logger.warn("[AI ATS] Gemini request failed:", err.message);
    return emptyAtsResult();
  }

  let parsed;
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(clean);
  } catch (err) {
    logger.warn("[AI ATS] Could not parse Gemini JSON response:", err.message);
    return emptyAtsResult();
  }

  const breakdown = {};
  for (const key of BREAKDOWN_KEYS) breakdown[key] = clampScore(parsed?.breakdown?.[key]);

  const suggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions.slice(0, 12).map((s, i) => ({
        id: (typeof s.id === "string" && s.id.trim()) ? s.id.trim().slice(0, 60) : `suggestion-${i}`,
        category: typeof s.category === "string" ? s.category.slice(0, 30) : "general",
        severity: SEVERITIES.has(s.severity) ? s.severity : "info",
        title: typeof s.title === "string" ? s.title.trim().slice(0, 120) : "Improve this resume",
        detail: typeof s.detail === "string" ? s.detail.trim().slice(0, 400) : "",
        apply: sanitizeApply(s.apply, resume),
      }))
    : [];

  return {
    score: clampScore(parsed.score),
    breakdown,
    strengths: sanitizeStringArray(parsed.strengths, 8),
    weaknesses: sanitizeStringArray(parsed.weaknesses, 8),
    criticalIssues: sanitizeStringArray(parsed.criticalIssues, 6),
    suggestions,
    suggestedSkills: sanitizeStringArray(parsed.suggestedSkills, 15, 50),
  };
};

// ── ATS Resume Checker — deep analysis of an UPLOADED resume's raw text ─────
// Distinct from analyzeResumeAts above (which audits the Resume Builder's own
// structured ResumeData). This one takes raw extracted text from an uploaded
// PDF/DOCX/pasted resume (see atsChecker.controller.js) and returns a much
// richer, section-scored, issue-level report for the ATS Checker product.

/** Exact, cheap, deterministic facts — deliberately NOT asked of the AI.
 *  LLMs are unreliable at precise counting; these are free and always right. */
function computeLocalStats(text) {
  const wordCount = (text.match(/\S+/g) || []).length;
  const bulletCount = (text.match(/^[ \t]*[•\-\*•][^\n]+/gm) || []).length;
  const pageEstimate = Math.max(1, Math.round(wordCount / 500)); // ~500 words/page is a common resume density
  const readingTimeSec = Math.round((wordCount / 200) * 60); // ~200 wpm average reading speed
  return { wordCount, bulletCount, pageEstimate, readingTimeSec };
}

// Fixed, documented weights — the overall score is ALWAYS this weighted
// average of the section scores the model returns, never a separate
// AI-provided top-line number. This is what makes "every score is derived
// from measurable analysis" actually true rather than marketing copy.
const CHECKER_SCORE_WEIGHTS = {
  atsCompatibility: 0.14, formatting: 0.08, grammar: 0.10, spelling: 0.06,
  structure: 0.08, readability: 0.08, keywords: 0.10, achievements: 0.14,
  experience: 0.10, projects: 0.04, skills: 0.06, length: 0.02,
};

function computeOverallScore(sectionScores) {
  let total = 0, weightSum = 0;
  for (const [key, weight] of Object.entries(CHECKER_SCORE_WEIGHTS)) {
    const v = sectionScores[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      total += v * weight;
      weightSum += weight;
    }
  }
  return weightSum > 0 ? Math.round(total / weightSum) : 0;
}

const CHECKER_MAX_CHARS = 12_000;
const ISSUE_CATEGORIES = new Set([
  "grammar", "spelling", "weak-verb", "duplicate", "long-sentence", "vague",
  "passive-voice", "formatting", "ats", "keywords",
]);
const ISSUE_SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const VERDICTS = new Set(["ready", "borderline", "needs-work"]);
const CHECKER_SECTION_KEYS = Object.keys(CHECKER_SCORE_WEIGHTS);

const ATS_CHECKER_PROMPT = `You are a senior technical recruiter, ATS parsing expert, and professional resume editor combined. Analyze the resume text below with the same rigor a real recruiter, an ATS parser, and a grammar/style editor would each apply — do not guess or fabricate; base every finding only on what is actually present in the text.

Known facts, computed exactly — use them, do not recalculate: {{STATS_JSON}}

Return ONLY a single valid JSON object — no markdown, no code fences, no explanation — matching EXACTLY this shape:
{
  "sectionsDetected": ["Header","Summary","Experience", ... only sections from Header/Summary/Experience/Projects/Skills/Education/Certifications/Achievements/Languages/Awards/Interests that are genuinely present],
  "sectionsMissing": [{"name": "e.g. Professional Summary", "impact": "critical"|"high"|"medium"|"low", "recommendation": "concrete, specific advice"}],
  "contactInfo": {
    "email": "<found email or empty string>", "phone": "<found phone or empty>",
    "linkedin": "<found linkedin url or empty>", "github": "<found github url or empty>", "portfolio": "<found portfolio url or empty>",
    "issues": ["only real problems, e.g. Phone number missing, LinkedIn URL malformed"]
  },
  "issues": [
    {
      "id": "short-kebab-slug",
      "category": "grammar"|"spelling"|"weak-verb"|"duplicate"|"long-sentence"|"vague"|"passive-voice"|"formatting"|"ats"|"keywords",
      "severity": "critical"|"high"|"medium"|"low",
      "quote": "a SHORT substring copied VERBATIM from the resume text above (under 25 words), character-for-character exact — used to locate and highlight it, so it must match exactly or be omitted",
      "explanation": "why this matters, one to two sentences",
      "suggestion": "the concrete fix — a rewritten sentence, correct spelling, a stronger verb, etc.",
      "scoreImpact": <negative integer, -1 to -5, how many points this issue costs>
    }
    ... every real issue found, most severe first. No artificial cap, but never invent filler issues to pad the list.
  ],
  "achievementStats": {
    "quantifiedCount": <experience/project bullets containing a real metric: %, number, currency>,
    "totalBullets": <total experience+project bullets found>,
    "strongCount": <bullets that are specific, quantified, achievement-focused>,
    "moderateCount": <bullets that are reasonable but generic or unquantified>,
    "weakCount": <vague responsibility statements, e.g. "Worked on X">
  },
  "sectionScores": {
    "atsCompatibility": <0-100 — standard headers, no evidence of tables/columns/images/icons/text-boxes complicating parsing>,
    "formatting": <0-100 — consistency of bullet style, spacing, date formats>,
    "grammar": <0-100, reflecting the grammar issues actually found>,
    "spelling": <0-100, reflecting the spelling issues actually found>,
    "structure": <0-100 — do sections follow the recruiter-preferred order: Header, Summary, Skills, Experience, Projects, Education, Certifications, Achievements, Languages>,
    "readability": <0-100 — sentence length, passive voice %, jargon density, clarity>,
    "keywords": <0-100 — relevant role/industry keyword presence; infer the target role from the resume itself>,
    "achievements": <0-100, derived from achievementStats — more quantified/strong bullets scores higher>,
    "experience": <0-100 — career progression, clarity of impact, ownership, relevance>,
    "projects": <0-100 — technical depth/clarity of project descriptions, or 100 if no projects section is expected for this resume's seniority>,
    "skills": <0-100 — relevance and organization, no obvious gaps for the apparent target role>,
    "length": <0-100, based on the word/page facts given above — 1-2 pages is ideal for most roles>
  },
  "strengths": ["short, specific, positive observation", ...up to 6],
  "weaknesses": ["short, specific, actionable observation", ...up to 6],
  "recruiterSummary": { "verdict": "ready"|"borderline"|"needs-work", "notes": "2-3 sentence realistic recruiter-style closing assessment" }
}

Be honest and specific. Every "quote" must be copied verbatim from the resume text so it can be located automatically — never paraphrase it. If you cannot find an exact quote for an issue, omit that issue entirely rather than guessing.

RESUME TEXT:
"""
{{RESUME_TEXT}}
"""`;

function emptyCheckerResult(resumeText, stats) {
  const sectionScores = Object.fromEntries(CHECKER_SECTION_KEYS.map(k => [k, 0]));
  return {
    resumeText, sectionsDetected: [], sectionsMissing: [],
    contactInfo: { email: "", phone: "", linkedin: "", github: "", portfolio: "", issues: [] },
    issues: [], achievementStats: { quantifiedCount: 0, totalBullets: 0, strongCount: 0, moderateCount: 0, weakCount: 0 },
    sectionScores, overallScore: 0, lengthStats: stats,
    strengths: [], weaknesses: [], recruiterSummary: { verdict: "needs-work", notes: "" },
  };
}

/** @param {{ resumeText: string }} params */
const analyzeUploadedResume = async ({ resumeText }) => {
  const text = (resumeText || "").slice(0, CHECKER_MAX_CHARS);
  const stats = computeLocalStats(text);
  if (!text.trim() || stats.wordCount < 30) return emptyCheckerResult(text, stats);

  const prompt = ATS_CHECKER_PROMPT
    .replace("{{STATS_JSON}}", JSON.stringify(stats))
    .replace("{{RESUME_TEXT}}", text);

  let raw;
  try {
    raw = await ask(prompt);
  } catch (err) {
    logger.warn("[ATS Checker] Gemini request failed:", err.message);
    return emptyCheckerResult(text, stats);
  }

  let parsed;
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(clean);
  } catch (err) {
    logger.warn("[ATS Checker] Could not parse Gemini JSON response:", err.message);
    return emptyCheckerResult(text, stats);
  }

  const sectionScores = {};
  for (const key of CHECKER_SECTION_KEYS) sectionScores[key] = clampScore(parsed?.sectionScores?.[key]);
  const overallScore = computeOverallScore(sectionScores);

  const issues = Array.isArray(parsed.issues)
    ? parsed.issues
        .filter(i => i && typeof i.quote === "string" && i.quote.trim() && ISSUE_CATEGORIES.has(i.category))
        .slice(0, 60)
        .map((i, idx) => ({
          id: (typeof i.id === "string" && i.id.trim()) ? i.id.trim().slice(0, 60) : `issue-${idx}`,
          category: i.category,
          severity: ISSUE_SEVERITIES.has(i.severity) ? i.severity : "medium",
          quote: i.quote.trim().slice(0, 220),
          explanation: typeof i.explanation === "string" ? i.explanation.trim().slice(0, 400) : "",
          suggestion: typeof i.suggestion === "string" ? i.suggestion.trim().slice(0, 400) : "",
          scoreImpact: Number.isFinite(Number(i.scoreImpact)) ? Math.max(-10, Math.min(0, Math.round(Number(i.scoreImpact)))) : -1,
        }))
    : [];

  const sectionsMissing = Array.isArray(parsed.sectionsMissing)
    ? parsed.sectionsMissing
        .filter(s => s && typeof s.name === "string" && s.name.trim())
        .slice(0, 12)
        .map(s => ({
          name: s.name.trim().slice(0, 60),
          impact: ISSUE_SEVERITIES.has(s.impact) ? s.impact : "medium",
          recommendation: typeof s.recommendation === "string" ? s.recommendation.trim().slice(0, 300) : "",
        }))
    : [];

  const ci = parsed.contactInfo || {};
  const contactInfo = {
    email: typeof ci.email === "string" ? ci.email.trim().slice(0, 150) : "",
    phone: typeof ci.phone === "string" ? ci.phone.trim().slice(0, 40) : "",
    linkedin: typeof ci.linkedin === "string" ? ci.linkedin.trim().slice(0, 200) : "",
    github: typeof ci.github === "string" ? ci.github.trim().slice(0, 200) : "",
    portfolio: typeof ci.portfolio === "string" ? ci.portfolio.trim().slice(0, 200) : "",
    issues: sanitizeStringArray(ci.issues, 8, 150),
  };

  const as = parsed.achievementStats || {};
  const toInt = (v) => Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0;
  const achievementStats = {
    quantifiedCount: toInt(as.quantifiedCount), totalBullets: toInt(as.totalBullets),
    strongCount: toInt(as.strongCount), moderateCount: toInt(as.moderateCount), weakCount: toInt(as.weakCount),
  };

  const recruiterSummary = {
    verdict: VERDICTS.has(parsed?.recruiterSummary?.verdict) ? parsed.recruiterSummary.verdict : "needs-work",
    notes: typeof parsed?.recruiterSummary?.notes === "string" ? parsed.recruiterSummary.notes.trim().slice(0, 500) : "",
  };

  return {
    resumeText: text,
    sectionsDetected: sanitizeStringArray(parsed.sectionsDetected, 12, 40),
    sectionsMissing,
    contactInfo,
    issues,
    achievementStats,
    sectionScores,
    overallScore,
    lengthStats: stats,
    strengths: sanitizeStringArray(parsed.strengths, 6),
    weaknesses: sanitizeStringArray(parsed.weaknesses, 6),
    recruiterSummary,
  };
};

// ── Portfolio Bio / About Generation ─────────────────────────────────────────
const generatePortfolioBio = async ({ name, role, skills, tone = "professional" }) => {
  const skillsText = Array.isArray(skills) ? skills.slice(0, 10).join(", ") : skills || "";

  const prompt = `You are an expert personal-brand copywriter writing a portfolio "About" bio.

Name: ${name || "the candidate"}
Role/title: ${role || "professional"}
Key skills: ${skillsText}
Tone: ${tone}

Write a compelling first-person portfolio bio (2-3 short paragraphs, under 150 words total). Highlight expertise and what makes them stand out. No placeholders, no headings — just the finished bio text.

Return ONLY the bio text. No explanation, no markdown, no quotes.`;

  const bio = (await ask(prompt)).trim();
  return { bio };
};

// ── Portfolio Project Description Generation ─────────────────────────────────
const generatePortfolioProjectDescription = async ({ title, techStack, summary }) => {
  const techText = Array.isArray(techStack) ? techStack.slice(0, 10).join(", ") : techStack || "";

  const prompt = `You are an expert portfolio copywriter writing a project description for a developer/designer portfolio.

Project title: ${title || "this project"}
Tech stack: ${techText}
Notes from the author: ${(summary || "").slice(0, 500)}

Write a concise, compelling project description (2-4 sentences, under 60 words) that explains what it does and the impact/outcome. Be specific, not generic marketing fluff.

Return ONLY the description text. No explanation, no markdown, no quotes.`;

  const description = (await ask(prompt)).trim();
  return { description };
};

// ── Portfolio Text Rewrite (AI assist popover: improve/shorten/expand/tone) ──
const PORTFOLIO_REWRITE_PROMPTS = {
  improve: (text) => `You are a portfolio copy editor. Improve the clarity, flow, and impact of the following portfolio text while keeping the facts and meaning unchanged.\n\nText:\n${text}\n\nReturn ONLY the improved text. No explanation, no markdown, no quotes.`,
  shorten: (text) => `You are a portfolio copy editor. Rewrite the following portfolio text to be noticeably more concise while keeping every key fact.\n\nText:\n${text}\n\nReturn ONLY the shortened text. No explanation, no markdown, no quotes.`,
  expand:  (text) => `You are a portfolio copywriter. Expand the following portfolio text with more specific, realistic detail while staying truthful to what's given.\n\nText:\n${text}\n\nReturn ONLY the expanded text. No explanation, no markdown, no quotes.`,
  professional: (text) => `You are a portfolio copywriter. Rewrite the following text in a polished, professional tone.\n\nText:\n${text}\n\nReturn ONLY the rewritten text. No explanation, no markdown, no quotes.`,
  casual: (text) => `You are a portfolio copywriter. Rewrite the following text in a warmer, more casual and personable tone, while staying credible.\n\nText:\n${text}\n\nReturn ONLY the rewritten text. No explanation, no markdown, no quotes.`,
  grammar: (text) => `You are a meticulous copy editor. Fix all grammar, spelling, and punctuation errors in the following portfolio text. Keep the meaning and tone unchanged.\n\nText:\n${text}\n\nReturn ONLY the corrected text. No explanation, no markdown, no quotes.`,
};

const rewritePortfolioText = async ({ mode, text }) => {
  const builder = PORTFOLIO_REWRITE_PROMPTS[mode];
  if (!builder) throw new Error(`Unsupported rewrite mode: ${mode}`);
  const prompt = builder(text.slice(0, 3000));
  const result = (await ask(prompt)).trim();
  return { result };
};

module.exports = {
  summarizePdf,
  chatWithPdf,
  extractKeywords,
  extractFormData,
  generateResumeBullets,
  generateCoverLetter,
  transformResumeText,
  analyzeResumeAts,
  extractPdfText,
  extractDocxText,
  analyzeUploadedResume,
  generatePortfolioBio,
  generatePortfolioProjectDescription,
  rewritePortfolioText,
};
