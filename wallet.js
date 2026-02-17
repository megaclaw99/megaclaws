/**
 * MegaClaw Wallet — shared wallet connection module v2
 * - EIP-6963 multi-wallet detection (Rabby, MetaMask, Zerion, Coinbase, etc.)
 * - Detected wallets sorted first; Rabby prioritized
 * - Disconnect popover, session persistence, chain switching
 * - Emits: wallet:connected, wallet:disconnected
 * - Auto-wires: .btn-connect, #connectBtn, [data-wallet-btn]
 */
(function () {
  'use strict';

  const CHAIN_ID     = 4326;
  const CHAIN_HEX    = '0x10E6';
  const CHAIN_NAME   = 'MegaETH Mainnet';
  const RPC_URL      = 'https://mainnet.megaeth.com/rpc';
  const EXPLORER_URL = 'https://mega.etherscan.io';
  const LS_KEY       = 'mc_wallet';
  const LS_PROV_KEY  = 'mc_wallet_rdns'; // remember which provider was used

  // ── State ──────────────────────────────────────────────────────────────────
  window.MC = window.MC || {};
  MC.wallet = { address: null, connected: false, provider: null };

  // Collect EIP-6963 announced providers: { info, provider }[]
  const eip6963Providers = [];

  // ── Wallet Catalog ─────────────────────────────────────────────────────────
  // Priority order: lower index = shown first when installed
  const WALLET_CATALOG = [
    {
      id: 'rabby',
      rdns: 'im.rabby',
      name: 'Rabby Wallet',
      desc: 'Smart wallet for DeFi power users',
      icon: `<img src="https://cdn.jsdelivr.net/gh/RabbyHub/Rabby@master/src/ui/assets/logo.svg" width="24" height="24" style="border-radius:5px;object-fit:cover" onerror="this.outerHTML='<span style=&quot;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:#8B5CF6;border-radius:5px;font-size:12px;font-weight:900;color:#fff;font-family:monospace&quot;>R</span>'">`,
      installUrl: 'https://rabby.io/',
      detect: () => {
        if (window.rabby) return window.rabby;
        if (window.ethereum?.isRabby) return window.ethereum;
        const multi = window.ethereum?.providers?.find(p => p.isRabby);
        if (multi) return multi;
        return null;
      }
    },
    {
      id: 'metamask',
      rdns: 'io.metamask',
      name: 'MetaMask',
      desc: 'The most popular browser wallet',
      icon: `<img src="https://avatars.githubusercontent.com/u/11744586?s=64&v=4" width="24" height="24" style="border-radius:5px;object-fit:cover" onerror="this.outerHTML='<span style=&quot;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:#E2761B;border-radius:5px;font-size:12px;font-weight:900;color:#fff;font-family:monospace&quot;>M</span>'">`,
      installUrl: 'https://metamask.io/download/',
      detect: () => {
        // Rabby spoof-proofs: check isRabby first to not pick it as MetaMask
        if (window.ethereum?.isMetaMask && !window.ethereum?.isRabby) return window.ethereum;
        const multi = window.ethereum?.providers?.find(p => p.isMetaMask && !p.isRabby);
        if (multi) return multi;
        return null;
      }
    },
    {
      id: 'zerion',
      rdns: 'io.zerion.wallet',
      name: 'Zerion',
      desc: 'Invest in DeFi from one place',
      icon: `<img src="https://cdn.jsdelivr.net/gh/zeriontech/zerion-wallet-extension@main/src/ui/assets/zerion-logo.svg" width="24" height="24" style="border-radius:5px;object-fit:cover" onerror="this.outerHTML='<span style=&quot;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:#2962EF;border-radius:5px;font-size:9px;font-weight:900;color:#fff;font-family:monospace&quot;>ZR</span>'">`,
      installUrl: 'https://zerion.io/download',
      detect: () => {
        if (window.zerionWallet) return window.zerionWallet;
        if (window.ethereum?.isZerion) return window.ethereum;
        const multi = window.ethereum?.providers?.find(p => p.isZerion);
        if (multi) return multi;
        return null;
      }
    },
    {
      id: 'coinbase',
      rdns: 'com.coinbase.wallet',
      name: 'Coinbase Wallet',
      desc: 'Your key to the open financial system',
      icon: `<img src="https://avatars.githubusercontent.com/u/1885080?s=64&v=4" width="24" height="24" style="border-radius:5px;object-fit:cover" onerror="this.outerHTML='<span style=&quot;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:#0052FF;border-radius:5px;font-size:9px;font-weight:900;color:#fff;font-family:monospace&quot;>CB</span>'">`,
      installUrl: 'https://www.coinbase.com/wallet/downloads',
      detect: () => {
        if (window.coinbaseWalletExtension) return window.coinbaseWalletExtension;
        if (window.ethereum?.isCoinbaseWallet) return window.ethereum;
        const multi = window.ethereum?.providers?.find(p => p.isCoinbaseWallet);
        if (multi) return multi;
        return null;
      }
    },
    {
      id: 'rainbow',
      rdns: 'me.rainbow',
      name: 'Rainbow',
      desc: 'The fun wallet for Ethereum',
      icon: `<img src="https://avatars.githubusercontent.com/u/48327834?s=64&v=4" width="24" height="24" style="border-radius:5px;object-fit:cover" onerror="this.outerHTML='<span style=&quot;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:linear-gradient(135deg,#FF4D4D,#FFAD33,#4D9FFF);border-radius:5px;font-size:9px;font-weight:900;color:#fff;font-family:monospace&quot;>RW</span>'">`,
      installUrl: 'https://rainbow.me/download',
      detect: () => {
        if (window.rainbow) return window.rainbow;
        if (window.ethereum?.isRainbow) return window.ethereum;
        const multi = window.ethereum?.providers?.find(p => p.isRainbow);
        if (multi) return multi;
        return null;
      }
    },
    {
      id: 'okx',
      rdns: 'com.okex.wallet',
      name: 'OKX Wallet',
      desc: 'Web3 wallet by OKX exchange',
      icon: `<img src="https://avatars.githubusercontent.com/u/120148534?s=64&v=4" width="24" height="24" style="border-radius:5px;object-fit:cover" onerror="this.outerHTML='<span style=&quot;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:#111;border-radius:5px;font-size:8px;font-weight:900;color:#fff;font-family:monospace;border:1px solid #333&quot;>OKX</span>'">`,
      installUrl: 'https://www.okx.com/web3',
      detect: () => {
        if (window.okxwallet) return window.okxwallet;
        if (window.ethereum?.isOkxWallet || window.ethereum?.isOKExWallet) return window.ethereum;
        return null;
      }
    },
    {
      id: 'trust',
      rdns: 'com.trustwallet.app',
      name: 'Trust Wallet',
      desc: 'The most trusted & secure crypto wallet',
      icon: `<img src="https://avatars.githubusercontent.com/u/32179889?s=64&v=4" width="24" height="24" style="border-radius:5px;object-fit:cover" onerror="this.outerHTML='<span style=&quot;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:#3375BB;border-radius:5px;font-size:9px;font-weight:900;color:#fff;font-family:monospace&quot;>TW</span>'">`,
      installUrl: 'https://trustwallet.com/download',
      detect: () => {
        if (window.trustwallet) return window.trustwallet;
        if (window.ethereum?.isTrust || window.ethereum?.isTrustWallet) return window.ethereum;
        const multi = window.ethereum?.providers?.find(p => p.isTrust || p.isTrustWallet);
        if (multi) return multi;
        return null;
      }
    },
    {
      id: 'phantom',
      rdns: 'app.phantom',
      name: 'Phantom',
      desc: 'Friendly crypto wallet for Web3',
      icon: `<img src="https://avatars.githubusercontent.com/u/124594793?s=64&v=4" width="24" height="24" style="border-radius:5px;object-fit:cover" onerror="this.outerHTML='<span style=&quot;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:#AB9FF2;border-radius:5px;font-size:9px;font-weight:900;color:#fff;font-family:monospace&quot;>PH</span>'">`,
      installUrl: 'https://phantom.app/download',
      detect: () => {
        if (window.phantom?.ethereum) return window.phantom.ethereum;
        if (window.ethereum?.isPhantom) return window.ethereum;
        return null;
      }
    },
  ];

  // WalletConnect — always shown at bottom of Popular Wallets (not a browser extension)
  const WC_ENTRY = {
    id: 'walletconnect',
    name: 'WalletConnect',
    desc: 'Connect any mobile wallet via QR code',
    icon: `<img src="https://avatars.githubusercontent.com/u/37784886?s=64&v=4" width="24" height="24" style="border-radius:5px;object-fit:cover" onerror="this.outerHTML='<span style=&quot;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:#3B99FC;border-radius:5px;font-size:8px;font-weight:900;color:#fff;font-family:monospace&quot;>WC</span>'">`,
  };

  // ── EIP-6963 listener ──────────────────────────────────────────────────────
  window.addEventListener('eip6963:announceProvider', (event) => {
    const { info, provider } = event.detail;
    if (!eip6963Providers.find(p => p.info.rdns === info.rdns)) {
      eip6963Providers.push({ info, provider });
    }
    // Re-render modal if open
    if (document.getElementById('mc-modal-overlay')?.classList.contains('open')) {
      renderWalletList();
    }
  });
  // Trigger any already-announced providers
  window.dispatchEvent(new Event('eip6963:requestProvider'));

  // ── Utils ──────────────────────────────────────────────────────────────────
  function shortAddr(a) { return a ? a.slice(0, 6) + '...' + a.slice(-4) : ''; }
  function emit(name, detail) { window.dispatchEvent(new CustomEvent(name, { detail })); }
  function saveSession(address, rdns) {
    try { localStorage.setItem(LS_KEY, address); if (rdns) localStorage.setItem(LS_PROV_KEY, rdns); } catch (_) {}
  }
  function clearSession() {
    try { localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_PROV_KEY); } catch (_) {}
  }
  function getSavedSession() {
    try { return { address: localStorage.getItem(LS_KEY), rdns: localStorage.getItem(LS_PROV_KEY) }; } catch (_) { return {}; }
  }

  // ── Inject CSS ─────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #mc-modal-overlay {
      position:fixed;inset:0;z-index:99999;
      background:rgba(10,10,11,.88);backdrop-filter:blur(8px);
      display:flex;align-items:center;justify-content:center;
      padding:24px;opacity:0;pointer-events:none;transition:opacity .2s;
    }
    #mc-modal-overlay.open{opacity:1;pointer-events:all;}
    #mc-modal {
      background:#1a1a1b;border:1px solid #3a3738;
      width:100%;max-width:420px;
      box-shadow:0 0 80px rgba(0,0,0,.9);
      animation:mcModalIn .2s ease;
      font-family:'Share Tech Mono',monospace;
    }
    @keyframes mcModalIn{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}
    #mc-modal-header {
      background:rgba(255,255,255,.03);border-bottom:1px solid #2e2c2d;
      padding:15px 20px;display:flex;align-items:center;justify-content:space-between;
    }
    #mc-modal-title {
      font-family:'Orbitron',sans-serif;font-size:12px;font-weight:700;
      letter-spacing:3px;color:#ECE8E8;text-transform:uppercase;
    }
    #mc-modal-close {
      background:transparent;border:1px solid #2e2c2d;
      color:#8e8888;font-family:'Share Tech Mono',monospace;
      font-size:11px;letter-spacing:1px;padding:4px 12px;
      cursor:pointer;transition:all .2s;text-transform:uppercase;
    }
    #mc-modal-close:hover{border-color:#e07070;color:#e07070;}
    #mc-modal-body{padding:16px 20px 20px;}
    #mc-modal-subtitle {
      font-size:9px;color:#8e8888;letter-spacing:2px;
      text-transform:uppercase;margin-bottom:12px;text-align:center;
    }
    #mc-wallet-list{display:flex;flex-direction:column;gap:5px;}
    .mc-wallet-section-label {
      font-size:8px;color:#6fcf7a;letter-spacing:2px;
      text-transform:uppercase;padding:6px 0 4px;
    }
    .mc-wallet-section-label.dim{color:#555;}
    .mc-wallet-option {
      display:flex;align-items:center;gap:12px;
      padding:12px 14px;
      background:rgba(236,232,232,.025);border:1px solid #2e2c2d;
      cursor:pointer;transition:all .15s;text-decoration:none;
      position:relative;
    }
    .mc-wallet-option:hover{background:rgba(236,232,232,.06);border-color:#4a4748;}
    .mc-wallet-option.installed{border-color:#2e2e40;}
    .mc-wallet-option.installed:hover{border-color:#6060cc;}
    .mc-wallet-option.not-installed{opacity:.55;}
    .mc-wallet-icon {
      width:36px;height:36px;flex-shrink:0;
      display:flex;align-items:center;justify-content:center;
      background:rgba(236,232,232,.04);border:1px solid #2e2c2d;overflow:hidden;
    }
    .mc-wallet-icon img{width:24px;height:24px;object-fit:contain;}
    .mc-wallet-info{flex:1;min-width:0;}
    .mc-wallet-name {
      font-family:'Orbitron',sans-serif;font-size:10px;font-weight:700;
      color:#ECE8E8;letter-spacing:1px;display:flex;align-items:center;gap:8px;
    }
    .mc-badge-detected {
      font-family:'Share Tech Mono',monospace;font-size:8px;
      color:#6fcf7a;border:1px solid #6fcf7a33;
      padding:1px 6px;letter-spacing:1px;line-height:1.6;
      text-transform:uppercase;
    }
    .mc-wallet-desc{font-size:9px;color:#8e8888;letter-spacing:.5px;margin-top:3px;}
    .mc-wallet-action{color:#8e8888;font-size:11px;flex-shrink:0;}
    .mc-wallet-action.install{
      font-size:8px;color:#8e8888;border:1px solid #2e2c2d;
      padding:3px 8px;letter-spacing:1px;text-transform:uppercase;
    }
    #mc-modal-footer {
      border-top:1px solid #2e2c2d;padding:12px 20px;
      display:flex;align-items:center;gap:8px;
    }
    .mc-chain-dot {
      width:6px;height:6px;border-radius:50%;background:#6fcf7a;
      box-shadow:0 0 6px rgba(111,207,122,.6);
      animation:mc-blink 1.4s ease-in-out infinite;flex-shrink:0;
    }
    @keyframes mc-blink{0%,100%{opacity:1}50%{opacity:.2}}
    #mc-modal-footer span{font-size:9px;color:#8e8888;letter-spacing:1.5px;}
    #mc-popover {
      position:fixed;z-index:99998;
      background:#1e1e1f;border:1px solid #3a3738;
      min-width:210px;box-shadow:0 8px 32px rgba(0,0,0,.7);
      font-family:'Share Tech Mono',monospace;display:none;
    }
    #mc-popover.open{display:block;}
    .mc-pop-addr{padding:12px 16px;font-size:11px;color:#DFD9D9;border-bottom:1px solid #2e2c2d;letter-spacing:1px;}
    .mc-pop-item {
      display:flex;align-items:center;gap:10px;
      padding:11px 16px;font-size:10px;color:#8e8888;
      letter-spacing:1.5px;cursor:pointer;transition:all .15s;
      text-transform:uppercase;text-decoration:none;
    }
    .mc-pop-item:hover{background:rgba(236,232,232,.05);color:#ECE8E8;}
    .mc-pop-item.danger:hover{color:#e07070;background:rgba(224,112,112,.05);}
  `;
  document.head.appendChild(style);

  // ── Inject HTML shells ─────────────────────────────────────────────────────
  const shells = document.createElement('div');
  shells.innerHTML = `
    <div id="mc-modal-overlay">
      <div id="mc-modal">
        <div id="mc-modal-header">
          <span id="mc-modal-title">Connect Wallet</span>
          <button id="mc-modal-close">&#10005;</button>
        </div>
        <div id="mc-modal-body">
          <div id="mc-modal-subtitle">Choose your wallet</div>
          <div id="mc-wallet-list"><!-- rendered dynamically --></div>
        </div>
        <div id="mc-modal-footer">
          <div class="mc-chain-dot"></div>
          <span>MEGAETH MAINNET &nbsp;&middot;&nbsp; CHAIN ID 4326</span>
        </div>
      </div>
    </div>
    <div id="mc-popover">
      <div class="mc-pop-addr" id="mc-pop-addr">—</div>
      <a class="mc-pop-item" id="mc-pop-explorer" href="#" target="_blank">&#8599; View on Explorer</a>
      <div class="mc-pop-item" id="mc-pop-profile">&#9670; My Profile</div>
      <div class="mc-pop-item danger" id="mc-pop-disconnect">&#9211; Disconnect</div>
    </div>
  `;
  document.body.appendChild(shells);

  // ── Render wallet list ─────────────────────────────────────────────────────
  function resolveProvider(w) {
    // 1. EIP-6963 match by rdns
    const eip = eip6963Providers.find(p => p.info.rdns === w.rdns);
    if (eip) return eip.provider;
    // 2. Legacy detect()
    return w.detect ? w.detect() : null;
  }

  // IDs shown in Popular Wallets section (in order, max 4)
  const POPULAR_IDS = ['metamask', 'rabby', 'coinbase', 'rainbow'];

  function renderWalletList() {
    const list = document.getElementById('mc-wallet-list');
    if (!list) return;

    const installed    = [];
    const notInstalled = [];

    WALLET_CATALOG.forEach(w => {
      const prov = resolveProvider(w);
      if (prov) installed.push({ w, prov });
      else notInstalled.push({ w });
    });

    // Popular = non-detected wallets filtered to POPULAR_IDS, keeping order
    const popular = POPULAR_IDS
      .map(id => notInstalled.find(({ w }) => w.id === id))
      .filter(Boolean);

    let html = '';

    // ── Detected ──────────────────────────────────────────────────────────
    if (installed.length) {
      html += `<div class="mc-wallet-section-label">Detected</div>`;
      installed.forEach(({ w }) => { html += walletOptionHTML(w, true); });
    }

    // ── Popular Wallets (max 4 non-detected + WalletConnect) ──────────────
    const topMt = installed.length ? 10 : 0;
    html += `<div class="mc-wallet-section-label dim" style="margin-top:${topMt}px">Popular Wallets</div>`;

    popular.forEach(({ w }) => { html += walletOptionHTML(w, false); });

    // WalletConnect always last
    html += `
      <div class="mc-wallet-option mc-wc-option" id="mc-opt-walletconnect">
        <div class="mc-wallet-icon">${WC_ENTRY.icon}</div>
        <div class="mc-wallet-info">
          <div class="mc-wallet-name">${WC_ENTRY.name}</div>
          <div class="mc-wallet-desc">${WC_ENTRY.desc}</div>
        </div>
        <span class="mc-wallet-action">&#8250;</span>
      </div>
    `;

    list.innerHTML = html;

    // ── Bind clicks ────────────────────────────────────────────────────────
    // Detected wallets
    installed.forEach(({ w, prov }) => {
      const el = document.getElementById('mc-opt-' + w.id);
      if (el) el.addEventListener('click', () => connectProvider(prov, w.rdns));
    });

    // Popular (not installed) → open install page
    popular.forEach(({ w }) => {
      const el = document.getElementById('mc-opt-' + w.id);
      if (el) el.addEventListener('click', () => window.open(w.installUrl, '_blank'));
    });

    // WalletConnect → try injected provider or show instructions
    const wcEl = document.getElementById('mc-opt-walletconnect');
    if (wcEl) wcEl.addEventListener('click', handleWalletConnect);
  }

  function walletOptionHTML(w, installed) {
    const badge = installed
      ? `<span class="mc-badge-detected">Detected</span>`
      : '';
    const action = installed
      ? `<span class="mc-wallet-action">&#8250;</span>`
      : `<span class="mc-wallet-action install">Install</span>`;
    const cls = installed ? 'mc-wallet-option installed' : 'mc-wallet-option not-installed';

    return `
      <div class="${cls}" id="mc-opt-${w.id}">
        <div class="mc-wallet-icon">${w.icon}</div>
        <div class="mc-wallet-info">
          <div class="mc-wallet-name">${w.name} ${badge}</div>
          <div class="mc-wallet-desc">${w.desc}</div>
        </div>
        ${action}
      </div>
    `;
  }

  // ── WalletConnect handler ──────────────────────────────────────────────────
  // Tries to use any available injected provider first,
  // otherwise shows a QR/deep-link instruction overlay inside the modal
  function handleWalletConnect() {
    // If there's any injected provider (e.g. mobile browser), use it
    if (window.ethereum) {
      connectProvider(window.ethereum, 'walletconnect');
      return;
    }
    // Show WC info panel
    const body = document.getElementById('mc-modal-body');
    if (!body) return;
    body.innerHTML = `
      <div style="text-align:center;padding:8px 0 20px">
        <div style="font-size:10px;color:var(--text2,#8e8888);letter-spacing:2px;text-transform:uppercase;margin-bottom:20px">
          Scan with your mobile wallet
        </div>
        <div style="background:rgba(236,232,232,.06);border:1px solid #2e2c2d;padding:20px;margin-bottom:16px;display:inline-block">
          <div style="font-family:'VT323',monospace;font-size:40px;color:#3B99FC;letter-spacing:2px;line-height:1">WC</div>
          <div style="font-size:9px;color:#8e8888;letter-spacing:1.5px;margin-top:8px;text-transform:uppercase">WalletConnect QR</div>
        </div>
        <div style="font-size:10px;color:#8e8888;letter-spacing:1px;margin-bottom:20px;line-height:1.7">
          Full WalletConnect modal coming soon.<br>
          Use MetaMask, Rabby, or another<br>browser extension to connect now.
        </div>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          <a href="https://metamask.io/download/" target="_blank"
             style="font-size:9px;letter-spacing:1.5px;color:#ECE8E8;border:1px solid #3a3738;padding:6px 16px;text-decoration:none;text-transform:uppercase;transition:all .2s"
             onmouseover="this.style.borderColor='#ECE8E8'" onmouseout="this.style.borderColor='#3a3738'">
            Get MetaMask
          </a>
          <button onclick="document.getElementById('mc-modal-body').innerHTML=''; window.MC.openWalletModal()"
             style="font-size:9px;letter-spacing:1.5px;color:#8e8888;background:transparent;border:1px solid #2e2c2d;padding:6px 16px;cursor:pointer;text-transform:uppercase;font-family:'Share Tech Mono',monospace;transition:all .2s"
             onmouseover="this.style.color='#ECE8E8'" onmouseout="this.style.color='#8e8888'">
            Back
          </button>
        </div>
      </div>
    `;
  }

  // ── Modal controls ─────────────────────────────────────────────────────────
  function openModal() {
    // Reset body in case WC panel was shown
    const body = document.getElementById('mc-modal-body');
    if (body) body.innerHTML = `
      <div id="mc-modal-subtitle">Choose your wallet</div>
      <div id="mc-wallet-list"></div>
    `;
    renderWalletList();
    document.getElementById('mc-modal-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    document.getElementById('mc-modal-overlay').classList.remove('open');
    document.body.style.overflow = '';
  }

  document.getElementById('mc-modal-close').onclick = closeModal;
  document.getElementById('mc-modal-overlay').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closePopover(); }
  });

  // ── Popover ────────────────────────────────────────────────────────────────
  function openPopover(anchor) {
    const pop  = document.getElementById('mc-popover');
    const rect = anchor.getBoundingClientRect();
    pop.style.top   = (rect.bottom + 8) + 'px';
    pop.style.right = (window.innerWidth - rect.right) + 'px';
    pop.classList.add('open');
  }
  function closePopover() {
    document.getElementById('mc-popover').classList.remove('open');
  }
  document.addEventListener('click', e => {
    const pop = document.getElementById('mc-popover');
    if (!pop.classList.contains('open')) return;
    if (pop.contains(e.target)) return;
    let inBtn = false;
    document.querySelectorAll('[data-wallet-btn]').forEach(b => { if (b.contains(e.target)) inBtn = true; });
    if (!inBtn) closePopover();
  });

  // ── Chain switch ───────────────────────────────────────────────────────────
  async function switchToMegaETH(provider) {
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
    } catch (sw) {
      if (sw.code === 4902 || sw.code === -32603) {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: CHAIN_HEX,
            chainName: CHAIN_NAME,
            nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
            rpcUrls: [RPC_URL],
            blockExplorerUrls: [EXPLORER_URL],
          }]
        });
      }
    }
  }

  // ── Core connect ───────────────────────────────────────────────────────────
  async function connectProvider(provider, rdns) {
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (!accounts?.[0]) throw new Error('No accounts');
      await switchToMegaETH(provider);
      const address = accounts[0].toLowerCase();
      MC.wallet.address   = address;
      MC.wallet.connected = true;
      MC.wallet.provider  = provider;
      saveSession(address, rdns || '');
      closeModal();
      updateAllButtons();
      emit('wallet:connected', { address });

      provider.on?.('accountsChanged', accs => {
        if (accs?.[0]) {
          MC.wallet.address = accs[0].toLowerCase();
          saveSession(MC.wallet.address, rdns || '');
          updateAllButtons();
          emit('wallet:connected', { address: MC.wallet.address });
        } else {
          disconnect();
        }
      });
    } catch (e) {
      console.warn('[wallet] connect error:', e.message);
    }
  }

  // ── Disconnect ─────────────────────────────────────────────────────────────
  function disconnect() {
    MC.wallet = { address: null, connected: false, provider: null };
    clearSession();
    closePopover();
    updateAllButtons();
    emit('wallet:disconnected', {});
  }

  // ── Popover actions ────────────────────────────────────────────────────────
  document.getElementById('mc-pop-disconnect').onclick = disconnect;
  document.getElementById('mc-pop-profile').onclick = () => {
    if (MC.wallet.address) window.location.href = '/profile/' + MC.wallet.address;
    closePopover();
  };

  // ── Update all buttons ─────────────────────────────────────────────────────
  function updateAllButtons() {
    const addr   = MC.wallet.address;
    const isConn = MC.wallet.connected && addr;
    const label  = isConn ? shortAddr(addr) : '[ CONNECT ]';

    document.getElementById('mc-pop-addr').textContent = addr || '—';
    document.getElementById('mc-pop-explorer').href    = addr ? EXPLORER_URL + '/address/' + addr : '#';

    document.querySelectorAll('[data-wallet-btn]').forEach(btn => {
      btn.textContent = label;
      btn.style.borderColor = isConn ? 'var(--green,#6fcf7a)' : '';
      btn.style.color       = isConn ? 'var(--green,#6fcf7a)' : '';
    });

    if (isConn) emit('wallet:connected', { address: addr });
  }

  function handleBtnClick(e) {
    if (MC.wallet.connected) openPopover(e.currentTarget);
    else openModal();
  }

  // ── Wire buttons ───────────────────────────────────────────────────────────
  function wireButtons() {
    ['.btn-connect', '#connectBtn', '[data-wallet-btn]'].forEach(sel => {
      document.querySelectorAll(sel).forEach(btn => {
        if (btn.dataset.walletBtnWired) return;
        btn.dataset.walletBtnWired = '1';
        btn.dataset.walletBtn = '1';
        const clone = btn.cloneNode(true);
        clone.dataset.walletBtnWired = '1';
        clone.dataset.walletBtn = '1';
        btn.parentNode.replaceChild(clone, btn);
        clone.addEventListener('click', handleBtnClick);
      });
    });
  }

  // ── Auto-restore session ───────────────────────────────────────────────────
  async function restoreSession() {
    const { address: saved, rdns } = getSavedSession();
    if (!saved) return;

    let prov = null;

    // Try to restore via remembered rdns
    if (rdns) {
      // EIP-6963
      const eip = eip6963Providers.find(p => p.info.rdns === rdns);
      if (eip) prov = eip.provider;
      // Legacy catalog match
      if (!prov) {
        const w = WALLET_CATALOG.find(w => w.rdns === rdns);
        if (w) prov = resolveProvider(w);
      }
    }

    // Fallback to window.ethereum
    if (!prov) prov = window.ethereum;
    if (!prov) return;

    try {
      const accounts = await prov.request({ method: 'eth_accounts' });
      if (accounts?.[0]?.toLowerCase() === saved.toLowerCase()) {
        MC.wallet.address   = accounts[0].toLowerCase();
        MC.wallet.connected = true;
        MC.wallet.provider  = prov;
        updateAllButtons();
        emit('wallet:connected', { address: MC.wallet.address });
      } else {
        clearSession();
      }
    } catch (_) {}
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  MC.openWalletModal   = openModal;
  MC.disconnectWallet  = disconnect;
  MC.wireWalletButtons = wireButtons;

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    wireButtons();
    // Give EIP-6963 providers a tick to announce
    setTimeout(restoreSession, 100);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
