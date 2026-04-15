"use strict";

/**
 * Send a successful JSON response.
 */
const success = (res, data = {}, message = "Success", statusCode = 200) =>
  res.status(statusCode).json({ success: true, message, data });

/**
 * Send a paginated JSON response.
 */
const paginated = (res, data, total, page, limit, message = "Success") =>
  res.status(200).json({
    success: true,
    message,
    data,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
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
