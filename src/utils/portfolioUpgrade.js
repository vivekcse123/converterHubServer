"use strict";

/**
 * Lazy-upgrade helpers for the section-based Portfolio redesign.
 * There is no migration framework in this app, so old flat-field Portfolio
 * documents are upgraded to the new `sections`/`theme` shape on read, not via
 * a bulk migration script. These functions are pure — they never write to the
 * DB; the caller decides whether to persist the result (only on explicit
 * save/publish).
 */

const DEFAULT_THEME = {
  templateId:  "minimal",
  accentColor: "#4f46e5",
  fontFamily:  "inter",
  mode:        "dark",
  layoutWidth: "wide",
  radius:      "rounded",
};

/** Builds a default `sections` array from a legacy flat Portfolio document. */
function buildSectionsFromLegacy(doc) {
  const sections = [];
  let order = 0;

  sections.push({
    id: "hero", type: "hero", enabled: true, order: order++,
    config: {
      headline:         doc.displayName || doc.username || "",
      subheadline:      doc.tagline || "",
      photoUrl:         doc.photoUrl || "",
      ctaLabel:         "",
      ctaUrl:           "",
      resumeCtaEnabled: !!doc.pinnedResumeId,
    },
  });

  if (doc.about) {
    sections.push({
      id: "about", type: "about", enabled: true, order: order++,
      config: { body: doc.about, highlights: [] },
    });
  }

  if (Array.isArray(doc.skills) && doc.skills.length) {
    sections.push({
      id: "skills", type: "skills", enabled: true, order: order++,
      config: { groups: [{ label: "Skills", items: doc.skills.map(s => ({ name: s.name, level: s.level })) }] },
    });
  }

  if (Array.isArray(doc.projects) && doc.projects.length) {
    sections.push({
      id: "projects", type: "projects", enabled: true, order: order++,
      config: {
        items: doc.projects.map(p => ({
          title: p.title, description: p.description, imageUrl: p.imageUrl,
          url: p.url, githubUrl: p.githubUrl, tags: p.tags || [], featured: !!p.featured,
        })),
      },
    });
  }

  sections.push({
    id: "contact", type: "contact", enabled: true, order: order++,
    config: { showEmail: !!doc.email, showPhone: !!doc.phone, showSocial: true, ctaLabel: "Get in touch" },
  });

  return sections;
}

/** Returns a fully section-based snapshot built from a document's legacy flat fields. */
function upgradeLegacyPortfolio(doc) {
  return {
    username:        doc.username,
    isPublic:        doc.isPublic,
    displayName:     doc.displayName,
    tagline:         doc.tagline,
    about:           doc.about,
    photoUrl:        doc.photoUrl,
    location:        doc.location,
    email:           doc.email,
    phone:           doc.phone,
    social:          doc.social,
    pinnedResumeId:  doc.pinnedResumeId,
    metaTitle:       doc.metaTitle,
    metaDescription: doc.metaDescription,
    sections:        buildSectionsFromLegacy(doc),
    theme:           doc.theme && doc.theme.templateId ? doc.theme : DEFAULT_THEME,
  };
}

/** Ensures a lean portfolio doc has a populated `draft` blob (upgrading legacy fields if needed). */
function withDraft(doc) {
  if (!doc) return doc;
  if (doc.draft && Object.keys(doc.draft).length > 0) return doc;
  return { ...doc, draft: upgradeLegacyPortfolio(doc) };
}

/** Ensures a lean portfolio doc has a populated `published` blob (upgrading legacy fields if needed). */
function withPublished(doc) {
  if (!doc) return doc;
  if (doc.published && Object.keys(doc.published).length > 0) return doc;
  return { ...doc, published: upgradeLegacyPortfolio(doc) };
}

module.exports = { upgradeLegacyPortfolio, buildSectionsFromLegacy, withDraft, withPublished, DEFAULT_THEME };
