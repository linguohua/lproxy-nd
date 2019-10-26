"use strict";

const tunbuilder = require("./tunnel");

class TunMgr {
    constructor(uuid, tunnelCount, tunnelCap, url) {
        this.uuid = uuid;
        this.tunnelCount = tunnelCount;
        this.tunnelCap = tunnelCap;
        this.url = url;
        this.reconnects = [];
        this.currentTunIdex = 0;
        console.log("[TunMgr], constructor, tunnelCount:", tunnelCount,
            ",tunnelCap:", tunnelCap, ", url:", url);
    }

    startup() {
        this.tunnels = [];
        this.sortedTunnels = [];
        for (let i = 0; i < this.tunnelCount; i++) {
            let tunnel = new tunbuilder(this.uuid, i, this, this.url, this.tunnelCap);
            this.tunnels.push(tunnel);
            this.sortedTunnels.push(tunnel);

            tunnel.connect();
        }

        // keep-alive timer
        setInterval(() => {
            this.keepalive();
        }, 15 * 1000);

        // sort tunnels
        setInterval(() => {
            this.doSortTunnels();
        }, 3 * 1000);
    }

    onAcceptRequest(sock, info) {
        // allocate tunnel for sock
        let tun = this.allocTunnelForRequest();
        if (tun === null) {
            // failed to allocate tunnel for sock, discard it
            console.log("[TunMgr] failed to alloc tunnel for sock, discard it");

            sock.destroy();
            return;
        }

        if (tun.onAcceptRequest(sock, info) === null) {
            sock.destroy();
            return;
        }
    }

    onAcceptHTTPsRequest(sock, info, head) {
        // allocate tunnel for sock
        let tun = this.allocTunnelForRequest();
        if (tun === null) {
            // failed to allocate tunnel for sock, discard it
            console.log("[TunMgr] failed to alloc tunnel for https, discard it");

            sock.destroy();
            return;
        }

        if (tun.onAcceptHTTPsRequest(sock, info, head) === null) {
            sock.destroy();
            return;
        }
    }

    onAcceptHTTPRequest(reqRaw, info, head) {
        let sock = reqRaw.socket;
        // allocate tunnel for sock
        let tun = this.allocTunnelForRequest();
        if (tun === null) {
            // failed to allocate tunnel for sock, discard it
            console.log("[TunMgr] failed to alloc tunnel for http, discard it");

            sock.destroy();
            return;
        }

        if (tun.onAcceptHTTPRequest(reqRaw, info, head) === null) {
            sock.destroy();
            return;
        }
    }

    allocTunnelForRequest() {
        let length = this.sortedTunnels.length;
        let currentIdx = this.currentTunIdex;

        for (let i = currentIdx; i < length; i++) {
            let tun = this.sortedTunnels[i];
            if (!tun.isConnected || tun.isFulled) {
                continue;
            }

            this.currentTunIdex = (i + 1) % length;

            return tun;
        }

        for (let i = 0; i < currentIdx; i++) {
            let tun = this.sortedTunnels[i];
            if (!tun.isConnected || tun.isFulled) {
                continue;
            }

            this.currentTunIdex = (i + 1) % length;

            return tun;
        }

        return null;
    }

    doSortTunnels() {
        let length = this.sortedTunnels.length;
        this.sortedTunnels.sort((x, y) => {
            return x.busy - y.busy;
        });

        for (let i = 0; i < length; i++) {
            let tun = this.sortedTunnels[i];
            tun.resetBusy();
        }

        this.currentTunIdex = 0;
    }

    keepalive() {
        let length = this.tunnels.length;
        for (let i = 0; i < length; i++) {
            let tun = this.tunnels[i];
            if (!tun.isConnected) {
                continue;
            }

            tun.sendPing();
        }

        length = this.reconnects.length;
        for (let i = 0; i < length; i++) {
            let idx = this.reconnects[i];
            let tun = this.tunnels[idx];

            if (tun.isConnected) {
                continue;
            }

            tun.connect();
        }

        this.reconnects = [];
    }

    onTunnelBroken(tun) {
        this.reconnects.push(tun.idx);
    }
};

module.exports = TunMgr;
