/**
 * MegaClaw Wallet — shared wallet connection module
 * Loaded on all pages. Provides:
 *   - Multi-wallet modal (MetaMask, WalletConnect, Coinbase, Browser)
 *   - Disconnect via popover dropdown
 *   - Persists connection in localStorage
 *   - Emits window events: wallet:connected, wallet:disconnected
 *   - Auto-wires any element with data-wallet-btn attribute
 */
(function () {
  'use strict';

  const CHAIN_ID     = 4326;
  const CHAIN_HEX    = '0x10E6';
  const CHAIN_NAME   = 'MegaETH Mainnet';
  const RPC_URL      = 'https://mainnet.megaeth.com/rpc';
  const EXPLORER_URL = 'https://mega.etherscan.io';
  const LS_KEY       = 'mc_wallet';

  // ── State ──────────────────────────────────────────────────────────────────
  window.MC = window.MC || {};
  MC.wallet = {
    address: null,
    connected: false,
    provider: null,
  };

  // ── Utils ──────────────────────────────────────────────────────────────────
  function shortAddr(a) {
    return a ? a.slice(0, 6) + '...' + a.slice(-4) : '';
  }
  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
  function saveSession(address) {
    try { localStorage.setItem(LS_KEY, address); } catch (_) {}
  }
  function clearSession() {
    try { localStorage.removeItem(LS_KEY); } catch (_) {}
  }
  function getSavedSession() {
    try { return localStorage.getItem(LS_KEY); } catch (_) { return null; }
  }

  // ── Inject CSS ─────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    /* ── Wallet Modal ── */
    #mc-modal-overlay {
      position: fixed; inset: 0; z-index: 99999;
      background: rgba(10,10,11,.85); backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      padding: 24px; opacity: 0; pointer-events: none;
      transition: opacity .2s;
    }
    #mc-modal-overlay.open { opacity: 1; pointer-events: all; }
    #mc-modal {
      background: #222223; border: 1px solid #3a3738;
      width: 100%; max-width: 400px;
      box-shadow: 0 0 80px rgba(0,0,0,.8);
      animation: mcModalIn .2s ease;
      font-family: 'Share Tech Mono', monospace;
    }
    @keyframes mcModalIn {
      from { transform: translateY(16px); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    #mc-modal-header {
      background: rgba(236,232,232,.04);
      border-bottom: 1px solid #2e2c2d;
      padding: 16px 20px;
      display: flex; align-items: center; justify-content: space-between;
    }
    #mc-modal-title {
      font-family: 'Orbitron', sans-serif;
      font-size: 12px; font-weight: 700;
      letter-spacing: 3px; color: #ECE8E8;
      text-transform: uppercase;
    }
    #mc-modal-close {
      background: transparent; border: 1px solid #2e2c2d;
      color: #8e8888; font-family: 'Share Tech Mono', monospace;
      font-size: 11px; letter-spacing: 1px; padding: 4px 12px;
      cursor: pointer; transition: all .2s; text-transform: uppercase;
    }
    #mc-modal-close:hover { border-color: #e07070; color: #e07070; }
    #mc-modal-body { padding: 24px; }
    #mc-modal-subtitle {
      font-size: 10px; color: #8e8888; letter-spacing: 2px;
      text-transform: uppercase; margin-bottom: 16px; text-align: center;
    }
    .mc-wallet-option {
      display: flex; align-items: center; gap: 14px;
      padding: 14px 16px; margin-bottom: 6px;
      background: rgba(236,232,232,.025);
      border: 1px solid #2e2c2d;
      cursor: pointer; transition: all .15s;
      text-decoration: none;
    }
    .mc-wallet-option:hover {
      background: rgba(236,232,232,.06);
      border-color: #3a3738;
    }
    .mc-wallet-icon {
      width: 36px; height: 36px;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; flex-shrink: 0;
      background: rgba(236,232,232,.04); border: 1px solid #2e2c2d;
    }
    .mc-wallet-info { flex: 1; }
    .mc-wallet-name {
      font-family: 'Orbitron', sans-serif;
      font-size: 11px; font-weight: 700;
      color: #ECE8E8; letter-spacing: 1px;
    }
    .mc-wallet-desc {
      font-size: 9px; color: #8e8888;
      letter-spacing: 1px; margin-top: 3px;
    }
    .mc-wallet-arrow { color: #8e8888; font-size: 14px; }
    .mc-wallet-option.disabled { opacity: .4; cursor: not-allowed; pointer-events: none; }
    #mc-modal-footer {
      border-top: 1px solid #2e2c2d;
      padding: 14px 20px;
      display: flex; align-items: center; gap: 8px;
    }
    .mc-chain-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #6fcf7a;
      box-shadow: 0 0 6px rgba(111,207,122,.6);
      animation: mc-blink 1.4s ease-in-out infinite; flex-shrink: 0;
    }
    @keyframes mc-blink { 0%,100%{opacity:1} 50%{opacity:.2} }
    #mc-modal-footer span {
      font-size: 9px; color: #8e8888; letter-spacing: 1.5px;
    }

    /* ── Disconnect Popover ── */
    #mc-popover {
      position: fixed; z-index: 99998;
      background: #222223; border: 1px solid #3a3738;
      min-width: 200px;
      box-shadow: 0 8px 32px rgba(0,0,0,.6);
      font-family: 'Share Tech Mono', monospace;
      display: none;
    }
    #mc-popover.open { display: block; }
    .mc-pop-addr {
      padding: 12px 16px;
      font-size: 11px; color: #DFD9D9;
      border-bottom: 1px solid #2e2c2d;
      letter-spacing: 1px;
    }
    .mc-pop-item {
      display: flex; align-items: center; gap: 10px;
      padding: 11px 16px; font-size: 10px;
      color: #8e8888; letter-spacing: 1.5px;
      cursor: pointer; transition: all .15s;
      text-transform: uppercase; text-decoration: none;
    }
    .mc-pop-item:hover { background: rgba(236,232,232,.05); color: #ECE8E8; }
    .mc-pop-item.danger:hover { color: #e07070; background: rgba(224,112,112,.05); }
  `;
  document.head.appendChild(style);

  // ── Inject Modal HTML ──────────────────────────────────────────────────────
  const modalEl = document.createElement('div');
  modalEl.innerHTML = `
    <div id="mc-modal-overlay">
      <div id="mc-modal">
        <div id="mc-modal-header">
          <span id="mc-modal-title">Connect Wallet</span>
          <button id="mc-modal-close">&#10005;</button>
        </div>
        <div id="mc-modal-body">
          <div id="mc-modal-subtitle">Choose your wallet</div>
          <div id="mc-metamask" class="mc-wallet-option">
            <div class="mc-wallet-icon">🦊</div>
            <div class="mc-wallet-info">
              <div class="mc-wallet-name">MetaMask</div>
              <div class="mc-wallet-desc">Connect with MetaMask browser extension</div>
            </div>
            <span class="mc-wallet-arrow">›</span>
          </div>
          <div id="mc-coinbase" class="mc-wallet-option">
            <div class="mc-wallet-icon">🔵</div>
            <div class="mc-wallet-info">
              <div class="mc-wallet-name">Coinbase Wallet</div>
              <div class="mc-wallet-desc">Connect with Coinbase Wallet</div>
            </div>
            <span class="mc-wallet-arrow">›</span>
          </div>
          <div id="mc-injected" class="mc-wallet-option">
            <div class="mc-wallet-icon">◈</div>
            <div class="mc-wallet-info">
              <div class="mc-wallet-name">Browser Wallet</div>
              <div class="mc-wallet-desc">Any injected EIP-1193 wallet</div>
            </div>
            <span class="mc-wallet-arrow">›</span>
          </div>
        </div>
        <div id="mc-modal-footer">
          <div class="mc-chain-dot"></div>
          <span>MEGAETH MAINNET &nbsp;·&nbsp; CHAIN ID 4326</span>
        </div>
      </div>
    </div>
    <div id="mc-popover">
      <div class="mc-pop-addr" id="mc-pop-addr">—</div>
      <a class="mc-pop-item" id="mc-pop-explorer" href="#" target="_blank">↗ View on Explorer</a>
      <div class="mc-pop-item" id="mc-pop-profile">◈ My Profile</div>
      <div class="mc-pop-item danger" id="mc-pop-disconnect">⏻ Disconnect</div>
    </div>
  `;
  document.body.appendChild(modalEl);

  // ── Modal controls ─────────────────────────────────────────────────────────
  function openModal() {
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
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closePopover(); } });

  // ── Popover controls ───────────────────────────────────────────────────────
  function openPopover(anchorEl) {
    const pop = document.getElementById('mc-popover');
    const rect = anchorEl.getBoundingClientRect();
    pop.style.top  = (rect.bottom + 8) + 'px';
    pop.style.right = (window.innerWidth - rect.right) + 'px';
    pop.classList.add('open');
  }
  function closePopover() {
    document.getElementById('mc-popover').classList.remove('open');
  }
  document.addEventListener('click', e => {
    const pop = document.getElementById('mc-popover');
    if (pop.classList.contains('open') && !pop.contains(e.target)) {
      const btns = document.querySelectorAll('[data-wallet-btn]');
      let inBtn = false;
      btns.forEach(b => { if (b.contains(e.target)) inBtn = true; });
      if (!inBtn) closePopover();
    }
  });

  // ── Switch / add MegaETH chain ─────────────────────────────────────────────
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

  // ── Core connect flow ──────────────────────────────────────────────────────
  async function connectProvider(provider) {
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (!accounts || !accounts[0]) throw new Error('No accounts returned');
      await switchToMegaETH(provider);
      const address = accounts[0].toLowerCase();
      MC.wallet.address   = address;
      MC.wallet.connected = true;
      MC.wallet.provider  = provider;
      saveSession(address);
      closeModal();
      updateAllButtons();
      emit('wallet:connected', { address });

      // Listen for account/chain changes
      provider.on('accountsChanged', accounts => {
        if (accounts[0]) {
          MC.wallet.address = accounts[0].toLowerCase();
          saveSession(MC.wallet.address);
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
    MC.wallet.address   = null;
    MC.wallet.connected = false;
    MC.wallet.provider  = null;
    clearSession();
    closePopover();
    updateAllButtons();
    emit('wallet:disconnected', {});
  }

  // ── Wallet option handlers ─────────────────────────────────────────────────
  document.getElementById('mc-metamask').onclick = async () => {
    const prov = window.ethereum?.providers?.find(p => p.isMetaMask) || (window.ethereum?.isMetaMask ? window.ethereum : null);
    if (!prov) { window.open('https://metamask.io/download/', '_blank'); return; }
    await connectProvider(prov);
  };

  document.getElementById('mc-coinbase').onclick = async () => {
    const prov = window.ethereum?.providers?.find(p => p.isCoinbaseWallet) || (window.ethereum?.isCoinbaseWallet ? window.ethereum : null);
    if (!prov) { window.open('https://www.coinbase.com/wallet', '_blank'); return; }
    await connectProvider(prov);
  };

  document.getElementById('mc-injected').onclick = async () => {
    if (!window.ethereum) { alert('No wallet detected. Install MetaMask or a compatible browser wallet.'); return; }
    await connectProvider(window.ethereum);
  };

  // ── Popover actions ────────────────────────────────────────────────────────
  document.getElementById('mc-pop-disconnect').onclick = disconnect;
  document.getElementById('mc-pop-profile').onclick = () => {
    if (MC.wallet.address) window.location.href = '/profile/' + MC.wallet.address;
    closePopover();
  };

  // ── Update all wallet buttons on page ─────────────────────────────────────
  function updateAllButtons() {
    const addr   = MC.wallet.address;
    const isConn = MC.wallet.connected && addr;
    const label  = isConn ? shortAddr(addr) : '[ CONNECT ]';

    // Update popover
    document.getElementById('mc-pop-addr').textContent    = addr || '—';
    document.getElementById('mc-pop-explorer').href        = addr ? EXPLORER_URL + '/address/' + addr : '#';

    // Update all registered buttons
    document.querySelectorAll('[data-wallet-btn]').forEach(btn => {
      btn.textContent = label;
      if (isConn) {
        btn.style.borderColor = 'var(--green,#6fcf7a)';
        btn.style.color       = 'var(--green,#6fcf7a)';
      } else {
        btn.style.borderColor = '';
        btn.style.color       = '';
      }
    });

    // Emit for page-specific handlers
    if (isConn) emit('wallet:connected', { address: addr });
  }

  // ── Button click handler (connect or show popover) ─────────────────────────
  function handleBtnClick(e) {
    if (MC.wallet.connected) {
      openPopover(e.currentTarget);
    } else {
      openModal();
    }
  }

  // ── Wire existing buttons with class .btn-connect or id=connectBtn ─────────
  function wireButtons() {
    const selectors = ['.btn-connect', '#connectBtn', '[data-wallet-btn]'];
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(btn => {
        if (!btn.dataset.walletBtnWired) {
          btn.dataset.walletBtnWired = '1';
          btn.dataset.walletBtn = '1';
          // Remove old click handlers by cloning
          const clone = btn.cloneNode(true);
          btn.parentNode.replaceChild(clone, btn);
          clone.dataset.walletBtnWired = '1';
          clone.dataset.walletBtn = '1';
          clone.addEventListener('click', handleBtnClick);
        }
      });
    });
  }

  // ── Auto-restore session ───────────────────────────────────────────────────
  async function restoreSession() {
    const saved = getSavedSession();
    if (!saved || !window.ethereum) return;
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (accounts[0] && accounts[0].toLowerCase() === saved.toLowerCase()) {
        MC.wallet.address   = accounts[0].toLowerCase();
        MC.wallet.connected = true;
        MC.wallet.provider  = window.ethereum;
        updateAllButtons();
        emit('wallet:connected', { address: MC.wallet.address });
      } else {
        clearSession();
      }
    } catch (_) {}
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  MC.openWalletModal  = openModal;
  MC.disconnectWallet = disconnect;
  MC.wireWalletButtons = wireButtons;

  // ── Init on DOM ready ──────────────────────────────────────────────────────
  function init() {
    wireButtons();
    restoreSession();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
