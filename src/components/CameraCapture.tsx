import React, { useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';

interface CameraCaptureProps {
  onCapture: (base64Image: string) => void;
  onCancel: () => void;
  title: string;
}

export function CameraCapture({ onCapture, onCancel, title }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState('');

  React.useEffect(() => {
    void startCamera();
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      setStream(mediaStream);
      if (videoRef.current) videoRef.current.srcObject = mediaStream;
    } catch (err: any) {
      setError(`Camera unavailable: ${err.message}`);
    }
  };

  const stopCamera = () => {
    if (!stream) return;
    stream.getTracks().forEach(track => track.stop());
    setStream(null);
  };

  const handleCapture = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0);
    onCapture(canvas.toDataURL('image/jpeg', 0.8));
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = loadEvent => onCapture(loadEvent.target?.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col overscroll-contain">
      <header className="flex justify-between items-center gap-4 p-4 bg-slate-950 text-white">
        <h2 className="text-xl font-black truncate">{title}</h2>
        <button type="button" aria-label="Close camera" onClick={onCancel} className="w-12 h-12 shrink-0 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors">
          <X className="w-6 h-6" aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 relative bg-black flex flex-col items-center justify-center overflow-hidden">
        {error ? (
          <div role="alert" className="p-6 text-center text-white max-w-sm">
            <p className="text-lg font-bold">{error}</p>
            <label className="mt-6 min-h-14 inline-flex items-center gap-2 px-6 bg-white text-slate-950 rounded-2xl font-black cursor-pointer">
              <Upload className="w-5 h-5" aria-hidden="true" />
              Choose photo
              <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            </label>
          </div>
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />

            <div className="absolute bottom-[max(2rem,env(safe-area-inset-bottom))] left-0 right-0 flex justify-center items-center gap-8 px-6">
              <label aria-label="Choose photo" title="Choose photo" className="w-14 h-14 bg-slate-950/80 rounded-full cursor-pointer hover:bg-slate-900 transition-colors text-white flex items-center justify-center">
                <Upload className="w-6 h-6" aria-hidden="true" />
                <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              </label>

              <button type="button" aria-label="Take photo" onClick={handleCapture} className="w-20 h-20 bg-white rounded-full border-4 border-white/70 flex items-center justify-center shadow-lg active:scale-95 transition-transform">
                <span className="w-14 h-14 rounded-full border-4 border-slate-800" aria-hidden="true" />
              </button>

              <div className="w-14" aria-hidden="true" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
