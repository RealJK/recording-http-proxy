#!/usr/bin/env node

////////////////////////////////////////////////////////////////////////////////
//
// recording_http_proxy.js
//
// Simple HTTP proxy server that features the ability to:
//
//  - Persist requested files to the local drive
//  - Create subfolders for each user (identified by remote address)
//
// Example of folder hierarchy:
//
//   /var/cache/recording_proxy/
//     + jkiok
//     |    +- http/www.yahoo.com/80/index.html
//     |    +- http/www.yahoo.com/80/favicon.ico
//     |    +- https/www.google.com/443/default.php
//     + jdoe
//          +- http/www.comcast.net/80/logo.png
//
////////////////////////////////////////////////////////////////////////////////


////////////////////////////////////////////////////////////////////////////////
//                      DO NOT MODIFY BELOW THESE LINE                        //
////////////////////////////////////////////////////////////////////////////////

var WORK_DIRECTORY = __dirname + "/work/";

////////////////////////////////////////////////////////////////////////////////
/// LIBRARIES //////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

var cli = require('commander');
var connect = require('connect');
var fs = require("fs");
var http = require('http');
var https = require('https');
var log4js = require('log4js');
var moment = require('moment');
var node_fs = require('node-fs');
var fs_extra = require('fs.extra');
var path = require('path');
var url = require('url');
var util = require('util');
var logger = log4js.getLogger();

////////////////////////////////////////////////////////////////////////////////
/// USAGE //////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

var scriptName = path.basename(process.argv[1]);

cli
	.version('0.0.1')
    .option('-p, --proxy_port <port>', 'proxy port number', parseInt)
    .option('-h, --http_port <port>', 'admin port number', parseInt)
    .option('-d, --debug')
    .parse(process.argv);

////////////////////////////////////////////////////////////////////////////////
/// CHECK ARGUMENTS ////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

if (!cli.proxy_port || !cli.http_port) {
    cli.help();
}

logger.setLevel(cli.debug ? 'DEBUG' : 'ERROR');

////////////////////////////////////////////////////////////////////////////////
/// FUNCTIONS //////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

var logTimestampFormat = "YYYY-MM-DD HH:mm:ss.SSS";
var timestampFormat = "YYYY-MM-DDTHH-mm-ss-SSS";

/**
 * getFileSystemUrl
 * Return the file URL where to save this HTTP asset to.
 * @param cacheDirectory
 * @param requestObj
 * @param remoteIpAddress
 */
function getFileSystemUrl(cacheDirectory, requestObj, remoteIpAddress) {

	// Template: /{cache_directory}/{protocol}/{hostname}/{port}/{pathname}
	// Example: /var/cache/http/www.yahoo.com/80/images/logo.png
	var protocol = requestObj['protocol'].replace(':', '');
	var port = requestObj['port'] ? requestObj['port'] : 80;
	var pathname = requestObj['pathname'] ? requestObj['pathname'] : 'no-name.txt';
	if (pathname.lastIndexOf('/') + 1 == pathname.length) {
		pathname += "no-name.txt";
	}

	if (pathname.length > (256 - timestampFormat.length)) {
		logger.debug("Filename too long, need to truncate");
		pathname = pathname.substring(0,254-timestampFormat.length);
	}

	var fullPath = path.normalize(util.format("%s/%s/%s/%s/%s/%s.%s",
		cacheDirectory,
		remoteIpAddress,
		protocol,
		requestObj['hostname'],
		port,
		pathname,
		moment().format(timestampFormat)));

	return fullPath;
}

/**
 * doInternalProxyRequest
 * Process the HTTP request - saves the response to the disk, and serve it to the client.
 * @param incomingMessage
 * @param requestObj
 * @param response
 * @param proxyResponse
 * @param cacheDirectory
 * @param clientIp
 */
function doInternalProxyRequest(incomingMessage, requestObj, response,
	proxyResponse, cacheDirectory, clientIp) {

	// Step 1: Figure out the file URL to save the asset to
	var fileUrl = getFileSystemUrl(cacheDirectory, requestObj, clientIp);
	logger.debug("[" + incomingMessage.url + "] -> " + fileUrl);

	// Should we save this HTTP asset?
	var saveToDisk = true;

	var directory = path.dirname(fileUrl);
	if (!fs.existsSync(directory)) {
		logger.debug("Creating directory [" + directory + "] for fileUrl [" + fileUrl + "]");
		node_fs.mkdirSync(path.dirname(fileUrl), 0755, true);
	} else {

		if (fs.statSync(directory).isFile()) {
			logger.error("Failed to create directory [" + directory + "] because there is a file with the same name");
			saveToDisk = false;
		}
	}

	var fh = null;
	if (saveToDisk) {
		fh = fs.createWriteStream(fileUrl);
	}

	// Step 2: Write out the HTTP status code and headers
	response.writeHead(proxyResponse.statusCode, proxyResponse.headers);

	// Step 3: Serve the chunk and close connection
	proxyResponse.on("data", function(chunk) {
		response.write(chunk, 'binary');
		if (saveToDisk) fh.write(chunk);
	}).on("end", function() {
		response.end();
		if (saveToDisk) fh.end();
		if (saveToDisk) fh.destroy();
		doAccessLog(cacheDirectory, clientIp, proxyResponse.statusCode, incomingMessage.url, fileUrl)
	}).on("close", function() {
		response.end();
		if (saveToDisk) fh.end();
		if (saveToDisk) fh.destroy();
		doAccessLog(cacheDirectory, clientIp, proxyResponse.statusCode, incomingMessage.url, fileUrl)
	});
};

/**
 * Save the access log entry.
 * @param cacheDirectory
 * @param clientIp
 * @param statusCode
 * @param url
 * @param fileUrl
 */
function doAccessLog(cacheDirectory, clientIp, statusCode, url, fileUrl) {

	var statsPath = path.normalize(util.format("%s/%s/access_log.txt", cacheDirectory, clientIp))
	fs.appendFile(statsPath, util.format("[%s] - %s - %s - %s - %s\n",
		moment().format(logTimestampFormat), statusCode, getFileSize(fileUrl), url, fileUrl.replace(cacheDirectory, '')))
}

/**
 * Return the size for a given file.
 * @param filename
 */
function getFileSize(filename) {
	var stats = fs.statSync(filename)
	return stats["size"]
}

/**
 * doInternalProxy
 * Process the proxied incoming HTTP transaction.
 * @param incomingMessage
 * @param cacheDirectory
 * @param response
 */
function doInternalProxy(incomingMessage, cacheDirectory, response) {

	// Step 1: Parse the incomingMessage HTTP object
	var requestObj = url.parse(incomingMessage.url);

	// Step 2: Create the HTTP options map
	var options = {
		hostname: requestObj['hostname'],
		port: requestObj['port'],
		path: requestObj['path'],
		method: incomingMessage.method,
		headers: incomingMessage['headers']
	}

	var clientIp = incomingMessage.connection.remoteAddress;

	var proxyRequest = null;

	if (requestObj['protocol'] == 'http:') {
		proxyRequest = http.request(options, function(proxyResponse) {
			doInternalProxyRequest(incomingMessage, requestObj, response, proxyResponse, cacheDirectory, clientIp);
	    });
	} else if (requestObj['protocol'] == 'https:') {
		proxyRequest = https.request(options, function(proxyResponse) {
			doInternalProxyRequest(incomingMessage, requestObj, response, proxyResponse, cacheDirectory, clientIp);
	    });
	}

	// Step 3: For POST data, be sure to pass it along
	incomingMessage.on("data", function(chunk) {
		proxyRequest.write(chunk);
	}).on("end", function() {
		proxyRequest.end();
	}).on("close", function() {
		logger.error("Browser terminated connection before end()");
	});
}

////////////////////////////////////////////////////////////////////////////////
/// MAIN BODY //////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

process.on('uncaughtException', function(err) {
	console.log(err);
	console.log(err.stack);
});

http.createServer(function(incomingMessage, response) {
	doInternalProxy(incomingMessage, WORK_DIRECTORY, response);
}).on("connect", function(request, socket, head) {
	// TODO: doInternalProxy(request, WORK_DIRECTORY, null);
}).listen(parseInt(cli.proxy_port));

connect()
	.use(connect.static(WORK_DIRECTORY))
	.use(connect.directory(WORK_DIRECTORY))
	.use(function(req, res) {
		if (req.url.indexOf('clear') != -1) {
			var ip = req.connection.remoteAddress;
			logger.debug("Deleting directory for " + ip);
			fs_extra.rmrfSync(WORK_DIRECTORY + ip);
			res.writeHead(200, null);
			res.end();
		}
	}).listen(cli.http_port);
