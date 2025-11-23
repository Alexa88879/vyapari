import { useState, useEffect } from "react";
import DashboardLayout from "../layouts/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Calculator, TrendingUp, TrendingDown, DollarSign, Calendar, Loader2 } from "lucide-react";
import { db } from "../lib/firebase";
import { collection, query, where, getDocs, orderBy, limit, Timestamp } from "firebase/firestore";
import { useAuth } from "../contexts/AuthContext";

export default function Accounting() {
    const [loading, setLoading] = useState(true);
    const [summary, setSummary] = useState({
        totalSales: 0,
        profit: 0,
        transactions: []
    });
    const { currentUser } = useAuth();

    useEffect(() => {
        if (currentUser) {
            fetchAccountingData();
        }
    }, [currentUser]);

    const fetchAccountingData = async () => {
        try {
            setLoading(true);
            
            // Fetch today's transactions
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const q = query(
                collection(db, "stores", currentUser.uid, "transactions"),
                where("timestamp", ">=", Timestamp.fromDate(today)),
                orderBy("timestamp", "desc")
            );
            const txnSnapshot = await getDocs(q);
            
            const transactions = txnSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                time: doc.data().timestamp?.toDate().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) || 'N/A'
            }));

            const totalSales = transactions.reduce((acc, curr) => acc + (curr.totalAmount || 0), 0);
            // Profit calculation needs cost price which might not be in transaction items yet
            // For now, we'll assume 20% margin if not available or calculate if cost is present
            const totalProfit = transactions.reduce((acc, curr) => {
                // If transaction has profit field, use it
                if (curr.profit) return acc + curr.profit;
                
                // Otherwise try to calculate from items
                if (curr.items) {
                    const txnProfit = curr.items.reduce((iAcc, item) => {
                        const cost = item.costPrice || (item.unitPrice * 0.8); // Fallback to 80% cost
                        return iAcc + ((item.unitPrice - cost) * item.quantity);
                    }, 0);
                    return acc + txnProfit;
                }
                
                return acc + (curr.totalAmount * 0.2); // Fallback 20% margin
            }, 0);

            setSummary({
                totalSales,
                profit: Math.round(totalProfit),
                transactions
            });

        } catch (error) {
            console.error("Accounting error", error);
            // Set empty state on error
            setSummary({
                totalSales: 0,
                profit: 0,
                transactions: []
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Daily Accounting</h1>
                        <p className="text-gray-600">Track your sales and profits.</p>
                    </div>
                    <div className="flex items-center text-gray-500 bg-white px-3 py-1 rounded-lg border border-gray-200">
                        <Calendar className="mr-2 h-4 w-4" />
                        <span className="text-sm font-medium">{new Date().toLocaleDateString()}</span>
                    </div>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Card>
                        <CardContent className="p-6 flex items-center">
                            <div className="p-3 rounded-full bg-green-100 text-green-600 mr-4">
                                <DollarSign className="h-6 w-6" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-600">Total Sales Today</p>
                                <p className="text-2xl font-bold text-gray-900">₹{summary.totalSales}</p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="p-6 flex items-center">
                            <div className="p-3 rounded-full bg-blue-100 text-blue-600 mr-4">
                                <TrendingUp className="h-6 w-6" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-600">Estimated Profit</p>
                                <p className="text-2xl font-bold text-gray-900">₹{summary.profit}</p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="p-6 flex items-center">
                            <div className="p-3 rounded-full bg-purple-100 text-purple-600 mr-4">
                                <Calculator className="h-6 w-6" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-600">Transactions</p>
                                <p className="text-2xl font-bold text-gray-900">{summary.transactions.length}</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Recent Transactions */}
                <Card>
                    <CardHeader>
                        <CardTitle>Recent Transactions</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div className="flex justify-center items-center h-32">
                                <Loader2 className="h-8 w-8 text-primary animate-spin" />
                            </div>
                        ) : summary.transactions.length === 0 ? (
                            <div className="text-center py-12 text-gray-500">
                                <p>No transactions recorded for today.</p>
                                <p className="text-sm mt-2">Sales data will appear here once you add transactions.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                                        <tr>
                                            <th className="px-6 py-3">Time</th>
                                            <th className="px-6 py-3">Items</th>
                                            <th className="px-6 py-3 text-right">Total</th>
                                            <th className="px-6 py-3 text-right">Profit</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {summary.transactions.map((txn) => (
                                            <tr key={txn.id} className="bg-white border-b hover:bg-gray-50">
                                                <td className="px-6 py-4 font-medium text-gray-900">{txn.time}</td>
                                                <td className="px-6 py-4 text-gray-600">
                                                    {txn.items?.map(i => `${i.quantity}x ${i.productName}`).join(", ") || "N/A"}
                                                </td>
                                                <td className="px-6 py-4 text-right font-medium">₹{txn.totalAmount || 0}</td>
                                                <td className="px-6 py-4 text-right text-green-600">
                                                    {/* Show profit if available, else estimate */}
                                                    +₹{Math.round(txn.profit || (txn.totalAmount * 0.2))}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </DashboardLayout>
    );
}
