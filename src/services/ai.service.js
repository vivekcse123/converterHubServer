"use strict";
const fse = require("fs-extra");
const path = require("path");
const pdfParse = require("pdf-parse");
const { v4: uuidv4 } = require("uuid");
const { OUTPUT_DIR } = require("../config/constants");
const logger = require("../utils/logger");

// Lazy-load OpenAI to avoid failures when OPENAI_API_KEY is not set
let openaiClient = null;
const getOpenAI = () => {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY)
      throw new Error("OPENAI_API_KEY is not configured");
    const { OpenAI } = require("openai");
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
};

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_CONTEXT_CHARS = 12_000; // ~3000 tokens

// ── Extract text from PDF for AI context ────────────────────────────────────
const extractPdfText = async (pdfPath) => {
  const buf = await fse.readFile(pdfPath);
  const data = await pdfParse(buf);
  return data.text.slice(0, MAX_CONTEXT_CHARS);
};

// ── Summarize PDF ────────────────────────────────────────────────────────────
const summarizePdf = async (
  pdfPath,
  { length = "medium", language = "English" } = {},
) => {
  const text = await extractPdfText(pdfPath);
  const wordCount = { short: 100, medium: 250, long: 500 }[length] || 250;
  const ai = getOpenAI();
  const result = await ai.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: `You are a document analysis assistant. Summarize the following document in approximately ${wordCount} words in ${language}. Focus on key points, conclusions, and important details.`,
      },
      { role: "user", content: text },
    ],
    max_tokens: 1000,
    temperature: 0.3,
  });
  const summary = result.choices[0].message.content;
  const tokensUsed = result.usage?.total_tokens || 0;

  // Save as TXT
  const fileName = `summary-${uuidv4()}.txt`;
  const outputPath = path.join(OUTPUT_DIR, fileName);
  await fse.writeFile(outputPath, summary, "utf8");
  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size, summary, tokensUsed };
};

// ── Chat with PDF ────────────────────────────────────────────────────────────
// For chat, we return just the answer (no file output)
const chatWithPdf = async (pdfPath, question, conversationHistory = []) => {
  const text = await extractPdfText(pdfPath);
  const ai = getOpenAI();
  const messages = [
    {
      role: "system",
      content: `You are a helpful assistant answering questions about the following document:\n\n---\n${text}\n---\n\nAnswer based only on the document content. If the answer is not in the document, say so.`,
    },
    ...conversationHistory,
    { role: "user", content: question },
  ];
  const result = await ai.chat.completions.create({
    model: MODEL,
    messages,
    max_tokens: 800,
    temperature: 0.2,
  });
  const answer = result.choices[0].message.content;
  const tokensUsed = result.usage?.total_tokens || 0;
  return { answer, tokensUsed };
};

// ── Extract Keywords ─────────────────────────────────────────────────────────
const extractKeywords = async (pdfPath) => {
  const text = await extractPdfText(pdfPath);
  const ai = getOpenAI();
  const result = await ai.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "Extract the 20 most important keywords and key phrases from this document. Return them as a JSON array of strings. No explanation, just the JSON array.",
      },
      { role: "user", content: text },
    ],
    max_tokens: 500,
    temperature: 0.1,
    response_format: { type: "json_object" },
  });
  let keywords = [];
  try {
    const parsed = JSON.parse(result.choices[0].message.content);
    keywords =
      parsed.keywords || parsed.key_phrases || Object.values(parsed)[0] || [];
  } catch {
    keywords = [];
  }
  const tokensUsed = result.usage?.total_tokens || 0;

  const fileName = `keywords-${uuidv4()}.json`;
  const outputPath = path.join(OUTPUT_DIR, fileName);
  await fse.writeFile(
    outputPath,
    JSON.stringify({ keywords }, null, 2),
    "utf8",
  );
  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size, keywords, tokensUsed };
};

// ── Auto Form Fill from PDF ──────────────────────────────────────────────────
const extractFormData = async (pdfPath) => {
  const text = await extractPdfText(pdfPath);
  const ai = getOpenAI();
  const result = await ai.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "Extract all form field data from this document. Return a JSON object with field names as keys and extracted values as values. Common fields include: name, email, date, address, phone, etc.",
      },
      { role: "user", content: text },
    ],
    max_tokens: 800,
    temperature: 0.1,
    response_format: { type: "json_object" },
  });
  let formData = {};
  try {
    formData = JSON.parse(result.choices[0].message.content);
  } catch {
    formData = {};
  }
  const tokensUsed = result.usage?.total_tokens || 0;

  const fileName = `form-data-${uuidv4()}.json`;
  const outputPath = path.join(OUTPUT_DIR, fileName);
  await fse.writeFile(outputPath, JSON.stringify(formData, null, 2), "utf8");
  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size, formData, tokensUsed };
};

module.exports = {
  summarizePdf,
  chatWithPdf,
  extractKeywords,
  extractFormData,
};
