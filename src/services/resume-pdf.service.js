"use strict";
const PdfPrinter = require("pdfmake");

// Built-in Roboto fonts bundled with pdfmake
const fonts = {
  Roboto: {
    normal:      require.resolve("pdfmake/build/vfs_fonts.js").replace("vfs_fonts.js", "") + "/../fonts/Roboto-Regular.ttf",
    bold:        require.resolve("pdfmake/build/vfs_fonts.js").replace("vfs_fonts.js", "") + "/../fonts/Roboto-Medium.ttf",
    italics:     require.resolve("pdfmake/build/vfs_fonts.js").replace("vfs_fonts.js", "") + "/../fonts/Roboto-Italic.ttf",
    bolditalics: require.resolve("pdfmake/build/vfs_fonts.js").replace("vfs_fonts.js", "") + "/../fonts/Roboto-MediumItalic.ttf",
  },
};

// Use the VFS-based approach (fonts embedded in pdfmake's vfs) instead of file paths
const pdfMakeBrowser = (() => {
  try {
    const pdfMake = require("pdfmake/build/pdfmake");
    const vfsFonts = require("pdfmake/build/vfs_fonts");
    pdfMake.vfs = vfsFonts.pdfMake ? vfsFonts.pdfMake.vfs : vfsFonts.vfs || vfsFonts;
    return pdfMake;
  } catch (e) {
    return null;
  }
})();

// Template header styling
const TEMPLATE_STYLES = {
  "ats-professional":   { headerBg: "#1e293b", headerText: "#ffffff", accentColor: "#334155", border: true  },
  "modern-professional":{ headerBg: "#1d4ed8", headerText: "#ffffff", accentColor: "#1e40af", border: false },
  "fresher":            { headerBg: "#059669", headerText: "#ffffff", accentColor: "#047857", border: false },
  "executive":          { headerBg: "#1e293b", headerText: "#fbbf24", accentColor: "#334155", border: false },
  "tech":               { headerBg: "#0f172a", headerText: "#34d399", accentColor: "#059669", border: false },
  "elegant":            { headerBg: "#f43f5e", headerText: "#ffffff", accentColor: "#e11d48", border: false },
  "creative":           { headerBg: "#7c3aed", headerText: "#ffffff", accentColor: "#6d28d9", border: false },
  "bold":               { headerBg: "#6d28d9", headerText: "#ffffff", accentColor: "#5b21b6", border: false },
  "compact":            { headerBg: "#2563eb", headerText: "#ffffff", accentColor: "#1d4ed8", border: false },
  "minimal":            { headerBg: "#ffffff", headerText: "#111827", accentColor: "#374151", border: true  },
};

const PREMIUM_TEMPLATE_IDS = ["ats-professional", "modern-professional", "tech"];

function formatDate(str) {
  if (!str) return "";
  if (/present/i.test(str)) return "Present";
  return str;
}

function sectionHeader(title, style) {
  const accent = style.accentColor;
  return [
    { text: title.toUpperCase(), style: "sectionHeader", color: accent },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: accent }] },
    { text: "", margin: [0, 4, 0, 0] },
  ];
}

function buildDocDef(resume, isPro, templateId) {
  const style  = TEMPLATE_STYLES[templateId] || TEMPLATE_STYLES["minimal"];
  const p      = resume.personal || {};
  const content = [];

  // ── Header ─────────────────────────────────────────────────────────────────
  const contactParts = [p.email, p.phone, p.location].filter(Boolean);
  const socialParts  = [
    p.linkedin ? `LinkedIn: ${p.linkedin}` : null,
    p.github   ? `GitHub: ${p.github}`     : null,
    p.portfolio? `Portfolio: ${p.portfolio}`: null,
  ].filter(Boolean);

  const isMinimal = style.headerBg === "#ffffff";
  if (isMinimal) {
    content.push(
      { text: p.fullName || "Your Name",  style: "nameMinimal" },
      p.jobTitle ? { text: p.jobTitle, style: "jobTitleMinimal" } : null,
      contactParts.length ? { text: contactParts.join("  •  "), style: "contactMinimal" } : null,
      socialParts.length  ? { text: socialParts.join("  •  "),  style: "contactMinimal" } : null,
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: "#111827" }] },
      { text: "", margin: [0, 6, 0, 0] },
    );
  } else {
    const headerStack = [
      { text: p.fullName || "Your Name", style: "nameColored",    color: style.headerText },
      p.jobTitle ? { text: p.jobTitle,   style: "jobTitleColored", color: style.headerText } : null,
      contactParts.length ? { text: contactParts.join("  |  "), style: "contactColored", color: style.headerText } : null,
      socialParts.length  ? { text: socialParts.join("  |  "),  style: "contactColored", color: style.headerText } : null,
    ].filter(Boolean);
    content.push({
      table: { widths: ["*"], body: [[{ stack: headerStack, margin: [16, 12, 16, 12], fillColor: style.headerBg }]] },
      layout: "noBorders",
      margin: [0, 0, 0, 12],
    });
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  if (resume.summary?.trim()) {
    content.push(...sectionHeader("Professional Summary", style));
    content.push({ text: resume.summary, style: "body", margin: [0, 0, 0, 10] });
  }

  // ── Experience ──────────────────────────────────────────────────────────────
  if (resume.experience?.length) {
    content.push(...sectionHeader("Work Experience", style));
    for (const exp of resume.experience) {
      if (!exp.role && !exp.company) continue;
      const dateStr = [formatDate(exp.startDate), formatDate(exp.endDate)].filter(Boolean).join(" – ");
      content.push({
        columns: [
          { text: [{ text: exp.role || "", bold: true }, exp.company ? `  •  ${exp.company}` : ""], style: "entryTitle", width: "*" },
          { text: [dateStr, exp.location ? `\n${exp.location}` : ""].filter(Boolean).join(""), style: "dateRight", width: "auto" },
        ],
        columnGap: 8,
        margin: [0, 2, 0, 0],
      });
      if (exp.bullets?.length) {
        content.push({
          ul: exp.bullets.filter(Boolean),
          style: "bullet",
          margin: [8, 2, 0, 6],
        });
      } else {
        content.push({ text: "", margin: [0, 0, 0, 6] });
      }
    }
  }

  // ── Education ───────────────────────────────────────────────────────────────
  if (resume.education?.length) {
    content.push(...sectionHeader("Education", style));
    for (const edu of resume.education) {
      if (!edu.institution && !edu.degree) continue;
      const dateStr = [formatDate(edu.startDate), formatDate(edu.endDate)].filter(Boolean).join(" – ");
      const degreeText = [edu.degree, edu.field].filter(Boolean).join(", ");
      content.push({
        columns: [
          { text: [{ text: edu.institution || "", bold: true }, degreeText ? `  •  ${degreeText}` : ""], style: "entryTitle", width: "*" },
          { text: dateStr, style: "dateRight", width: "auto" },
        ],
        columnGap: 8,
        margin: [0, 2, 0, 0],
      });
      if (edu.description?.trim()) {
        content.push({ text: edu.description, style: "body", margin: [0, 2, 0, 6] });
      } else {
        content.push({ text: "", margin: [0, 0, 0, 6] });
      }
    }
  }

  // ── Projects ─────────────────────────────────────────────────────────────────
  if (resume.projects?.length) {
    content.push(...sectionHeader("Projects", style));
    for (const proj of resume.projects) {
      if (!proj.name) continue;
      const dateStr = [formatDate(proj.startDate), formatDate(proj.endDate)].filter(Boolean).join(" – ");
      content.push({
        columns: [
          { text: [{ text: proj.name, bold: true }, proj.url ? `  |  ${proj.url}` : ""], style: "entryTitle", width: "*" },
          { text: dateStr, style: "dateRight", width: "auto" },
        ],
        columnGap: 8,
        margin: [0, 2, 0, 0],
      });
      if (proj.bullets?.length) {
        content.push({ ul: proj.bullets.filter(Boolean), style: "bullet", margin: [8, 2, 0, 2] });
      }
      if (proj.techStack?.trim()) {
        content.push({ text: [{ text: "Tech: ", bold: true }, proj.techStack], style: "body", margin: [0, 2, 0, 6] });
      } else {
        content.push({ text: "", margin: [0, 0, 0, 6] });
      }
    }
  }

  // ── Skills ───────────────────────────────────────────────────────────────────
  if (resume.skills?.length) {
    content.push(...sectionHeader("Skills", style));
    for (const group of resume.skills) {
      if (!group.items?.length) continue;
      content.push({
        text: [
          group.category ? { text: `${group.category}: `, bold: true } : null,
          group.items.join(", "),
        ].filter(Boolean),
        style: "body",
        margin: [0, 2, 0, 3],
      });
    }
    content.push({ text: "", margin: [0, 0, 0, 6] });
  }

  // ── Certifications ───────────────────────────────────────────────────────────
  if (resume.certifications?.filter(c => c.name).length) {
    content.push(...sectionHeader("Certifications", style));
    for (const cert of resume.certifications) {
      if (!cert.name) continue;
      const parts = [cert.name, cert.issuer ? `by ${cert.issuer}` : null, cert.date || null].filter(Boolean);
      content.push({ text: parts.join("  •  "), style: "body", margin: [0, 2, 0, 3] });
    }
    content.push({ text: "", margin: [0, 0, 0, 4] });
  }

  // ── Languages ────────────────────────────────────────────────────────────────
  if (resume.languages?.filter(l => l.name).length) {
    content.push(...sectionHeader("Languages", style));
    const langText = resume.languages
      .filter(l => l.name)
      .map(l => l.proficiency ? `${l.name} (${l.proficiency})` : l.name)
      .join("  •  ");
    content.push({ text: langText, style: "body", margin: [0, 2, 0, 8] });
  }

  // ── Achievements ─────────────────────────────────────────────────────────────
  if (resume.achievements?.filter(Boolean).length) {
    content.push(...sectionHeader("Achievements", style));
    content.push({ ul: resume.achievements.filter(Boolean), style: "bullet", margin: [8, 2, 0, 8] });
  }

  // ── Interests ────────────────────────────────────────────────────────────────
  if (resume.interests?.filter(Boolean).length) {
    content.push(...sectionHeader("Interests", style));
    content.push({ text: resume.interests.filter(Boolean).join("  •  "), style: "body", margin: [0, 2, 0, 4] });
  }

  // ── Custom Sections ──────────────────────────────────────────────────────────
  if (resume.customSections?.length) {
    for (const section of resume.customSections) {
      if (!section.title || !section.entries?.length) continue;
      content.push(...sectionHeader(section.title, style));
      for (const entry of section.entries) {
        if (entry.heading) content.push({ text: entry.heading, bold: true, style: "entryTitle", margin: [0, 2, 0, 0] });
        if (entry.subheading) content.push({ text: entry.subheading, style: "body", italics: true });
        if (entry.description) content.push({ text: entry.description, style: "body", margin: [0, 0, 0, 6] });
      }
    }
  }

  // ── Document definition ──────────────────────────────────────────────────────
  const docDef = {
    pageSize: "A4",
    pageMargins: [36, 36, 36, 36],
    content: content.filter(Boolean),
    defaultStyle: { font: "Roboto", fontSize: 9, lineHeight: 1.3 },
    styles: {
      nameMinimal:     { fontSize: 22, bold: true, color: "#111827", margin: [0, 0, 0, 2] },
      jobTitleMinimal: { fontSize: 11, color: "#374151", margin: [0, 0, 0, 2] },
      contactMinimal:  { fontSize: 8,  color: "#6b7280", margin: [0, 0, 0, 2] },
      nameColored:     { fontSize: 20, bold: true },
      jobTitleColored: { fontSize: 10 },
      contactColored:  { fontSize: 8 },
      sectionHeader:   { fontSize: 9.5, bold: true, letterSpacing: 1.2, margin: [0, 8, 0, 3] },
      entryTitle:      { fontSize: 9.5, color: "#1e293b" },
      dateRight:       { fontSize: 8.5, color: "#6b7280", alignment: "right" },
      body:            { fontSize: 9,   color: "#374151" },
      bullet:          { fontSize: 9,   color: "#374151" },
    },
  };

  // Watermark for free users
  if (!isPro) {
    docDef.watermark = {
      text: "ApnaConverter.com  •  Free Version  •  Upgrade to Pro",
      color: "#94a3b8",
      opacity: 0.15,
      bold: true,
      fontSize: 14,
      angle: -45,
    };
  }

  return docDef;
}

/**
 * Generate PDF buffer for the given resume data.
 * @param {object} resume - Full resume data object
 * @param {string} templateId - Template identifier
 * @param {boolean} isPro - Whether the user has Pro subscription
 * @returns {Promise<Buffer>}
 */
function generatePdfBuffer(resume, templateId, isPro) {
  return new Promise((resolve, reject) => {
    try {
      const docDef = buildDocDef(resume, isPro, templateId);

      // Use the browser/vfs build of pdfmake that works in both environments
      if (pdfMakeBrowser) {
        const pdfDocGenerator = pdfMakeBrowser.createPdf(docDef);
        pdfDocGenerator.getBuffer((buffer) => resolve(Buffer.from(buffer)));
        return;
      }

      // Fallback: PdfPrinter with file-based fonts
      const printer = new PdfPrinter(fonts);
      const doc = printer.createPdfKitDocument(docDef);
      const chunks = [];
      doc.on("data",  (chunk) => chunks.push(chunk));
      doc.on("end",   () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generatePdfBuffer, PREMIUM_TEMPLATE_IDS };
