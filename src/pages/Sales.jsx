import { useState, useEffect, useRef } from "react";
import DashboardLayout from "../layouts/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Barcode, ShoppingCart, X, Plus, Minus, Check, Loader2, Trash2, Calendar } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { db } from "../lib/firebase";
import { 
    collection, 
    addDoc, 
    Timestamp, 
    doc, 
    getDoc, 
    query, 
    where, 
    getDocs,
    runTransaction,
    orderBy,
    limit
} from "firebase/firestore";
import { useAuth } from "../contexts/AuthContext";
import BarcodeScanner from "../components/BarcodeScanner";

import { ScanLine } from "lucide-react";

export default function Sales() {
    const { currentUser } = useAuth();
    const [cart, setCart] = useState([]);
    const [saleActive, setSaleActive] = useState(false);
    const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [lastScannedBarcode, setLastScannedBarcode] = useState(null);
    const [lastScanTime, setLastScanTime] = useState(0);
    const [scanning, setScanning] = useState(false);
    const [showBillSummary, setShowBillSummary] = useState(false);
    const [processingPayment, setProcessingPayment] = useState(false);
    const [transactions, setTransactions] = useState([]);
    const [todayStats, setTodayStats] = useState({ count: 0, revenue: 0 });
    const [toasts, setToasts] = useState([]);

    // Toast notification helper with deduplication
    const showToast = (message, type = 'success') => {
        const now = Date.now();
        // Check if same message shown within last 2 seconds
        const recentDuplicate = toasts.find(t => 
            t.message === message && (now - t.timestamp) < 2000
        );
        
        if (recentDuplicate) {
            return; // Don't show duplicate
        }

        const id = now;
        const toast = { id, message, type, timestamp: now };
        
        setToasts(prev => {
            const updated = [...prev, toast];
            // Limit to max 3 toasts
            if (updated.length > 3) {
                return updated.slice(-3);
            }
            return updated;
        });
        
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3000);
    };

    // Load transactions on mount
    useEffect(() => {
        loadTransactions();
        calculateTodayStats();
    }, [currentUser]);

    const loadTransactions = async () => {
        try {
            const q = query(
                collection(db, "stores", currentUser.uid, "transactions"),
                orderBy("timestamp", "desc"),
                limit(20)
            );
            const snapshot = await getDocs(q);
            const txns = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setTransactions(txns);
        } catch (error) {
            console.error("Failed to load transactions:", error);
        }
    };

    const calculateTodayStats = async () => {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const q = query(
                collection(db, "stores", currentUser.uid, "transactions"),
                where("timestamp", ">=", Timestamp.fromDate(today)),
                where("type", "==", "SALE")
            );
            const snapshot = await getDocs(q);
            
            let totalRevenue = 0;
            snapshot.docs.forEach(doc => {
                totalRevenue += doc.data().totalAmount || 0;
            });
            
            setTodayStats({ count: snapshot.size, revenue: totalRevenue });
        } catch (error) {
            console.error("Failed to calculate today's stats:", error);
        }
    };

    // Cart management
    const addToCart = (product) => {
        setCart(prev => {
            const existing = prev.find(item => item.productId === product.productId);
            if (existing) {
                // Increment quantity
                if (existing.quantity < product.availableStock) {
                    return prev.map(item =>
                        item.productId === product.productId
                            ? { ...item, quantity: item.quantity + 1, lineTotal: (item.quantity + 1) * item.unitPrice }
                            : item
                    );
                } else {
                    showToast(`Only ${product.availableStock} units available`, 'error');
                    return prev;
                }
            } else {
                // Add new item
                return [...prev, {
                    ...product,
                    quantity: 1,
                    lineTotal: product.unitPrice
                }];
            }
        });
    };

    const updateCartQuantity = (productId, newQuantity) => {
        setCart(prev => {
            const item = prev.find(i => i.productId === productId);
            if (!item) return prev;
            
            if (newQuantity <= 0) {
                return prev.filter(i => i.productId !== productId);
            }
            
            if (newQuantity > item.availableStock) {
                showToast(`Only ${item.availableStock} units available`, 'error');
                return prev;
            }
            
            return prev.map(i =>
                i.productId === productId
                    ? { ...i, quantity: newQuantity, lineTotal: newQuantity * i.unitPrice }
                    : i
            );
        });
    };

    const removeFromCart = (productId) => {
        setCart(prev => prev.filter(item => item.productId !== productId));
    };

    const clearCart = () => {
        setCart([]);
    };

    const calculateCartTotal = () => {
        return cart.reduce((sum, item) => sum + item.lineTotal, 0);
    };

    // Barcode scanning for sales
    const startSale = () => {
        setSaleActive(true);
        setShowBarcodeScanner(true); // Auto-start scanner when sale starts
    };

    const stopSale = () => {
        if (cart.length > 0) {
            const proceed = confirm("Are you sure you want to cancel this sale? The cart will be cleared.");
            if (!proceed) return;
        }
        
        setSaleActive(false);
        setShowBarcodeScanner(false);
        clearCart();
    };

    const handleBarcodeScanned = async (barcode) => {
        // Stop scanning immediately
        setIsScanning(false);

        // Check for duplicate scans
        const now = Date.now();
        if (barcode === lastScannedBarcode && (now - lastScanTime) < 2000) {
            return; // Ignore duplicate scan within 2 seconds
        }
        
        setLastScannedBarcode(barcode);
        setLastScanTime(now);
        setScanning(true);
        
        const product = await lookupProductByBarcode(barcode);
        
        if (product) {
            if (product.availableStock > 0) {
                addToCart(product);
                showToast(`Added ${product.name} to cart`, 'success');
            } else {
                showToast(`${product.name} is out of stock`, 'error');
            }
        } else {
            showToast("Product not found in inventory", 'error');
        }
        
        setScanning(false);
    };

    const lookupProductByBarcode = async (barcode) => {
        try {
            // Query inventory for product with this barcode
            const q = query(
                collection(db, "stores", currentUser.uid, "inventory"),
                where("barcode", "==", barcode),
                limit(1)
            );
            const snapshot = await getDocs(q);
            
            if (!snapshot.empty) {
                const docData = snapshot.docs[0];
                const product = docData.data();
                return {
                    productId: docData.id,
                    name: product.name,
                    unitPrice: product.sellingPrice || product.unitPrice || 0,
                    availableStock: product.quantity || 0,
                    barcode: barcode
                };
            }
            
            return null;
        } catch (error) {
            console.error("Product lookup error:", error);
            return null;
        }
    };

    const handleCheckout = () => {
        if (cart.length === 0) {
            showToast("Cart is empty", 'error');
            return;
        }
        setShowBillSummary(true);
    };

    const completeSale = async () => {
        setProcessingPayment(true);
        
        try {
            await runTransaction(db, async (transaction) => {
                // 1. Read current inventory for all items
                const inventoryRefs = cart.map(item => 
                    doc(db, "stores", currentUser.uid, "inventory", item.productId)
                );
                const inventoryDocs = await Promise.all(
                    inventoryRefs.map(ref => transaction.get(ref))
                );
                
                // 2. Validate stock availability
                cart.forEach((item, index) => {
                    const currentStock = inventoryDocs[index].data()?.quantity || 0;
                    if (currentStock < item.quantity) {
                        throw new Error(`Insufficient stock for ${item.name}. Only ${currentStock} available.`);
                    }
                });
                
                // 3. Update inventory (decrement quantities)
                cart.forEach((item, index) => {
                    const currentData = inventoryDocs[index].data();
                    const newQuantity = currentData.quantity - item.quantity;
                    transaction.update(inventoryRefs[index], { 
                        quantity: newQuantity,
                        lastUpdated: Timestamp.now()
                    });
                });
                
                // 4. Create transaction record
                const transactionRef = doc(collection(db, "stores", currentUser.uid, "transactions"));
                transaction.set(transactionRef, {
                    timestamp: Timestamp.now(),
                    type: "SALE",
                    items: cart.map(item => ({
                        productId: item.productId,
                        productName: item.name,
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        lineTotal: item.lineTotal
                    })),
                    subtotal: calculateCartTotal(),
                    tax: 0,
                    totalAmount: calculateCartTotal(),
                    userId: currentUser.uid
                });
            });
            
            // Success
            showToast("Sale completed successfully!", 'success');
            setShowBillSummary(false);
            clearCart();
            setSaleActive(false);
            setShowBarcodeScanner(false);
            if (barcodeScanner) {
                barcodeScanner.clear();
                setBarcodeScanner(null);
            }
            
            // Refresh data
            loadTransactions();
            calculateTodayStats();
            
        } catch (error) {
            console.error("Sale failed:", error);
            showToast(error.message || "Sale failed. Please try again.", 'error');
        } finally {
            setProcessingPayment(false);
        }
    };

    return (
        <DashboardLayout>
            {/* Toast Container */}
            <div className="fixed top-4 right-4 z-50 space-y-2">
                <AnimatePresence>
                    {toasts.map(toast => (
                        <motion.div
                            key={toast.id}
                            initial={{ opacity: 0, y: -20, x: 50 }}
                            animate={{ opacity: 1, y: 0, x: 0 }}
                            exit={{ opacity: 0, x: 50 }}
                            className={`px-4 py-3 rounded-lg shadow-lg text-white flex items-center gap-2 min-w-[300px] ${
                                toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
                            }`}
                        >
                            {toast.type === 'success' ? (
                                <Check className="h-5 w-5 flex-shrink-0" />
                            ) : (
                                <X className="h-5 w-5 flex-shrink-0" />
                            )}
                            <span className="flex-1">{toast.message}</span>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>

            <div className="max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Sales</h1>
                    <p className="text-gray-600">Process customer sales with barcode scanning.</p>
                </div>

                {/* Today's Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card>
                        <CardContent className="p-4">
                            <p className="text-sm text-gray-600">Today's Transactions</p>
                            <p className="text-2xl font-bold text-gray-900">{todayStats.count}</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <p className="text-sm text-gray-600">Today's Revenue</p>
                            <p className="text-2xl font-bold text-primary">₹{todayStats.revenue.toFixed(2)}</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4 flex items-center justify-center">
                            {!saleActive ? (
                                <Button onClick={startSale} size="lg" className="w-full">
                                    <ShoppingCart className="mr-2 h-5 w-5" /> Start New Sale
                                </Button>
                            ) : (
                                <p className="text-sm text-gray-600">Sale in progress</p>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {saleActive && (
                    <>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Scanner Section */}
                        <div className="lg:col-span-2 space-y-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Barcode className="h-5 w-5" />
                                        Scan Products
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-6 flex flex-col items-center justify-center min-h-[400px] space-y-6">
                                    {!showBarcodeScanner ? (
                                        <div className="text-center py-12">
                                            <Barcode className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                                            <p className="text-gray-600 mb-4">Ready to scan products</p>
                                            <Button onClick={() => setShowBarcodeScanner(true)} size="lg">
                                                <Barcode className="mr-2 h-5 w-5" /> Start Scanning
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col space-y-4 w-full">
                                            <div className="w-full h-full min-h-[400px] relative">
                                                <BarcodeScanner 
                                                    isOpen={showBarcodeScanner}
                                                    isScanning={isScanning}
                                                    onScan={handleBarcodeScanned}
                                                    onClose={() => {
                                                        setShowBarcodeScanner(false);
                                                        setIsScanning(false);
                                                    }}
                                                />
                                            </div>
                                            
                                            {/* Scanner Controls */}
                                            <div className="flex justify-center pt-2">
                                                {!isScanning ? (
                                                    <Button 
                                                        onClick={() => setIsScanning(true)}
                                                        className="bg-indigo-600 hover:bg-indigo-700 text-white w-full max-w-xs"
                                                    >
                                                        <ScanLine className="w-4 h-4 mr-2" />
                                                        Start Scan
                                                    </Button>
                                                ) : (
                                                    <Button 
                                                        onClick={() => setIsScanning(false)}
                                                        variant="destructive"
                                                        className="w-full max-w-xs"
                                                    >
                                                        <X className="w-4 h-4 mr-2" />
                                                        Stop Scan
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    
                                    {scanning && (
                                        <div className="flex items-center justify-center text-primary mt-4">
                                            <Loader2 className="h-6 w-6 animate-spin mr-2" />
                                            <p>Looking up product...</p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                        
                        {/* Cart Section */}
                        <div>
                            <Card className="sticky top-4">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <ShoppingCart className="h-5 w-5" /> Cart ({cart.length})
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-6 space-y-4">
                                    {cart.length === 0 ? (
                                        <p className="text-center text-gray-500 py-8">
                                            Cart is empty. Scan products to add them.
                                        </p>
                                    ) : (
                                        <>
                                            <div className="space-y-3 max-h-96 overflow-y-auto">
                                                {cart.map(item => (
                                                    <div key={item.productId} className="p-3 bg-gray-50 rounded-lg space-y-2">
                                                        <div className="flex items-start justify-between">
                                                            <div className="flex-1 min-w-0">
                                                                <p className="font-medium text-gray-900 text-sm truncate">
                                                                    {item.name}
                                                                </p>
                                                                <p className="text-xs text-gray-500">
                                                                    ₹{item.unitPrice} each
                                                                </p>
                                                                <p className="text-xs text-gray-500">
                                                                    Stock: {item.availableStock} available
                                                                </p>
                                                            </div>
                                                            <button
                                                                onClick={() => removeFromCart(item.productId)}
                                                                className="text-red-500 hover:text-red-700"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </button>
                                                        </div>
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center gap-1">
                                                                <button
                                                                    onClick={() => updateCartQuantity(item.productId, item.quantity - 1)}
                                                                    className="h-6 w-6 flex items-center justify-center rounded border border-gray-300 bg-white hover:bg-gray-50"
                                                                >
                                                                    <Minus className="h-3 w-3" />
                                                                </button>
                                                                <input
                                                                    type="number"
                                                                    min="1"
                                                                    max={item.availableStock}
                                                                    value={item.quantity}
                                                                    onChange={(e) => updateCartQuantity(item.productId, parseInt(e.target.value) || 1)}
                                                                    className="w-12 px-1 py-1 border border-gray-300 rounded text-xs text-center focus:outline-none focus:ring-2 focus:ring-primary"
                                                                />
                                                                <button
                                                                    onClick={() => updateCartQuantity(item.productId, item.quantity + 1)}
                                                                    disabled={item.quantity >= item.availableStock}
                                                                    className="h-6 w-6 flex items-center justify-center rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                                                >
                                                                    <Plus className="h-3 w-3" />
                                                                </button>
                                                            </div>
                                                            <p className="font-semibold text-sm text-gray-900">
                                                                ₹{item.lineTotal.toFixed(2)}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="border-t pt-4 space-y-2">
                                                <div className="flex justify-between text-lg font-bold">
                                                    <span>Total:</span>
                                                    <span className="text-primary">₹{calculateCartTotal().toFixed(2)}</span>
                                                </div>
                                                <Button onClick={handleCheckout} className="w-full" size="lg">
                                                    <Check className="mr-2 h-5 w-5" /> Checkout
                                                </Button>
                                            </div>
                                        </>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                    
                    {/* Cancel Sale Button */}
                    <div className="flex justify-center mt-4">
                        <Button onClick={stopSale} variant="secondary" size="lg" className="px-8">
                            <X className="mr-2 h-5 w-5" /> Cancel Sale
                        </Button>
                    </div>
                    </>
                )}

                {/* Transaction History */}
                <Card>
                    <CardHeader>
                        <CardTitle>Recent Transactions</CardTitle>
                    </CardHeader>
                    <CardContent className="p-6">
                        {transactions.length === 0 ? (
                            <p className="text-center text-gray-500 py-8">No transactions yet.</p>
                        ) : (
                            <div className="space-y-3">
                                {transactions.map(txn => (
                                    <div key={txn.id} className="p-4 bg-gray-50 rounded-lg">
                                        <div className="flex items-center justify-between mb-2">
                                            <div>
                                                <p className="font-medium text-gray-900">
                                                    {txn.timestamp?.toDate().toLocaleString()}
                                                </p>
                                                <p className="text-sm text-gray-600">
                                                    {txn.items?.length || 0} items
                                                </p>
                                            </div>
                                            <p className="text-lg font-bold text-primary">
                                                ₹{(txn.totalAmount || 0).toFixed(2)}
                                            </p>
                                        </div>
                                        <div className="text-xs text-gray-500 space-y-1">
                                            {txn.items?.map((item, idx) => (
                                                <p key={idx}>
                                                    {item.quantity}x {item.productName} @ ₹{item.unitPrice}
                                                </p>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Bill Summary Modal */}
            <AnimatePresence>
                {showBillSummary && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
                        onClick={() => !processingPayment && setShowBillSummary(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.9, y: 20 }}
                            className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <h2 className="text-2xl font-bold text-gray-900 mb-4">Bill Summary</h2>
                            
                            <div className="space-y-2 mb-4">
                                {cart.map(item => (
                                    <div key={item.productId} className="flex justify-between text-sm">
                                        <span>{item.quantity}x {item.name}</span>
                                        <span>₹{item.lineTotal.toFixed(2)}</span>
                                    </div>
                                ))}
                            </div>
                            
                            <div className="border-t pt-4 mb-6">
                                <div className="flex justify-between text-lg font-bold">
                                    <span>Total:</span>
                                    <span className="text-primary">₹{calculateCartTotal().toFixed(2)}</span>
                                </div>
                            </div>
                            
                            <div className="flex gap-3">
                                <Button
                                    variant="secondary"
                                    onClick={() => setShowBillSummary(false)}
                                    disabled={processingPayment}
                                    className="flex-1"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={completeSale}
                                    disabled={processingPayment}
                                    className="flex-1"
                                >
                                    {processingPayment ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Processing...
                                        </>
                                    ) : (
                                        <>
                                            <Check className="mr-2 h-4 w-4" />
                                            Confirm Payment
                                        </>
                                    )}
                                </Button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </DashboardLayout>
    );
}
