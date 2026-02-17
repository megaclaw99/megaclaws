const express = require('express');
const { provider } = require('../chain');

const router = express.Router();

// GET /api/health
router.get('/', async (req, res) => {
  try {
    const block = await provider.getBlockNumber();
    res.json({
      status: 'ok',
      chain: 'MegaETH Mainnet',
      chainId: 4326,
      block,
      rpc: process.env.RPC_URL,
      factory: process.env.FACTORY_CONTRACT,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// GET /api/oracle/eth
router.get('/oracle/eth', async (req, res) => {
  try {
    // Fetch ETH price from a public oracle
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    const data = await response.json();
    const price = data?.ethereum?.usd || 0;
    res.json({
      price: price.toString(),
      currency: 'USD',
      source: 'coingecko',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Oracle error', message: err.message });
  }
});

module.exports = router;
