"use strict";
const fse = require("fs-extra");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { OUTPUT_DIR } = require("../config/constants");

// ── OCR: Extract searchable text from a PDF or image using Tesseract.js ───────
const performOCR = async (
  filePath,
  { lang = "eng", outputFormat = "pdf" } = {},
) => {
  const { createWorker } = require("tesseract.js");
  const worker = await createWorker(lang, 1, {
    logger: () => {}, // suppress console noise
    cachePath: path.join(__dirname, "../../.tessdata"),
  });

  let result;
  if (outputFormat === "txt") {
    const { data } = await worker.recognize(filePath);
    await worker.terminate();
    const fileName = `ocr-result-${uuidv4()}.txt`;
    const outputPath = path.join(OUTPUT_DIR, fileName);
    await fse.writeFile(outputPath, data.text, "utf8");
    const stat = await fse.stat(outputPath);
    return {
      outputPath,
      fileName,
      size: stat.size,
      text: data.text.slice(0, 500) + "…",
    };
  }

  // Default: return searchable text in a PDF (using pdfkit)
  const { data } = await worker.recognize(filePath);
  await worker.terminate();

  const PDFKit = require("pdfkit");
  const fileName = `ocr-result-${uuidv4()}.pdf`;
  const outputPath = path.join(OUTPUT_DIR, fileName);

  await new Promise((resolve, reject) => {
    const doc = new PDFKit({ margin: 50 });
    const stream = fse.createWriteStream(outputPath);
    doc.pipe(stream);
    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor("#333")
      .text("OCR Extracted Text", { align: "center", underline: true })
      .moveDown();
    doc.fontSize(10).text(data.text, { align: "left", lineGap: 3 });
    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size, confidence: data.confidence };
};

module.exports = { performOCR };
