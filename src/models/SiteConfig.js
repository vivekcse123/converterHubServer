"use strict";
const mongoose = require("mongoose");

// Singleton document (there is only ever one) holding the site's editable
// branding fields — the small, concrete slice of "Branding/Logo/Settings"
// that has a real admin surface. Broader "Themes/APIs/Storage/Security"
// settings mentioned in the original spec have no backing mechanism in this
// codebase and are intentionally not modeled here.
const siteConfigSchema = new mongoose.Schema(
  {
    siteName:    { type: String, trim: true, default: "ApnaConverter" },
    logoUrl:     { type: String, trim: true, default: "" },
    supportEmail: { type: String, trim: true, default: "" },
    social: {
      twitter:  { type: String, trim: true, default: "" },
      linkedin: { type: String, trim: true, default: "" },
      github:   { type: String, trim: true, default: "" },
    },
  },
  { timestamps: true }
);

siteConfigSchema.statics.getSingleton = async function () {
  let doc = await this.findOne();
  if (!doc) doc = await this.create({});
  return doc;
};

module.exports = mongoose.model("SiteConfig", siteConfigSchema);
