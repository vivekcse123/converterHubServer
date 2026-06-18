"use strict";

/**
 * Send a successful JSON response.
 */
const success = (res, data = {}, message = "Success", statusCode = 200) =>
  res.status(statusCode).json({ success: true, message, data });

/**
 * Send a paginated JSON response.
 * The 6th argument is an optional meta object (e.g. { statusCounts }).
 */
const paginated = (res, data, total, page, limit, meta = {}) =>
  res.status(200).json({
    success: true,
    message: "Success",
    data,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    meta,
  });

/**
 * Send an error JSON response.
 */
const error = (
  res,
  message = "Internal Server Error",
  statusCode = 500,
  details = null,
) => {
  const body = { success: false, message };
  if (details) body.details = details;
  return res.status(statusCode).json(body);
};

module.exports = { success, paginated, error };
