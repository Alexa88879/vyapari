import { useState, useRef, useEffect } from "react";
import DashboardLayout from "../layouts/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Camera, Upload, X, Check, Loader2, Plus, FileText, Barcode, Minus, Edit2, Square, CheckSquare, ScanLine } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { db } from "../lib/firebase";
import { collection, addDoc, Timestamp, doc, setDoc, getDoc, query, where, getDocs, updateDoc } from "firebase/firestore";
import { useAuth } from "../contexts/AuthContext";
import BarcodeScanner from "../components/BarcodeScanner";

export default function InventoryScan() {
    const { currentUser } = useAuth();
    const [scanMode, setScanMode] = useState("barcode"); // 'barcode', 'product', 'invoice'
    const [image, setImage] = useState(null);
    const [scanning, setScanning] = useState(false);
    const [results, setResults] = useState(null);
    const [addedItems, setAddedItems] = useState(new Set());
    const [saving, setSaving] = useState(false);
    const [itemQuantities, setItemQuantities] = useState({});
    const fileInputRef = useRef(null);
    const videoRef = useRef(null);
    const [showCamera, setShowCamera] = useState(false);
    const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [barcodeLoading, setBarcodeLoading] = useState(false);
    const [toasts, setToasts] = useState([]);
    const [selectedItems, setSelectedItems] = useState({}); // Track selection state
    const [editingItem, setEditingItem] = useState(null); // Track which item is being edited
    const [editedNames, setEditedNames] = useState({}); // Store edited names
    const [expiryDates, setExpiryDates] = useState({}); // Store expiry dates
    const [sellingPrices, setSellingPrices] = useState({}); // Store selling prices
    const [costPrices, setCostPrices] = useState({}); // Store cost prices

    // Toast notification helper
    const showToast = (message, type = 'success') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3000);
    };

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setImage(reader.result);
                setResults(null);
                setItemQuantities({});
            };
            reader.readAsDataURL(file);
        }
    };

    const startCamera = async () => {
        setShowCamera(true);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
        } catch (err) {
            console.error("Error accessing camera:", err);
            showToast("Could not access camera", 'error');
            setShowCamera(false);
        }
    };

    const captureImage = () => {
        if (videoRef.current) {
            const canvas = document.createElement("canvas");
            canvas.width = videoRef.current.videoWidth;
            canvas.height = videoRef.current.videoHeight;
            canvas.getContext("2d").drawImage(videoRef.current, 0, 0);
            const dataUrl = canvas.toDataURL("image/jpeg");
            setImage(dataUrl);
            stopCamera();
        }
    };

    const stopCamera = () => {
        if (videoRef.current && videoRef.current.srcObject) {
            const tracks = videoRef.current.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            videoRef.current.srcObject = null;
        }
        setShowCamera(false);
    };

    // Barcode scanner handlers
    const handleBarcodeScanned = async (barcode) => {
        setShowBarcodeScanner(false);
        const productData = await lookupBarcode(barcode);

        if (productData) {
            setResults([{
                name: productData.name,
                category: productData.category,
                confidence: 1.0,
                barcode: barcode
            }]);
            setItemQuantities({ 0: 1 });
            setSelectedItems({ 0: true });
            setExpiryDates({ 0: '' });
            setSellingPrices({ 0: '' });
            setCostPrices({ 0: '' });
            setEditedNames({});
            setEditingItem(null);
        }
    };

    const lookupBarcode = async (barcode) => {
        setBarcodeLoading(true);
        try {
            // 1. Check Firestore cache first
            const barcodeDocRef = doc(db, "stores", currentUser.uid, "barcodes", barcode);
            const barcodeDoc = await getDoc(barcodeDocRef);

            if (barcodeDoc.exists()) {
                return barcodeDoc.data();
            }

            // 2. Query Open Food Facts API
            const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
            const data = await response.json();

            if (data.status === 1 && data.product) {
                const product = data.product;
                const productData = {
                    name: product.product_name || `Product ${barcode}`,
                    category: product.categories_tags?.[0]?.replace('en:', '') || "General",
                    barcode: barcode
                };

                // Cache in Firestore
                await setDoc(barcodeDocRef, {
                    ...productData,
                    createdAt: Timestamp.now()
                });

                return productData;
            }

            // 3. If not found, prompt for manual entry
            const name = prompt(`Barcode ${barcode} not found. Enter product name:`);
            if (name) {
                const productData = {
                    name: name,
                    category: "General",
                    barcode: barcode
                };

                // Save manual entry to cache
                await setDoc(barcodeDocRef, {
                    ...productData,
                    createdAt: Timestamp.now()
                });

                return productData;
            }

            return null;
        } catch (error) {
            console.error("Barcode lookup error:", error);
            showToast("Failed to lookup barcode", 'error');
            return null;
        } finally {
            setBarcodeLoading(false);
        }
    };



    // Clean up all state when scan mode changes
    useEffect(() => {
        stopCamera();
        setShowBarcodeScanner(false);
        setImage(null);
        setResults(null);
        setAddedItems(new Set());
        setItemQuantities({});
    }, [scanMode]);

    const handleScan = async () => {
        if (!image) return;

        setScanning(true);
        setResults(null);
        setAddedItems(new Set());
        setItemQuantities({});

        try {
            const response = await fetch("/inventoryScan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image, mode: scanMode })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Server error: ${response.status} ${errorText}`);
            }

            const data = await response.json();

            if (data.success && data.data && data.data.detections) {
                const detections = data.data.detections;

                // Consolidate duplicates
                const consolidated = consolidateDuplicates(detections);

                setResults(consolidated);
                // Initialize quantities from detected items or default to 1
                const quantities = {};
                const selections = {};
                const expiries = {};
                const selling = {};
                const costs = {};
                consolidated.forEach((item, index) => {
                    quantities[index] = item.quantity || 1;
                    selections[index] = true; // All items selected by default
                    expiries[index] = item.expiryDate || '';
                    selling[index] = item.sellingPrice || '';
                    costs[index] = item.costPrice || '';
                });
                setItemQuantities(quantities);
                setSelectedItems(selections);
                setExpiryDates(expiries);
                setSellingPrices(selling);
                setCostPrices(costs);
                setEditedNames({});
                setEditingItem(null);
            } else {
                throw new Error("Invalid response format from server");
            }

        } catch (error) {
            console.error("Scan failed", error);
            showToast(`Scan failed: ${error.message}`, 'error');
        } finally {
            setScanning(false);
        }
    };

    const updateQuantity = (index, value) => {
        const qty = parseInt(value) || 1;
        if (qty > 0) {
            setItemQuantities(prev => ({ ...prev, [index]: qty }));
        }
    };

    const toggleSelection = (index) => {
        setSelectedItems(prev => ({ ...prev, [index]: !prev[index] }));
    };

    const startEditing = (index) => {
        setEditingItem(index);
    };

    const saveEdit = (index) => {
        setEditingItem(null);
    };

    const cancelEdit = (index) => {
        setEditedNames(prev => {
            const newNames = { ...prev };
            delete newNames[index];
            return newNames;
        });
        setEditingItem(null);
    };

    const updateItemName = (index, newName) => {
        setEditedNames(prev => ({ ...prev, [index]: newName }));
    };

    const getItemName = (item, index) => {
        return editedNames[index] !== undefined ? editedNames[index] : item.name;
    };

    // Duplicate detection and consolidation
    const consolidateDuplicates = (products) => {
        const groups = {};

        products.forEach((product, origIndex) => {
            const key = product.name.toLowerCase().trim();
            if (!groups[key]) {
                groups[key] = {
                    ...product,
                    quantity: 0,
                    duplicates: [],
                    originalIndices: []
                };
            }
            groups[key].quantity += (product.quantity || 1);
            groups[key].duplicates.push(product);
            groups[key].originalIndices.push(origIndex);
        });

        return Object.values(groups).map(group => ({
            ...group,
            duplicateCount: group.duplicates.length
        }));
    };

    // Helper function to find existing product by name (case-insensitive)
    const findExistingProduct = async (productName) => {
        try {
            const nameLower = productName.toLowerCase().trim();
            const q = query(
                collection(db, "stores", currentUser.uid, "inventory"),
                where("nameLower", "==", nameLower)
            );
            const snapshot = await getDocs(q);
            return snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
        } catch (error) {
            console.error("Error checking for existing product:", error);
            return null; // Fallback: proceed without duplicate check
        }
    };

    const addToInventory = async (item, index) => {
        const quantity = itemQuantities[index] || 1;
        if (quantity <= 0) {
            showToast("Quantity must be greater than 0", 'error');
            return;
        }

        // Validate expiry date (required)
        const expiryDate = expiryDates[index];
        if (!expiryDate) {
            showToast("Expiry date is required", 'error');
            return;
        }

        // Validate expiry date is in the future
        const expiry = new Date(expiryDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (expiry < today) {
            showToast("Expiry date must be in the future", 'error');
            return;
        }

        // Validate selling price (required)
        const sellingPrice = parseFloat(sellingPrices[index]);
        if (!sellingPrice || sellingPrice <= 0) {
            showToast("Selling price is required and must be greater than 0", 'error');
            return;
        }

        // Cost price is optional
        const costPrice = costPrices[index] ? parseFloat(costPrices[index]) : null;

        // Warn if selling price < cost price (but allow it)
        if (costPrice && sellingPrice < costPrice) {
            const proceed = confirm("Warning: Selling price is lower than cost price. Continue anyway?");
            if (!proceed) return;
        }

        try {
            // Use edited name if available
            const itemName = getItemName(item, index);

            // Check for existing product
            const existing = await findExistingProduct(itemName);

            if (existing) {
                // Update existing product quantity
                const currentQty = existing.quantity || existing.qty || 0;
                const newQuantity = currentQty + quantity;
                await updateDoc(
                    doc(db, "stores", currentUser.uid, "inventory", existing.id),
                    {
                        quantity: newQuantity,
                        expiryDate: expiryDate,
                        sellingPrice: sellingPrice,
                        costPrice: costPrice,
                        lastUpdated: Timestamp.now()
                    }
                );
                setAddedItems(prev => new Set(prev).add(index));
                showToast(`Updated ${itemName} quantity to ${newQuantity}`, 'success');
                return true;
            } else {
                // Create new product
                await addDoc(collection(db, "stores", currentUser.uid, "inventory"), {
                    name: itemName,
                    nameLower: itemName.toLowerCase().trim(),
                    quantity: quantity,
                    expiryDate: expiryDate,
                    sellingPrice: sellingPrice,
                    costPrice: costPrice,
                    unitPrice: sellingPrice, // Keep for backward compatibility
                    category: item.category || "General",
                    barcode: item.barcode || null,
                    createdAt: Timestamp.now()
                });
                setAddedItems(prev => new Set(prev).add(index));
                showToast(`Added ${quantity}x ${itemName} to inventory`, 'success');
                return true;
            }
        } catch (error) {
            console.error("Failed to add item:", error);
            showToast(`Failed to add ${getItemName(item, index)}: ${error.message}`, 'error');
            return false;
        }
    };

    const addAllToInventory = async () => {
        if (!results || results.length === 0) return;

        setSaving(true);
        try {
            // Filter for selected items that haven't been added yet
            const itemsToAdd = results.filter((_, index) =>
                selectedItems[index] && !addedItems.has(index)
            );

            if (itemsToAdd.length === 0) {
                showToast("No items selected to add", 'info');
                setSaving(false);
                return;
            }

            const promises = itemsToAdd.map((item, origIndex) => {
                const index = results.indexOf(item);
                return addToInventory(item, index);
            });
            await Promise.all(promises);

            // Calculate total quantity added
            const totalQuantity = itemsToAdd.reduce((sum, item, origIndex) => {
                const index = results.indexOf(item);
                return sum + (itemQuantities[index] || 1);
            }, 0);

            showToast(`Successfully added ${itemsToAdd.length} items (${totalQuantity} total units) to inventory!`, 'success');
        } catch (error) {
            console.error("Failed to add all items:", error);
            showToast("Some items failed to add. Please try again.", 'error');
        } finally {
            setSaving(false);
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
                            className={`px-4 py-3 rounded-lg shadow-lg text-white flex items-center gap-2 min-w-[300px] ${toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
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

            <div className="max-w-4xl mx-auto space-y-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Scan Inventory</h1>
                    <p className="text-gray-600">Use your camera or upload an image to add items.</p>
                </div>

                {/* Scan Mode Tabs */}
                <div className="flex gap-2 border-b border-gray-200">
                    <button
                        onClick={() => setScanMode("barcode")}
                        className={`px-4 py-2 font-medium transition-colors border-b-2 ${scanMode === "barcode"
                            ? "border-primary text-primary"
                            : "border-transparent text-gray-600 hover:text-gray-900"
                            }`}
                    >
                        <Barcode className="inline h-4 w-4 mr-2" />
                        Barcode Scan
                    </button>
                    <button
                        onClick={() => setScanMode("product")}
                        className={`px-4 py-2 font-medium transition-colors border-b-2 ${scanMode === "product"
                            ? "border-primary text-primary"
                            : "border-transparent text-gray-600 hover:text-gray-900"
                            }`}
                    >
                        <Camera className="inline h-4 w-4 mr-2" />
                        Product Scan
                    </button>
                    <button
                        onClick={() => setScanMode("invoice")}
                        className={`px-4 py-2 font-medium transition-colors border-b-2 ${scanMode === "invoice"
                            ? "border-primary text-primary"
                            : "border-transparent text-gray-600 hover:text-gray-900"
                            }`}
                    >
                        <FileText className="inline h-4 w-4 mr-2" />
                        Invoice Scan
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Input Section */}
                    <Card>
                        <CardContent className="p-6 flex flex-col items-center justify-center min-h-[400px] space-y-6">
                            {showCamera ? (
                                <div className="relative w-full h-full bg-black rounded-lg overflow-hidden">
                                    <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                                    <div className="absolute bottom-4 left-0 right-0 flex justify-center space-x-4">
                                        <Button onClick={captureImage} variant="primary" className="rounded-full p-4">
                                            <Camera className="h-6 w-6" />
                                        </Button>
                                        <Button onClick={stopCamera} variant="secondary" className="rounded-full p-4 bg-white">
                                            <X className="h-6 w-6" />
                                        </Button>
                                    </div>
                                </div>
                            ) : image ? (
                                <div className="relative w-full h-full">
                                    <img src={image} alt="Preview" className="w-full h-full object-contain rounded-lg" />
                                    <Button
                                        onClick={() => setImage(null)}
                                        variant="secondary"
                                        size="sm"
                                        className="absolute top-2 right-2 bg-white/80 hover:bg-white"
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            ) : (
                                <div className="text-center space-y-4">
                                    {!showBarcodeScanner && (
                                        <div className="p-4 bg-orange-50 rounded-full inline-block">
                                            {scanMode === "barcode" ? (
                                                <Barcode className="h-12 w-12 text-primary" />
                                            ) : (
                                                <Camera className="h-12 w-12 text-primary" />
                                            )}
                                        </div>
                                    )}
                                    <div className={`w-full mx-auto ${showBarcodeScanner ? '' : 'max-w-xs'}`}>
                                        {scanMode === "barcode" ? (
                                            <>
                                                {showBarcodeScanner ? (
                                                    <div className="flex flex-col space-y-4">
                                                        <div className="w-full h-full min-h-[400px] relative">
                                                            <BarcodeScanner
                                                                isOpen={showBarcodeScanner}
                                                                isScanning={isScanning}
                                                                onScan={(code) => {
                                                                    setIsScanning(false); // Auto-stop
                                                                    handleBarcodeScanned(code);
                                                                }}
                                                                onClose={() => {
                                                                    setShowBarcodeScanner(false);
                                                                    setIsScanning(false);
                                                                }}
                                                            />
                                                        </div>

                                                        {/* Scanner Controls (Outside) */}
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
                                                ) : (
                                                    <>
                                                        <p className="text-gray-600 mb-3">Ready to scan barcodes</p>
                                                        <Button onClick={() => setShowBarcodeScanner(true)} className="w-full">
                                                            <Barcode className="mr-2 h-4 w-4" /> Start Scanner
                                                        </Button>
                                                        {barcodeLoading && (
                                                            <div className="flex items-center justify-center mt-4 text-primary">
                                                                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                                                                <p className="text-sm">Looking up product...</p>
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </>
                                        ) : (
                                            <>
                                                <Button onClick={startCamera} className="w-full mb-2">
                                                    <Camera className="mr-2 h-4 w-4" /> Start Camera
                                                </Button>
                                                <p className="text-sm text-gray-500 my-2">- OR -</p>
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    className="hidden"
                                                    ref={fileInputRef}
                                                    onChange={handleFileUpload}
                                                />
                                                <Button variant="secondary" onClick={() => fileInputRef.current?.click()} className="w-full">
                                                    <Upload className="mr-2 h-4 w-4" /> Upload Image
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}

                            {image && !scanning && !results && (
                                <Button onClick={handleScan} size="lg" className="w-full mt-4">
                                    Analyze Image
                                </Button>
                            )}

                            {scanning && (
                                <div className="flex flex-col items-center text-primary">
                                    <Loader2 className="h-8 w-8 animate-spin mb-2" />
                                    <p>Analyzing with Gemini AI...</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Results Section */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Detected Items</CardTitle>
                        </CardHeader>
                        <CardContent className="p-6">
                            {!results ? (
                                <div className="text-center text-gray-500 py-12">
                                    <p>Scan an image to see detected products here.</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {results.map((item, index) => {
                                        const isSelected = selectedItems[index] !== false;
                                        const isEditing = editingItem === index;
                                        const isAdded = addedItems.has(index);

                                        return (
                                            <motion.div
                                                key={index}
                                                initial={{ opacity: 0, x: 20 }}
                                                animate={{
                                                    opacity: isSelected ? 1 : 0.5,
                                                    x: 0,
                                                    backgroundColor: isAdded
                                                        ? ['#f0fdf4', '#f9fafb']
                                                        : '#f9fafb'
                                                }}
                                                transition={{
                                                    delay: index * 0.1,
                                                    backgroundColor: { duration: 0.5 }
                                                }}
                                                className="p-4 rounded-lg border border-gray-100 space-y-3"
                                            >
                                                <div className="flex items-start gap-3">
                                                    {/* Selection Checkbox */}
                                                    <button
                                                        onClick={() => toggleSelection(index)}
                                                        disabled={isAdded}
                                                        className="flex-shrink-0 mt-0.5 disabled:cursor-not-allowed"
                                                    >
                                                        {isSelected ? (
                                                            <CheckSquare className={`h-5 w-5 ${isAdded ? 'text-green-500' : 'text-primary'}`} />
                                                        ) : (
                                                            <Square className="h-5 w-5 text-gray-400" />
                                                        )}
                                                    </button>

                                                    <div className="flex-1 min-w-0">
                                                        {/* Product Name with Inline Edit */}
                                                        <div className="flex items-center gap-2 mb-1">
                                                            {isEditing ? (
                                                                <>
                                                                    <input
                                                                        type="text"
                                                                        value={editedNames[index] !== undefined ? editedNames[index] : item.name}
                                                                        onChange={(e) => updateItemName(index, e.target.value)}
                                                                        onKeyDown={(e) => {
                                                                            if (e.key === 'Enter') saveEdit(index);
                                                                            if (e.key === 'Escape') cancelEdit(index);
                                                                        }}
                                                                        onBlur={() => saveEdit(index)}
                                                                        autoFocus
                                                                        className="flex-1 px-2 py-1 border border-primary rounded focus:outline-none focus:ring-2 focus:ring-primary font-medium text-gray-900"
                                                                    />
                                                                    <button
                                                                        onClick={() => saveEdit(index)}
                                                                        className="flex-shrink-0 text-green-600 hover:text-green-700"
                                                                    >
                                                                        <Check className="h-4 w-4" />
                                                                    </button>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <p className="font-medium text-gray-900 flex-1">
                                                                        {getItemName(item, index)}
                                                                    </p>
                                                                    {!isAdded && (
                                                                        <button
                                                                            onClick={() => startEditing(index)}
                                                                            className="flex-shrink-0 text-gray-500 hover:text-primary"
                                                                        >
                                                                            <Edit2 className="h-4 w-4" />
                                                                        </button>
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>

                                                        <p className="text-xs text-gray-500">
                                                            Confidence: {Math.round((item.confidence || 0) * 100)}%
                                                        </p>
                                                        {item.duplicateCount > 1 && (
                                                            <p className="text-xs text-blue-600 font-medium mt-1">
                                                                {item.duplicateCount} duplicates consolidated
                                                            </p>
                                                        )}
                                                        {item.unitPrice && (
                                                            <p className="text-xs text-gray-600 mt-1">Price: ₹{item.unitPrice}</p>
                                                        )}
                                                    </div>

                                                    {/* Add Button */}
                                                    <Button
                                                        size="sm"
                                                        variant={isAdded ? "primary" : "secondary"}
                                                        className="h-8 w-8 p-0 rounded-full flex-shrink-0"
                                                        onClick={() => addToInventory(item, index)}
                                                        disabled={isAdded || !isSelected}
                                                    >
                                                        {isAdded ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                                                    </Button>
                                                </div>

                                                {/* Quantity Controls */}
                                                <div className="flex items-center gap-2">
                                                    <label className="text-sm font-medium text-gray-700">Qty:</label>
                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            onClick={() => updateQuantity(index, Math.max(1, (itemQuantities[index] || 1) - 1))}
                                                            disabled={isAdded || (itemQuantities[index] || 1) <= 1}
                                                            className="h-8 w-8 flex items-center justify-center rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                                        >
                                                            <Minus className="h-4 w-4" />
                                                        </button>
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            placeholder="Qty"
                                                            value={itemQuantities[index] || 1}
                                                            onChange={(e) => updateQuantity(index, e.target.value)}
                                                            disabled={isAdded}
                                                            className="w-16 px-2 py-1 border border-gray-300 rounded text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-100"
                                                        />
                                                        <button
                                                            onClick={() => updateQuantity(index, (itemQuantities[index] || 1) + 1)}
                                                            disabled={isAdded}
                                                            className="h-8 w-8 flex items-center justify-center rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                                        >
                                                            <Plus className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Expiry Date (Required) */}
                                                <div className="space-y-1">
                                                    <label className="text-sm font-medium text-gray-700">
                                                        Expiry Date <span className="text-red-500">*</span>
                                                    </label>
                                                    <input
                                                        type="date"
                                                        value={expiryDates[index] || ''}
                                                        onChange={(e) => setExpiryDates(prev => ({ ...prev, [index]: e.target.value }))}
                                                        disabled={isAdded}
                                                        min={new Date().toISOString().split('T')[0]}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-100"
                                                    />
                                                </div>

                                                {/* Pricing Fields */}
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="space-y-1">
                                                        <label className="text-sm font-medium text-gray-700">
                                                            Selling Price <span className="text-red-500">*</span>
                                                        </label>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            placeholder="₹0.00"
                                                            value={sellingPrices[index] || ''}
                                                            onChange={(e) => setSellingPrices(prev => ({ ...prev, [index]: e.target.value }))}
                                                            disabled={isAdded}
                                                            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-100"
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-sm font-medium text-gray-700">
                                                            Cost Price
                                                        </label>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            placeholder="₹0.00"
                                                            value={costPrices[index] || ''}
                                                            onChange={(e) => setCostPrices(prev => ({ ...prev, [index]: e.target.value }))}
                                                            disabled={isAdded}
                                                            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-100"
                                                        />
                                                    </div>
                                                </div>
                                            </motion.div>
                                        );
                                    })}
                                    <div className="pt-4 border-t border-gray-100 mt-4">
                                        <Button
                                            className="w-full"
                                            onClick={addAllToInventory}
                                            disabled={saving || results.every((_, idx) => !selectedItems[idx] || addedItems.has(idx))}
                                        >
                                            {saving ? (
                                                <>
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                                                </>
                                            ) : (
                                                <>
                                                    <Check className="mr-2 h-4 w-4" />
                                                    Add {results.filter((_, idx) => selectedItems[idx] && !addedItems.has(idx)).length} Selected to Inventory
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>

        </DashboardLayout >
    );
}
