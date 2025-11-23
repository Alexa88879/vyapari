import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import DashboardLayout from '../layouts/DashboardLayout';
import { db } from '../lib/firebase';
import { 
  collection, 
  doc, 
  onSnapshot, 
  deleteDoc,
  setDoc,
  getDoc 
} from 'firebase/firestore';
import { 
  Bell, 
  Users, 
  Send, 
  Trash2, 
  Copy, 
  CheckCircle,
  ExternalLink,
  Loader2,
  AlertCircle
} from 'lucide-react';
import QRCode from 'qrcode';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export default function TelegramSettings() {
  const { currentUser } = useAuth();
  const [subscribers, setSubscribers] = useState([]);
  const [settings, setSettings] = useState({
    lowStockThreshold: 5,
    expiryWarningDays: 7,
  });
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [testLoading, setTestLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const botUsername = 'vyapar_copilot_bot';
  const deepLink = `https://t.me/${botUsername}?start=store_${currentUser?.uid}`;

  // Generate QR code on mount
  useEffect(() => {
    if (deepLink) {
      QRCode.toDataURL(deepLink, {
        width: 200,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      })
        .then(url => setQrCodeUrl(url))
        .catch(err => console.error('QR code generation error:', err));
    }
  }, [deepLink]);

  // Listen to subscribers in real-time
  useEffect(() => {
    if (!currentUser) return;

    const subscribersRef = collection(
      db,
      'stores',
      currentUser.uid,
      'telegram',
      'subscribers',
      'users'
    );

    const unsubscribe = onSnapshot(
      subscribersRef,
      (snapshot) => {
        const subs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));
        setSubscribers(subs);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching subscribers:', error);
        setError('Failed to load subscribers');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser]);

  // Load settings
  useEffect(() => {
    if (!currentUser) return;

    const loadSettings = async () => {
      try {
        const settingsRef = doc(
          db,
          'stores',
          currentUser.uid,
          'telegram',
          'settings',
          'config',
          'default'
        );
        const settingsDoc = await getDoc(settingsRef);
        
        if (settingsDoc.exists()) {
          setSettings({ ...settings, ...settingsDoc.data() });
        }
      } catch (error) {
        console.error('Error loading settings:', error);
      }
    };

    loadSettings();
  }, [currentUser]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(deepLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleRemoveSubscriber = async (subscriberId) => {
    if (!confirm('Remove this subscriber from alerts?')) return;

    try {
      const subscriberRef = doc(
        db,
        'stores',
        currentUser.uid,
        'telegram',
        'subscribers',
        'users',
        subscriberId
      );
      await deleteDoc(subscriberRef);
      setSuccess('Subscriber removed successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error('Error removing subscriber:', error);
      setError('Failed to remove subscriber');
      setTimeout(() => setError(''), 3000);
    }
  };

  const handleSaveSettings = async () => {
    try {
      const settingsRef = doc(
        db,
        'stores',
        currentUser.uid,
        'telegram',
        'settings',
        'config',
        'default'
      );
      await setDoc(settingsRef, settings, { merge: true });
      setSuccess('Settings saved successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error('Error saving settings:', error);
      setError('Failed to save settings');
      setTimeout(() => setError(''), 3000);
    }
  };

  const handleSendTestAlert = async () => {
    if (subscribers.length === 0) {
      setError('No subscribers connected');
      setTimeout(() => setError(''), 3000);
      return;
    }

    setTestLoading(true);
    setError('');
    setSuccess('');

    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(
        'https://us-central1-vyapar-56857.cloudfunctions.net/sendTestTelegramAlert',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ storeId: currentUser.uid }),
        }
      );

      const data = await response.json();

      if (response.ok && data.success) {
        setSuccess(data.message || 'Test alert sent successfully!');
      } else {
        setError(data.error || 'Failed to send test alert');
      }
    } catch (error) {
      console.error('Error sending test alert:', error);
      setError('Failed to send test alert. Please try again.');
    } finally {
      setTestLoading(false);
      setTimeout(() => {
        setSuccess('');
        setError('');
      }, 5000);
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Never';
    try {
      const date = timestamp.toDate();
      return date.toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (e) {
      return 'Unknown';
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Bell className="w-8 h-8 text-indigo-600" />
          Telegram Alerts
        </h1>
        <p className="text-gray-600 mt-2">
          Get instant notifications for expiring products and low stock items
        </p>
      </div>

      {/* Success/Error Messages */}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-2 text-green-800">
          <CheckCircle className="w-5 h-5" />
          {success}
        </div>
      )}
      
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2 text-red-800">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      {/* Connection Card */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Bell className="w-5 h-5 text-indigo-600" />
          Connect Telegram
        </h2>

        <div className="grid md:grid-cols-2 gap-6">
          {/* QR Code */}
          <div className="flex flex-col items-center justify-center space-y-4">
            {qrCodeUrl && (
              <div className="bg-white p-4 rounded-lg border-2 border-indigo-200">
                <img src={qrCodeUrl} alt="QR Code" className="w-48 h-48" />
              </div>
            )}
            <p className="text-sm text-gray-600 text-center">
              Scan with your phone to connect
            </p>
          </div>

          {/* Link and Instructions */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Or use this link:
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={deepLink}
                  readOnly
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm"
                />
                <Button
                  onClick={handleCopyLink}
                  variant="outline"
                  className="flex items-center gap-2"
                >
                  {copied ? (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </div>

            <a
              href={deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Open Telegram Bot
            </a>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
              <p className="font-medium text-blue-900 mb-2">How to connect:</p>
              <ol className="list-decimal list-inside space-y-1 text-blue-800">
                <li>Click "Open Telegram Bot" or scan QR code</li>
                <li>Click START in Telegram</li>
                <li>You'll receive a welcome message</li>
                <li>Check below to see yourself connected</li>
              </ol>
            </div>
          </div>
        </div>
      </Card>

      {/* Alert Settings Card */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Alert Settings</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Low Stock Threshold
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={settings.lowStockThreshold}
              onChange={(e) => setSettings({
                ...settings,
                lowStockThreshold: parseInt(e.target.value) || 5,
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <p className="text-sm text-gray-600 mt-1">
              Get alerts when items fall below this quantity
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Expiry Warning Days
            </label>
            <input
              type="number"
              min="1"
              max="30"
              value={settings.expiryWarningDays}
              onChange={(e) => setSettings({
                ...settings,
                expiryWarningDays: parseInt(e.target.value) || 7,
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <p className="text-sm text-gray-600 mt-1">
              Get alerts X days before items expire
            </p>
          </div>

          <Button onClick={handleSaveSettings} className="w-full">
            Save Settings
          </Button>
        </div>
      </Card>

      {/* Subscribers Card */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-600" />
            Connected Subscribers ({subscribers.length})
          </h2>
          
          <Button
            onClick={handleSendTestAlert}
            disabled={testLoading || subscribers.length === 0}
            variant="outline"
            className="flex items-center gap-2"
          >
            {testLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Send Test Alert
              </>
            )}
          </Button>
        </div>

        {subscribers.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No subscribers yet</p>
            <p className="text-sm mt-1">Share the link above to connect</p>
          </div>
        ) : (
          <div className="space-y-3">
            {subscribers.map((subscriber) => (
              <div
                key={subscriber.id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900">
                      {subscriber.firstName} {subscriber.lastName || ''}
                    </p>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Active
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">
                    {subscriber.username ? `@${subscriber.username}` : 'No username'}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Connected: {formatDate(subscriber.joinedAt)}
                  </p>
                  {subscriber.lastAlertSent && (
                    <p className="text-xs text-gray-500">
                      Last alert: {formatDate(subscriber.lastAlertSent)}
                    </p>
                  )}
                </div>

                <Button
                  onClick={() => handleRemoveSubscriber(subscriber.id)}
                  variant="outline"
                  className="text-red-600 hover:bg-red-50 hover:border-red-300"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Info Card */}
      <Card className="p-6 bg-gradient-to-r from-indigo-50 to-blue-50 border-indigo-200">
        <h3 className="font-semibold text-indigo-900 mb-3">What you'll receive:</h3>
        <ul className="space-y-2 text-sm text-indigo-800">
          <li className="flex items-start gap-2">
            <span className="text-lg">📅</span>
            <span><strong>Expiry Warnings:</strong> Items expiring within {settings.expiryWarningDays} days</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-lg">🔴</span>
            <span><strong>Expired Items:</strong> Products past their expiry date</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-lg">📦</span>
            <span><strong>Low Stock:</strong> Items with quantity ≤ {settings.lowStockThreshold} units</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-lg">🕐</span>
            <span><strong>Schedule:</strong> Daily at 8:00 AM IST</span>
          </li>
        </ul>
      </Card>
    </div>
    </DashboardLayout>
  );
}
