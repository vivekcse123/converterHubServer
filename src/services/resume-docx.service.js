"use strict";

const { Document, Paragraph, TextRun, BorderStyle, Packer } = require("docx");

// Approximate per-template accent color, mirrored from the PDF export's
// `TEMPLATE_STYLES` in `resume-pdf.service.js`, so a Word download and a PDF
// download of the same resume agree on brand color.
const TEMPLATE_ACCENTS = {
  "ats-professional":    "334155",
  "modern-professional": "1e40af",
  "fresher":             "047857",
  "executive":           "334155",
  "tech":                "059669",
  "elegant":             "e11d48",
  "creative":            "6d28d9",
  "bold":                "5b21b6",
  "compact":             "1d4ed8",
  "minimal":             "374151",
};

function formatDate(str) {
  if (!str) return "";
  if (/present/i.test(str)) return "Present";
  return str;
}

function accentFor(resume, templateId) {
  const custom = resume?.design?.accentColor;
  if (custom && /^#[0-9a-fA-F]{6}$/.test(custom)) return custom.slice(1);
  return TEMPLATE_ACCENTS[templateId] || "374151";
}

function heading(title, accent) {
  return new Paragraph({
    spacing: { before: 260, after: 100 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: accent, space: 4 } },
    children: [
      new TextRun({ text: title.toUpperCase(), bold: true, size: 20, color: accent, font: "Calibri" }),
    ],
  });
}

function bodyPara(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 120 },
    children: [new TextRun({ text, size: 21, font: "Calibri", ...opts.run })],
  });
}

function bulletPara(text) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, size: 21, font: "Calibri" })],
  });
}

/** Builds a clean, ATS-friendly Word document from the resume's structured data
 *  (not a pixel-for-pixel copy of the chosen visual template — a plain, well
 *  formatted export, matching what most resume builders offer as a Word download). */
function buildDocxDocument(resume, templateId) {
  const p = resume.personal || {};
  const accent = accentFor(resume, templateId);
  const children = [];

  // ── Header ──────────────────────────────────────────────────────────────
  children.push(
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: p.fullName || "Your Name", bold: true, size: 40, font: "Calibri", color: "111827" })],
    }),
  );
  if (p.jobTitle) {
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: p.jobTitle, bold: true, size: 22, font: "Calibri", color: accent })],
    }));
  }
  const contactParts = [p.email, p.phone, p.location].filter(Boolean);
  if (contactParts.length) {
    children.push(bodyPara(contactParts.join("   •   "), { after: 20, run: { size: 18, color: "6B7280" } }));
  }
  const socialParts = [p.linkedin, p.github, p.portfolio].filter(Boolean);
  if (socialParts.length) {
    children.push(bodyPara(socialParts.join("   •   "), { after: 200, run: { size: 18, color: "6B7280" } }));
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  if (resume.summary?.trim()) {
    children.push(heading("Professional Summary", accent));
    children.push(bodyPara(resume.summary));
  }

  // ── Experience ──────────────────────────────────────────────────────────
  if (resume.experience?.length) {
    children.push(heading("Work Experience", accent));
    for (const exp of resume.experience) {
      if (!exp.role && !exp.company) continue;
      const dateStr = [formatDate(exp.startDate), formatDate(exp.endDate)].filter(Boolean).join(" – ");
      const titleLine = [exp.role, exp.company].filter(Boolean).join("  •  ");
      children.push(new Paragraph({
        spacing: { after: 40 },
        tabStops: [{ type: "right", position: 9020 }],
        children: [
          new TextRun({ text: titleLine, bold: true, size: 21, font: "Calibri" }),
          new TextRun({ text: `\t${dateStr}`, size: 18, font: "Calibri", color: "6B7280" }),
        ],
      }));
      for (const bullet of exp.bullets || []) {
        if (bullet) children.push(bulletPara(bullet));
      }
      children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    }
  }

  // ── Education ───────────────────────────────────────────────────────────
  if (resume.education?.length) {
    children.push(heading("Education", accent));
    for (const edu of resume.education) {
      if (!edu.institution && !edu.degree) continue;
      const dateStr = [formatDate(edu.startDate), formatDate(edu.endDate)].filter(Boolean).join(" – ");
      const degreeText = [edu.degree, edu.field].filter(Boolean).join(", ");
      const titleLine = [edu.institution, degreeText].filter(Boolean).join("  •  ");
      children.push(new Paragraph({
        spacing: { after: edu.description?.trim() ? 40 : 120 },
        tabStops: [{ type: "right", position: 9020 }],
        children: [
          new TextRun({ text: titleLine, bold: true, size: 21, font: "Calibri" }),
          new TextRun({ text: `\t${dateStr}`, size: 18, font: "Calibri", color: "6B7280" }),
        ],
      }));
      if (edu.description?.trim()) children.push(bodyPara(edu.description, { after: 120 }));
    }
  }

  // ── Projects ────────────────────────────────────────────────────────────
  if (resume.projects?.length) {
    children.push(heading("Projects", accent));
    for (const proj of resume.projects) {
      if (!proj.name) continue;
      const dateStr = [formatDate(proj.startDate), formatDate(proj.endDate)].filter(Boolean).join(" – ");
      children.push(new Paragraph({
        spacing: { after: 40 },
        tabStops: [{ type: "right", position: 9020 }],
        children: [
          new TextRun({ text: proj.name, bold: true, size: 21, font: "Calibri" }),
          new TextRun({ text: `\t${dateStr}`, size: 18, font: "Calibri", color: "6B7280" }),
        ],
      }));
      for (const bullet of proj.bullets || []) {
        if (bullet) children.push(bulletPara(bullet));
      }
      if (proj.techStack?.trim()) children.push(bodyPara(`Tech: ${proj.techStack}`, { after: 120, run: { italics: true, color: "6B7280" } }));
      else children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    }
  }

  // ── Skills ──────────────────────────────────────────────────────────────
  if (resume.skills?.length) {
    children.push(heading("Skills", accent));
    for (const group of resume.skills) {
      if (!group.items?.length) continue;
      children.push(new Paragraph({
        spacing: { after: 60 },
        children: [
          ...(group.category ? [new TextRun({ text: `${group.category}: `, bold: true, size: 21, font: "Calibri" })] : []),
          new TextRun({ text: group.items.join(", "), size: 21, font: "Calibri" }),
        ],
      }));
    }
  }

  // ── Certifications ──────────────────────────────────────────────────────
  const certs = (resume.certifications || []).filter(c => c.name);
  if (certs.length) {
    children.push(heading("Certifications", accent));
    for (const cert of certs) {
      const parts = [cert.name, cert.issuer ? `by ${cert.issuer}` : null, cert.date || null].filter(Boolean);
      children.push(bodyPara(parts.join("  •  "), { after: 60 }));
    }
  }

  // ── Languages ───────────────────────────────────────────────────────────
  const langs = (resume.languages || []).filter(l => l.name);
  if (langs.length) {
    children.push(heading("Languages", accent));
    const langText = langs.map(l => l.proficiency ? `${l.name} (${l.proficiency})` : l.name).join("  •  ");
    children.push(bodyPara(langText, { after: 120 }));
  }

  // ── Achievements ────────────────────────────────────────────────────────
  const achievements = (resume.achievements || []).filter(Boolean);
  if (achievements.length) {
    children.push(heading("Achievements", accent));
    for (const a of achievements) children.push(bulletPara(a));
  }

  return new Document({
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } },
      children,
    }],
  });
}

async function generateDocxBuffer(resume, templateId) {
  const doc = buildDocxDocument(resume, templateId);
  return Packer.toBuffer(doc);
}

module.exports = { generateDocxBuffer };
