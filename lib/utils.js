/*
Node wrapper for Freshdesk v2 API

Copyright (C) 2016-2018 Arjun Komath <arjunkomath@gmail.com>
Copyright (C) 2016-2018 Maksim Koryukov <maxkoryukov@gmail.com>

This program is free software: you can redistribute it and/or modify
it under the terms of the MIT License, attached to this software package.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

You should have received a copy of the MIT License along with this
program. If not, see <https://opensource.org/licenses/MIT>.

http://spdx.org/licenses/MIT
*/

/**
 * Freshdesk API utilities
 *
 * @module
 */

"use strict";

const debug = require("debug")("freshdesk-api");
const { FormData } = require('formdata-node')
const { request } = require('undici')

/**
 * Freshdesk's API protocol violations
 *
 * @param {String}  message Error message
 * @param {Number}  status  HTTP status of the received Freshdesk-response. Could be useful for debugging
 * @param {Object}  data    Parsed response of the Freshdesk API
 */
class FreshdeskError extends Error {
	constructor(message, data, res, req) {
		super();

		this.name = "FreshdeskError";
		this.message = message || "Error in Freshdesk's client API";
		this.stack = new Error().stack;

		this.data = data;

		this.status = res.statusCode;

		this.apiTarget = `${req.method} ${req.path}`;
		this.requestId = res.headers["x-request-id"];
	}
}

function createResponseHandler(cb) {
	return function (error, response, body, request) {
		if (error) {
			debug("Error on request: [%s], req path [%s] raw body: %o", error);
			return cb(error);
		}

		const extra = {
			pageIsLast: true,
			requestId: "",
		};

		debug("Got API response, status [%s]", response.status);

		if (
			response &&
			response.headers &&
			"string" === typeof response.headers.link
		) {
			debug(
				"Detected http-header LINK, page is not last",
				response.headers.link
			);
			extra.pageIsLast = false;
			// TODO: reconsider this property
			extra._headersLink = response.headers.link;
		}

		if (
			response &&
			response.headers &&
			"string" === typeof response.headers["x-request-id"]
		) {
			extra.requestId = response.headers["x-request-id"];
		}

		switch (response.statusCode) {
			// SUCCESS
			// https://httpstatuses.com/200 OK
			// https://httpstatuses.com/201 Created
			case 200:
			case 201:
				return cb(null, body, extra);

			// SUCCESS for DELETE operations
			// https://httpstatuses.com/204 No Content
			case 204:
				return cb(null, null, extra);

			// https://httpstatuses.com/404 Not found
			case 404:
				debug("path:[%s] raw body: %o", request.path);

				// In most casses 404 means, that there is no such entity on requested
				// Freshdesk domain. For example, you are trying to update non-existent
				// contact
				// But, it also could be a result of wrong URL (?!?!?)
				//
				// In most cases the body is EMPTY, so we will just warn about wrong entity
				return cb(
					new FreshdeskError(
						"The requested entity was not found",
						body,
						response,
						request
					)
				);

			// https://httpstatuses.com/409 Conflict  - NOT UNIQUE, where unique required
			case 409:
			default:
				debug("path:[%s] raw body: %o", request.path);
				return cb(new FreshdeskError(body.description, body, response, request));
		}
	};
}

// TODO: try to make less params here
async function makeRequest(method, auth, url, qs, data, cb) {
	// eslint-disable-line max-params
	const options = {
		method: method,
		headers: {
			"Content-Type": "application/json",
			Authorization: auth,
		},
		query: qs,
	};

	if (data) {
		if ("attachments" in data && Array.isArray(data.attachments)) {
			const form = new FormData();

			for (let i = 0; i < Object.keys(data).length; i++) {
				const key = Object.keys(data)[i];
				if (Array.isArray(data[key])) {
					for (let i = 0; i < data[key].length; i++) {
						form.append(key + "[]", data[key][i]);
					}
				} else {
					form.append(key, data[key]);
				}
			}

			options.headers["Content-Type"] = "multipart/form-data"; // browser
			options.body = form;
		} else {
			options.body = JSON.stringify(data);
		}
	}

	const fullUrl = new URL(url)
	const req = {
		...options,
		url,
		path: fullUrl.pathname
	}

	try {
		const response = await request(url, options);
		const data = response.body ? await response.body.json() : null
		return createResponseHandler(cb)(null, response, data, req);
	} catch (error) {
		if (error.response) {
			const data = error.response.body ? await error.response.body.json() : null
			return createResponseHandler(cb)(
				null,
				error.response,
				data,
				req
			);
		} else if (error.request) {
			const data = error.request.body ? await error.request.body.json() : null
			return createResponseHandler(cb)(
				new Error(error.message),
				error.request,
				data,
				req
			);
		} else {
			const data = request.body
			return createResponseHandler(cb)(
				error,
				req,
				data,
				req
			);
		}
	}
}

/**
 * Checks if value is null or undefined.
 *
 * @private
 *
 * @param  {*}       value    The value to check.
 * @return {boolean}          Returns `true` if value is `null` or `undefined`; else `false`.
 *
 */
function isNil(value) {
	if (value === null || typeof value === "undefined") {
		return true;
	}

	return false;
}

/**
 * Checks if value is classified as a Function object.
 *
 * @private
 *
 * @param  {*}       value    The value to check.
 * @return {boolean}          Returns `true` if value is a `function`; else `false`.
 */
function isFunction(value) {
	return typeof value === "function";
}

module.exports.makeRequest = makeRequest;
module.exports.FreshdeskError = FreshdeskError;
module.exports.isNil = isNil;
module.exports.isFunction = isFunction;

// For testing
module.exports.createResponseHandler = createResponseHandler;
