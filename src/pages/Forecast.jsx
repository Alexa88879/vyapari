import { useState, useEffect } from "react";
import DashboardLayout from "../layouts/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { TrendingUp, AlertTriangle, Lightbulb, Loader2, Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { db } from "../lib/firebase";
import { collection, getDocs, addDoc, Timestamp, query, orderBy, limit } from "firebase/firestore";
import { useAuth } from "../contexts/AuthContext";

export default function Forecast() {
    const [loading, setLoading] = useState(true);
    const [forecast, setForecast] = useState(null);
    const [forecasts, setForecasts] = useState([]);
    const [selectedForecastIndex, setSelectedForecastIndex] = useState(0);
    const [showHistory, setShowHistory] = useState(false);
    const { currentUser } = useAuth();

    useEffect(() => {
        if (currentUser) {
            loadForecasts();
        }
    }, [currentUser]);

    const loadForecasts = async () => {
        try {
            setLoading(true);
            const q = query(
                collection(db, "stores", currentUser.uid, "forecasts"),
                orderBy("timestamp", "desc"),
                limit(10)
            );
            const snapshot = await getDocs(q);
            const loadedForecasts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            setForecasts(loadedForecasts);
            
            if (loadedForecasts.length > 0) {
                setForecast(loadedForecasts[0].data);
                setSelectedForecastIndex(0);
            } else {
                generateForecast();
            }
        } catch (error) {
            console.error("Failed to load forecasts:", error);
            generateForecast();
        } finally {
            setLoading(false);
        }
    };

    const generateForecast = async () => {
        try {
            setLoading(true);
            // Fetch current inventory
            const snapshot = await getDocs(collection(db, "stores", currentUser.uid, "inventory"));
            const inventory = snapshot.docs.map(doc => ({ name: doc.data().name, qty: doc.data().qty }));

            if (inventory.length === 0) {
                const emptyForecast = {
                    highDemand: [],
                    lowRotation: [],
                    suggestions: ["Add items to your inventory to get a forecast!"]
                };
                setForecast(emptyForecast);
                setLoading(false);
                return;
            }

            // Call Cloud Function
            const response = await fetch("/forecast", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    inventory,
                    season: "Summer",
                    date: new Date().toLocaleDateString()
                })
            });

            if (!response.ok) {
                throw new Error(`Forecast API failed with status ${response.status}`);
            }

            const data = await response.json();
            const forecastData = data.data;
            setForecast(forecastData);

            // Save to Firestore
            await addDoc(collection(db, "stores", currentUser.uid, "forecasts"), {
                timestamp: Timestamp.now(),
                forecastPeriod: "Next 30 days",
                data: forecastData,
                aiModelVersion: "gemini-2.5-flash",
                userId: currentUser.uid
            });

            // Reload forecasts
            loadForecasts();

        } catch (error) {
            console.error("Forecast error", error);
            setForecast({
                highDemand: [],
                lowRotation: [],
                suggestions: [`Error: ${error.message}. Please try again later.`]
            });
        } finally {
            setLoading(false);
        }
    };

    const viewForecast = (index) => {
        setSelectedForecastIndex(index);
        setForecast(forecasts[index].data);
        setShowHistory(false);
    };

    const navigateForecast = (direction) => {
        const newIndex = direction === 'next' ? selectedForecastIndex + 1 : selectedForecastIndex - 1;
        if (newIndex >= 0 && newIndex < forecasts.length) {
            viewForecast(newIndex);
        }
    };

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Demand Forecast</h1>
                        <p className="text-gray-600">AI-powered predictions for your shop.</p>
                        {forecasts.length > 0 && (
                            <p className="text-sm text-gray-500 mt-1">
                                Viewing forecast from {forecasts[selectedForecastIndex]?.timestamp?.toDate().toLocaleString()}
                            </p>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={() => setShowHistory(!showHistory)} variant="secondary">
                            <Calendar className="mr-2 h-4 w-4" />
                            {showHistory ? 'Hide History' : 'View History'}
                        </Button>
                        <Button onClick={generateForecast} disabled={loading}>
                            <TrendingUp className="mr-2 h-4 w-4" />
                            Generate New
                        </Button>
                    </div>
                </div>

                {/* History View */}
                {showHistory && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Forecast History</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-2">
                                {forecasts.map((f, index) => (
                                    <button
                                        key={f.id}
                                        onClick={() => viewForecast(index)}
                                        className={`w-full text-left p-3 rounded-lg border transition-colors ${
                                            index === selectedForecastIndex
                                                ? 'border-primary bg-orange-50'
                                                : 'border-gray-200 hover:border-gray-300'
                                        }`}
                                    >
                                        <p className="font-medium text-gray-900">
                                            {f.timestamp?.toDate().toLocaleDateString()} at {f.timestamp?.toDate().toLocaleTimeString()}
                                        </p>
                                        <p className="text-sm text-gray-600">{f.forecastPeriod || 'Next 30 days'}</p>
                                    </button>
                                ))}
                                {forecasts.length === 0 && (
                                    <p className="text-center text-gray-500 py-4">No forecast history yet.</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Navigation */}
                {forecasts.length > 1 && !showHistory && (
                    <div className="flex justify-between items-center">
                        <Button
                            onClick={() => navigateForecast('prev')}
                            disabled={selectedForecastIndex === 0}
                            variant="secondary"
                        >
                            <ChevronLeft className="h-4 w-4 mr-2" />
                            Previous
                        </Button>
                        <span className="text-sm text-gray-600">
                            {selectedForecastIndex + 1} of {forecasts.length}
                        </span>
                        <Button
                            onClick={() => navigateForecast('next')}
                            disabled={selectedForecastIndex === forecasts.length - 1}
                            variant="secondary"
                        >
                            Next
                            <ChevronRight className="h-4 w-4 ml-2" />
                        </Button>
                    </div>
                )}

                {loading ? (
                    <div className="flex flex-col items-center justify-center h-64 space-y-4">
                        <Loader2 className="h-12 w-12 text-primary animate-spin" />
                        <p className="text-gray-500">Analyzing market trends and inventory...</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* High Demand */}
                        <Card className="border-l-4 border-l-green-500">
                            <CardHeader>
                                <CardTitle className="flex items-center text-green-700">
                                    <TrendingUp className="mr-2 h-5 w-5" /> Likely High Demand
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ul className="space-y-2">
                                    {forecast?.highDemand.map((item, i) => (
                                        <li key={i} className="flex items-center bg-green-50 p-2 rounded text-green-800">
                                            <span className="font-medium">{item}</span>
                                        </li>
                                    ))}
                                    {forecast?.highDemand.length === 0 && <p className="text-gray-500">No high demand items predicted.</p>}
                                </ul>
                            </CardContent>
                        </Card>

                        {/* Low Rotation */}
                        <Card className="border-l-4 border-l-red-500">
                            <CardHeader>
                                <CardTitle className="flex items-center text-red-700">
                                    <AlertTriangle className="mr-2 h-5 w-5" /> Low Rotation Risk
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ul className="space-y-2">
                                    {forecast?.lowRotation.map((item, i) => (
                                        <li key={i} className="flex items-center bg-red-50 p-2 rounded text-red-800">
                                            <span className="font-medium">{item}</span>
                                        </li>
                                    ))}
                                    {forecast?.lowRotation.length === 0 && <p className="text-gray-500">No slow moving items detected.</p>}
                                </ul>
                            </CardContent>
                        </Card>

                        {/* Suggestions */}
                        <Card className="md:col-span-2 border-l-4 border-l-purple-500">
                            <CardHeader>
                                <CardTitle className="flex items-center text-purple-700">
                                    <Lightbulb className="mr-2 h-5 w-5" /> AI Suggestions
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid gap-4">
                                    {forecast?.suggestions.map((suggestion, i) => (
                                        <div key={i} className="flex items-start p-3 bg-purple-50 rounded-lg">
                                            <div className="flex-shrink-0 mt-0.5">
                                                <div className="h-2 w-2 rounded-full bg-purple-500"></div>
                                            </div>
                                            <p className="ml-3 text-purple-900">{suggestion}</p>
                                        </div>
                                    ))}
                                    {forecast?.suggestions.length === 0 && <p className="text-gray-500">No suggestions available.</p>}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
