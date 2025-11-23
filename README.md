# Vyapari Copilot 🏪

Vyapari Copilot is an intelligent, AI-powered assistant designed specifically for Indian microshops (Kirana stores). It streamlines inventory management, sales, accounting, and customer engagement using advanced AI technologies like Google Gemini and Vision AI.

## 🚀 Features

### 📦 Inventory Management
- **Smart Scan**: Add products by scanning barcodes or taking photos of items/shelves.
- **AI Recognition**: Uses Google Vision & Gemini to identify products from images automatically.
- **Expiry Tracking**: Track product expiry dates and get alerts.
- **Low Stock Alerts**: Automatic notifications when stock runs low.

### 💰 Sales & POS
- **Barcode Billing**: Fast checkout using the built-in camera barcode scanner.
- **Cart Management**: Add items, adjust quantities, and calculate totals instantly.
- **Digital Receipts**: Generate digital records of every sale.

### 📊 Accounting & Analytics
- **Daily Dashboard**: Real-time view of total sales, profit estimates, and transaction history.
- **Profit Tracking**: Automatically calculates profit based on cost price and selling price.
- **Demand Forecasting**: AI-driven predictions for stock needs based on sales history and seasons.

### 🤖 AI Assistant
- **Price Suggestions**: AI recommends competitive selling prices based on product cost and category.
- **Smart Insights**: Get actionable advice on what to stock up on.

### 🔔 Telegram Alerts
- **Real-time Notifications**: Get instant alerts on Telegram for:
  - Low stock items
  - Expiring products
  - Daily sales summaries
- **Easy Setup**: Connect simply by scanning a QR code.

## 🛠️ Prerequisites

- **Node.js**: v18 or higher
- **npm**: v9 or higher
- **Firebase CLI**: Install globally via `npm install -g firebase-tools`
- **Google Cloud Project**: With Blaze plan (pay-as-you-go) enabled for Cloud Functions.

## ⚙️ Installation & Setup

### 1. Clone the Repository
```bash
git clone <your-repo-url>
cd vyapari
```

### 2. Install Dependencies
Install dependencies for both the React frontend and Cloud Functions backend.

```bash
# Frontend dependencies
npm install

# Backend dependencies
cd functions
npm install
cd ..
```

### 3. Firebase Setup
1.  Create a project at [Firebase Console](https://console.firebase.google.com/).
2.  Enable **Authentication** (Email/Password).
3.  Enable **Firestore Database**.
4.  Enable **Storage**.
5.  Login to Firebase CLI:
    ```bash
    firebase login
    ```
6.  Initialize the project (if not already linked):
    ```bash
    firebase use --add
    ```

### 4. Environment Configuration
**Crucial Step**: This project uses API keys that must be kept secret.

1.  **Frontend (.env)**:
    Create a `.env` file in the root directory with your Firebase config:
    ```env
    VITE_FIREBASE_API_KEY=your_api_key
    VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
    VITE_FIREBASE_PROJECT_ID=your_project_id
    VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
    VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
    VITE_FIREBASE_APP_ID=your_app_id
    ```

2.  **Backend (Cloud Functions)**:
    Set secrets using Firebase config variables:
    ```bash
    firebase functions:config:set gemini.key="YOUR_GEMINI_API_KEY"
    firebase functions:config:set vision.key="YOUR_VISION_API_KEY"
    firebase functions:config:set telegram.bot_token="YOUR_TELEGRAM_BOT_TOKEN"
    ```
    *Note: You will need to update `functions/index.js` to use `functions.config().gemini.key` instead of hardcoded strings.*

## 🏃‍♂️ Running Locally

### Start Frontend
```bash
npm run dev
```
Access at `http://localhost:5173`

### Start Backend (Emulators)
```bash
firebase emulators:start
```

## 🚀 Deployment

To deploy the full application (Frontend + Backend) to Firebase:

```bash
npm run build
firebase deploy
```

## 📱 Telegram Bot Setup
1.  Open Telegram and search for **@BotFather**.
2.  Send `/newbot` to create a new bot.
3.  Copy the **HTTP API Token**.
4.  Set the token in your Firebase config (as shown above).
5.  In the app, go to **Dashboard > Telegram Alerts** to connect your account.

## 📖 How to Use

### 1. Adding Inventory
- Go to **Scan Items** from the sidebar.
- **Barcode Mode**: Scan a product barcode. If it's new, you'll be prompted to enter details. If it exists, stock will be updated.
- **Product Mode**: Take a photo of a shelf or item. The AI will identify products and suggest names.
- **Invoice Mode**: Upload a photo of a supplier bill to bulk add items.

### 2. Processing Sales
- Go to **Sales**.
- Click **Start New Sale**.
- Use the camera to scan product barcodes.
- Items are automatically added to the cart with their prices.
- Adjust quantities if needed.
- Click **Checkout** to complete the sale and update inventory instantly.

### 3. Checking Accounting
- Go to **Accounting**.
- View today's total sales, estimated profit, and transaction history.
- Data is updated in real-time as you make sales.

### 4. Demand Forecasting
- Go to **Forecast**.
- The AI analyzes your current inventory and seasonal trends.
- It provides a list of "High Demand" items to stock up on and "Low Rotation" items to clear out.

### 5. Connecting Telegram Alerts
- Go to **Telegram Alerts** (via Dashboard or Sidebar).
- Scan the QR code with your phone or click "Open Telegram Bot".
- Click **Start** in the Telegram chat.
- You will now receive daily summaries and low-stock alerts directly on your phone.

## 🔒 Security Note
Never commit your `.env` files or hardcode API keys in `src/` or `functions/`. The `.gitignore` file is configured to exclude these sensitive files.
