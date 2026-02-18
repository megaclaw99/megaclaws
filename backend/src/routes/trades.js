const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { ethers } = require('ethers');
const db = require('../db');
const { requireAuth } = require('../auth');
const { decrypt } = require('../crypto');
const { getFactory, getERC20, getWallet, applySlippage, estimateBuy, estimateSell, FACTORY_ABI } = require('../chain');

const router = express.Router();

const EXPLORER = 'https://mega.etherscan.io';
const FACTORY_ADDRESS = process.env.FACTORY_CONTRACT;

// POST /api/trades/execute
router.post('/execute', requireAuth, async (req, res) => {
  try {
    const { tokenAddress, tradeDirection, amount, slippageBps = 300 } = req.body;

    if (!tokenAddress || !tokenAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ error: 'Validation', message: 'Invalid tokenAddress' });
    }
    if (!['BUY', 'SELL'].includes(tradeDirection)) {
      return res.status(400).json({ error: 'Validation', message: 'tradeDirection must be BUY or SELL' });
    }
    if (!amount || !/^\d+$/.test(amount)) {
      return res.status(400).json({ error: 'Validation', message: 'amount must be a positive integer string (wei)' });
    }
    if (slippageBps < 0 || slippageBps > 5000) {
      return res.status(400).json({ error: 'Validation', message: 'slippageBps must be 0-5000' });
    }

    // Check token exists in DB
    const tokenRow = db.prepare(
      'SELECT * FROM tokens WHERE LOWER(token_address) = LOWER(?)'
    ).get(tokenAddress);

    if (!tokenRow) {
      return res.status(404).json({ error: 'Not found', message: 'Token not found. Only tokens deployed via MegaClaw Factory are supported.' });
    }

    if (tokenRow.migrated) {
      return res.status(400).json({ error: 'Migrated', message: 'Token has graduated to Kumbaya V3. Trade there directly.' });
    }

    const { agent } = req;
    const privateKey = decrypt(agent.encrypted_pk);
    const wallet = getWallet(privateKey);
    const factory = getFactory(wallet);
    const amountBig = BigInt(amount);
    const slipBig = BigInt(slippageBps);

    let tx, receipt, amountIn, amountOut, fee;

    if (tradeDirection === 'BUY') {
      // amount = ETH to spend (wei)
      const balance = await wallet.provider.getBalance(wallet.address);
      if (balance < amountBig) {
        return res.status(400).json({
          error: 'Insufficient balance',
          message: `Agent wallet has ${ethers.formatEther(balance)} ETH, need ${ethers.formatEther(amountBig)} ETH`,
        });
      }

      const estimated = await estimateBuy(tokenAddress, amountBig);
      const minTokensOut = applySlippage(estimated, slipBig);

      tx = await factory.buyTokens(tokenAddress, minTokensOut, { 
        value: amountBig,
        gasLimit: 500000n 
      });
      receipt = await tx.wait();

      // Parse TokensPurchased event from factory
      const iface = new ethers.Interface(FACTORY_ABI);
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === 'TokensPurchased') {
            amountIn = parsed.args.ethIn.toString();
            amountOut = parsed.args.tokensOut.toString();
            fee = parsed.args.fee.toString();
            break;
          }
        } catch {}
      }

      amountIn = amountIn || amountBig.toString();
      amountOut = amountOut || estimated.toString();
      fee = fee || '0';

    } else {
      // SELL — amount = token amount (wei)
      const token = getERC20(tokenAddress, wallet);
      const tokenBalance = await token.balanceOf(wallet.address);
      if (tokenBalance < amountBig) {
        return res.status(400).json({
          error: 'Insufficient balance',
          message: `Agent wallet has ${ethers.formatEther(tokenBalance)} tokens, need ${ethers.formatEther(amountBig)}`,
        });
      }

      const estimated = await estimateSell(tokenAddress, amountBig);
      const minETHOut = applySlippage(estimated, slipBig);

      // Check and set allowance
      const allowance = await token.allowance(wallet.address, FACTORY_ADDRESS);
      if (allowance < amountBig) {
        const approveTx = await token.approve(FACTORY_ADDRESS, ethers.MaxUint256);
        await approveTx.wait();
      }

      tx = await factory.sellTokens(tokenAddress, amountBig, minETHOut, {
        gasLimit: 500000n
      });
      receipt = await tx.wait();

      // Parse TokensSold event from factory
      const iface = new ethers.Interface(FACTORY_ABI);
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === 'TokensSold') {
            amountIn = parsed.args.tokensIn.toString();
            amountOut = parsed.args.ethOut.toString();
            fee = '0'; // No fee on sells in V4
            break;
          }
        } catch {}
      }

      amountIn = amountIn || amountBig.toString();
      amountOut = amountOut || estimated.toString();
      fee = fee || '0';
    }

    const tradeId = uuidv4();
    db.prepare(`
      INSERT INTO trades (id, token_address, agent_id, trader_address, direction, amount_in, amount_out, fee, tx_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tradeId, tokenAddress.toLowerCase(), agent.id, wallet.address, tradeDirection, amountIn, amountOut, fee, tx.hash);

    res.json({
      id: tradeId,
      tokenAddress,
      tradeDirection,
      amountIn,
      amountOut,
      fee,
      trader: wallet.address,
      txHash: tx.hash,
      txExplorerUrl: `${EXPLORER}/tx/${tx.hash}`,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('trade error:', err);

    const msg = err.reason || err.shortMessage || err.message || 'Unknown error';
    if (msg.includes('Slippage') || msg.includes('slippage')) {
      return res.status(400).json({ error: 'Slippage', message: 'Trade failed: slippage exceeded. Try increasing slippageBps.' });
    }
    if (msg.includes('graduated') || msg.includes('Graduated')) {
      return res.status(400).json({ error: 'Graduated', message: 'Token has graduated to Kumbaya V3.' });
    }
    res.status(500).json({ error: 'Server error', message: msg });
  }
});

module.exports = router;
