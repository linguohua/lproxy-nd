"use strict";
const WebSocket = require('ws');
const reqqbuilder = require("./reqq");

/*
    None = 0,
    ReqData = 1,
    ReqCreated = 2,
    ReqClientClosed = 3,
    ReqClientFinished = 4,
    ReqServerFinished = 5,
    ReqServerClosed = 6,
*/

const CMD_None = 0;
const CMD_ReqData = 1;
const CMD_ReqCreated = 2;
const CMD_ReqClientClosed = 3;
const CMD_ReqClientFinished = 4;
const CMD_ReqServerFinished = 5;
const CMD_ReqServerClosed = 6;

class Tunnel {
    constructor(idx, tunmgr, url, cap) {
        this.idx = idx;
        this.tunmgr = tunmgr;
        this.url = url;
        this.cap = cap;
        this.rttArray = [];
        this.rttIndex = 0;
        this.rttSum = 0;
        this.rttArraySize = 5;
        this.busy = 0;

        for (let i = 0; i < this.rttArraySize; i++) {
            this.rttArray.push(0);
        }

        this.reqq = new reqqbuilder(cap);
    }

    connect() {
        // close if exist
        if (this.ws !== undefined) {
            this.ws.close();
        }

        this.ws = new WebSocket(this.url + "?cap=" + this.cap);
        let wsold = this.ws;

        this.ws.on('open', () => {
            this.onWebsocketConnected(wsold);
        });

        this.ws.on('error', (err) => {
            console.log('[Tunnel]ws error:', err);
            //--error之后会触发close
        });

        this.ws.on('close', () => {
            console.log('[Tunnel]ws close');
            this.onWebsocketClosed(wsold);
        });

        this.ws.on('pong', (data) => {
            if (data.length !== 8) {
                console.log("[Tunnel] pong data length not 8");
                return;
            }

            let now = Date.now();
            let prev = data.readDoubleLE(0);
            let rtt = now - prev;
            this.appendRtt(rtt);
        });
    }

    onWebsocketConnected(wsold) {
        this.ws.on('message', (data) => {
            if (this.ws !== wsold) {
                return;
            }

            this.onTunnelMsg(data);
        });
        console.log("[Tunnel]websocket connected");
    }

    onWebsocketClosed(wsold) {
        if (this.ws !== wsold) {
            return;
        }

        delete (this.ws);
        this.tunmgr.onTunnelBroken(this);
        console.log("[Tunnel]websocket broken, reconnect later");
    }

    resetBusy() {
        this.busy = 0;
    }

    onTunnelMsg(data) {
        // console.log("[Tunnel]onTunnelMsg, length:", data.length);
        this.busy += data.length;

        // read header
        let offset = 0;
        let cmd = data.readUInt8(offset);
        offset += 1;
        let idx = data.readUInt16LE(offset);
        offset += 2;
        let tag = data.readUInt16LE(offset);
        offset += 2;

        // dispatch message
        switch (cmd) {
            case CMD_ReqData:
                {
                    let data2 = data.subarray(offset);
                    this.onServerRequestData(idx, tag, data2);
                }
                break;
            case CMD_ReqServerFinished:
                {
                    this.onServerRecvFinished(idx, tag);
                }
                break;
            case CMD_ReqServerClosed:
                {
                    this.onServerRecvClosed(idx, tag);
                }
                break;
            default:
                console.log("[Tunnel]unknown cmd:", cmd);
                break;
        }
    }

    get isConnected() {
        return this.ws !== undefined
            && this.ws.readyState === WebSocket.OPEN;
    }

    onServerRequestData(idx, tag, data) {
        let sock = this.reqq.getSock(idx, tag);
        if (sock === null) {
            return; // discard
        }

        sock.write(data);
    }

    onServerRecvFinished(idx, tag) {
        let sock = this.reqq.getSock(idx, tag);
        if (sock === null) {
            return; // discard
        }

        sock.end();
    }

    onServerRecvClosed(idx, tag) {
        let sock = this.reqq.getSock(idx, tag);
        if (sock === null) {
            return; // discard
        }

        sock.destroy();
    }

    onAcceptRequest(sock, info) {
        if (!this.isConnected) {
            console.log("[Tunnel] accept sock failed, tunnel is disconnected");

            return null;
        }

        let req = this.reqq.allocReq(sock);
        if (req == null) {
            console.log("[Tunnel] allocReq failed, discard sock");
            return null;
        }

        // send create message to server
        this.sendCreate2Server(req, info);

        // enable sock events
        let reqIdx = req.idx;
        let reqTag = req.tag;

        this.serve_sock(sock, reqIdx, reqTag);

        return req;
    }

    onAcceptHTTPsRequest(sock, info, head) {
        let req = this.onAcceptRequest(sock, info);
        if (req === null) {
            return null;
        }

        sock.write('HTTP/1.1 200 Connection Established\r\n' +
            'Proxy-agent: linproxy\r\n' +
            '\r\n');

        this.onSockClientRecvData(sock, req.idx, req.tag, head);

        return req;
    }

    sendCreate2Server(req, info) {
        let port = info.dstPort;
        let addr = info.dstAddr;
        let addrLength = addr.length;
        let buf = Buffer.allocUnsafe(9 + addrLength)
        let offset = 0;

        // 1 byte cmd
        buf.writeUInt8(CMD_ReqCreated, offset);
        offset += 1;

        // 2 bytes req_idx
        buf.writeUInt16LE(req.idx, offset);
        offset += 2;

        // 2 bytes req_tag
        buf.writeUInt16LE(req.tag, offset);
        offset += 2;

        // 1 byte address_type, always be domain type
        buf.writeUInt8(1, offset);
        offset += 1;

        // 1 byte domain length
        buf.writeUInt8(addrLength, offset);
        offset += 1;

        // domain
        let wr = buf.write(addr, offset);
        offset += addrLength;
        if (wr !== addrLength) {
            console.log("[Tunnel]write dst-addr to buff length not match");
        }
        // console.log("[Tunnel]dst-port:", port);
        // 2 bytes port, port need BE format
        buf.writeUInt16LE(port, offset);

        if (this.isConnected) {
            this.ws.send(buf);
        }
    }

    sendCtl2Server(cmd, idx, tag) {
        let offset = 0;
        let buf = Buffer.allocUnsafe(5)
        // 1 byte cmd
        buf.writeUInt8(cmd, offset);
        offset += 1;

        // 2 bytes req_idx
        buf.writeUInt16LE(idx, offset);
        offset += 2;

        // 2 bytes req_tag
        buf.writeUInt16LE(tag, offset);

        if (this.isConnected) {
            this.ws.send(buf);
        }
    }

    serve_sock(sock, idx, tag) {
        sock.on('end', () => {
            this.onSockClientRecvFinished(sock, idx, tag);
        });

        sock.on('close', () => {
            this.onSockClientRecvClosed(sock, idx, tag);
        });

        sock.on('error', () => {
            // will emit 'close'
        });

        sock.on('data', (data) => {
            this.onSockClientRecvData(sock, idx, tag, data);
        });
    }

    onSockClientRecvData(sock, idx, tag, data) {
        // check valid
        if (!this.reqq.sockReqValid(sock, idx, tag)) {
            return;
        }

        let dataLength = data.length;
        let offset = 0;
        let buf = Buffer.allocUnsafe(5 + dataLength)
        // 1 byte cmd
        buf.writeUInt8(CMD_ReqData, offset);
        offset += 1;

        // 2 bytes req_idx
        buf.writeUInt16LE(idx, offset);
        offset += 2;

        // 2 bytes req_tag
        buf.writeUInt16LE(tag, offset);
        offset += 2;

        // data
        data.copy(buf, offset);
        if (this.isConnected) {
            this.ws.send(buf);
        }
    }

    onSockClientRecvFinished(sock, idx, tag) {
        // check valid
        if (!this.reqq.sockReqValid(sock, idx, tag)) {
            return;
        }

        // send to server
        this.sendCtl2Server(CMD_ReqClientFinished, idx, tag);
    }

    onSockClientRecvClosed(sock, idx, tag) {
        // check valid
        if (!this.reqq.sockReqValid(sock, idx, tag)) {
            return;
        }

        // free req object
        this.reqq.free(idx, tag);

        // send to server
        this.sendCtl2Server(CMD_ReqClientClosed, idx, tag);
        console.log("[Tunnel]onSockClientRecvClosed, idx:", idx);
    }

    sendPing() {
        // send ping
        let now = Date.now();
        let buf = Buffer.allocUnsafe(8);
        buf.writeDoubleLE(now, 0);

        if (this.isConnected) {
            this.ws.ping(buf);
        }
    }

    appendRtt(rtt) {
        let rttRemove = this.rttArray[this.rttIndex];
        this.rttArray[this.rttIndex] = rtt;
        let length = this.rttArray.length;
        this.rttIndex = (this.rttIndex + 1) % length;
        this.rttSum = this.rttSum + rtt - rttRemove;

        // console.log("[Tunnel]append rtt:", rtt, ", sum:", this.rttSum);
    }

    get rtt() {
        return Math.floor(this.rttSum / this.rttArraySize);
    }

    get isFulled() {
        return this.reqq.isFulled;
    }

    get reqCount() {
        return this.reqq.reqCount;
    }
}

module.exports = Tunnel;
