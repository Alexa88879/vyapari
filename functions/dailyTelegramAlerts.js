const { onMessagePublished } = require('firebase-functions/v2/pubsub');
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { sendMessage } = require('./lib/telegramBot');

// Initialize Firestore
const db = admin.firestore();

/**
 * Daily Telegram Alerts Function
 * Triggered by Cloud Scheduler via Pub/Sub
 * Checks all stores and sends alerts for expiring/expired/low stock items
 */
exports.dailyTelegramAlerts = onMessagePublished('telegram-alerts', async (event) => {
    console.log('Daily Telegram alerts job started');
    const startTime = Date.now();

    try {
      // Fetch all stores
      const storesSnapshot = await db.collection('stores').get();
      console.log(`Processing ${storesSnapshot.size} stores`);

      let totalAlertsSent = 0;
      let successCount = 0;
      let failureCount = 0;

      // Process each store sequentially to avoid overwhelming Firestore
      for (const storeDoc of storesSnapshot.docs) {
        try {
          const alerts = await processStoreAlerts(storeDoc);
          if (alerts > 0) {
            successCount++;
            totalAlertsSent += alerts;
          }

          // Rate limiting: 1 second delay between stores
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
          console.error(`Error processing store ${storeDoc.id}:`, error);
          failureCount++;
          // Continue processing other stores
        }
      }

      const duration = Date.now() - startTime;
      console.log(`Daily alerts completed in ${duration}ms`);
      console.log(`Stores processed: ${storesSnapshot.size}`);
      console.log(`Successful: ${successCount}, Failed: ${failureCount}`);
      console.log(`Total alerts sent: ${totalAlertsSent}`);

      return { success: true, totalAlertsSent, successCount, failureCount };

    } catch (error) {
      console.error('Error in daily alerts job:', error);
      throw error;
    }
  });

/**
 * Process alerts for a single store
 * @param {DocumentSnapshot} storeDoc - Firestore store document
 * @returns {number} Number of alerts sent
 */
async function processStoreAlerts(storeDoc) {
  const storeId = storeDoc.id;
  const storeName = storeDoc.data().name || 'Your Store';

  // Fetch subscribers
  const subscribersSnapshot = await storeDoc.ref
    .collection('telegram')
    .doc('subscribers')
    .collection('users')
    .get();

  if (subscribersSnapshot.empty) {
    console.log(`Store ${storeId}: No subscribers, skipping`);
    return 0;
  }

  console.log(`Store ${storeId}: ${subscribersSnapshot.size} subscribers`);

  // Fetch store settings
  const settings = await getStoreSettings(storeDoc.ref);

  // Fetch inventory
  const inventorySnapshot = await storeDoc.ref
    .collection('inventory')
    .get();

  if (inventorySnapshot.empty) {
    console.log(`Store ${storeId}: No inventory, skipping`);
    return 0;
  }

  const inventory = inventorySnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  }));

  // Analyze inventory for alerts
  const { expired, nearExpiry, lowStock } = analyzeInventory(
    inventory,
    settings.expiryWarningDays,
    settings.lowStockThreshold
  );

  // Skip if no alerts needed
  if (expired.length === 0 && nearExpiry.length === 0 && lowStock.length === 0) {
    console.log(`Store ${storeId}: No alerts needed`);
    return 0;
  }

  // Format alert message
  const message = formatAlertMessage(storeName, expired, nearExpiry, lowStock);

  // Send to all subscribers
  let alertsSent = 0;
  for (const subscriberDoc of subscribersSnapshot.docs) {
    const subscriber = subscriberDoc.data();
    const chatId = subscriber.chatId;

    try {
      const result = await sendMessage(chatId, message);

      if (result.success) {
        // Update last alert sent timestamp
        await subscriberDoc.ref.update({
          lastAlertSent: admin.firestore.FieldValue.serverTimestamp(),
        });
        alertsSent++;
      } else if (result.blocked) {
        // User blocked the bot, remove subscriber
        console.log(`User ${subscriber.telegramUserId} blocked bot, removing`);
        await subscriberDoc.ref.delete();
      } else {
        console.error(`Failed to send to chat ${chatId}:`, result.error);
      }

      // Rate limiting: 100ms delay between messages
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      console.error(`Error sending to subscriber ${subscriberDoc.id}:`, error);
    }
  }

  console.log(`Store ${storeId}: Sent ${alertsSent} alerts`);
  return alertsSent;
}

/**
 * Get store settings with defaults
 * @param {DocumentReference} storeRef - Store document reference
 * @returns {object} Settings object
 */
async function getStoreSettings(storeRef) {
  const defaults = {
    lowStockThreshold: 5,
    expiryWarningDays: 7,
    enableExpiryAlerts: true,
    enableLowStockAlerts: true,
  };

  try {
    const settingsDoc = await storeRef
      .collection('telegram')
      .doc('settings')
      .collection('config')
      .doc('default')
      .get();

    if (settingsDoc.exists) {
      return { ...defaults, ...settingsDoc.data() };
    }
  } catch (error) {
    console.error('Error fetching settings:', error);
  }

  return defaults;
}

/**
 * Analyze inventory for expiry and low stock issues
 * @param {Array} inventory - Array of inventory items
 * @param {number} expiryWarningDays - Days in advance to warn
 * @param {number} lowStockThreshold - Minimum quantity threshold
 * @returns {object} Categorized items
 */
function analyzeInventory(inventory, expiryWarningDays, lowStockThreshold) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expired = [];
  const nearExpiry = [];
  const lowStock = [];

  for (const item of inventory) {
    // Check expiry date
    if (item.expiryDate) {
      try {
        const expiryDate = new Date(item.expiryDate);
        expiryDate.setHours(0, 0, 0, 0);
        
        const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));

        if (daysUntilExpiry <= 0) {
          // Expired
          expired.push({
            name: item.name || 'Unnamed Item',
            daysExpired: Math.abs(daysUntilExpiry),
            expiryDate: expiryDate,
          });
        } else if (daysUntilExpiry <= expiryWarningDays) {
          // Near expiry
          nearExpiry.push({
            name: item.name || 'Unnamed Item',
            daysUntilExpiry: daysUntilExpiry,
            expiryDate: expiryDate,
          });
        }
      } catch (error) {
        console.error(`Invalid expiry date for item ${item.name}:`, error);
      }
    }

    // Check low stock
    const quantity = item.quantity || 0;
    if (quantity <= lowStockThreshold) {
      lowStock.push({
        name: item.name || 'Unnamed Item',
        quantity: quantity,
      });
    }
  }

  // Sort arrays
  expired.sort((a, b) => b.daysExpired - a.daysExpired); // Most expired first
  nearExpiry.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry); // Soonest first
  lowStock.sort((a, b) => a.quantity - b.quantity); // Lowest quantity first

  return { expired, nearExpiry, lowStock };
}

/**
 * Format alert message with Telegram markdown
 * @param {string} storeName - Name of the store
 * @param {Array} expired - Expired items
 * @param {Array} nearExpiry - Near expiry items
 * @param {Array} lowStock - Low stock items
 * @returns {string} Formatted message
 */
function formatAlertMessage(storeName, expired, nearExpiry, lowStock) {
  const date = new Date().toLocaleDateString('en-IN', { 
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata'
  });

  let message = `🚨 *Daily Inventory Alert*\n${storeName} - ${date}\n\n`;

  // Expired items section
  if (expired.length > 0) {
    message += `❌ *Expired Items (${expired.length}):*\n`;
    const itemsToShow = expired.slice(0, 10); // Limit to 10 items
    
    for (const item of itemsToShow) {
      const expiredText = item.daysExpired === 0 
        ? 'Expired today' 
        : `Expired ${item.daysExpired} day${item.daysExpired > 1 ? 's' : ''} ago`;
      message += `🔴 ${item.name} - ${expiredText}\n`;
    }
    
    if (expired.length > 10) {
      message += `_...and ${expired.length - 10} more items_\n`;
    }
    message += '\n';
  }

  // Near expiry items section
  if (nearExpiry.length > 0) {
    message += `📅 *Expiring Soon (${nearExpiry.length}):*\n`;
    const itemsToShow = nearExpiry.slice(0, 10);
    
    for (const item of itemsToShow) {
      const emoji = item.daysUntilExpiry === 1 ? '🔴' : 
                   item.daysUntilExpiry <= 3 ? '🟠' : '🟡';
      const dateStr = item.expiryDate.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        timeZone: 'Asia/Kolkata'
      });
      message += `${emoji} ${item.name} - Expires in ${item.daysUntilExpiry} day${item.daysUntilExpiry > 1 ? 's' : ''} (${dateStr})\n`;
    }
    
    if (nearExpiry.length > 10) {
      message += `_...and ${nearExpiry.length - 10} more items_\n`;
    }
    message += '\n';
  }

  // Low stock items section
  if (lowStock.length > 0) {
    message += `📦 *Low Stock (${lowStock.length}):*\n`;
    const itemsToShow = lowStock.slice(0, 10);
    
    for (const item of itemsToShow) {
      const emoji = item.quantity === 0 ? '🔴' : '⚠️';
      const quantityText = item.quantity === 0 
        ? 'Out of stock' 
        : `Only ${item.quantity} left`;
      message += `${emoji} ${item.name} - ${quantityText}\n`;
    }
    
    if (lowStock.length > 10) {
      message += `_...and ${lowStock.length - 10} more items_\n`;
    }
    message += '\n';
  }

  message += `👉 [Open Dashboard](https://vyaparcopilot.web.app)`;

  return message;
}

/**
 * Send test alert to specific store
 * Callable function for manual testing from dashboard
 */
exports.sendTestTelegramAlert = onRequest(async (req, res) => {
  // Enable CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { storeId } = req.body;

    if (!storeId) {
      return res.status(400).json({ error: 'Missing storeId' });
    }

    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    // Verify user owns this store
    if (decodedToken.uid !== storeId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Fetch subscribers
    const storeRef = db.collection('stores').doc(storeId);
    const subscribersSnapshot = await storeRef
      .collection('telegram')
      .doc('subscribers')
      .collection('users')
      .get();

    if (subscribersSnapshot.empty) {
      return res.status(404).json({ error: 'No subscribers found' });
    }

    // Send test alerts
    let sentCount = 0;
    for (const subscriberDoc of subscribersSnapshot.docs) {
      const subscriber = subscriberDoc.data();
      try {
        const { sendTestAlert } = require('./lib/telegramBot');
        const result = await sendTestAlert(subscriber.chatId);
        if (result.success) {
          sentCount++;
        }
      } catch (error) {
        console.error(`Error sending test alert to ${subscriber.chatId}:`, error);
      }
    }

    return res.status(200).json({ 
      success: true, 
      message: `Test alert sent to ${sentCount} subscriber(s)` 
    });

  } catch (error) {
    console.error('Error sending test alert:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
