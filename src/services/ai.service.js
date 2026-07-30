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

module.exports = {
  summarizePdf,
  chatWithPdf,
  extractKeywords,
  extractFormData,
  generateResumeBullets,
  generateCoverLetter,
  transformResumeText,
};
