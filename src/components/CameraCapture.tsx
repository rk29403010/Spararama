import React, { useState, useRef } from "react";
import { Camera, Upload, X, Loader2 } from "lucide-react";

interface CameraCaptureProps {
  onCapture: (base64Image: string) => void;
  onCancel: () => void;
  title: string;
}

export function CameraCapture({ onCapture, onCancel, title }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string>("");
  const [timer, setTimer] = useState<number | null>(null);

  React.useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  React.useEffect(() => {
    if (timer === null) return;
    if (timer > 0) {
      const id = setTimeout(() => setTimer(timer - 1), 1000);
      return () => clearTimeout(id);
    } else if (timer === 0) {
       // Beep when timer hits 0
       const ctx = new AudioContext();
       const osc = ctx.createOscillator();
       osc.connect(ctx.destination);
       osc.frequency.value = 880;
       osc.start();
       setTimeout(() => osc.stop(), 500);
       setTimer(null);
    }
  }, [timer]);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: "environment" } 
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err: any) {
      setError("Unable to access camera: " + err.message);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const handleCapture = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0);
    const base64 = canvas.toDataURL("image/jpeg", 0.8);
    onCapture(base64);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      onCapture(result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col">
      <div className="flex justify-between items-center p-4 bg-slate-800 text-white">
        <h2 className="text-lg font-medium">{title}</h2>
        <button onClick={onCancel} className="p-2 bg-slate-700 rounded-full hover:bg-slate-600 transition-colors">
          <X className="w-5 h-5 text-white" />
        </button>
      </div>
      
      <div className="flex-1 relative bg-black flex flex-col items-center justify-center">
        {error ? (
          <div className="p-6 text-center text-red-400">
            <p>{error}</p>
            <label className="mt-6 inline-flex items-center gap-2 px-6 py-3 bg-slate-800 rounded-lg text-white font-medium cursor-pointer">
              <Upload className="w-5 h-5" />
              Upload Photo Instead
              <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            </label>
          </div>
        ) : (
          <>
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              className="w-full h-full object-cover"
            />
            
            {title.includes("Strip") && (
              <div className="absolute top-8 left-0 right-0 flex justify-center">
                <button 
                  onClick={() => setTimer(15)}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-full shadow-lg font-medium"
                >
                  {timer !== null ? `Read in ${timer}s` : "Start 15s Timer (Dip Now!)"}
                </button>
              </div>
            )}

            <div className="absolute bottom-8 left-0 right-0 flex justify-center items-center gap-8">
               <label className="p-4 bg-slate-800/80 rounded-full cursor-pointer hover:bg-slate-700 transition-colors text-white">
                <Upload className="w-6 h-6" />
                <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              </label>
              
              <button 
                onClick={handleCapture}
                className="w-20 h-20 bg-white rounded-full border-4 border-slate-300 flex items-center justify-center shadow-lg active:scale-95 transition-transform"
              >
                <div className="w-16 h-16 rounded-full border-2 border-slate-400" />
              </button>
              
              <div className="w-14" /> {/* Spacer for centering */}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
