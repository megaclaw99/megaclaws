const { ethers } = require('ethers');

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL, {
  chainId: parseInt(process.env.CHAIN_ID || '4326'),
  name: 'megaeth',
});

const FACTORY_ABI = [
  'function createToken(string name, string symbol) external returns (address)',
  'function getTokenCount() external view returns (uint256)',
  'function getCreatorTokens(address creator) external view returns (address[])',
  'function getCreatorTokenCount(address creator) external view returns (uint256)',
  'function allTokens(uint256) external view returns (address)',
  'event TokenCreated(address indexed token, address indexed creator, string name, string symbol, uint256 timestamp)',
];

const BONDING_CURVE_ABI = [
  'function buyTokens(uint256 minTokensOut) external payable',
  'function sellTokens(uint256 tokenAmount, uint256 minETHOut) external',
  'function getReserves() external view returns (uint256 reserveETH, uint256 reserveToken)',
  'function balanceOf(address account) external view returns (uint256)',
  'function totalSupply() external view returns (uint256)',
  'function name() external view returns (string)',
  'function symbol() external view returns (string)',
  'function migrated() external view returns (bool)',
  'function reserveETH() external view returns (uint256)',
  'function reserveToken() external view returns (uint256)',
  'function creator() external view returns (address)',
  'function feeDistributor() external view returns (address)',
  'function TOTAL_SUPPLY() external view returns (uint256)',
  'function MIGRATION_THRESHOLD() external view returns (uint256)',
  'function TRADE_FEE_BPS() external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'event TokensPurchased(address indexed buyer, uint256 ethIn, uint256 tokensOut, uint256 fee)',
  'event TokensSold(address indexed seller, uint256 tokensIn, uint256 ethOut, uint256 fee)',
  'event Migrated(uint256 ethAmount, uint256 tokenAmount)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

function getFactory(signerOrProvider = provider) {
  return new ethers.Contract(process.env.FACTORY_CONTRACT, FACTORY_ABI, signerOrProvider);
}

function getBondingCurve(tokenAddress, signerOrProvider = provider) {
  return new ethers.Contract(tokenAddress, BONDING_CURVE_ABI, signerOrProvider);
}

function getERC20(tokenAddress, signerOrProvider = provider) {
  return new ethers.Contract(tokenAddress, ERC20_ABI, signerOrProvider);
}

function getWallet(privateKey) {
  return new ethers.Wallet(privateKey, provider);
}

async function getETHBalance(address) {
  return provider.getBalance(address);
}

// Calculate slippage-adjusted minimum out
function applySlippage(amount, slippageBps) {
  const bps = BigInt(slippageBps);
  return (amount * (10000n - bps)) / 10000n;
}

// Estimate tokens out for a given ETH in (mirrors _calculateBuy)
async function estimateBuy(tokenAddress, ethIn) {
  const curve = getBondingCurve(tokenAddress);
  const [reserveETH, reserveToken] = await curve.getReserves();
  const feeBps = 100n;
  const fee = (ethIn * feeBps) / 10000n;
  const ethAfterFee = ethIn - fee;

  let tokensOut;
  if (reserveETH === 0n) {
    const TOTAL = 1_000_000_000n * (10n ** 18n);
    tokensOut = (ethAfterFee * TOTAL) / (20000n * (10n ** 18n));
  } else {
    const k = reserveETH * reserveToken;
    const newReserveETH = reserveETH + ethAfterFee;
    const newReserveToken = k / newReserveETH;
    tokensOut = reserveToken - newReserveToken;
  }
  return tokensOut;
}

// Estimate ETH out for a given token sell (mirrors _calculateSell)
async function estimateSell(tokenAddress, tokensIn) {
  const curve = getBondingCurve(tokenAddress);
  const [reserveETH, reserveToken] = await curve.getReserves();

  if (reserveETH === 0n || reserveToken === 0n) return 0n;

  const k = reserveETH * reserveToken;
  const newReserveToken = reserveToken + tokensIn;
  const newReserveETH = k / newReserveToken;
  const ethOut = reserveETH - newReserveETH;

  const feeBps = 100n;
  const fee = (ethOut * feeBps) / 10000n;
  return ethOut - fee;
}

module.exports = {
  provider,
  getFactory,
  getBondingCurve,
  getERC20,
  getWallet,
  getETHBalance,
  applySlippage,
  estimateBuy,
  estimateSell,
};
