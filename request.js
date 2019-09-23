"use strict";

class Request {
    constructor(idx) {
        this.idx = idx;
        this.tag = 0;
        this.sock = null;
        this.inused = false;
    }
}

module.exports = Request;
