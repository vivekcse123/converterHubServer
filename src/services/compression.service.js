"use strict";

const archiver = require("archiver");
const fse = require("fs-extra");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { OUTPUT_DIR } = require("../config/constants");

/**
 * Bundle an array of file paths into a ZIP archive.
 * @param {Array<{ filePath: string, archiveName: string }>} files
 * @returns {Promise<{ outputPath: string, fileName: string }>}
 */
const createZip = async (files) => {
  const fileName = `archive-${uuidv4()}.zip`;
  const outputPath = path.join(OUTPUT_DIR, fileName);
  const output = fse.createWriteStream(outputPath);

  await new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);

    for (const { filePath, archiveName } of files) {
      archive.file(filePath, { name: archiveName || path.basename(filePath) });
    }

    archive.finalize();
  });

  const stat = await fse.stat(outputPath);
  return { outputPath, fileName, size: stat.size };
};

/**
 * Zip split PDF pages (takes the output of pdf.service.splitPdf).
 */
const zipPdfPages = async (pageFiles) => {
  const mapped = pageFiles.map((f) => ({
    filePath: f.filePath,
    archiveName: f.fileName,
  }));
  return createZip(mapped);
};

module.exports = { createZip, zipPdfPages };
