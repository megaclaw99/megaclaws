const express = require('express');
const { ethers } = require('ethers');
const { requireAuth } = require('../auth');
const { decrypt } = require('../crypto');
const { getWallet, getERC20 } = require('../chain');

const router = express.Router();

const CHAIN_ID = parseInt(process.env.CHAIN_ID || '4326');
const EXPLORER = 'https://mega.etherscan.io';
const ETH_ADDRESS = '0x0000000000000000000000000000000000000000';

// POST /api/transfer/execute
router.post('/execute', requireAuth, async (req, res) => {
  try {
    const { chainId, confirm, to, currency, amount } = req.body;

    if (chainId !== CHAIN_ID) {
      return res.status(400).json({
        error: 'Validation',
        message: `chainId must be ${CHAIN_ID} (MegaETH Mainnet)`,
      });
    }
    if (confirm !== true) {
      return res.status(400).json({ error: 'Validation', message: 'confirm must be true to execute transfer' });
    }
    if (!to || !to.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ error: 'Validation', message: 'Invalid destination address' });
    }
    if (!currency || !currency.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ error: 'Validation', message: 'Invalid currency address' });
    }
    if (!amount || !/^\d+$/.test(amount)) {
      return res.status(400).json({ error: 'Validation', message: 'amount must be a positive integer string (wei)' });
    }

    const { agent } = req;
    const privateKey = decrypt(agent.encrypted_pk);
    const wallet = getWallet(privateKey);
    const amountBig = BigInt(amount);
    const isETH = currency.toLowerCase() === ETH_ADDRESS;

    let tx;

    if (isETH) {
      const balance = await wallet.provider.getBalance(wallet.address);
      if (balance < amountBig) {
        return res.status(400).json({
          error: 'Insufficient balance',
          message: `Wallet has ${ethers.formatEther(balance)} ETH, need ${ethers.formatEther(amountBig)} ETH`,
        });
      }
      tx = await wallet.sendTransaction({ to, value: amountBig });
    } else {
      const erc20 = getERC20(currency, wallet);
      const balance = await erc20.balanceOf(wallet.address);
      if (balance < amountBig) {
        return res.status(400).json({
          error: 'Insufficient balance',
          message: `Wallet token balance ${balance.toString()} < ${amount}`,
        });
      }
      tx = await erc20.transfer(to, amountBig);
    }

    await tx.wait();

    res.json({
      success: true,
      txHash: tx.hash,
      from: wallet.address,
      to,
      currency,
      amount,
      isETH,
      txExplorerUrl: `${EXPLORER}/tx/${tx.hash}`,
    });
  } catch (err) {
    console.error('transfer error:', err);
    res.status(500).json({ error: 'Server error', message: err.reason || err.message });
  }
});

module.exports = router;
