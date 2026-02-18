const { ethers } = require('ethers');

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL, {
  chainId: parseInt(process.env.CHAIN_ID || '4326'),
  name: 'megaeth',
});

// V4 Factory ABI - bonding curve with Kumbaya graduation
const FACTORY_ABI = [
  // Token creation
  'function createToken(string name, string symbol) external returns (address)',
  
  // Trading
  'function buyTokens(address token, uint256 minTokensOut) external payable returns (uint256 tokensOut)',
  'function sellTokens(address token, uint256 tokenAmount, uint256 minETHOut) external returns (uint256 ethOut)',
  
  // View functions
  'function getTokenInfo(address token) external view returns (address creator, uint256 reserveETH, uint256 reserveTokens, uint256 creatorFees, bool graduated, address pool, uint256 positionId)',
  'function getTokenCount() external view returns (uint256)',
  'function getCurrentPrice(address token) external view returns (uint256 priceInWei)',
  'function getTokensForETH(address token, uint256 ethAmount) external view returns (uint256 tokensOut, uint256 fee)',
  'function getETHForTokens(address token, uint256 tokenAmount) external view returns (uint256 ethOut)',
  'function getBondingCurveProgress(address token) external view returns (uint256 currentETH, uint256 targetETH, uint256 progressBps)',
  'function allTokens(uint256) external view returns (address)',
  
  // Fee withdrawal
  'function withdrawCreatorFees(address token) external',
  
  // Constants
  'function TOTAL_SUPPLY() external view returns (uint256)',
  'function VIRTUAL_ETH() external view returns (uint256)',
  'function GRADUATION_THRESHOLD() external view returns (uint256)',
  'function PLATFORM_FEE_BPS() external view returns (uint256)',
  
  // Events
  'event TokenCreated(address indexed token, address indexed creator, string name, string symbol, uint256 timestamp)',
  'event TokensPurchased(address indexed token, address indexed buyer, uint256 ethIn, uint256 tokensOut, uint256 fee, uint256 newReserveETH, uint256 newReserveTokens)',
  'event TokensSold(address indexed token, address indexed seller, uint256 tokensIn, uint256 ethOut, uint256 newReserveETH, uint256 newReserveTokens)',
  'event TokenGraduated(address indexed token, address indexed pool, uint256 ethLiquidity, uint256 tokenLiquidity, uint256 positionId)',
  'event CreatorFeesWithdrawn(address indexed token, address indexed creator, uint256 amount)',
];

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

function getFactory(signerOrProvider = provider) {
  return new ethers.Contract(process.env.FACTORY_CONTRACT, FACTORY_ABI, signerOrProvider);
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

// Estimate tokens out for a given ETH in
async function estimateBuy(tokenAddress, ethIn) {
  const factory = getFactory();
  const result = await factory.getTokensForETH(tokenAddress, ethIn);
  return result.tokensOut;
}

// Estimate ETH out for a given token sell
async function estimateSell(tokenAddress, tokensIn) {
  const factory = getFactory();
  return await factory.getETHForTokens(tokenAddress, tokensIn);
}

// Get token info from factory
async function getTokenInfo(tokenAddress) {
  const factory = getFactory();
  const info = await factory.getTokenInfo(tokenAddress);
  return {
    creator: info.creator,
    reserveETH: info.reserveETH,
    reserveTokens: info.reserveTokens,
    creatorFees: info.creatorFees,
    graduated: info.graduated,
    pool: info.pool,
    positionId: info.positionId,
  };
}

// Get bonding curve progress
async function getBondingProgress(tokenAddress) {
  const factory = getFactory();
  const progress = await factory.getBondingCurveProgress(tokenAddress);
  return {
    currentETH: progress.currentETH,
    targetETH: progress.targetETH,
    progressBps: Number(progress.progressBps),
  };
}

module.exports = {
  provider,
  getFactory,
  getERC20,
  getWallet,
  getETHBalance,
  applySlippage,
  estimateBuy,
  estimateSell,
  getTokenInfo,
  getBondingProgress,
  FACTORY_ABI,
};
