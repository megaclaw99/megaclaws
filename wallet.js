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
      icon: `<svg viewBox="0 0 36 36" width="24" height="24"><rect width="36" height="36" rx="8" fill="#8B5CF6"/><text x="18" y="25" text-anchor="middle" font-family="monospace" font-size="15" font-weight="bold" fill="white">R</text></svg>`,
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
      icon: `<svg viewBox="0 0 36 36" width="24" height="24"><rect width="36" height="36" rx="8" fill="#E2761B"/><text x="18" y="25" text-anchor="middle" font-family="monospace" font-size="15" font-weight="bold" fill="white">M</text></svg>`,
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
      icon: `<svg viewBox="0 0 36 36" width="24" height="24"><rect width="36" height="36" rx="8" fill="#2962EF"/><text x="18" y="25" text-anchor="middle" font-family="monospace" font-size="13" font-weight="bold" fill="white">ZR</text></svg>`,
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
      icon: `<svg viewBox="0 0 36 36" width="24" height="24"><rect width="36" height="36" rx="8" fill="#0052FF"/><text x="18" y="25" text-anchor="middle" font-family="monospace" font-size="13" font-weight="bold" fill="white">CB</text></svg>`,
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
      icon: `<svg viewBox="0 0 36 36" width="24" height="24"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#FF4D4D"/><stop offset="50%" stop-color="#FFAD33"/><stop offset="100%" stop-color="#4D9FFF"/></linearGradient></defs><rect width="36" height="36" rx="8" fill="url(#rg)"/><text x="18" y="25" text-anchor="middle" font-family="monospace" font-size="15" font-weight="bold" fill="white">RW</text></svg>`,
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
      icon: `<svg viewBox="0 0 36 36" width="24" height="24"><rect width="36" height="36" rx="8" fill="#000"/><text x="18" y="25" text-anchor="middle" font-family="monospace" font-size="11" font-weight="bold" fill="white">OKX</text></svg>`,
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
      icon: `<svg viewBox="0 0 36 36" width="24" height="24"><rect width="36" height="36" rx="8" fill="#3375BB"/><text x="18" y="25" text-anchor="middle" font-family="monospace" font-size="12" font-weight="bold" fill="white">TW</text></svg>`,
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
      icon: `<svg viewBox="0 0 36 36" width="24" height="24"><rect width="36" height="36" rx="8" fill="#AB9FF2"/><text x="18" y="25" text-anchor="middle" font-family="monospace" font-size="12" font-weight="bold" fill="white">PH</text></svg>`,
      installUrl: 'https://phantom.app/download',
      detect: () => {
        if (window.phantom?.ethereum) return window.phantom.ethereum;
        if (window.ethereum?.isPhantom) return window.ethereum;
        return null;
      }
    },
  ];

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

  function renderWalletList() {
    const list = document.getElementById('mc-wallet-list');
    if (!list) return;

    const installed   = [];
    const notInstalled = [];

    WALLET_CATALOG.forEach(w => {
      const prov = resolveProvider(w);
      if (prov) installed.push({ w, prov });
      else notInstalled.push({ w });
    });

    let html = '';

    if (installed.length) {
      html += `<div class="mc-wallet-section-label">Detected</div>`;
      installed.forEach(({ w }) => {
        html += walletOptionHTML(w, true);
      });
    }

    if (notInstalled.length) {
      html += `<div class="mc-wallet-section-label dim" style="margin-top:${installed.length?10:0}px">Other Wallets</div>`;
      notInstalled.forEach(({ w }) => {
        html += walletOptionHTML(w, false);
      });
    }

    list.innerHTML = html;

    // Bind click events
    WALLET_CATALOG.forEach(w => {
      const el = document.getElementById('mc-opt-' + w.id);
      if (!el) return;
      const prov = resolveProvider(w);
      if (prov) {
        el.addEventListener('click', () => connectProvider(prov, w.rdns));
      } else {
        // open install link
        el.addEventListener('click', () => window.open(w.installUrl, '_blank'));
      }
    });
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

  // ── Modal controls ─────────────────────────────────────────────────────────
  function openModal() {
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
