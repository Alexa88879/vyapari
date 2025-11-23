import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import DashboardLayout from "../layouts/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { ScanLine, Plus, TrendingUp, Package, Loader2, Bell, CheckCircle, ExternalLink } from "lucide-react";
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

                        {/* Quick Actions */}
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                                
                                {/* Telegram Status Card */}
                                <Link to="/settings/telegram">
                                    <Card className={`hover:shadow-md transition-shadow cursor-pointer h-full border-2 ${telegramConnected ? 'border-green-100 bg-green-50' : 'border-indigo-100 bg-indigo-50'}`}>
                                        <CardContent className="flex flex-col items-center justify-center p-6 text-center space-y-3">
                                            <div className={`p-3 rounded-full ${telegramConnected ? 'bg-green-500' : 'bg-indigo-500'} text-white`}>
                                                <Bell className="h-6 w-6" />
                                            </div>
                                            <div>
                                                <span className="font-medium text-gray-900 block">Telegram Alerts</span>
                                                <span className={`text-xs font-medium ${telegramConnected ? 'text-green-600' : 'text-indigo-600'}`}>
                                                    {telegramConnected ? 'Connected' : 'Connect Now'}
                                                </span>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </Link>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </DashboardLayout>
    );
}
