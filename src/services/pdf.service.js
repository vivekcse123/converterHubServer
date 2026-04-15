"use strict";

const { PDFDocument, rgb, StandardFonts, degrees } = require("pdf-lib");
const PDFKit = require("pdfkit");
const sharp = require("sharp");
const fse = require("fs-extra");
const path = require("path");
const mammoth = require("mammoth");
const { v4: uuidv4 } = require("uuid");
const { OUTPUT_DIR, PAGE_SIZES } = require("../config/constants");

// ─── Image → PDF ─────────────────────────────────────────────────────────────

/**
 * Convert one or more image files into a single PDF.
 * @param {string[]} imagePaths
 * @param {{ pageSize?: string, orientation?: 'portrait'|'landscape', margin?: number }} opts
 */
const imagesToPdf = async (imagePaths, opts = {}) => {
  const { pageSize = "A4", orientation = "portrait", margin = 20 } = opts;
  const pdfDoc = await PDFDocument.create();
  const [pw, ph] = PAGE_SIZES[pageSize] || PAGE_SIZES.A4;

  for (const imgPath of imagePaths) {
    // Convert to JPEG via sharp for universal compatibility
    const jpegBuf = await sharp(imgPath).jpeg({ quality: 90 }).toBuffer();
    const embImg = await pdfDoc.embedJpg(jpegBuf);

    const isLandscape = orientation === "landscape";
    const pageW = isLandscape ? ph : pw;
    const pageH = isLandscape ? pw : ph;

    const page = pdfDoc.addPage([pageW, pageH]);
    const maxW = pageW - margin * 2;
    const maxH = pageH - margin * 2;

    // Scale image to fit within the page with margins
    const scale = Math.min(maxW / embImg.width, maxH / embImg.height);
    const imgW = embImg.width * scale;
    const imgH = embImg.height * scale;
    const x = (pageW - imgW) / 2;
    const y = (pageH - imgH) / 2;

    page.drawImage(embImg, { x, y, width: imgW, height: imgH });
  }

  const pdfBytes = await pdfDoc.save();
  const fileName = `image-to-pdf-${uuidv4()}.pdf`;
  const outputPath = path.join(OUTPUT_DIR, fileName);
  await fse.writeFile(outputPath, pdfBytes);

  return { outputPath, fileName };
};

// ─── PDF Merge ────────────────────────────────────────────────────────────────

/**
 * Merge multiple PDF files into one.
 */
const mergePdfs = async (pdfPaths) => {
  const merged = await PDFDocument.create();

  for (const pdfPath of pdfPaths) {
    const srcBytes = await fse.readFile(pdfPath);
    const srcDoc = await PDFDocument.load(srcBytes);
    const pages = await merged.copyPages(srcDoc, srcDoc.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }

  const pdfBytes = await merged.save();
  const fileName = `merged-${uuidv4()}.pdf`;
  const outputPath = path.join(OUTPUT_DIR, fileName);
  await fse.writeFile(outputPath, pdfBytes);

  return { outputPath, fileName };
};

// ─── PDF Split ────────────────────────────────────────────────────────────────

/**
 * Split a PDF into separate pages and return them as a ZIP (handled in compression service).
 * This function returns an array of single-page PDFs.
 */
const splitPdf = async (pdfPath, pageRanges = null) => {
  const srcBytes = await fse.readFile(pdfPath);
  const srcDoc = await PDFDocument.load(srcBytes);
  const total = srcDoc.getPageCount();

  // pageRanges: array of [start, end] 1-indexed inclusive, or null for all pages
  const ranges =
    pageRanges || Array.from({ length: total }, (_, i) => [i + 1, i + 1]);

  const outputFiles = [];
  for (const [start, end] of ranges) {
    const newDoc = await PDFDocument.create();
    for (let i = start - 1; i < end && i < total; i++) {
      const [page] = await newDoc.copyPages(srcDoc, [i]);
      newDoc.addPage(page);
    }
    const bytes = await newDoc.save();
    const fileName = `page-${start}-${end}-${uuidv4()}.pdf`;
    const filePath = path.join(OUTPUT_DIR, fileName);
    await fse.writeFile(filePath, bytes);
    outputFiles.push({ fileName, filePath });
  }

  return outputFiles;
};

// ─── PDF Compress ─────────────────────────────────────────────────────────────

/**
 * Basic PDF compression (removes unnecessary metadata).
 * Note: Deep compression (re-encoding fonts/images) requires Ghostscript.
 */
const compressPdf = async (pdfPath) => {
  const srcBytes = await fse.readFile(pdfPath);
  const pdfDoc = await PDFDocument.load(srcBytes, { updateMetadata: false });

  // Remove creator/producer metadata to reduce size
  pdfDoc.setCreator("Converter Hub");
  pdfDoc.setProducer("Converter Hub");
  pdfDoc.setTitle("");
  pdfDoc.setSubject("");
  pdfDoc.setKeywords([]);

  const compressed = await pdfDoc.save({ useObjectStreams: true });
  const fileName = `compressed-${uuidv4()}.pdf`;
  const outputPath = path.join(OUTPUT_DIR, fileName);
  await fse.writeFile(outputPath, compressed);

  const [origStat, newStat] = await Promise.all([
    fse.stat(pdfPath),
    fse.stat(outputPath),
  ]);

  return {
    outputPath,
    fileName,
    originalSize: origStat.size,
    newSize: newStat.size,
  };
};

// ─── Text → PDF ───────────────────────────────────────────────────────────────

/**
 * Convert a plain-text string (or file path) to a PDF.
 */
const textToPdf = async (text) => {
  const fileName = `text-to-pdf-${uuidv4()}.pdf`;
  const outputPath = path.join(OUTPUT_DIR, fileName);

  await new Promise((resolve, reject) => {
    const doc = new PDFKit({ margin: 50 });
    const stream = fse.createWriteStream(outputPath);
    doc.pipe(stream);
    doc
      .font("Helvetica")
      .fontSize(12)
      .fillColor("#333333")
      .text(text, { align: "left", lineGap: 4 });
    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return { outputPath, fileName };
};

// ─── Word → PDF (basic via html) ───────────────────────────────────────────────

/**
 * Extract text from a DOCX file and convert to PDF.
 * For full fidelity conversion, use LibreOffice (see README).
 */
const wordToPdf = async (docxPath) => {
  const result = await mammoth.extractRawText({ path: docxPath });
  return textToPdf(result.value);
};

// ─── PDF → Word (text extraction) ─────────────────────────────────────────────

/**
 * Extract text from a PDF and generate a basic DOCX.
 */
const pdfToWord = async (pdfPath) => {
  const pdfParse = require("pdf-parse");
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
  } = require("docx");

  const pdfBuffer = await fse.readFile(pdfPath);
  const pdfData = await pdfParse(pdfBuffer);
  const lines = pdfData.text.split("\n").filter((l) => l.trim());

  const paragraphs = lines.map(
    (line) =>
      new Paragraph({
        children: [new TextRun({ text: line, size: 24 })],
        spacing: { after: 200 },
      }),
  );

  const doc = new Document({ sections: [{ children: paragraphs }] });
  const buf = await Packer.toBuffer(doc);

  const fileName = `pdf-to-word-${uuidv4()}.docx`;
  const outputPath = path.join(OUTPUT_DIR, fileName);
  await fse.writeFile(outputPath, buf);

  return { outputPath, fileName };
};

module.exports = {
  imagesToPdf,
  mergePdfs,
  splitPdf,
  compressPdf,
  textToPdf,
  wordToPdf,
  pdfToWord,
};
