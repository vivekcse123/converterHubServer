"use strict";
require("dotenv").config({
  path: require("path").join(__dirname, "../../.env"),
});
const { Worker } = require("bullmq");
const { getRedisConnection } = require("../config/redis");
const logger = require("../utils/logger");
const Job = require("../models/Job");
const ConversionHistory = require("../models/ConversionHistory");
const {
  emitJobProgress,
  emitJobComplete,
  emitJobFailed,
} = require("../../sockets/index");

// Lazy-load services to avoid start-up cost
const getService = (name) => require(`../services/${name}`);

const QUEUE_NAME = "conversion";
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY, 10) || 3;

const processor = async (bullJob) => {
  const { tool, jobDbId, userId, inputPaths, options } = bullJob.data;
  logger.info(`[Worker] Processing job ${bullJob.id} tool=${tool}`);

  // Update DB job status
  const dbJob = await Job.findByIdAndUpdate(
    jobDbId,
    {
      status: "processing",
      startedAt: new Date(),
      bullJobId: bullJob.id,
    },
    { new: true },
  );

  const updateProgress = async (pct, msg) => {
    await bullJob.updateProgress(pct);
    if (dbJob) {
      dbJob.progress = pct;
      await dbJob.save();
    }
    emitJobProgress(jobDbId, { progress: pct, message: msg });
  };

  try {
    await updateProgress(5, "Starting...");
    let result;

    // Route to correct service
    switch (tool) {
      case "pdf-to-jpg":
        result = await getService("advanced-pdf.service").pdfToJpg(
          inputPaths[0],
          options,
        );
        break;
      case "ocr":
        result = await getService("ocr.service").performOCR(
          inputPaths[0],
          options,
        );
        break;
      case "watermark-pdf":
        result = await getService("advanced-pdf.service").watermarkPdf(
          inputPaths[0],
          options,
        );
        break;
      case "sign-pdf":
        result = await getService("advanced-pdf.service").signPdf(
          inputPaths[0],
          options,
        );
        break;
      case "redact-pdf":
        result = await getService("advanced-pdf.service").redactPdf(
          inputPaths[0],
          options,
        );
        break;
      case "page-numbers":
        result = await getService("advanced-pdf.service").addPageNumbers(
          inputPaths[0],
          options,
        );
        break;
      case "pdf-to-pdfa":
        result = await getService("advanced-pdf.service").pdfToPdfa(
          inputPaths[0],
        );
        break;
      case "compare-pdfs":
        result = await getService("advanced-pdf.service").comparePdfs(
          inputPaths[0],
          inputPaths[1],
        );
        break;
      case "pdf-to-txt":
        result = await getService("extended-converters.service").pdfToTxt(
          inputPaths[0],
        );
        break;
      case "pdf-to-markdown":
        result = await getService("extended-converters.service").pdfToMarkdown(
          inputPaths[0],
        );
        break;
      case "pdf-to-json":
        result = await getService("extended-converters.service").pdfToJson(
          inputPaths[0],
        );
        break;
      case "pdf-to-csv":
        result = await getService("extended-converters.service").pdfToCsv(
          inputPaths[0],
        );
        break;
      case "pdf-to-epub":
        result = await getService("extended-converters.service").pdfToEpub(
          inputPaths[0],
          options,
        );
        break;
      case "pdf-to-pptx":
        result = await getService("extended-converters.service").pdfToPptx(
          inputPaths[0],
        );
        break;
      case "pdf-to-excel":
        result = await getService("extended-converters.service").pdfToExcel(
          inputPaths[0],
        );
        break;
      case "heic-to-jpg":
        result = await getService("extended-converters.service").heicToJpg(
          inputPaths[0],
        );
        break;
      case "gif-to-pdf":
        result = await getService("extended-converters.service").gifToPdf(
          inputPaths[0],
        );
        break;
      case "markdown-to-pdf":
        result = await getService("extended-converters.service").markdownToPdf(
          inputPaths[0],
        );
        break;
      case "csv-to-pdf":
        result = await getService("extended-converters.service").csvToPdf(
          inputPaths[0],
        );
        break;
      case "html-to-pdf":
        result = await getService("extended-converters.service").htmlToPdf(
          inputPaths[0],
        );
        break;
      case "ai-summarize":
        result = await getService("ai.service").summarizePdf(
          inputPaths[0],
          options,
        );
        break;
      case "ai-keyword-extract":
        result = await getService("ai.service").extractKeywords(inputPaths[0]);
        break;
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }

    await updateProgress(95, "Finalizing...");

    // Update DB job to completed
    const completedAt = new Date();
    await Job.findByIdAndUpdate(jobDbId, {
      status: "completed",
      progress: 100,
      outputFiles: Array.isArray(result) ? result : [result],
      completedAt,
      processingTimeMs: completedAt - dbJob.startedAt,
    });

    // Log conversion history
    await ConversionHistory.findOneAndUpdate(
      { jobId: jobDbId },
      { status: "completed", processingTimeMs: completedAt - dbJob.startedAt },
    );

    await updateProgress(100, "Complete");
    emitJobComplete(jobDbId, result, userId);
    logger.info(`[Worker] Job ${bullJob.id} completed`);
    return result;
  } catch (err) {
    logger.error(`[Worker] Job ${bullJob.id} failed: ${err.message}`);
    await Job.findByIdAndUpdate(jobDbId, {
      status: "failed",
      errorMessage: err.message,
      progress: 0,
    });
    emitJobFailed(jobDbId, err.message, userId);
    throw err;
  }
};

// Start the worker (only when this file is run directly or explicitly started)
const startWorker = () => {
  try {
    const connection = getRedisConnection();
    const worker = new Worker(QUEUE_NAME, processor, {
      connection,
      concurrency: CONCURRENCY,
    });

    worker.on("completed", (job) =>
      logger.info(`[Worker] Job ${job.id} completed ✓`),
    );
    worker.on("failed", (job, err) =>
      logger.error(`[Worker] Job ${job?.id} failed: ${err.message}`),
    );
    worker.on("error", (err) => logger.error("[Worker] Error:", err.message));

    logger.info(`[Worker] Started with concurrency=${CONCURRENCY}`);
    return worker;
  } catch (err) {
    logger.error("[Worker] Failed to start:", err.message);
    return null;
  }
};

if (require.main === module) {
  require("../config/db").connectDB().then(startWorker);
}

module.exports = { startWorker, processor };
