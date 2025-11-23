import { useState, useEffect } from "react";
import DashboardLayout from "../layouts/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Plus, Search, Edit2, Trash2, X, Save, Lightbulb } from "lucide-react";
import { db } from "../lib/firebase";
import { collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, where, getDocs } from "firebase/firestore";
import { useAuth } from "../contexts/AuthContext";
import { motion, AnimatePresence } from "framer-motion";

export default function Inventory() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const { currentUser } = useAuth();

    // Form State
    const [formData, setFormData] = useState({
        name: "",
        sku: "",
        quantity: "",
        unitPrice: "",
        costPrice: ""
    });

    useEffect(() => {
        if (!currentUser) return;

        const q = query(collection(db, "stores", currentUser.uid, "inventory"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const inventoryData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setItems(inventoryData);
            setLoading(false);
        }, (error) => {
            console.error("Inventory fetch error:", error);
            setLoading(false);
            alert("Error fetching inventory: " + error.message);
        });

        return unsubscribe;
    }, [currentUser]);

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

    const handleSave = async (e) => {
        e.preventDefault();
        try {
            if (editingItem) {
                // Editing existing item - update as before
                const itemData = {
                    ...formData,
                    quantity: Number(formData.quantity),
                    nameLower: formData.name.toLowerCase().trim(),
                    unitPrice: Number(formData.unitPrice),
                    costPrice: Number(formData.costPrice),
                    lastUpdated: serverTimestamp()
                };
                await updateDoc(doc(db, "stores", currentUser.uid, "inventory", editingItem.id), itemData);
            } else {
                // Adding new item - check for duplicates
                const existing = await findExistingProduct(formData.name);
                
                if (existing) {
                    // Ask user if they want to update quantity
                    const currentQty = existing.quantity || existing.qty || 0;
                    const confirm = window.confirm(
                        `Product "${formData.name}" already exists with quantity ${currentQty}. ` +
                        `Do you want to add ${formData.quantity} more to it?`
                    );
                    
                    if (confirm) {
                        const newQuantity = currentQty + Number(formData.quantity);
                        await updateDoc(
                            doc(db, "stores", currentUser.uid, "inventory", existing.id),
                            { 
                                quantity: newQuantity,
                                lastUpdated: serverTimestamp()
                            }
                        );
                    } else {
                        return; // User cancelled
                    }
                } else {
                    // Create new product
                    const itemData = {
                        ...formData,
                        quantity: Number(formData.quantity),
                        nameLower: formData.name.toLowerCase().trim(),
                        unitPrice: Number(formData.unitPrice),
                        costPrice: Number(formData.costPrice),
                        createdAt: serverTimestamp()
                    };
                    await addDoc(collection(db, "stores", currentUser.uid, "inventory"), itemData);
                }
            }

            closeModal();
        } catch (error) {
            console.error("Error saving item:", error);
            alert("Failed to save item");
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm("Are you sure you want to delete this item?")) {
            try {
                await deleteDoc(doc(db, "stores", currentUser.uid, "inventory", id));
            } catch (error) {
                console.error("Error deleting item:", error);
            }
        }
    };

    const openModal = (item = null) => {
        if (item) {
            setEditingItem(item);
            setFormData({
                name: item.name,
                sku: item.sku || "",
                quantity: item.quantity || item.qty || 0,
                unitPrice: item.unitPrice,
                costPrice: item.costPrice || ""
            });
        } else {
            setEditingItem(null);
            setFormData({
                name: "",
                sku: "",
                quantity: "",
                unitPrice: "",
                costPrice: ""
            });
        }
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingItem(null);
    };

    const filteredItems = items.filter(item =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.sku?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
                        <p className="text-gray-600">Manage your products and stock levels.</p>
                    </div>
                    <Button onClick={() => openModal()}>
                        <Plus className="mr-2 h-4 w-4" /> Add New Item
                    </Button>
                </div>

                {/* Search Bar */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                    <input
                        type="text"
                        placeholder="Search by name or SKU..."
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                {/* Inventory List */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {loading ? (
                        <p>Loading inventory...</p>
                    ) : filteredItems.length === 0 ? (
                        <div className="col-span-full text-center py-12 text-gray-500">
                            No items found. Add your first item!
                        </div>
                    ) : (
                        filteredItems.map((item) => {
                            const displayQty = item.quantity || item.qty || 0;
                            return (
                            <Card key={item.id} className="hover:shadow-md transition-shadow">
                                <CardContent className="p-5">
                                    <div className="flex justify-between items-start mb-2">
                                        <div>
                                            <h3 className="font-semibold text-lg text-gray-900">{item.name}</h3>
                                            <p className="text-sm text-gray-500">SKU: {item.sku || "N/A"}</p>
                                        </div>
                                        <div className={`px-2 py-1 rounded text-xs font-medium ${displayQty < 10 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                                            {displayQty} in stock
                                        </div>
                                    </div>

                                    <div className="flex justify-between items-end mt-4">
                                        <div>
                                            <p className="text-xs text-gray-500">Selling Price</p>
                                            <p className="font-bold text-primary">₹{item.unitPrice}</p>
                                        </div>
                                        <div className="flex space-x-2">
                                            <Button variant="ghost" size="sm" onClick={() => openModal(item)} className="h-8 w-8 p-0">
                                                <Edit2 className="h-4 w-4 text-blue-600" />
                                            </Button>
                                            <Button variant="ghost" size="sm" onClick={() => handleDelete(item.id)} className="h-8 w-8 p-0">
                                                <Trash2 className="h-4 w-4 text-red-600" />
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        )})
                    )}
                </div>

                {/* Add/Edit Modal */}
                <AnimatePresence>
                    {isModalOpen && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
                            >
                                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                                    <h3 className="text-lg font-semibold text-gray-900">
                                        {editingItem ? "Edit Item" : "Add New Item"}
                                    </h3>
                                    <button onClick={closeModal} className="text-gray-400 hover:text-gray-500">
                                        <X className="h-5 w-5" />
                                    </button>
                                </div>

                                <form onSubmit={handleSave} className="p-6 space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Item Name</label>
                                        <input
                                            type="text"
                                            required
                                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary focus:border-primary"
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">SKU (Optional)</label>
                                            <input
                                                type="text"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary focus:border-primary"
                                                value={formData.sku}
                                                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                                            <input
                                                type="number"
                                                required
                                                min="0"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary focus:border-primary"
                                                value={formData.quantity}
                                                onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Selling Price (₹)</label>
                                            <input
                                                type="number"
                                                required
                                                min="0"
                                                step="0.01"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary focus:border-primary"
                                                value={formData.unitPrice}
                                                onChange={(e) => setFormData({ ...formData, unitPrice: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Cost Price (₹)</label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary focus:border-primary"
                                                value={formData.costPrice}
                                                onChange={(e) => setFormData({ ...formData, costPrice: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div className="pt-4 flex justify-end space-x-3">
                                        <Button type="button" variant="ghost" onClick={closeModal}>Cancel</Button>
                                        <Button type="submit">
                                            <Save className="mr-2 h-4 w-4" /> Save Item
                                        </Button>
                                    </div>
                                </form>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>
            </div>
        </DashboardLayout>
    );
}
