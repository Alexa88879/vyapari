const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { sendMessage, validateTelegramUpdate, sendTestAlert } = require('./lib/telegramBot');

// Initialize Firestore
const db = admin.firestore();

/**
 * Telegram webhook handler
 * Receives and processes updates from Telegram Bot API
 */
exports.telegramWebhook = onRequest(async (req, res) => {
  try {
    // Only accept POST requests
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    // Validate secret token
    const secretToken = req.headers['x-telegram-bot-api-secret-token'];
    const update = req.body;

    if (!validateTelegramUpdate(update, secretToken)) {
      console.warn('Invalid Telegram update');
      return res.status(403).send('Forbidden');
    }

    // Extract message data
    const message = update.message;
    if (!message || !message.text) {
      // Ignore non-text messages
      return res.status(200).send('OK');
    }

    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text.trim();
    const command = text.split(' ')[0].toLowerCase();

    console.log(`Received command: ${command} from user ${userId}`);

    // Route to appropriate command handler
    switch (command) {
      case '/start':
        await handleStart(message);
        break;
      
      case '/help':
        await handleHelp(chatId);
        break;
      
      case '/status':
        await handleStatus(message);
        break;
      
      case '/test':
        await handleTest(message);
        break;
      
      default:
        await handleUnknown(chatId);
        break;
    }

    // Always return 200 OK to Telegram
    return res.status(200).send('OK');

  } catch (error) {
    console.error('Error in webhook handler:', error);
    // Still return 200 to prevent Telegram from retrying
    return res.status(200).send('OK');
  }
});

/**
 * Handle /start command with deep link
 * Format: /start store_{storeId}
 */
async function handleStart(message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text.trim();
  const username = message.from.username || null;
  const firstName = message.from.first_name || 'User';
  const lastName = message.from.last_name || null;

  try {
    // Extract store ID from command
    const parts = text.split(' ');
    if (parts.length < 2 || !parts[1].startsWith('store_')) {
      await sendMessage(chatId, `
👋 Welcome to Vyapari Copilot Bot!

To connect your store, please use the link provided in your dashboard.

Need help? Visit: https://vyaparcopilot.web.app
`);
      return;
    }

    const storeId = parts[1].replace('store_', '');
    
    // Get or create store document
    const storeRef = db.collection('stores').doc(storeId);
    const storeDoc = await storeRef.get();

    let storeName = 'Your Store';
    
    if (!storeDoc.exists) {
      // Auto-create store document with default data
      await storeRef.set({
        name: 'My Store',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        telegramConnected: true,
      }, { merge: true });
      storeName = 'My Store';
      console.log(`Created new store document for ${storeId}`);
    } else {
      storeName = storeDoc.data().name || 'Your Store';
    }

    // Save subscriber information
    const subscriberRef = storeRef
      .collection('telegram')
      .doc('subscribers')
      .collection('users')
      .doc(userId.toString());

    const subscriberData = {
      telegramUserId: userId,
      chatId: chatId,
      username: username,
      firstName: firstName,
      lastName: lastName,
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastAlertSent: null,
    };

    await subscriberRef.set(subscriberData, { merge: true });

    // Send welcome message
    await sendMessage(chatId, `
✅ *Successfully Connected!*

You're now subscribed to alerts for *${storeName}*.

📅 *You'll receive daily alerts for:*
• Items expiring within 7 days
• Expired products
• Low stock items (≤5 units)

🕐 *Alert Schedule:*
Daily at 8:00 AM IST

*Available Commands:*
/status - Check connection status
/test - Send a test alert
/help - Show help information

👉 Manage settings: https://vyaparcopilot.web.app
`);

    console.log(`User ${userId} subscribed to store ${storeId}`);

  } catch (error) {
    console.error('Error handling /start command:', error);
    await sendMessage(chatId, `
❌ *Connection Error*

Something went wrong. Please try again or contact support.
`);
  }
}

/**
 * Handle /help command
 */
async function handleHelp(chatId) {
  try {
    await sendMessage(chatId, `
📚 *Vyapari Copilot Bot - Help*

*Available Commands:*
/start - Connect your store
/status - Check connection and settings
/test - Send a test alert
/help - Show this help message

*What You'll Receive:*
📅 *Expiry Warnings* - Items expiring soon
🔴 *Expired Items* - Products past expiry
📦 *Low Stock Alerts* - Items running low

*Alert Schedule:*
🕐 Every day at 8:00 AM IST

*Need More Help?*
Visit: https://vyaparcopilot.web.app

*Having Issues?*
Contact support through the dashboard.
`);
  } catch (error) {
    console.error('Error handling /help command:', error);
  }
}

/**
 * Handle /status command
 * Shows connection status and settings
 */
async function handleStatus(message) {
  const chatId = message.chat.id;
  const userId = message.from.id;

  try {
    // Find which store(s) this user is subscribed to
    const storesSnapshot = await db.collection('stores').get();
    const connectedStores = [];

    for (const storeDoc of storesSnapshot.docs) {
      const subscriberRef = storeDoc.ref
        .collection('telegram')
        .doc('subscribers')
        .collection('users')
        .doc(userId.toString());
      
      const subscriberDoc = await subscriberRef.get();
      if (subscriberDoc.exists) {
        connectedStores.push({
          id: storeDoc.id,
          name: storeDoc.data().name || 'Unnamed Store',
          data: subscriberDoc.data(),
        });
      }
    }

    if (connectedStores.length === 0) {
      await sendMessage(chatId, `
⚠️ *Not Connected*

You're not connected to any store yet.

Use the /start link from your dashboard to connect.
`);
      return;
    }

    // Get settings for first store
    const store = connectedStores[0];
    const settingsRef = store.data.storeRef || 
                       db.collection('stores').doc(store.id)
                         .collection('telegram')
                         .doc('settings')
                         .collection('config')
                         .doc('default');
    
    let settings = { lowStockThreshold: 5, expiryWarningDays: 7 };
    try {
      const settingsDoc = await db.collection('stores').doc(store.id)
        .collection('telegram')
        .doc('settings')
        .collection('config')
        .doc('default')
        .get();
      if (settingsDoc.exists) {
        settings = { ...settings, ...settingsDoc.data() };
      }
    } catch (e) {
      // Use defaults if settings don't exist
    }

    const lastAlert = store.data.lastAlertSent 
      ? new Date(store.data.lastAlertSent.toDate()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      : 'Never';

    await sendMessage(chatId, `
✅ *Connection Status*

*Store:* ${store.name}
*Status:* Connected

*Alert Settings:*
• Low stock threshold: ${settings.lowStockThreshold} units
• Expiry warning: ${settings.expiryWarningDays} days in advance
• Daily alert time: 8:00 AM IST

*Last Alert:* ${lastAlert}

${connectedStores.length > 1 ? `\n*Note:* You're connected to ${connectedStores.length} stores` : ''}

👉 Change settings: https://vyaparcopilot.web.app
`);

  } catch (error) {
    console.error('Error handling /status command:', error);
    await sendMessage(chatId, `
❌ *Error*

Could not fetch status. Please try again.
`);
  }
}

/**
 * Handle /test command
 * Sends a test alert to verify the connection
 */
async function handleTest(message) {
  const chatId = message.chat.id;

  try {
    await sendTestAlert(chatId);
    console.log(`Test alert sent to chat ${chatId}`);
  } catch (error) {
    console.error('Error handling /test command:', error);
    await sendMessage(chatId, `
❌ *Test Failed*

Could not send test alert. Please try again.
`);
  }
}

/**
 * Handle unknown commands
 */
async function handleUnknown(chatId) {
  try {
    await sendMessage(chatId, `
❓ *Unknown Command*

I don't recognize that command.

Type /help to see available commands.
`);
  } catch (error) {
    console.error('Error handling unknown command:', error);
  }
}
