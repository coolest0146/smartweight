import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core'; // Use @tauri-apps/api/tauri for Tauri v1
import { listen } from '@tauri-apps/api/event';

interface CameraFeedProps {
  streamName: string;
  url: string;
}

interface CameraFramePayload {
  stream: string;
  image_base64: string;
}

interface CameraStatusPayload {
  stream: string;
  connected: boolean;
  message: string;
}

export const CameraFeed: React.FC<CameraFeedProps> = ({ streamName, url }) => {
  const [frame, setFrame] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('Connecting...');
  const [isConnected, setIsConnected] = useState<boolean>(false);

  useEffect(() => {
    let unlistenFrame: (() => void) | null = null;
    let unlistenStatus: (() => void) | null = null;

    async function setupStream() {
      // 1. Listen for incoming video frames
      unlistenFrame = await listen<CameraFramePayload>('camera-frame', (event) => {
        if (event.payload.stream === streamName) {
          setFrame(event.payload.image_base64);
        }
      });

      // 2. Listen for status changes (Connected, Failed, Stopped)
      unlistenStatus = await listen<CameraStatusPayload>('camera-status', (event) => {
        if (event.payload.stream === streamName) {
          setIsConnected(event.payload.connected);
          setStatus(event.payload.message);
        }
      });

      // 3. Command the backend to start the ffmpeg process
      try {
        await invoke('start_camera_stream', { streamName, url });
      } catch (err) {
        setStatus(`Failed to start backend: ${err}`);
      }
    }

    setupStream();

    // Cleanup function: runs automatically when the component disappears
    return () => {
      // Remove Tauri event listeners
      if (unlistenFrame) unlistenFrame();
      if (unlistenStatus) unlistenStatus();

      // Tell backend to kill the ffmpeg stream instantly
      invoke('stop_camera_stream', { streamName }).catch((err) =>
        console.error('Error stopping stream:', err)
      );
    };
  }, [streamName, url]);

   return (
  <div className="flex flex-col border border-blue-500 bg-blue-200  overflow-hidden w-full h-full shadow-lg">
    {/* Stream Header */}
    <div className=" px-3 py-2 border-b border-blue-500 bg-blue-100 flex justify-between items-center">
      <h3 className="text-sm font-semibold text-blue-700 tracking-wider">{streamName}</h3>
      <span className={`text-xs px-2 py-0.5 rounded ${isConnected ? ' text-green-400' : ' text-red-400'}`}>
        {isConnected ? 'LIVE' : 'OFFLINE'}
      </span>
    </div>
    
    {/* Video Frame Canvas */}
    <div className="relative flex-1 bg-blue-200 flex items-center justify-center min-h-60 aspect-video">
      {isConnected && frame ? (
        <img 
          src={frame} 
          alt={streamName} 
          className="w-full h-full object-contain" 
        />
      ) : (
        <div className="text-center p-4">
          <p className="text-xs text-slate-400 max-w-xs wrap-break-word">{status}</p>
        </div>
      )}
    </div>
  </div>
);

};
