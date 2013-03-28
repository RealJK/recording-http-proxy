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

////////////////////////////////////////////////////////////////////////////////
/// LIBRARIES //////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

var cli = require('commander');
var connect = require('connect');
var cookies = require('cookies');
var fs = require("fs");
var http = require('http');
var log4js = require('log4js');
var moment = require('moment');
var node_fs = require('node-fs');
var node_static = require('node-static');
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

var timestampFormat = "YYYY-MM-DDTHH-mm-ss-SSS";

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
		cacheDirectory, remoteIpAddress, protocol,
		requestObj['hostname'], port, moment().format(timestampFormat), pathname));

	return fullPath;
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
		path: requestObj['pathname'],
		method: incomingMessage.method,
		headers: incomingMessage['headers']
	}

	var proxyRequest = http.request(options, function(proxyResponse) {

		// Step 3: Figure out the file URL to save the asset to
		var fileUrl = getFileSystemUrl(cacheDirectory, requestObj,
			incomingMessage.connection.remoteAddress);
		logger.debug("[" + incomingMessage.url + "] -> " + fileUrl);

		// Should we save this HTTP asset
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

		// Step 4: Write out the HTTP status code and headers
		response.writeHead(proxyResponse.statusCode, proxyResponse.headers);

		// Step 5: Serve the chunk and close connection
        proxyResponse.on("data", function(chunk) {
			response.write(chunk, 'binary');
            if (saveToDisk) fh.write(chunk);
        }).on("end", function() {
			response.end();
            if (saveToDisk) fh.end();
            if (saveToDisk) fh.destroy();
        }).on("close", function() {
			response.end();
			if (saveToDisk) fh.end();
			if (saveToDisk) fh.destroy();
		});
    });

	// Step 6: For POST data, be sure to pass it along
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
	doInternalProxy(incomingMessage, __dirname + "/work", response);
}).listen(parseInt(cli.proxy_port));

connect()
	.use(connect.static(__dirname + "/work"))
	.use(connect.directory(__dirname + "/work"))
	.use(function(req, res) {
		if (req.url.indexOf('clear') != -1) {
			var ip = req.connection.remoteAddress;
			logger.debug("Deleting directory for " + ip);
			fs_extra.rmrfSync(__dirname + "/work/" + ip);
			res.writeHead(200, null);
			res.end();
		}
	}).listen(cli.http_port);
