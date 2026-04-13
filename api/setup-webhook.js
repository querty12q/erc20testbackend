import axios from 'axios';
import { handleCors, TELEGRAM_BOT_TOKEN } from './_lib/helpers.js';

// Call this endpoint ONCE after deployment to register your Telegram webhook.
// GET /setup-webhook?url=https://your-vercel-app.vercel.app
export default async function handler(req, res) {
    if (handleCors(req, res)) return;

    const vercelUrl = req.query.url;

    if (!vercelUrl) {
        return res.status(400).json({
            error: 'Missing "url" query parameter. Example: /setup-webhook?url=https://your-app.vercel.app'
        });
    }

    if (!TELEGRAM_BOT_TOKEN) {
        return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN not configured.' });
    }

    const webhookUrl = `${vercelUrl}/telegram-webhook`;

    try {
        const response = await axios.post(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,
            { url: webhookUrl }
        );

        console.log('Webhook set response:', response.data);

        res.json({
            success: true,
            message: `Telegram webhook set to: ${webhookUrl}`,
            telegramResponse: response.data
        });
    } catch (error) {
        console.error('Failed to set webhook:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
}
