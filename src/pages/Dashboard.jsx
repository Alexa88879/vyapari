import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import DashboardLayout from "../layouts/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { ScanLine, Plus, TrendingUp, Package, Loader2, Bell, CheckCircle, ExternalLink, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { db } from "../lib/firebase";
import { collection, getDocs, query, where, Timestamp, onSnapshot, doc, getDoc } from "firebase/firestore";

export default function Dashboard() {
    const { currentUser } = useAuth();
    const [loading, setLoading] = useState(true);
    const [userName, setUserName] = useState(currentUser?.displayName || "Shopkeeper");
    const [stats, setStats] = useState({
        totalItems: 0,
        totalStock: 0,
        lowStock: 0,
        todaysSales: 0
    });
    const [telegramConnected, setTelegramConnected] = useState(false);

    useEffect(() => {
        if (currentUser) {
            fetchDashboardStats();
            fetchUserName();
            
            // Check Telegram connection status
            const unsubscribeTelegram = onSnapshot(
                collection(db, 'stores', currentUser.uid, 'telegram', 'subscribers', 'users'),
                (snapshot) => {
                    setTelegramConnected(!snapshot.empty);
                }
            );
            
            return () => unsubscribeTelegram();
        }
    }, [currentUser]);

    const fetchUserName = async () => {
        if (currentUser?.displayName) {
            setUserName(currentUser.displayName);
            return;
        }

        try {
            const userDocRef = doc(db, "users", currentUser.uid);
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists() && userDoc.data().displayName) {
                setUserName(userDoc.data().displayName);
            } else if (currentUser.email) {
                // Fallback to email username if no display name found
                const emailName = currentUser.email.split('@')[0];
                setUserName(emailName.charAt(0).toUpperCase() + emailName.slice(1));
            }
        } catch (error) {
            console.error("Error fetching user name:", error);
        }
    };

    const fetchDashboardStats = async () => {
        try {
            setLoading(true);
            
            // Fetch inventory
            const inventorySnapshot = await getDocs(collection(db, "stores", currentUser.uid, "inventory"));
            const totalItems = inventorySnapshot.size;
            
            // Calculate total stock and low stock with backward compatibility
            const totalStock = inventorySnapshot.docs.reduce((sum, doc) => {
                const qty = doc.data().quantity || doc.data().qty || 0;
                return sum + qty;
            }, 0);
            
            const lowStockItems = inventorySnapshot.docs.filter(doc => {
                const qty = doc.data().quantity || doc.data().qty || 0;
                return qty < 10;
            }).length;

            // Fetch today's transactions
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const q = query(
                collection(db, "stores", currentUser.uid, "transactions"),
                where("timestamp", ">=", Timestamp.fromDate(today))
            );
            const txnSnapshot = await getDocs(q);
            const todaysSales = txnSnapshot.docs.reduce((sum, doc) => sum + (doc.data().totalAmount || 0), 0);

            setStats({
                totalItems,
                totalStock,
                lowStock: lowStockItems,
                todaysSales
            });
        } catch (error) {
            console.error("Failed to fetch dashboard stats:", error);
        } finally {
            setLoading(false);
        }
    };

    const statsDisplay = [
        { title: "Total Items", value: stats.totalItems.toString(), icon: Package, color: "text-blue-600", bg: "bg-blue-100" },
        { title: "Total Stock", value: stats.totalStock.toString(), icon: Package, color: "text-purple-600", bg: "bg-purple-100" },
        { title: "Low Stock", value: stats.lowStock.toString(), icon: TrendingUp, color: "text-red-600", bg: "bg-red-100" },
        { title: "Today's Sales", value: `₹${stats.todaysSales.toLocaleString()}`, icon: TrendingUp, color: "text-green-600", bg: "bg-green-100" },
    ];

    const quickActions = [
        { name: "Scan Inventory", href: "/inventory/scan", icon: ScanLine, color: "bg-primary" },
        { name: "Add Item", href: "/inventory/scan", icon: Plus, color: "bg-secondary" },
        { name: "Forecast Demand", href: "/forecast", icon: TrendingUp, color: "bg-purple-600" },
    ];

    return (
        <DashboardLayout>
            <div className="space-y-8">
                {/* Welcome Section */}
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">
                        Namaste, {userName}! 🙏
                    </h1>
                    <p className="text-gray-600 mt-1">Here's what's happening in your shop today.</p>
                </div>

                {loading ? (
                    <div className="flex justify-center items-center h-64">
                        <Loader2 className="h-12 w-12 text-primary animate-spin" />
                    </div>
                ) : (
                    <>
                        {/* Stats Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            {statsDisplay.map((stat) => (
                                <Card key={stat.title}>
                                    <CardContent className="flex items-center p-6">
                                        <div className={`p-3 rounded-full ${stat.bg} mr-4`}>
                                            <stat.icon className={`h-6 w-6 ${stat.color}`} />
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-gray-600">{stat.title}</p>
                                            <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>

                        {/* Telegram Alert Feature - Highlighted Section */}
                        <Card className={`overflow-hidden transition-all duration-300 ${
                            telegramConnected 
                                ? 'bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 shadow-lg' 
                                : 'bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 border-2 border-indigo-200 shadow-lg animate-pulse'
                        }`}>
                            <CardContent className="p-6">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start gap-4 flex-1">
                                        <div className={`p-4 rounded-2xl ${
                                            telegramConnected 
                                                ? 'bg-gradient-to-br from-green-500 to-emerald-600' 
                                                : 'bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600'
                                        } text-white shadow-lg relative`}>
                                            <Bell className="h-8 w-8" />
                                            {telegramConnected && (
                                                <div className="absolute -top-1 -right-1 bg-white rounded-full p-1">
                                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                                </div>
                                            )}
                                            {!telegramConnected && (
                                                <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping" />
                                            )}
                                        </div>
                                        <div className="flex-1">
                                            <h3 className="text-xl font-bold text-gray-900 mb-1">
                                                Telegram Alerts
                                            </h3>
                                            <p className="text-sm text-gray-600 mb-3">
                                                {telegramConnected 
                                                    ? '✅ You\'re receiving real-time notifications on Telegram!' 
                                                    : '🔔 Get instant alerts for low stock, expiring items & daily sales summaries'}
                                            </p>
                                            <div className="flex flex-wrap gap-2 mb-3">
                                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-white/80 text-gray-700 border border-gray-200">
                                                    📦 Low Stock Alerts
                                                </span>
                                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-white/80 text-gray-700 border border-gray-200">
                                                    ⏰ Expiry Warnings
                                                </span>
                                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-white/80 text-gray-700 border border-gray-200">
                                                    💰 Daily Sales Summary
                                                </span>
                                            </div>
                                            {telegramConnected ? (
                                                <div className="flex items-center gap-2 text-sm">
                                                    <div className="flex items-center gap-1.5 text-green-700 font-medium">
                                                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                                                        Active & Connected
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 text-sm">
                                                    <div className="flex items-center gap-1.5 text-orange-600 font-medium">
                                                        <AlertCircle className="w-4 h-4" />
                                                        Not Connected Yet
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <Link to="/settings/telegram">
                                        <Button 
                                            className={`${
                                                telegramConnected 
                                                    ? 'bg-green-600 hover:bg-green-700' 
                                                    : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:via-indigo-700 hover:to-purple-700 shadow-lg'
                                            } text-white font-semibold px-6 py-2.5 transition-all duration-200`}
                                        >
                                            {telegramConnected ? (
                                                <>
                                                    <CheckCircle className="w-4 h-4 mr-2" />
                                                    Manage Alerts
                                                </>
                                            ) : (
                                                <>
                                                    <ExternalLink className="w-4 h-4 mr-2" />
                                                    Connect Now
                                                </>
                                            )}
                                        </Button>
                                    </Link>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Quick Actions */}
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                {quickActions.map((action) => (
                                    <Link key={action.name} to={action.href}>
                                        <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                                            <CardContent className="flex flex-col items-center justify-center p-6 text-center space-y-3">
                                                <div className={`p-3 rounded-full ${action.color} text-white`}>
                                                    <action.icon className="h-6 w-6" />
                                                </div>
                                                <span className="font-medium text-gray-900">{action.name}</span>
                                            </CardContent>
                                        </Card>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </DashboardLayout>
    );
}
