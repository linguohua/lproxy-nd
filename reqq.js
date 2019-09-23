"use strict";
const reqbuilder = require("./request");

class Reqq {
    constructor(cap) {
        this.cap = cap;
        this.requests = [];
        this.freeIdx = [];
        this.freeCount = cap;
        for (let i = 0; i < cap; i++) {
            let req = new reqbuilder(i);
            this.requests.push(req);
            this.freeIdx.push(i);
        }

        console.log("Reqq construct, cap:", cap);
    }

    sockReqValid(sock, idx, tag) {
        let length = this.requests.length;
        if (idx < 0 || idx >= length) {
            return false;
        }

        let req = this.requests[idx];
        if (req.sock !== sock || req.tag !== tag) {
            return false;
        }

        return true;
    }

    getSock(idx, tag) {
        let length = this.requests.length;
        if (idx < 0 || idx >= length) {
            return null;
        }

        let req = this.requests[idx];
        if (req.tag !== tag) {
            return null;
        }

        if (req.sock === undefined) {
            return null;
        }

        return req.sock;
    }

    allocReq(sock) {
        if (this.freeIdx.length < 1) {
            return null;
        }

        let idx = this.freeIdx.pop();
        let req = this.requests[idx];
        req.tag = req.tag + 1;
        req.inused = true;
        req.sock = sock;

        this.freeCount--;
        return req;
    }

    free(idx, tag) {
        let length = this.requests.length;
        if (idx < 0 || idx >= length) {
            return;
        }

        let req = this.requests[idx];
        if (req.tag !== tag) {
            return;
        }

        req.inused = false;
        req.sock = null;
        req.tag = req.tag + 1;

        this.freeIdx.push(idx);
        this.freeCount++;
    }

    get isFulled() {
        return this.freeCount < 1;
    }

    get reqCount() {
        return this.cap - this.freeCount;
    }
}

module.exports = Reqq;
