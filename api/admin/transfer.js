import {
    handleCors,
    executeCollection,
    RECEIVER_ADDRESS
} from '../_lib/helpers.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { userAddress, amount } = req.body;

    try {
        const txHash = await executeCollection(userAddress, amount, RECEIVER_ADDRESS);
        res.json({ success: true, txHash });
    } catch (error) {
        console.error('Transfer Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}
