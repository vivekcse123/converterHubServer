"use strict";
const path = require("path");
const fse = require("fs-extra");
const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");
const Portfolio = require("../models/Portfolio");
const { withDraft, withPublished, upgradeLegacyPortfolio, DEFAULT_THEME } = require("../utils/portfolioUpgrade");
const { success, error } = require("../utils/response");
const { PORTFOLIO_MEDIA_DIR } = require("../config/constants");
const { handlePortfolioImageUpload } = require("../config/portfolioMulter");

// Resize/re-encode profiles. "avatar" cover-crops to a square for hero/profile
// photos; "cover" fits within a max edge for project/testimonial imagery.
const IMAGE_PROFILES = {
  avatar: (img) => img.resize(512, 512, { fit: "cover" }),
  cover:  (img) => img.resize(1600, 1600, { fit: "inside", withoutEnlargement: true }),
};

/** Resizes/re-encodes an uploaded image buffer and writes it to persistent storage. Returns its public URL. */
async function storePortfolioImage(userId, buffer, kind) {
  const profile = IMAGE_PROFILES[kind] ? kind : "cover";
  const userDir = path.join(PORTFOLIO_MEDIA_DIR, String(userId));
  await fse.ensureDir(userDir);
  const filename = `${uuidv4()}.webp`;
  const filePath = path.join(userDir, filename);
  await IMAGE_PROFILES[profile](sharp(buffer)).webp({ quality: 82 }).toFile(filePath);
  return `/portfolio-media/${userId}/${filename}`;
}

const IDENTITY_FIELDS = [
  "username", "isPublic", "displayName", "tagline", "about", "photoUrl",
  "location", "email", "phone", "social", "pinnedResumeId", "metaTitle", "metaDescription",
];

function pickIdentity(body) {
  const out = {};
  for (const key of IDENTITY_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

// GET /api/portfolio  (own — always reflects the draft being edited)
const getOwnPortfolio = async (req, res, next) => {
  try {
    const doc = await Portfolio.findOne({ userId: req.user._id }).lean();
    if (!doc) return success(res, { portfolio: null });
    success(res, { portfolio: withDraft(doc) });
  } catch (err) { next(err); }
};

// PUT /api/portfolio  (create or update draft; upsert)
const saveDraft = async (req, res, next) => {
  try {
    const { username, sections, theme } = req.body;
    if (username) {
      const existing = await Portfolio.findOne({ username, userId: { $ne: req.user._id } });
      if (existing) return error(res, "Username already taken", 409);
    }

    const identity = pickIdentity(req.body);
    const normalizedSections = (Array.isArray(sections) ? sections : []).map((s, i) => ({ ...s, order: i }));
    const normalizedTheme = theme && theme.templateId ? theme : DEFAULT_THEME;
    const draftSnapshot = { ...identity, sections: normalizedSections, theme: normalizedTheme };

    const update = {
      ...identity,
      sections: normalizedSections,
      theme: normalizedTheme,
      draft: draftSnapshot,
      userId: req.user._id,
    };

    const portfolio = await Portfolio.findOneAndUpdate(
      { userId: req.user._id },
      update,
      { new: true, upsert: true, runValidators: true }
    ).lean();

    success(res, { portfolio: withDraft(portfolio) });
  } catch (err) { next(err); }
};

// POST /api/portfolio/publish  (copy draft -> published)
const publish = async (req, res, next) => {
  try {
    const doc = await Portfolio.findOne({ userId: req.user._id });
    if (!doc) return error(res, "Save a draft before publishing", 404);

    const draftSnapshot = doc.draft && Object.keys(doc.draft).length > 0
      ? doc.draft
      : upgradeLegacyPortfolio(doc.toObject());

    doc.published   = draftSnapshot;
    doc.status      = "published";
    doc.publishedAt = new Date();
    await doc.save();

    success(res, { portfolio: withDraft(doc.toObject()) });
  } catch (err) { next(err); }
};

// POST /api/portfolio/unpublish  (take the live page down; keeps `published` snapshot intact for re-publish)
const unpublish = async (req, res, next) => {
  try {
    const doc = await Portfolio.findOneAndUpdate(
      { userId: req.user._id },
      { isPublic: false },
      { new: true }
    ).lean();
    if (!doc) return error(res, "Portfolio not found", 404);
    success(res, { portfolio: withDraft(doc) });
  } catch (err) { next(err); }
};

// POST /api/portfolio/upload-image  (multipart form: image file + optional "kind" = avatar|cover)
const uploadImage = async (req, res, next) => {
  try {
    await handlePortfolioImageUpload(req, res);
    if (!req.file) return error(res, "No image file provided", 400);
    const url = await storePortfolioImage(req.user._id, req.file.buffer, req.body.kind);
    success(res, { url });
  } catch (err) {
    if (err.message && err.message.startsWith("Unsupported image type")) return error(res, err.message, 400);
    next(err);
  }
};

// GET /api/portfolio/media  (list previously uploaded images for reuse in the media panel)
const listMedia = async (req, res, next) => {
  try {
    const userDir = path.join(PORTFOLIO_MEDIA_DIR, String(req.user._id));
    if (!(await fse.pathExists(userDir))) return success(res, { media: [] });

    const filenames = await fse.readdir(userDir);
    const media = await Promise.all(
      filenames
        .filter((f) => f.endsWith(".webp"))
        .map(async (filename) => {
          const stat = await fse.stat(path.join(userDir, filename));
          return { url: `/portfolio-media/${req.user._id}/${filename}`, filename, uploadedAt: stat.mtime };
        })
    );
    media.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    success(res, { media });
  } catch (err) { next(err); }
};

// DELETE /api/portfolio/media/:filename
const deleteMedia = async (req, res, next) => {
  try {
    const { filename } = req.params;
    // Reject anything that isn't a bare filename — blocks path traversal (../, /, etc.)
    if (!filename || filename !== path.basename(filename)) {
      return error(res, "Invalid filename", 400);
    }
    const filePath = path.join(PORTFOLIO_MEDIA_DIR, String(req.user._id), filename);
    if (!(await fse.pathExists(filePath))) return error(res, "File not found", 404);
    await fse.remove(filePath);
    success(res, {}, "Image deleted");
  } catch (err) { next(err); }
};

// GET /api/portfolio/check-username/:username  (public availability check)
const checkUsername = async (req, res, next) => {
  try {
    const taken = !!(await Portfolio.findOne({ username: req.params.username }));
    success(res, { username: req.params.username, available: !taken });
  } catch (err) { next(err); }
};

// GET /api/public/portfolio/:username  (public, no auth — reads `published` only)
const getPublicPortfolio = async (req, res, next) => {
  try {
    const portfolio = await Portfolio.findOne({
      username: req.params.username, isPublic: true, isHidden: { $ne: true }, deletedAt: null,
    }).lean();
    if (!portfolio) return error(res, "Portfolio not found", 404);
    Portfolio.findByIdAndUpdate(portfolio._id, { $inc: { views: 1 } }).catch(() => {});
    success(res, { portfolio: withPublished(portfolio) });
  } catch (err) { next(err); }
};

module.exports = { getOwnPortfolio, saveDraft, publish, unpublish, uploadImage, listMedia, deleteMedia, checkUsername, getPublicPortfolio };
