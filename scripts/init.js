const ProxyInit = {
    DEFAULT_WISP: window.SITE_CONFIG?.defaultWisp || "wss://glseries.net/wisp/",
    WISP_SERVERS: window.SITE_CONFIG?.wispServers || [],
    BASE_PATH: (window.STATICSJ_BASE_PATH || "/staticsjv2/").replace(/\/?$/, '/'),

    getCurrent() {
        const stored = window.Settings?.get('proxServer') || localStorage.getItem("proxServer");
        return stored || this.DEFAULT_WISP;
    },

    setCurrent(url) {
        if (window.Settings) window.Settings.set('proxServer', url);
        else localStorage.setItem("proxServer", url);
    },

    async ping(url, timeout = 1000) {
        return new Promise(res => {
            const start = Date.now();
            try {
                const ws = new WebSocket(url);
                const timer = setTimeout(() => { try { ws.close(); } catch { } res({ url, success: false }); }, timeout);
                ws.onopen = () => { clearTimeout(timer); const latency = Date.now() - start; try { ws.close(); } catch { } res({ url, success: true, latency }); };
                ws.onerror = () => { clearTimeout(timer); res({ url, success: false }); };
            } catch { res({ url, success: false }); }
        });
    },

    async findBest() {
        const current = this.getCurrent();

        const check = await this.ping(current, 800);
        if (check.success) return current;

        const autoswitch = window.Settings ? window.Settings.get('wispAutoswitch') !== false : localStorage.getItem('wispAutoswitch') !== 'false';
        if (!autoswitch || !this.WISP_SERVERS.length) return current;

        const results = await Promise.all(this.WISP_SERVERS.map(s => this.ping(s.url, 1500)));
        const working = results.filter(r => r.success).sort((a, b) => a.latency - b.latency);
        return working[0]?.url || this.DEFAULT_WISP;
    },

    async init() {
        try {
            if (document.readyState !== 'complete') {
                await new Promise(r => window.addEventListener('load', r, { once: true }));
            }

            const best = await this.findBest();
            this.setCurrent(best);

            if (window.Notify) {
                window.Notify.info("Initializing", "Starting proxy service...");
            }

            const settings = JSON.parse(localStorage.getItem('void_settings') || '{}');
            const offlineEnabled = settings.offlineMode !== false;

            if ('serviceWorker' in navigator) {
                if (offlineEnabled) {
                    try {
                        const swPath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1) + 'sw.js';
                        await navigator.serviceWorker.register(swPath);
                    } catch (e) {
                        console.error('Main SW registration failed:', e);
                    }
                } else {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    for (const reg of regs) {
                        if (reg.active && reg.active.scriptURL.endsWith('/sw.js') && !reg.active.scriptURL.includes('/staticsjv2/')) {
                            await reg.unregister();
                            console.log('Main Offline SW unregistered');
                        }
                    }
                }
            }

            if (window.Notify) window.Notify.success("Ready", "Proxy service initialized");

            // Unblock Mode Notification
            if (window.parent && window.parent.__phantomStealth && window.parent.__phantomStealth.isActive()) {
                window.Notify.info("Unblock Mode Active");
            }
        } catch (e) {
            console.error(e);
            if (window.Notify) window.Notify.error("Failed", e.message);
        }
    }
};

window.ProxyInit = ProxyInit;

ProxyInit.init();

(function () {
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (!link || !link.href) return;

        try {
            const url = new URL(link.href, window.location.href);
            const isInternal = url.origin === window.location.origin &&
                !url.pathname.includes('staticsjv2/') &&
                !link.hasAttribute('download') &&
                link.target !== '_blank';

            if (isInternal && window.parent && window.parent.showLoading) {
                window.parent.showLoading();
            }
        } catch (e) { }
    });
})();

window.addEventListener('message', async (e) => {
    if (e.data?.type === 'proxy-fetch' && e.data.url) {
        try {
            const res = await fetch(e.data.url);
            e.source.postMessage({ type: 'proxy-fetch-result', url: e.data.url, blob: await res.blob() }, '*');
        } catch (err) { }
    }
});
