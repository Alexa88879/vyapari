import { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, X, RefreshCw, Loader2, SwitchCamera } from 'lucide-react';
import { Button } from './ui/Button';

/**
 * Modern Barcode Scanner Component - Inline Version
 * Features:
 * - Auto camera permission request
 * - Defaults to back camera
 * - Inline UI (not fullscreen)
 * - Professional camera controls
 * - Camera switching
 * - Auto-restart on navigation return
 */
export default function BarcodeScanner({ onScan, onClose, isOpen, isScanning: isScanningProp }) {
  const [scannerState, setScannerState] = useState('IDLE'); // IDLE, INITIALIZING, READY, ERROR
  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [error, setError] = useState('');
  const scannerRef = useRef(null);
  const containerRef = useRef(null);
  const isInitializing = useRef(false);
  const initTimeout = useRef(null);
  const isScanningRef = useRef(isScanningProp);

  // Update ref when prop changes
  useEffect(() => {
    isScanningRef.current = isScanningProp;
  }, [isScanningProp]);

  // Initialize scanner with delay to ensure DOM is ready
  const initializeScanner = async () => {
    if (isInitializing.current) return;
    
    // Wait for DOM to be ready
    if (!containerRef.current) {
      console.log('Container not ready, retrying...');
      initTimeout.current = setTimeout(initializeScanner, 100);
      return;
    }

    isInitializing.current = true;

    try {
      setScannerState('INITIALIZING');
      setError('');

      // Get available cameras
      const availableCameras = await Html5Qrcode.getCameras();
      
      if (!availableCameras || availableCameras.length === 0) {
        throw new Error('No cameras found');
      }

      setCameras(availableCameras);

      // Select back camera by default (or first camera)
      const backCamera = availableCameras.find(cam => {
        const label = cam.label.toLowerCase();
        return label.includes('back') || label.includes('rear') || label.includes('environment');
      });
      
      const cameraToUse = backCamera || availableCameras[0];
      setSelectedCamera(cameraToUse);

      // Create scanner instance
      const scanner = new Html5Qrcode('barcode-scanner-reader');
      scannerRef.current = scanner;

      // Start scanning with selected camera
      await scanner.start(
        cameraToUse.id,
        {
          fps: 10,
          qrbox: { width: 200, height: 200 },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          // Success callback - only process if scanning is enabled
          if (onScan && isScanningRef.current !== false) {
            onScan(decodedText);
          }
        },
        (errorMessage) => {
          // Error callback (mostly scanning errors, can be ignored)
          console.debug('Scan error:', errorMessage);
        }
      );

      setScannerState('READY');
    } catch (err) {
      console.error('Scanner initialization error:', err);
      setError(err.message || 'Failed to access camera');
      setScannerState('ERROR');
    } finally {
      isInitializing.current = false;
    }
  };

  // Switch camera
  const switchCamera = async () => {
    if (!scannerRef.current || cameras.length <= 1) return;

    try {
      // Find next camera
      const currentIndex = cameras.findIndex(cam => cam.id === selectedCamera?.id);
      const nextIndex = (currentIndex + 1) % cameras.length;
      const nextCamera = cameras[nextIndex];

      // Stop current scanner
      await scannerRef.current.stop();
      
      // Start with new camera
      await scannerRef.current.start(
        nextCamera.id,
        {
          fps: 10,
          qrbox: { width: 200, height: 200 },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          if (onScan && isScanningRef.current !== false) {
            onScan(decodedText);
          }
        },
        (errorMessage) => {
          console.debug('Scan error:', errorMessage);
        }
      );

      setSelectedCamera(nextCamera);
    } catch (err) {
      console.error('Camera switch error:', err);
      setError('Failed to switch camera');
    }
  };

  // Cleanup on unmount or close
  const cleanup = async () => {
    if (initTimeout.current) {
      clearTimeout(initTimeout.current);
    }
    
    if (scannerRef.current) {
      try {
        const state = await scannerRef.current.getState();
        if (state === 2) { // Scanner is running
          await scannerRef.current.stop();
        }
        await scannerRef.current.clear();
      } catch (err) {
        console.error('Cleanup error:', err);
      }
      scannerRef.current = null;
    }
    
    isInitializing.current = false;
    setScannerState('IDLE');
  };

  // Handle close
  const handleClose = async () => {
    await cleanup();
    if (onClose) {
      onClose();
    }
  };

  // Initialize when opened
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure DOM is rendered
      initTimeout.current = setTimeout(initializeScanner, 300);
    } else {
      cleanup();
    }

    return () => {
      if (initTimeout.current) {
        clearTimeout(initTimeout.current);
      }
      cleanup();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div ref={containerRef} className="w-full space-y-3">
      {/* Inline styles to ensure video fills container properly */}
      <style>{`
        #barcode-scanner-reader video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
        }
        #barcode-scanner-reader {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
        }
      `}</style>
      {/* Scanner Status - Compact Header */}
      <div className="bg-gradient-to-r from-indigo-500 to-purple-500 rounded-lg p-3 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5" />
            <div>
              <h3 className="font-semibold text-sm">Scanner</h3>
            </div>
          </div>
          
          <Button
            onClick={handleClose}
            variant="secondary"
            size="sm"
            className="h-7 w-7 p-0 bg-white/20 hover:bg-white/30 text-white border-white/30 rounded-full"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Camera Preview Area - Always Rendered */}
      <div className="relative rounded-lg overflow-hidden shadow-md border border-indigo-200 bg-black aspect-[4/3]">
        {/* The actual scanner element - MUST BE PRESENT for library to attach */}
        <div id="barcode-scanner-reader" className="w-full h-full"></div>

        {/* Overlays based on state */}
        {scannerState === 'INITIALIZING' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 z-10">
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-2" />
            <p className="text-gray-900 text-sm font-medium">Starting camera...</p>
          </div>
        )}

        {scannerState === 'ERROR' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-50 z-10">
            <X className="w-8 h-8 text-red-500 mb-2" />
            <p className="text-gray-900 text-sm font-semibold mb-1">Camera Error</p>
            <p className="text-gray-600 text-xs text-center mb-3 px-4">
              {error || 'Check permissions'}
            </p>
            <Button onClick={initializeScanner} size="sm" className="bg-indigo-600 hover:bg-indigo-700">
              <RefreshCw className="w-3 h-3 mr-2" />
              Retry
            </Button>
          </div>
        )}
        
        {scannerState === 'READY' && (
          <div className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1 backdrop-blur-sm z-10 ${
            isScanningProp === false ? 'bg-yellow-500/90 text-white' : 'bg-green-500/90 text-white'
          }`}>
            <span className={`w-1.5 h-1.5 bg-white rounded-full ${isScanningProp !== false ? 'animate-pulse' : ''}`}></span>
            {isScanningProp === false ? 'Paused' : 'Active'}
          </div>
        )}
      </div>

      {/* Controls - Centered and Consistent */}
      <div className="flex flex-col gap-2 items-center">
        {cameras.length > 1 && (
          <Button
            onClick={switchCamera}
            className="w-full max-w-xs bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 h-9 text-sm"
            variant="secondary"
            disabled={scannerState !== 'READY'}
          >
            <SwitchCamera className="w-4 h-4 mr-2" />
            Switch Camera
          </Button>
        )}
        
        <Button
          onClick={handleClose}
          variant="destructive"
          className="w-full max-w-xs h-9 text-sm"
        >
          <X className="w-4 h-4 mr-2" />
          Stop Scanner
        </Button>
      </div>
    </div>
  );
}
