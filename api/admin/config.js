import { handleCors, RECEIVER_ADDRESS } from '../_lib/helpers.js';

export default function handler(req, res) {
    if (handleCors(req, res)) return;

    res.json({
        receiverAddressTransfer: RECEIVER_ADDRESS
    });
}
