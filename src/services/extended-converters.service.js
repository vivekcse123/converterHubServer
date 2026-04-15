"use strict";
const fse = require("fs-extra");
const path = require("path");
const sharp = require("sharp");
const pdfParse = require("pdf-parse");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const PDFKit = require("pdfkit");
const { v4: uuidv4 } = require("uuid");
const { OUTPUT_DIR, PAGE_SIZES } = require("../config/constants");

// ── output helper ────────────────────────────────────────────────────────────
const outPath = (name) => path.join(OUTPUT_DIR, name);
const uid = () => uuidv4();

// ── PDF → TXT ────────────────────────────────────────────────────────────────
const pdfToTxt = async (pdfPath) => {
  const buf = await fse.readFile(pdfPath);
  const data = await pdfParse(buf);
  const fileName = `pdf-to-txt-${uid()}.txt`;
  const outputPath = outPath(fileName);
  await fse.writeFile(outputPath, data.text, "utf8");
  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size };
};

// ── PDF → Markdown ───────────────────────────────────────────────────────────
const pdfToMarkdown = async (pdfPath) => {
  const buf = await fse.readFile(pdfPath);
  const data = await pdfParse(buf);
  // Basic conversion: paragraph detection, line breaks → markdown
  const lines = data.text.split("\n");
  let md = "# Converted Document\n\n";
  let inPara = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inPara) {
        md += "\n\n";
        inPara = false;
      }
      continue;
    }
    // Heuristic: short ALL-CAPS lines → headings
    if (
      trimmed === trimmed.toUpperCase() &&
      trimmed.length < 80 &&
      trimmed.length > 2
    ) {
      md += `\n## ${trimmed}\n\n`;
      inPara = false;
    } else {
      md += (inPara ? " " : "") + trimmed;
      inPara = true;
    }
  }
  if (inPara) md += "\n";
  const fileName = `pdf-to-md-${uid()}.md`;
  const outputPath = outPath(fileName);
  await fse.writeFile(outputPath, md, "utf8");
  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size };
};

// ── PDF → JSON ───────────────────────────────────────────────────────────────
const pdfToJson = async (pdfPath) => {
  const buf = await fse.readFile(pdfPath);
  const data = await pdfParse(buf);
  const obj = {
    metadata: {
      pages: data.numpages,
      pdfVersion: data.info?.PDFFormatVersion,
      title: data.info?.Title,
      author: data.info?.Author,
    },
    content: data.text
      .split("\n\n")
      .filter(Boolean)
      .map((p) => p.trim()),
  };
  const fileName = `pdf-to-json-${uid()}.json`;
  const outputPath = outPath(fileName);
  await fse.writeFile(outputPath, JSON.stringify(obj, null, 2), "utf8");
  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size };
};

// ── PDF → XML ────────────────────────────────────────────────────────────────
const pdfToXml = async (pdfPath) => {
  const buf = await fse.readFile(pdfPath);
  const data = await pdfParse(buf);
  const paragraphs = data.text.split("\n\n").filter(Boolean);
  const xmlParagraphs = paragraphs
    .map((p) => `  <paragraph>${escapeXml(p.trim())}</paragraph>`)
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<document>\n  <metadata>\n    <pages>${data.numpages}</pages>\n    <title>${escapeXml(data.info?.Title || "")}</title>\n  </metadata>\n  <content>\n${xmlParagraphs}\n  </content>\n</document>`;
  const fileName = `pdf-to-xml-${uid()}.xml`;
  const outputPath = outPath(fileName);
  await fse.writeFile(outputPath, xml, "utf8");
  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size };
};

// ── PDF → CSV ────────────────────────────────────────────────────────────────
const pdfToCsv = async (pdfPath) => {
  const buf = await fse.readFile(pdfPath);
  const data = await pdfParse(buf);
  const lines = data.text.split("\n").filter((l) => l.trim());
  const rows = lines.map((line) => [`"${line.trim().replace(/"/g, '""')}"`]);
  const csv = ['"Line"', ...rows.map((r) => r.join(","))].join("\n");
  const fileName = `pdf-to-csv-${uid()}.csv`;
  const outputPath = outPath(fileName);
  await fse.writeFile(outputPath, csv, "utf8");
  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size };
};

// ── PDF → EPUB ───────────────────────────────────────────────────────────────
const pdfToEpub = async (
  pdfPath,
  { title = "Converted Document", author = "Converter Hub" } = {},
) => {
  const buf = await fse.readFile(pdfPath);
  const data = await pdfParse(buf);
  const paragraphs = data.text
    .split("\n\n")
    .filter((p) => p.trim().length > 10);
  const Epub = require("epub-gen-memory").default || require("epub-gen-memory");
  const content = paragraphs.map((p, i) => ({
    title: `Section ${i + 1}`,
    content: `<p>${p.replace(/\n/g, " ").trim()}</p>`,
  }));
  const epubBuf = await Epub({ title, author, content });
  const fileName = `epub-${uid()}.epub`;
  const outputPath = outPath(fileName);
  await fse.writeFile(outputPath, Buffer.from(epubBuf));
  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size };
};

// ── PDF → PPTX ───────────────────────────────────────────────────────────────
const pdfToPptx = async (pdfPath) => {
  const pptxgen = require("pptxgenjs");
  const buf = await fse.readFile(pdfPath);
  const data = await pdfParse(buf);
  const paragraphs = data.text.split("\n\n").filter((p) => p.trim());

  const prs = new pptxgen();
  for (const para of paragraphs.slice(0, 20)) {
    // max 20 slides from text
    const slide = prs.addSlide();
    slide.addText(para.trim().slice(0, 500), {
      x: 0.5,
      y: 1,
      w: 9,
      h: 4,
      fontSize: 14,
      color: "363636",
      autoFit: true,
    });
  }
  const fileName = `pdf-to-pptx-${uid()}.pptx`;
  const outputPath = outPath(fileName);
  await prs.writeFile({ fileName: outputPath });
  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size };
};

// ── PDF → Excel ───────────────────────────────────────────────────────────────
const pdfToExcel = async (pdfPath) => {
  const ExcelJS = require("exceljs");
  const buf = await fse.readFile(pdfPath);
  const data = await pdfParse(buf);
  const lines = data.text.split("\n").filter((l) => l.trim());
  const rows = lines.map((line) =>
    line.split(/\s{2,}|\t/).map((c) => c.trim()),
  );
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  rows.forEach((row) => ws.addRow(row));
  const fileName = `pdf-to-excel-${uid()}.xlsx`;
  const outputPath = outPath(fileName);
  await wb.xlsx.writeFile(outputPath);
  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size };
};

// ── HEIC → JPG ────────────────────────────────────────────────────────────────
const heicToJpg = async (heicPath) => {
  const heicConvert = require("heic-convert");
  const inputBuf = await fse.readFile(heicPath);
  const output = await heicConvert({
    buffer: inputBuf,
    format: "JPEG",
    quality: 0.9,
  });
  const fileName = `heic-to-jpg-${uid()}.jpg`;
  const outputPath = outPath(fileName);
  await fse.writeFile(outputPath, Buffer.from(output));
  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size };
};

// ── GIF → PDF ────────────────────────────────────────────────────────────────
const gifToPdf = async (gifPath) => {
  const pdfDoc = await PDFDocument.create();
  const [pw, ph] = PAGE_SIZES.A4;
  // Extract all frames, embed each as a page
  const metadata = await sharp(gifPath).metadata();
  const frames = metadata.pages || 1;
  for (let i = 0; i < frames; i++) {
    const jpegBuf = await sharp(gifPath, { page: i })
      .jpeg({ quality: 85 })
      .toBuffer();
    const embImg = await pdfDoc.embedJpg(jpegBuf);
    const page = pdfDoc.addPage([pw, ph]);
    const scale = Math.min((pw - 40) / embImg.width, (ph - 40) / embImg.height);
    page.drawImage(embImg, {
      x: (pw - embImg.width * scale) / 2,
      y: (ph - embImg.height * scale) / 2,
      width: embImg.width * scale,
      height: embImg.height * scale,
    });
  }
  const fileName = `gif-to-pdf-${uid()}.pdf`;
  const outputPath = outPath(fileName);
  await fse.writeFile(outputPath, await pdfDoc.save());
  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size, frames };
};

// ── Markdown → PDF ────────────────────────────────────────────────────────────
const markdownToPdf = async (mdPath) => {
  const { marked } = require("marked");
  const mdText = await fse.readFile(mdPath, "utf8");
  const html = marked(mdText);
  return htmlToPdfFromString(html, "markdown-to-pdf");
};

// ── CSV → PDF ────────────────────────────────────────────────────────────────
const csvToPdf = async (csvPath) => {
  const { parse } = require("csv-parse/sync");
  const content = await fse.readFile(csvPath, "utf8");
  const records = parse(content, {
    skip_empty_lines: true,
    relax_column_count: true,
  });
  const fileName = `csv-to-pdf-${uid()}.pdf`;
  const outputPath = outPath(fileName);
  await new Promise((resolve, reject) => {
    const doc = new PDFKit({ margin: 30, size: "A4" });
    const stream = fse.createWriteStream(outputPath);
    doc.pipe(stream);
    doc.font("Helvetica-Bold").fontSize(10);
    const colWidth =
      (doc.page.width - 60) / Math.max((records[0] || []).length, 1);
    for (let r = 0; r < records.length; r++) {
      const row = records[r];
      if (r === 0) {
        doc.font("Helvetica-Bold");
      } else {
        doc.font("Helvetica");
      }
      let x = 30;
      for (const cell of row) {
        doc.text(String(cell).slice(0, 30), x, doc.y, {
          width: colWidth - 4,
          ellipsis: true,
        });
        x += colWidth;
      }
      doc.moveDown(0.3);
      if (r === 0)
        doc
          .moveTo(30, doc.y)
          .lineTo(doc.page.width - 30, doc.y)
          .stroke()
          .moveDown(0.3);
      if (doc.y > doc.page.height - 60) doc.addPage();
    }
    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size };
};

// ── HTML → PDF ────────────────────────────────────────────────────────────────
const htmlToPdf = async (htmlPath) => {
  const html = await fse.readFile(htmlPath, "utf8");
  return htmlToPdfFromString(html, "html-to-pdf");
};

const htmlToPdfFromString = async (html, prefix) => {
  const fileName = `${prefix}-${uid()}.pdf`;
  const outputPath = outPath(fileName);
  // Simple HTML → PDF via text extraction + PDFKit
  const cheerio = require("cheerio");
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ").trim();
  await new Promise((resolve, reject) => {
    const doc = new PDFKit({ margin: 50 });
    const stream = fse.createWriteStream(outputPath);
    doc.pipe(stream);
    doc
      .font("Helvetica")
      .fontSize(12)
      .fillColor("#333")
      .text(text, { align: "left", lineGap: 4 });
    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size };
};

// ── SVG → PDF ────────────────────────────────────────────────────────────────
const svgToPdf = async (svgPath) => {
  const svgContent = await fse.readFile(svgPath, "utf8");
  const fileName = `svg-to-pdf-${uid()}.pdf`;
  const outputPath = outPath(fileName);
  // Convert SVG to PNG first using sharp, then embed in PDF
  const pngBuf = await sharp(Buffer.from(svgContent)).png().toBuffer();
  const pdfDoc = await PDFDocument.create();
  const embImg = await pdfDoc.embedPng(pngBuf);
  const [pw, ph] = PAGE_SIZES.A4;
  const scale = Math.min((pw - 40) / embImg.width, (ph - 40) / embImg.height);
  const page = pdfDoc.addPage([pw, ph]);
  page.drawImage(embImg, {
    x: (pw - embImg.width * scale) / 2,
    y: (ph - embImg.height * scale) / 2,
    width: embImg.width * scale,
    height: embImg.height * scale,
  });
  await fse.writeFile(outputPath, await pdfDoc.save());
  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size };
};

// ─── helpers ─────────────────────────────────────────────────────────────────
const escapeXml = (str) =>
  String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

module.exports = {
  pdfToTxt,
  pdfToMarkdown,
  pdfToJson,
  pdfToXml,
  pdfToCsv,
  pdfToEpub,
  pdfToPptx,
  pdfToExcel,
  heicToJpg,
  gifToPdf,
  markdownToPdf,
  csvToPdf,
  htmlToPdf,
  svgToPdf,
};
