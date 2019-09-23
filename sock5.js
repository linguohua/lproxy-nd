"use strict";
const socks = require('socksv5');
const tmclass = require("./tunmgr");
const http = require('http');
const url = require('url');

const socks5_port = 1080;
const http_port = 1081;

let tm = new tmclass(20, 200, "wss://host:port/path");
tm.startup();

let srv = socks.createServer((info, accept, deny) => {
    let srcAddr = info.srcAddr;
    let srcPort = info.srcPort;
    let dstAddr = info.dstAddr;
    let dstPort = info.dstPort;
    console.log('accept sock, srcAddr:', srcAddr, ',srcPort:', srcPort, ',dstAddr:', dstAddr, ',dstPort:', dstPort);

    let sock = accept(true);

    tm.onAcceptRequest(sock, info);
});

srv.listen(socks5_port, 'localhost', function () {
    console.log('SOCKS server listening on port:', socks5_port);
});

// socks5
srv.useAuth(socks.auth.None())

function connectListener(req, cltSocket, head) {
    // connect to an origin server
    // console.log(`connectListener: ${req.url}`);
    const srvUrl = url.parse(`http://${req.url}`);

    let info = {};
    info.srcAddr = req.socket.localAddress;
    info.srcPort = req.socket.localPort;
    info.dstAddr = srvUrl.hostname;
    info.dstPort = srvUrl.port;

    console.log('accept https, srcAddr:', info.srcAddr, ',srcPort:', info.srcPort,
        ',dstAddr:', info.dstAddr, ',dstPort:', info.dstPort);

    tm.onAcceptHTTPsRequest(cltSocket, info, head);
}

function startHttpProxy() {
    const proxy = http.createServer();

    // add listener
    // proxy.on('request', requestListener);
    proxy.on('connect', connectListener);

    // now that proxy is running
    proxy.listen(http_port, 'localhost');

    console.log('HTTP Proxy server listening on port:', http_port);
}

startHttpProxy();
